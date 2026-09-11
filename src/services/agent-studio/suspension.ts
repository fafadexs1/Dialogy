import type { AgentStudioDocument } from './types';
import type { StudioSession } from './engine';
import { validateStudioField } from './collection';

export const STUDIO_RESUME_TTL = 30 * 60_000;
export const isStudioResumeRequest = (message: string) => /^(?:(?:quero|podemos|vamos) )?(?:voltar|retomar|continuar) (?:ao |a |o |com o )?(?:assunto|pedido|procedimento|atendimento|solicitacao) anterior[.!?\s]*$/.test(
  message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());

export function studioProcedureHasExecutedOperation(document: AgentStudioDocument, state: StudioSession): boolean {
  const procedure = document.resolveStage.procedures.find((p) => p.id === state.procedureId);
  return Boolean(state.inFlight || procedure?.steps.some((step) => (state.visits[`${procedure.id}:${step.id}`] || 0) > 0
    && ['http_request', 'mcp_tool_call', 'native_action'].includes(step.type)));
}

export function suspendStudioProcedure(document: AgentStudioDocument, state: StudioSession, now: number) {
  const procedure = document.resolveStage.procedures.find((p) => p.id === state.procedureId);
  if (!procedure || state.phase !== 'resolve' || studioProcedureHasExecutedOperation(document, state)) return;
  const values: Record<string, unknown> = {};
  const adaptive = document.resolveStage.conversationMode === 'adaptive';
  for (const step of adaptive ? procedure.steps : procedure.steps.slice(0, state.stepIndex)) {
    const field = step.collectField;
    if (!field || field.isSensitive || field.optionsSourceKey || ['cpf', 'cnpj', 'cpf_cnpj', 'file'].includes(field.type)) continue;
    const fact = state.sessionFacts?.[field.variableKey];
    const age = fact ? now - Date.parse(fact.at) : NaN;
    if (fact?.confirmed && age >= 0 && age <= STUDIO_RESUME_TTL && validateStudioField(field, state.values[field.variableKey]).valid) values[field.variableKey] = state.values[field.variableKey];
  }
  state.suspendedProcedures = [...(state.suspendedProcedures || []).filter((p) => p.procedureId !== procedure.id
    && now >= p.at && now - p.at <= STUDIO_RESUME_TTL), {
    procedureId: procedure.id, releaseId: state.releaseId, stepIndex: state.stepIndex,
    values, intent: state.activeIntent || procedure.name, at: now,
  }].slice(-3);
}

export function restoreStudioProcedure(document: AgentStudioDocument, state: StudioSession, id: string, now: number): boolean {
  const snapshot = state.suspendedProcedures?.find((p) => p.procedureId === id);
  const procedure = document.resolveStage.procedures.find((p) => p.id === id && p.status !== 'archived');
  if (!snapshot || !procedure || snapshot.releaseId !== state.releaseId || now < snapshot.at || now - snapshot.at > STUDIO_RESUME_TTL) return false;
  // Only pre-operation snapshots exist. Do not restore tool outputs or authorizations.
  for (const key of Object.keys(state.values)) if (!state.valueOrigins?.[key]?.stepId.startsWith('initial:')) {
    delete state.values[key]; if (state.valueOrigins) delete state.valueOrigins[key];
  }
  let restart = Math.min(snapshot.stepIndex, procedure.steps.length - 1);
  for (const [index, step] of procedure.steps.entries()) {
    const field = step.collectField;
    if (!field) continue;
    delete state.values[field.variableKey];
    if (state.valueOrigins) delete state.valueOrigins[field.variableKey];
    if (state.sessionFacts) delete state.sessionFacts[field.variableKey];
    if (index >= snapshot.stepIndex && document.resolveStage.conversationMode !== 'adaptive') continue;
    const validation = !field.isSensitive && !field.optionsSourceKey && !['cpf', 'cnpj', 'cpf_cnpj', 'file'].includes(field.type)
      ? validateStudioField(field, snapshot.values[field.variableKey]) : { valid: false };
    if (validation.valid && 'value' in validation) {
      state.values[field.variableKey] = validation.value;
      state.valueOrigins ||= {};
      state.valueOrigins[field.variableKey] = { source: 'customer', confirmed: true, stepId: `${id}:${step.id}`, at: new Date(snapshot.at).toISOString() };
      state.sessionFacts ||= {};
      state.sessionFacts[field.variableKey] = { value: validation.value, fieldType: field.type, labels: [field.name, ...(field.aliases || [])],
        source: 'customer', confirmed: true, isSensitive: false, at: new Date(snapshot.at).toISOString() };
    } else restart = Math.min(restart, index);
  }
  state.procedureId = id; state.phase = 'resolve'; state.status = 'waiting_input';
  state.stepIndex = Math.max(0, restart); state.activeIntent = snapshot.intent;
  state.pendingField = procedure.steps[state.stepIndex]?.collectField?.variableKey || null;
  state.confirmation = null; state.inFlight = null;
  delete state.topicChange; delete state.collectionProposal; delete state.resumeProposal; delete state.initialIntent;
  state.suspendedProcedures = state.suspendedProcedures?.filter((p) => p.procedureId !== id);
  return true;
}
