import type { AgentStudioDocument, ProcedureDocument, ProcedureStep } from './types';

export type StudioDataOption = { key: string; label: string; type?: string; sourceType: 'collected_field' | 'step_output' | 'contact_property'; guaranteed: boolean };
export const studioDataRoot = (key: string) => key.replace(/^\$\./, '').split(/[.[]/)[0];

/** Forward-only control flow. A value is guaranteed only when every incoming path provides it. */
export function studioDataAtSteps(document: AgentStudioDocument, procedure: ProcedureDocument) {
  const initial = document.understandStage.askInitialData ? document.understandStage.initialFields : [];
  const incoming = new Map<number, Set<string>[]>([[0, [new Set(initial.filter((field) => field.required).map((field) => field.variableKey))]]]);
  const indexes = new Map(procedure.steps.map((step, index) => [step.id, index]));
  return procedure.steps.map((step, index) => {
    const paths = incoming.get(index) || [];
    const before = new Set(paths[0] || []);
    for (const key of before) if (!paths.every((path) => path.has(key))) before.delete(key);
    const after = new Set(before);
    if (step.type === 'collect_data' && step.collectField?.required) after.add(step.collectField.variableKey);
    for (const output of studioStepOutputs(step)) if (output.required !== false) after.add(output.chipKey);
    const push = (target: string | null | undefined, keys = after) => {
      const next = target === null ? undefined : target ? indexes.get(target) : index + 1;
      if (paths.length && next !== undefined && next > index && next < procedure.steps.length) incoming.set(next, [...(incoming.get(next) || []), new Set(keys)]);
    };
    if (['decision', 'validate_data'].includes(step.type)) {
      for (const branch of step.decisionBranches || []) {
        if (branch.actionType === 'handoff') continue;
        const keys = new Set(after);
        // An existence guard proves only the exact root, not arbitrary nested siblings.
        if (branch.condition?.operator === 'exists' && studioDataRoot(branch.condition.fieldKey) === branch.condition.fieldKey) keys.add(branch.condition.fieldKey);
        push(branch.nextStepId ?? (branch.actionType === 'respond' ? null : step.nextStepId), keys);
      }
    } else if (!['handoff', 'finish'].includes(step.type) && !(step.type === 'native_action' && step.nativeActionType === 'close_chat')) push(step.nextStepId);
    return { before, reachable: paths.length > 0 };
  });
}

export function studioStepOutputs(step: ProcedureStep) {
  return step.type === 'http_request' ? step.httpRequest?.outputMappings || [] : step.type === 'mcp_tool_call' ? step.mcpTool?.outputMappings || [] : [];
}

export function availableStudioData(document: AgentStudioDocument, procedure: ProcedureDocument | null, index: number): StudioDataOption[] {
  const initial = document.understandStage.askInitialData ? document.understandStage.initialFields : [];
  const guaranteed = procedure ? studioDataAtSteps(document, procedure)[index]?.before || new Set<string>() : new Set(initial.filter((field) => field.required).map((field) => field.variableKey));
  const fields: StudioDataOption[] = initial.map((field) => ({ key: field.variableKey, label: field.name, type: field.type, sourceType: 'collected_field', guaranteed: guaranteed.has(field.variableKey) }));
  for (const step of (procedure?.steps || []).slice(0, index)) {
    if (step.type === 'collect_data' && step.collectField) fields.push({ key: step.collectField.variableKey, label: step.collectField.name, type: step.collectField.type, sourceType: 'collected_field', guaranteed: guaranteed.has(step.collectField.variableKey) });
    for (const output of studioStepOutputs(step)) fields.push({ key: output.chipKey, label: `${output.chipLabel} · ${step.title}`, sourceType: 'step_output', guaranteed: guaranteed.has(output.chipKey) });
  }
  fields.push(...[{ key: 'name', label: 'Nome do contato' }, { key: 'email', label: 'E-mail do contato' }, { key: 'phone', label: 'Telefone do contato' }].map((field) => ({ ...field, sourceType: 'contact_property' as const, guaranteed: false })));
  return fields.filter((field, index) => fields.findIndex((candidate) => candidate.key === field.key && candidate.sourceType === field.sourceType) === index);
}

/** Find dependants before destructive authoring edits, including optional references. */
export function studioStepConsumers(procedure: ProcedureDocument, removed: ProcedureStep): ProcedureStep[] {
  const keys = new Set([...(removed.collectField ? [removed.collectField.variableKey] : []), ...studioStepOutputs(removed).map((output) => output.chipKey)]);
  return procedure.steps.filter((step) => step.id !== removed.id && (
    step.nextStepId === removed.id || step.decisionBranches?.some((branch) => branch.nextStepId === removed.id || (branch.condition && keys.has(studioDataRoot(branch.condition.fieldKey)))) ||
    step.messageDataKeys?.some((key) => keys.has(studioDataRoot(key))) ||
    (step.collectField?.optionsSourceKey && keys.has(studioDataRoot(step.collectField.optionsSourceKey))) ||
    [...(step.httpRequest?.sentDataMappings || []), ...(step.nativeDataMappings || [])].some((mapping) => ['collected_field', 'step_output'].includes(mapping.sourceType) && keys.has(studioDataRoot(mapping.sourceValue))) ||
    step.mcpTool?.argumentMappings.some((mapping) => (!mapping.sourceType || ['collected_field', 'step_output'].includes(mapping.sourceType)) && keys.has(studioDataRoot(mapping.sourceChipKey)))
  ));
}
