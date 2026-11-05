import { z } from 'zod';
import type { AgentReleaseManifest } from './types';
import { readStudioValue, resolveStudioMapping, writeStudioValue } from './data-mapping';
import { StudioFlowInputMappingsSchema } from './flow-inputs';

export const StudioFlowFieldSchema = z.object({
  key: z.string().trim().min(1).max(200).regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/, 'Use um caminho como cliente.nome.'),
  label: z.string().trim().min(1).max(200),
  type: z.enum(['text', 'number', 'boolean', 'json']).default('text'),
  required: z.boolean().default(false),
  sensitive: z.boolean().default(false),
});
export const StudioFlowContractSchema = z.object({
  enabled: z.boolean().default(false),
  modes: z.array(z.enum(['conversation', 'task'])).max(2).default(['conversation', 'task']),
  inputs: z.array(StudioFlowFieldSchema).max(100).default([]),
  outputs: z.array(StudioFlowFieldSchema).max(100).default([]),
  exposedProcedureIds: z.array(z.string().min(1)).max(100).default([]),
  extensions: z.array(z.enum(['model', 'tools', 'knowledge', 'memory'])).max(4).default([]),
  completionCriteria: z.string().trim().max(4000).default(''),
  maxModelCalls: z.number().int().min(1).max(16).default(8),
  maxToolCalls: z.number().int().min(0).max(50).default(20),
  timeoutMs: z.number().int().min(1000).max(180000).default(90000),
}).superRefine((contract, context) => {
  if (contract.enabled && !contract.modes.length) context.addIssue({ code: 'custom', path: ['modes'], message: 'Selecione ao menos um modo de execução.' });
  for (const name of ['inputs', 'outputs'] as const) {
    const record: Record<string, unknown> = {};
    contract[name].forEach((field, index) => {
      try { writeStudioValue(record, field.key, true); }
      catch { context.addIssue({ code: 'custom', path: [name, index, 'key'], message: 'Campos duplicados ou caminhos incompatíveis.' }); }
    });
  }
});
export type StudioFlowContract = z.infer<typeof StudioFlowContractSchema>;
export type StudioFlowField = z.infer<typeof StudioFlowFieldSchema>;

export const STUDIO_FLOW_NODE_TYPES = ['ai.studio_agent', 'integration.studio_procedure', 'tool.studio_agent', 'tool.studio_procedure'] as const;
export function isStudioFlowNode(type: string) { return (STUDIO_FLOW_NODE_TYPES as readonly string[]).includes(type); }

export type StudioFlowReleaseSummary = {
  agentId: string; agentName: string; releaseId: string; version: number;
  contract: StudioFlowContract;
  procedures: Array<{ id: string; name: string; description: string }>;
  testOperations?: Array<{ id: string; label: string }>;
};

export function publishedStudioFlowContract(release: AgentReleaseManifest): StudioFlowContract {
  const parsed = StudioFlowContractSchema.safeParse(release.flowContract);
  if (!parsed.success || !parsed.data.enabled) throw new Error('Esta versão não permite composição. Habilite Uso no Flowbuilder no Studio e publique uma nova versão.');
  return parsed.data;
}

export function validateStudioFlowPublication(contract: StudioFlowContract, procedureIds: string[]) {
  if (new Set(contract.exposedProcedureIds).size !== contract.exposedProcedureIds.length || contract.exposedProcedureIds.some((id) => !procedureIds.includes(id))) {
    throw new Error('Uma habilidade exportada não pertence aos procedimentos ativos do agente.');
  }
}

export function studioFlowFieldMatches(field: StudioFlowField, value: unknown) {
  if (value === undefined || value === null) return !field.required;
  if (field.type === 'text') return typeof value === 'string' && (!field.required || value.trim().length > 0);
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'object' && value !== null;
}

export function projectStudioFlowData(fields: StudioFlowField[], value: Record<string, unknown>, includeSensitive = true) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const entry = readStudioValue(value, field.key);
    if (!studioFlowFieldMatches(field, entry)) throw new Error(`O dado “${field.label}” não corresponde ao contrato publicado.`);
    if (entry !== undefined) writeStudioValue(result, field.key, !includeSensitive && field.sensitive ? '[protegido]' : entry);
  }
  return result;
}

export function mapStudioCompositionInputs(contract: StudioFlowContract, mappings: unknown, source: { variables: Record<string, unknown>; current: Record<string, unknown>; input: Record<string, unknown> }) {
  const parsed = StudioFlowInputMappingsSchema.parse(mappings || []);
  const fields = new Map(contract.inputs.map((field) => [field.key, field]));
  const result: Record<string, unknown> = {};
  for (const mapping of parsed) {
    if (!fields.has(mapping.inputKey)) throw new Error('Entrada não autorizada pela versão do Studio.');
    const entry = mapping.sourceType === 'static'
      ? resolveStudioMapping({ sourceType: 'static_value', sourceValue: mapping.sourcePath, valueType: mapping.valueType || fields.get(mapping.inputKey)!.type }, { values: {} })
      : readStudioValue(mapping.sourceType === 'variable' ? source.variables : source[mapping.sourceType], mapping.sourcePath);
    if (entry !== undefined) {
      if (!studioFlowFieldMatches({ ...fields.get(mapping.inputKey)!, required: false }, entry)) throw new Error(`Tipo inválido para ${mapping.inputKey}.`);
      writeStudioValue(result, mapping.inputKey, entry);
    }
  }
  return result;
}

export function studioFlowJsonSchema(fields: StudioFlowField[]) {
  const schema: Record<string, unknown> = { type: 'object', properties: {}, additionalProperties: false };
  for (const field of fields) {
    const parts = field.key.split('.'); let parent = schema;
    for (const part of parts.slice(0, -1)) {
      const properties = parent.properties as Record<string, Record<string, unknown>>;
      properties[part] ||= { type: 'object', properties: {}, additionalProperties: false };
      if (field.required) parent.required = [...new Set([...(parent.required as string[] || []), part])];
      parent = properties[part];
    }
    const key = parts.at(-1)!;
    (parent.properties as Record<string, unknown>)[key] = { type: field.type === 'text' ? 'string' : field.type === 'json' ? 'object' : field.type, description: field.label };
    if (field.required) parent.required = [...new Set([...(parent.required as string[] || []), key])];
  }
  return schema;
}
