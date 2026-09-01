import { z } from 'zod';
import type { AgentStudioDocument } from './types';
import { readStudioValue, resolveStudioMapping, writeStudioValue } from './data-mapping';

export const StudioFlowInputMappingsSchema = z.array(z.object({
  inputKey: z.string().min(1).max(200), sourceType: z.enum(['variable', 'current', 'input', 'static']),
  sourcePath: z.string().max(4000), valueType: z.enum(['text', 'number', 'boolean', 'json']).optional(),
})).max(100);
export type StudioFlowInputMapping = z.infer<typeof StudioFlowInputMappingsSchema>[number];

export function studioFlowInputs(document: AgentStudioDocument) {
  const entries: Array<{ key: string; label: string; required: boolean }> = [];
  const field = (value: AgentStudioDocument['understandStage']['initialFields'][number]) => {
    if (value.reuseFrom?.sourceType === 'flow_input') entries.push({ key: value.reuseFrom.sourceValue, label: value.name, required: false });
  };
  if (document.understandStage.askInitialData) document.understandStage.initialFields.forEach(field);
  for (const procedure of document.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived')) for (const step of procedure.steps) {
    if (step.collectField) field(step.collectField);
    for (const mapping of [...(step.httpRequest?.sentDataMappings || []), ...(step.nativeDataMappings || [])]) if (mapping.sourceType === 'flow_input') entries.push({ key: mapping.sourceValue, label: `${step.title} · ${mapping.apiField}`, required: true });
    for (const mapping of step.mcpTool?.argumentMappings || []) if (mapping.sourceType === 'flow_input') entries.push({ key: mapping.sourceChipKey, label: `${step.title} · ${mapping.sourceChipLabel || mapping.argumentName}`, required: true });
  }
  const unique = new Map<string, typeof entries[number]>();
  for (const entry of entries) unique.set(entry.key, { ...entry, required: entry.required || Boolean(unique.get(entry.key)?.required) });
  return [...unique.values()];
}

export function studioFlowOutputs(document: AgentStudioDocument) {
  const fields = [...(document.understandStage.askInitialData ? document.understandStage.initialFields : []).map((field) => ({ key: field.variableKey, label: field.name, sensitive: field.isSensitive })),
    ...document.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps.flatMap((step) => [
      ...(step.collectField ? [{ key: step.collectField.variableKey, label: step.collectField.name, sensitive: step.collectField.isSensitive }] : []),
      ...(step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []).map((output) => ({ key: output.chipKey, label: output.chipLabel, sensitive: Boolean(output.sensitive) })),
    ]))];
  return [...new Map(fields.map((field) => [field.key, field])).values()];
}

/** Validate the fixed release's contract without looking up any customer values. */
export function validateStudioFlowBindings(document: AgentStudioDocument, mappings: unknown, outputKeys: unknown = []) {
  const parsed = StudioFlowInputMappingsSchema.parse(mappings ?? []);
  const contract = studioFlowInputs(document);
  const allowed = new Set(contract.map((field) => field.key));
  const destinations: Record<string, unknown> = {};
  for (const mapping of parsed) {
    if (!allowed.has(mapping.inputKey)) throw new Error('Este dado de entrada não é autorizado pela versão do agente.');
    writeStudioValue(destinations, mapping.inputKey, true); // Also rejects duplicate/overlapping destinations when sources are missing.
    if (mapping.sourceType === 'static') resolveStudioMapping({ sourceType: 'static_value', sourceValue: mapping.sourcePath, valueType: mapping.valueType }, { values: {} });
    else readStudioValue({}, mapping.sourcePath);
  }
  for (const field of contract.filter((field) => field.required)) {
    if (!parsed.some((mapping) => mapping.inputKey === field.key)) throw new Error(`Mapeie o dado obrigatório “${field.label}” antes de usar este agente.`);
  }
  const outputs = z.array(z.string().min(1).max(200)).max(100).parse(outputKeys ?? []);
  const allowedOutputs = new Set(studioFlowOutputs(document).map((field) => field.key));
  if (new Set(outputs).size !== outputs.length || outputs.some((key) => !allowedOutputs.has(key))) throw new Error('Um dado de saída não é autorizado pela versão do agente ou está duplicado.');
  return { mappings: parsed, outputKeys: outputs };
}

export function mapStudioFlowInputs(document: AgentStudioDocument, mappings: unknown, source: { variables: Record<string, unknown>; current: Record<string, unknown>; input: Record<string, unknown> }) {
  const result: Record<string, unknown> = {};
  for (const mapping of validateStudioFlowBindings(document, mappings).mappings) {
    const value = mapping.sourceType === 'static' ? resolveStudioMapping({ sourceType: 'static_value', sourceValue: mapping.sourcePath, valueType: mapping.valueType }, { values: {} })
      : readStudioValue(mapping.sourceType === 'variable' ? source.variables : source[mapping.sourceType], mapping.sourcePath);
    if (value === undefined) continue; // Optional reuse can still ask the customer; action mappings validate at their execution point.
    writeStudioValue(result, mapping.inputKey, value);
  }
  return result;
}
