import { STUDIO_SGP_ACTIONS } from './sgp-data';
import { z } from 'zod';
import { StudioReasoningStateSchema } from './reasoning-contract';
import type { AgentStudioDocument, CollectedFieldDefinition, ProcedureDocument, ProcedureStep } from './types';
import { extractStudioFieldCandidate, isStudioFieldQuestion, matchesStudioFieldLabel, resolveStudioCollectionOptions, validateStudioField } from './collection';
import { readStudioValue, type StudioDataContext } from './data-mapping';
import { matchExcludedStudioTopic, matchProhibitedStudioField, studioOperatingHoursAllow } from './policy';
import { isStudioInformationQuestion, resolveStudioOption } from './option-resolution';
import type { StudioCollectionInterpretation, StudioCollectionInterpretationInput } from './collection-interpreter';
import { isStudioResumeRequest, restoreStudioProcedure, suspendStudioProcedure, studioProcedureHasExecutedOperation, STUDIO_RESUME_TTL } from './suspension';
import { normalizeStudioDirectAnswer } from './natural-values';
import { studioPendingField, type StudioTurnDecision, type StudioTurnInput } from './turn-interpreter';
import { studioCollectionWindow, validateStudioCollectionPlan, type StudioCollectionPlanningInput } from './collection-planner';
import { availableStudioActions, studioVerifiedEvidence, type StudioActionPlanningInput } from './action-planner';
import { buildHandoffBriefing, resolveHandoffReasonCode, type HandoffReasonCode } from './handoff-reasons';
import { recoverableStudioFields, validateStudioRecoveredFacts, type StudioFactRecoveryInput, type StudioFactSource } from './fact-recovery';
import {
  detectExplicitStudioConversationControl,
  guardRepeatedStudioResponse,
  studioMessageMayContainConversationControl,
  type StudioConversationControl,
} from './conversation-governor';

export const StudioSessionSchema = z.object({
  id: z.string(), agentId: z.string(), releaseId: z.string(),
  phase: z.enum(['understand', 'resolve', 'conclude', 'done']),
  status: z.enum(['running', 'waiting_input', 'resolved', 'transferred', 'failed', 'cancelled']),
  procedureId: z.string().nullable(), stepIndex: z.number().int().nonnegative(),
  values: z.record(z.unknown()), attempts: z.record(z.number()), visits: z.record(z.number()),
  reasoning: StudioReasoningStateSchema.optional(),
  unavailableFields: z.record(z.object({ fieldKey: z.string(), at: z.string() })).optional(),
  deferredFields: z.record(z.object({ fieldKey: z.string(), at: z.string() })).optional(),
  adaptiveCompletedSteps: z.record(z.boolean()).optional(),
  adaptiveOperation: z.object({ procedureId: z.string(), stepId: z.string(), returnIndex: z.number().int().nonnegative() }).optional(),
  valueOrigins: z.record(z.object({ source: z.enum(['customer', 'contact_property', 'flow_input', 'integration']), confirmed: z.boolean(), stepId: z.string(), at: z.string() })).optional(),
  sessionFacts: z.record(z.object({ value: z.unknown(), fieldType: z.string(), labels: z.array(z.string()), source: z.enum(['customer', 'contact_property', 'flow_input']), confirmed: z.boolean(), isSensitive: z.boolean(), at: z.string() })).optional(),
  procedureStats: z.array(z.object({ id: z.string(), name: z.string(), selected: z.number(), completed: z.number(), failed: z.number(), collectionFailures: z.number(), integrationFailures: z.number() })).optional(),
  initialIntent: z.string().optional(),
  routingOptions: z.array(z.string()).optional(),
  routingContext: z.string().optional(),
  turnCount: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  processedMessageIds: z.array(z.string()).max(200).optional(),
  topicChange: z.object({ procedureId: z.string(), at: z.number(), intent: z.string().max(2000).optional() }).optional(),
  activeIntent: z.string().max(2000).optional(),
  intentHistory: z.array(z.object({ intent: z.string().max(2000), procedureId: z.string(), outcome: z.string(), at: z.string() })).max(20).optional(),
  recentResponses: z.array(z.string().max(20_000)).max(20).optional(),
  conversationMemory: z.array(z.object({ messageId: z.string(), customer: z.string().max(4000), assistant: z.string().max(4000) })).max(40).optional(),
  suspendedProcedures: z.array(z.object({ procedureId: z.string(), releaseId: z.string(), stepIndex: z.number().int().nonnegative(),
    values: z.record(z.unknown()), intent: z.string().max(2000), at: z.number() })).max(3).optional(),
  resumeProposal: z.object({ procedureId: z.string(), at: z.number() }).optional(),
  pendingField: z.string().nullable(),
  resolutionPromptPending: z.boolean().optional(),
  collectionProposal: z.object({ stepKey: z.string(), label: z.string(), valueSignature: z.string(), at: z.number() }).optional(),
  confirmation: z.object({ key: z.string(), signature: z.string(), at: z.number() }).nullable(),
  inFlight: z.object({ key: z.string(), stepId: z.string() }).nullable(),
  events: z.array(z.object({ stepId: z.string(), label: z.string(), kind: z.string(), at: z.string() })),
  lastTurn: z.object({ messageId: z.string(), response: z.string(), outcome: z.string() }).optional(),
  /** Why the AI handed this chat to a person (closed vocabulary in handoff-reasons.ts). Set once the transfer succeeds. */
  handoff: z.object({ reasonCode: z.string(), at: z.string() }).optional(),
});
export type StudioSession = z.infer<typeof StudioSessionSchema>;
export function studioHasUncertainOperation(state: StudioSession) {
  return Boolean(state.inFlight || state.reasoning?.operations.some((operation) => operation.status === 'unknown'));
}
export type StudioEngineDependencies = {
  recoverFacts?: (input: StudioFactRecoveryInput) => Promise<{ plan: unknown; sources: StudioFactSource[] }>;
  planAction?: (input: StudioActionPlanningInput) => Promise<string | null>;
  answerFromEvidence?: (input: { question: string; values: Record<string, unknown> }) => Promise<string | null>;
  planCollection?: (input: StudioCollectionPlanningInput) => Promise<unknown>;
  interpretTurn?: (input: StudioTurnInput) => Promise<StudioTurnDecision | null>;
  assertActive?: () => void;
  checkpoint?: (state: StudioSession) => Promise<void>;
  chooseProcedure?: (procedures: ProcedureDocument[], message: string) => Promise<string | null | { candidates: string[] }>;
  decide?: (step: ProcedureStep, context: StudioDataContext) => Promise<string | null>;
  interpretCollection?: (input: StudioCollectionInterpretationInput) => Promise<StudioCollectionInterpretation>;
  classifyControl?: (input: {
    message: string;
    procedure: ProcedureDocument;
    pendingField?: CollectedFieldDefinition;
  }) => Promise<StudioConversationControl>;
  execute: (step: ProcedureStep, context: StudioDataContext, operation: { id: string; confirmed: boolean; startedAt?: string; catalogProductId?: string | number; sgpQuery?: unknown }) => Promise<{ values?: Record<string, unknown>; presentedProduct?: { productId: string | number; caption: string; url: string }; memoryWarning?: string }>;
  knowledge: (query: string, collectionIds: string[], options?: {
    requireSources: boolean;
    collectionContext?: { fieldName: string; options: string[] };
  }) => Promise<string | null>;
  handoff: (team: string, reason: string, context: StudioDataContext, operationId: string,
    /** Closed-vocabulary reason and the internal briefing for the person who takes over. */
    meta?: { reasonCode: HandoffReasonCode; briefing: string }) => Promise<void | { message?: string }>;
  needsConfirmation?: (step: ProcedureStep) => Promise<boolean>;
  now?: () => number;
};

export function createStudioSession(agentId: string, releaseId: string, id: string): StudioSession {
  return { id, agentId, releaseId, phase: 'understand', status: 'running', procedureId: null, stepIndex: 0,
    values: {}, attempts: {}, visits: {}, sessionFacts: {}, pendingField: null, confirmation: null, inFlight: null, events: [] };
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const naturalProcedureName = (name: string) => name ? `${name.charAt(0).toLocaleLowerCase('pt-BR')}${name.slice(1)}` : 'seguir com esse pedido';
const isGreetingOnly = (text: string) => {
  const phrase = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(oi+|ola+|opa|e ai|bom dia|boa tarde|boa noite|hello|hi|hey)( tudo bem( com voce)?| como vai)?$/.test(phrase);
};
const literalAffirmative = (text: string) => /^(sim|confirmo|pode|pode sim|pode continuar|ok|correto|isso|yes)[.!\s]*$/.test(normalize(text));
const literalNegative = (text: string) => /^(nao|cancelar|cancela|nao quero|no)[.!\s]*$/.test(normalize(text));
const proceduresMatchingChoice = (procedures: ProcedureDocument[], message: string) => procedures.filter((p) =>
  p.steps.some((s) => s.collectField?.type === 'single_select' && !s.collectField.optionsSourceKey && !s.collectField.isSensitive
    && resolveStudioOption(s.collectField.options || [], message, false).kind === 'selected'));
// Consent belongs to one pending question, never to a later action in this turn.
function studioConsentScope(state: StudioSession): string | null {
  if (state.topicChange) return JSON.stringify(['topic', state.topicChange]);
  if (state.resumeProposal) return JSON.stringify(['resume', state.resumeProposal]);
  if (state.collectionProposal) return JSON.stringify(['proposal', state.collectionProposal]);
  if (state.confirmation) return JSON.stringify(['confirmation', state.confirmation]);
  return state.phase === 'conclude' && state.resolutionPromptPending !== false ? JSON.stringify(['resolution', state.procedureId]) : null;
}
const announcesTransfer = (text: string) => /\b(encaminh|transfer|direcion|equipe|atendente|especialista)/i.test(normalize(text));
const safeHandoffMessage = (team: string) => /^[0-9a-f-]{36}$/i.test(team)
  ? 'Vou encaminhar seu atendimento para a equipe responsável continuar com você.'
  : `Vou encaminhar seu atendimento para a equipe ${team} continuar com você.`;
class StudioCheckpointError extends Error {}

function renderMessage(step: ProcedureStep, context: StudioDataContext, unavailableLabels: ReadonlyMap<string, string>): string {
  const text = step.messageText || '';
  const values = (step.messageDataKeys || []).map((key) => {
    const value = readStudioValue(context.values, key);
    // A customer-declared unknown is valid context, not a failed tool result.
    // Render it only; never manufacture a value for CRM or integration inputs.
    if (value === undefined && unavailableLabels.has(key)) return `${unavailableLabels.get(key)}: não informado`;
    return value;
  });
  if (values.some((value) => value === undefined || value === null)) throw new Error('Falta um resultado necessário para responder.');
  return [text, ...values.map((value) => typeof value === 'string' ? value : JSON.stringify(value))].filter(Boolean).join('\n');
}

export function evaluateStudioCondition(condition: NonNullable<NonNullable<ProcedureStep['decisionBranches']>[number]['condition']>, context: StudioDataContext) {
  const value = readStudioValue(context.values, condition.fieldKey);
  const expected = condition.value || '';
  switch (condition.operator) {
    case 'exists': return value !== undefined && value !== null && value !== '';
    case 'not_exists': return value === undefined || value === null || value === '';
    case 'equals': return value !== undefined && String(value) === expected;
    case 'not_equals': return value !== undefined && String(value) !== expected;
    case 'greater_than': return value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) > Number(expected);
    case 'less_than': return value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) < Number(expected);
    case 'contains': return Array.isArray(value) ? value.some((item) => String(item) === expected) : typeof value === 'string' && value.includes(expected);
    case 'count_equals': return Array.isArray(value) && value.length === Number(expected);
    case 'count_greater_than': return Array.isArray(value) && value.length > Number(expected);
  }
}

/** Pure orchestration shared by production and the draft simulator. Effects are injected. */
export async function advanceStudioSession(input: {
  document: AgentStudioDocument;
  state: StudioSession;
  message: string;
  messageId: string;
  attachment?: { id: string; name: string; mimeType: string; size: number };
  context?: Omit<StudioDataContext, 'values'>;
  suggestionOnly?: boolean;
  dependencies: StudioEngineDependencies;
}) {
  const { document, dependencies: deps } = input;
  let message = input.message;
  deps.assertActive?.();
  const state = structuredClone(input.state);
  let turnDecision: StudioTurnDecision | null = null;
  let resolutionContinuationId: string | null = null;
  const consentScope = studioConsentScope(state);
  const scopedConsent = () => consentScope !== null && studioConsentScope(state) === consentScope;
  const affirmative = (text: string) => turnDecision
    ? turnDecision.kind === 'confirm' && scopedConsent() : literalAffirmative(text);
  const negative = (text: string) => turnDecision
    ? turnDecision.kind === 'reject' && scopedConsent() : literalNegative(text);
  state.valueOrigins ||= {};
  state.sessionFacts ||= {};
  if (state.agentId !== document.id) throw new Error('A sessão não pertence a este agente.');
  if (state.lastTurn?.messageId === input.messageId) return { state, response: state.lastTurn.response, replay: true };
  if (state.processedMessageIds?.includes(input.messageId)) return { state, response: '', replay: true };
  const now = deps.now || Date.now;
  const messages: string[] = [];
  const context = (): StudioDataContext => ({ ...input.context, values: state.values });
  const checkpoint = async () => {
    try { await deps.checkpoint?.(structuredClone(state)); }
    catch { throw new StudioCheckpointError('Não foi possível guardar a sessão com segurança. A execução foi interrompida.'); }
  };
  const event = (stepId: string, label: string, kind: string) => {
    state.events.push({ stepId, label, kind, at: new Date(now()).toISOString() });
    state.events = state.events.slice(-150);
    state.procedureStats ||= [];
    if (kind === 'procedure_selected' && !state.procedureStats.some((entry) => entry.id === stepId)) state.procedureStats.push({ id: stepId, name: label, selected: 0, completed: 0, failed: 0, collectionFailures: 0, integrationFailures: 0 });
    const stats = state.procedureStats.find((entry) => entry.id === state.procedureId);
    if (stats) {
      if (kind === 'procedure_selected') stats.selected++;
      if (kind === 'procedure_completed') stats.completed++;
      if (kind === 'validation_failed') stats.collectionFailures++;
      if (kind === 'failed' || kind === 'outcome_unknown') {
        stats.failed++;
        const step = document.resolveStage.procedures.find((item) => item.id === state.procedureId)?.steps.find((item) => item.id === stepId);
        if (step && ['http_request', 'mcp_tool_call'].includes(step.type)) stats.integrationFailures++;
      }
    }
  };
  const finish = async () => {
    const pendingProcedureStep = document.resolveStage.procedures.find((procedure) => procedure.id === state.procedureId)?.steps[state.stepIndex];
    const pendingDefinition = state.phase === 'understand'
      ? document.understandStage.initialFields.find((field) => field.variableKey === state.pendingField)
      : pendingProcedureStep?.collectField;
    const pendingStepKey = state.phase === 'understand' ? `initial:${pendingDefinition?.id}` : `${state.procedureId}:${pendingProcedureStep?.id}`;
    if (!state.pendingField || state.topicChange || !['understand', 'resolve'].includes(state.phase)
      || state.collectionProposal?.stepKey !== pendingStepKey) delete state.collectionProposal;
    const rawResponse = messages.filter(Boolean).join('\n\n');
    const response = guardRepeatedStudioResponse({
      response: rawResponse,
      recentResponses: state.recentResponses || [],
      procedureActive: Boolean(state.procedureId),
      pendingPrompt: state.collectionProposal ? `Confirma ${state.collectionProposal.label}? Responda sim ou informe outra opção.`
        : state.confirmation ? messages.at(-1) : state.pendingField ? pendingDefinition?.promptMessage : undefined,
    });
    if (rawResponse) state.recentResponses = [...(state.recentResponses || []), rawResponse.slice(0, 20_000)].slice(-20);
    state.lastTurn = { messageId: input.messageId, response, outcome: state.status };
    const originalField = input.state.phase === 'understand' ? document.understandStage.initialFields.find((field) => field.variableKey === input.state.pendingField)
      : document.resolveStage.procedures.find((p) => p.id === input.state.procedureId)?.steps[input.state.stepIndex]?.collectField;
    const compact = (value: string) => value.length <= 4000 ? value : `${value.slice(0, 3970)} [trecho abreviado]`;
    state.conversationMemory = [...(state.conversationMemory || []), { messageId: input.messageId,
      customer: originalField?.isSensitive ? '[Dado sensível omitido]' : compact(input.message), assistant: compact(response) }].slice(-40);
    state.processedMessageIds = [...(state.processedMessageIds || []), input.messageId].slice(-200);
    await checkpoint();
    return { state, response, replay: false };
  };
  const handoff = async (reason: string, team = document.concludeStage.handoffTeam) => {
    team ||= document.concludeStage.handoffTeam;
    state.confirmation = null; state.pendingField = null;
    if (input.suggestionOnly) { state.status = 'waiting_input'; messages.push(`Solicite à equipe ${team || 'responsável'} que assuma este atendimento.`); return; }
    if (!team) { state.phase = 'done'; state.status = 'failed'; messages.push('Não consegui resolver automaticamente. A equipe precisa revisar a configuração de transferência.'); return; }
    if (state.inFlight?.stepId === 'handoff') {
      state.phase = 'done'; state.status = 'failed';
      messages.push('A transferência anterior ficou sem confirmação. A equipe precisa conferir o atendimento antes de repetir.');
      event('handoff', 'Transferência sem confirmação', 'outcome_unknown'); return;
    }
    // Reserve the transfer too: losing the final checkpoint must not assign twice.
    const previousOperation = state.inFlight;
    state.inFlight = { key: `${state.id}:handoff`, stepId: 'handoff' };
    await checkpoint();
    try {
      const reasonCode = resolveHandoffReasonCode({ reason });
      const briefing = buildHandoffBriefing({ reasonCode, reason,
        requests: state.procedureId ? [{ objective: state.activeIntent || state.procedureId, status: 'active' }] : [], operations: [] });
      const handoffResult = await deps.handoff(team, reason, context(), `${state.id}:handoff`, { reasonCode, briefing });
      state.status = 'transferred';
      state.handoff = { reasonCode, at: new Date().toISOString() };
      state.inFlight = previousOperation;
      // A response step may have announced a stale or different team. Once the
      // transfer succeeds, expose one authoritative destination to the customer.
      for (let index = messages.length - 1; index >= 0; index--) if (announcesTransfer(messages[index])) messages.splice(index, 1);
      messages.push(handoffResult?.message || safeHandoffMessage(team));
      event('handoff', 'Transferência para equipe', 'transferred');
    } catch (error) {
      console.error('[AGENT_STUDIO_HANDOFF] Falha ao transferir ou enfileirar atendimento:', error);
      state.status = 'failed';
      messages.push('Não consegui conectar a equipe agora. Seu atendimento precisa de acompanhamento.');
      event('handoff', 'Transferência indisponível', 'failed');
    }
    state.phase = 'done';
  };
  if (state.phase === 'done' && state.status === 'resolved' && state.suspendedProcedures?.length) {
    state.phase = 'resolve'; state.status = 'waiting_input'; state.procedureId = null;
  }
  if (state.phase === 'done') return { state, response: '', replay: false };
  if (state.inFlight) {
    event(state.inFlight.stepId, 'Operação interrompida', 'outcome_unknown');
    // A crash/timeout may have occurred after a side effect. Never repeat it blindly.
    await handoff('Uma operação anterior ficou sem confirmação de resultado. É necessária conferência antes de repetir.');
    return finish();
  }
  if (!deps.interpretTurn && /\b(quero|preciso|falar com|chama|chamar)\b.{0,30}\b(humano|atendente|pessoa|equipe)\b/.test(normalize(message)) && !/\bnao (quero|preciso)\b/.test(normalize(message))) {
    await handoff('O cliente pediu atendimento humano.'); return finish();
  }
  const excludedTopic = matchExcludedStudioTopic(message, document);
  if (excludedTopic) {
    state.status = 'waiting_input'; messages.push(document.understandStage.outOfScopeMessage);
    event('policy', `Assunto fora do escopo: ${excludedTopic}`, 'policy_blocked'); return finish();
  }
  state.turnCount = (state.turnCount || 0) + 1;
  if (state.turnCount > (document.rules.maxTurnsPerSession || 30)) {
    event('limits', 'Limite de mensagens da sessão', 'limit_reached');
    await handoff('A conversa atingiu o limite de mensagens sem conclusão.'); return finish();
  }
  if (!studioOperatingHoursAllow(document, now())) { state.status = 'waiting_input'; messages.push(document.rules.outOfHoursMessage); return finish(); }
  type PlannedCollection = NonNullable<ReturnType<typeof validateStudioCollectionPlan>>;
  let cachedCollection: { key: string; result: PlannedCollection | null } | undefined;
  let planningCalls = 0;
  let planningConsumedMessage = false;
  const planWindow = async (window: NonNullable<ReturnType<typeof studioCollectionWindow>>) => {
    const key = `${state.phase}:${state.procedureId}:${window.start}:${window.end}`;
    if (cachedCollection?.key === key) return cachedCollection.result;
    const planning: StudioCollectionPlanningInput = { document, state: structuredClone(state), window,
      allowActionContinuation: Boolean(deps.planAction), context: context(),
      message: planningConsumedMessage || consentScope !== null ? '' : input.message };
    let result: PlannedCollection | null = null;
    if (planningCalls++ < (deps.planAction ? 4 : 2)) {
      try { result = validateStudioCollectionPlan(await deps.planCollection!(planning), planning, now()); }
      catch { deps.assertActive?.(); }
    }
    deps.assertActive?.();
    cachedCollection = { key, result };
    return result;
  };
  const planningWindow = deps.planCollection && !state.confirmation && !state.collectionProposal && !state.topicChange && !state.resumeProposal
    ? studioCollectionWindow(document, state) : null;
  const initialPlan = planningWindow ? await planWindow(planningWindow) : undefined;
  // A multi-field turn is one contribution; do not reinterpret its "don't know"
  // as an answer to whichever field happened to be first in the old sequence.
  if (initialPlan) {
    const intent = initialPlan.plan.intent;
    if (intent !== 'contribute') turnDecision = { kind: intent === 'clarify' ? 'unclear' : intent };
    // Deferring a question is not evidence that the customer supplied a value:
    // preserve contact references and other specific acts when no facts were extracted.
    else if (initialPlan.observations.length) turnDecision = { kind: 'answer' };
  }
  if (deps.interpretTurn || initialPlan) {
    try {
      if (!turnDecision) turnDecision = deps.interpretTurn
        ? await deps.interpretTurn({ document, state: structuredClone(state), message, context: context() })
        : { kind: 'answer' };
    }
    catch { deps.assertActive?.(); }
    deps.assertActive?.();
    if (!turnDecision) {
      state.status = 'waiting_input';
      messages.push('Não consegui interpretar sua mensagem com segurança agora. Seu pedido foi preservado; pode tentar novamente?');
      event('turn', 'Interpretação indisponível', 'turn_unavailable'); return finish();
    }
    if (state.phase === 'conclude' && turnDecision.kind === 'confirm') {
      if (!scopedConsent()) turnDecision = { kind: 'answer' };
      else if (!literalAffirmative(input.message) && deps.chooseProcedure) {
        // A rich affirmative can contain a new request. Check that request
        // before consuming the customer's words as consent to end the session.
        const alternatives = document.resolveStage.procedures.filter((p) => p.id !== state.procedureId);
        const matchingChoice = proceduresMatchingChoice(alternatives, input.message);
        const nextProcedures = matchingChoice.length ? matchingChoice : alternatives;
        try {
          const next = nextProcedures.length ? await deps.chooseProcedure(nextProcedures, input.message) : null;
          if (typeof next === 'string' && nextProcedures.some((p) => p.id === next)) {
            resolutionContinuationId = next;
            turnDecision = { kind: 'answer' };
          } else if (next && typeof next === 'object') turnDecision = { kind: 'answer' };
        } catch {
          deps.assertActive?.();
          turnDecision = { kind: 'unclear' };
        }
      }
    }
    event('turn', turnDecision.kind, 'turn_interpreted');
    const pending = studioPendingField({ document, state });
    if (turnDecision.kind === 'handoff') { await handoff('O cliente solicitou ou aceitou atendimento humano.'); return finish(); }
    if (deps.recoverFacts && (state.confirmation || state.collectionProposal)
      && !['cancel', 'change'].includes(turnDecision.kind) && !literalAffirmative(input.message) && !literalNegative(input.message)) {
      // Supplying another field is neither correcting the pending field nor
      // authorizing its operation. Store the contribution and keep consent open.
      const procedure = document.resolveStage.procedures.find((p) => p.id === state.procedureId);
      const recovery = { document, state: structuredClone(state), message: input.message, currentTurnOnly: true,
        fields: procedure?.steps.flatMap((s) => s.collectField && s.collectField.variableKey !== pending?.variableKey
          ? [{ field: s.collectField, stepKey: `${procedure.id}:${s.id}` }] : []) || [] };
      if (recoverableStudioFields(recovery).length) {
        try {
          const result = await deps.recoverFacts(recovery);
          deps.assertActive?.();
          const facts = validateStudioRecoveredFacts(result.plan, recovery, [{ customer: input.message }]);
          if (facts.length) {
            for (const fact of facts) {
              state.values[fact.field.variableKey] = fact.value;
              state.valueOrigins![fact.field.variableKey] = { source: 'customer', confirmed: false, stepId: fact.stepKey, at: new Date(now()).toISOString() };
              event(fact.stepKey, fact.field.name, 'conversation_fact_recovered');
            }
            state.status = 'waiting_input';
            messages.push(`Registrei: ${facts.map((f) => f.field.name).join(', ')}.`);
            messages.push(state.collectionProposal ? `Confirma ${state.collectionProposal.label}? Responda sim ou informe outra opção.`
              : pending ? `Confirma a informação de ${pending.name}? Responda sim ou não.`
                : 'A confirmação anterior continua pendente. Você confirma ou prefere não continuar com essa ação?');
            return finish();
          }
        } catch { deps.assertActive?.(); }
      }
    }
    if (turnDecision.kind === 'confirm') message = 'sim';
    if (turnDecision.kind === 'reject') message = 'não';
    if (turnDecision.kind === 'contact_reference') {
      const key = turnDecision.contactKey;
      const isFieldConfirmation = Boolean(state.confirmation?.key.startsWith('field:'));
      const allowed = pending && pending.variableKey === turnDecision.fieldKey
        && (state.pendingField === pending.variableKey || isFieldConfirmation)
        && (!state.confirmation || isFieldConfirmation) && !matchProhibitedStudioField(pending, document)
        && ((pending.type === 'phone' && key === 'phone') || (pending.type === 'email' && key === 'email'));
      const validated = allowed ? validateStudioField(pending, input.context?.contact?.[key]) : null;
      if (!validated?.valid) {
        messages.push('Não encontrei um dado válido deste atendimento para usar. Pode informar diretamente?');
        state.status = 'waiting_input'; return finish();
      }
      state.values[pending!.variableKey] = validated.value;
      const procedure = document.resolveStage.procedures.find((p) => p.id === state.procedureId);
      const stepKey = state.phase === 'understand' ? `initial:${pending!.id}` : `${procedure!.id}:${procedure!.steps[state.stepIndex].id}`;
      state.valueOrigins![pending!.variableKey] = { source: 'contact_property', confirmed: isFieldConfirmation, stepId: stepKey, at: new Date(now()).toISOString() };
      if (isFieldConfirmation) {
        state.confirmation = null;
        state.pendingField = null;
      }
      message = ''; cachedCollection = undefined; planningConsumedMessage = true;
    }
    if (turnDecision.kind === 'unable' && pending
      && (state.pendingField === pending.variableKey || state.confirmation?.key.startsWith('field:'))) {
      const procedure = document.resolveStage.procedures.find((p) => p.id === state.procedureId);
      const stepKey = state.phase === 'understand' ? `initial:${pending.id}` : `${procedure!.id}:${procedure!.steps[state.stepIndex].id}`;
      state.unavailableFields ||= {};
      state.unavailableFields[stepKey] = { fieldKey: pending.variableKey, at: new Date(now()).toISOString() };
      delete state.values[pending.variableKey]; delete state.valueOrigins![pending.variableKey]; delete state.sessionFacts![pending.variableKey];
      state.pendingField = null; state.confirmation = null; delete state.collectionProposal;
      state.status = 'running';
      messages.push('Tudo bem, vamos seguir com as próximas informações.');
      event(stepKey, pending.name, 'field_unavailable');
      // The reply belongs to the skipped field, never to the next data-entry slot.
      message = '';
      cachedCollection = undefined; planningConsumedMessage = true;
    } else if (turnDecision.kind === 'unable' || (turnDecision.kind === 'question' && Boolean(state.procedureId || pending)
      && !(deps.planAction && !state.confirmation && !state.collectionProposal
        && (availableStudioActions(document, state, context(), true).length || Object.keys(studioVerifiedEvidence(document, state)).length))) || turnDecision.kind === 'unclear'
      || (turnDecision.kind === 'continue' && Boolean(pending) && !deps.recoverFacts)) {
      let answer: string | null = null;
      if (turnDecision.kind === 'question') {
        try { answer = await deps.knowledge(input.message, document.resolveStage.knowledgeCollectionIds, { requireSources: true,
          collectionContext: pending ? { fieldName: pending.name, options: pending.options || [] } : undefined }); }
        catch { deps.assertActive?.(); }
      }
      state.status = 'waiting_input';
      if (state.phase === 'conclude') state.resolutionPromptPending = false;
      messages.push(answer || (turnDecision.kind === 'unable' && pending
        ? pending.unavailableMessage || `Entendi, você ainda não tem ${pending.name}. Seu pedido continua em andamento. Posso encaminhar para uma pessoa ajudar com esse dado, ou aguardamos você obtê-lo.`
        : turnDecision.kind === 'continue' && pending ? `Vamos continuar com seu pedido. ${pending.promptMessage}`
          : (Boolean(state.procedureId || pending || state.activeIntent)
            ? 'Seu pedido foi mantido. Pode esclarecer o que precisa ou pedir ajuda de uma pessoa?'
            : 'Olá! Como posso te ajudar hoje? Posso tirar dúvidas, apresentar informações ou iniciar o seu atendimento.')));
      event('turn', pending?.name || (Boolean(state.procedureId || pending || state.activeIntent) ? 'Objetivo preservado' : 'Acolhimento'), 'turn_paused'); return finish();
    }
  }
  const clearProcedureData = (preserveProcedureId?: string) => {
    delete state.adaptiveOperation;
    for (const key of Object.keys(state.values)) {
      const originStepId = state.valueOrigins![key]?.stepId || '';
      const belongsToTarget = Boolean(preserveProcedureId && originStepId.startsWith(`${preserveProcedureId}:`));
      if (!originStepId.startsWith('initial:') && !belongsToTarget) {
        delete state.values[key]; delete state.valueOrigins![key];
      }
    }
    state.pendingField = null; state.confirmation = null; state.stepIndex = 0; delete state.initialIntent;
  };
  const interruptProcedure = (outcome: string) => {
    delete state.adaptiveOperation;
    const procedureId = state.procedureId;
    if (procedureId) {
      if (state.activeIntent?.trim()) {
        state.intentHistory = [...(state.intentHistory || []), {
          intent: state.activeIntent.trim().slice(0, 2000),
          procedureId,
          outcome,
          at: new Date(now()).toISOString(),
        }].slice(-20);
      }
      for (const key of Object.keys(state.values)) if (state.valueOrigins![key]?.stepId.startsWith(`${procedureId}:`)) {
        delete state.values[key];
        delete state.valueOrigins![key];
      }
    }
    state.procedureId = null;
    state.stepIndex = 0;
    state.phase = 'resolve';
    state.status = 'waiting_input';
    state.pendingField = null;
    state.confirmation = null;
    delete state.activeIntent;
  };
  if (turnDecision?.kind === 'conclude') {
    clearProcedureData();
    state.procedureId = null;
    state.stepIndex = 0;
    state.phase = 'done';
    state.status = 'resolved';
    state.pendingField = null;
    state.confirmation = null;
    delete state.initialIntent; delete state.activeIntent; delete state.collectionProposal;
    delete state.topicChange; delete state.resumeProposal;
    messages.push(document.concludeStage.successClosingMessage);
    event('turn', 'Atendimento concluído pelo cliente', 'conversation_concluded'); return finish();
  }
  if (turnDecision?.kind === 'cancel' && !state.procedureId) {
    state.status = 'waiting_input'; state.pendingField = null; state.confirmation = null;
    delete state.initialIntent; delete state.activeIntent; delete state.collectionProposal;
    delete state.topicChange; delete state.resumeProposal;
    messages.push('Certo, parei este pedido. O que você gostaria de fazer agora?');
    event('turn', 'Pedido interrompido pelo cliente', 'intent_cancelled'); return finish();
  }
  const rememberField = (field: CollectedFieldDefinition) => {
    const origin = state.valueOrigins![field.variableKey];
    if (!origin || origin.source === 'integration' || !Object.hasOwn(state.values, field.variableKey)) return;
    state.sessionFacts![field.variableKey] = {
      value: state.values[field.variableKey], fieldType: field.type,
      labels: [field.name, ...(field.aliases || [])].map(normalize).filter(Boolean),
      source: origin.source, confirmed: field.requiresConfirmation ? origin.confirmed : true,
      isSensitive: Boolean(field.isSensitive), at: new Date(now()).toISOString(),
    };
  };
  const reuseSessionFacts = (fields: Array<{ field: CollectedFieldDefinition; stepKey: string }>) => {
    for (const { field, stepKey } of fields) {
      if (state.unavailableFields?.[stepKey]) continue;
      if (field.variableKey === state.pendingField) continue;
      if (Object.hasOwn(state.values, field.variableKey) || ['cpf', 'cnpj', 'cpf_cnpj', 'file'].includes(field.type) || (field.isSensitive && !field.requiresConfirmation)) continue;
      const labels = new Set([field.name, ...(field.aliases || [])].map(normalize).filter(Boolean));
      const exact = state.sessionFacts![field.variableKey];
      const semantic = Object.values(state.sessionFacts!).filter((fact) => fact.fieldType === field.type && fact.labels.some((label) => labels.has(label)));
      const fact = exact?.fieldType === field.type ? exact : semantic.length === 1 ? semantic[0] : undefined;
      if (!fact || !validateStudioField(field, fact.value).valid) continue;
      state.values[field.variableKey] = fact.value;
      state.valueOrigins![field.variableKey] = { source: fact.source, confirmed: fact.confirmed, stepId: stepKey, at: fact.at };
      event(stepKey, field.name, 'memory_reused');
    }
  };
  let collectionInterpretation: { variableKey: string; result: StudioCollectionInterpretation } | undefined;
  const directCandidate = (field: CollectedFieldDefinition) => normalizeStudioDirectAnswer(field, message, now(), document.rules.timeZone || 'America/Sao_Paulo')
    ?? extractStudioFieldCandidate(field, message, true);
  const supportsInterpretation = (field: CollectedFieldDefinition) => Boolean(deps.interpretCollection) && !field.isSensitive
    && !['cpf', 'cnpj', 'cpf_cnpj', 'file', 'phone', 'email', 'cep'].includes(field.type);
  const needsInterpretation = (field: CollectedFieldDefinition) => supportsInterpretation(field)
    && (field.type === 'single_select' ? resolveStudioOption(field.options || [], message).kind === 'unrecognized'
      : field.type === 'text' ? message.trim().split(/\s+/).length > 3
        : !validateStudioField(field, directCandidate(field)).valid);
  const interpretCollection = async (field: CollectedFieldDefinition) => {
    if (collectionInterpretation?.variableKey === field.variableKey) return collectionInterpretation.result;
    let result: StudioCollectionInterpretation = { kind: 'unavailable' };
    try {
      result = await deps.interpretCollection!({ message, fieldName: field.name, fieldType: field.type,
        prompt: field.promptMessage, options: field.options || [], lastAssistantMessage: state.lastTurn?.response || '' });
      deps.assertActive?.();
    } catch { deps.assertActive?.(); }
    collectionInterpretation = { variableKey: field.variableKey, result };
    return result;
  };
  const collect = async (field: CollectedFieldDefinition, stepKey: string): Promise<boolean> => {
    if (state.unavailableFields?.[stepKey]?.fieldKey === field.variableKey) return true;
    if (state.deferredFields?.[stepKey]?.fieldKey === field.variableKey) return true;
    const prohibited = matchProhibitedStudioField(field, document);
    if (prohibited) { await handoff(`A configuração tentou solicitar um dado proibido: ${prohibited}.`); return false; }
    const resolvedOptions = resolveStudioCollectionOptions(field, state.values);
    field = resolvedOptions.field;
    const options = resolvedOptions.options;
    const alreadyPresent = Object.hasOwn(state.values, field.variableKey);
    const directAnswer = state.pendingField === field.variableKey;
    const storedValue = state.values[field.variableKey];
    if (directAnswer && !alreadyPresent && turnDecision?.kind === 'continue') {
      state.status = 'waiting_input'; messages.push(field.promptMessage);
      event(stepKey, field.name, 'collection_resumed'); return false;
    }
    let confirmedProposal: string | undefined;
    const proposal = state.collectionProposal;
    if (proposal && directAnswer && !alreadyPresent && proposal.stepKey === stepKey) {
      const value = options ? options.find((option) => option.label === proposal.label)?.value : proposal.label;
      const valid = field.options?.includes(proposal.label) && value !== undefined
        && JSON.stringify(value) === proposal.valueSignature && now() >= proposal.at && now() - proposal.at <= 600_000;
      if (affirmative(message)) {
        delete state.collectionProposal;
        if (valid) {
          confirmedProposal = proposal.label;
          event(stepKey, field.name, 'collection_interpretation_confirmed');
        } else {
          state.status = 'waiting_input';
          messages.push(`Preciso conferir sua escolha novamente porque a sugestão expirou ou mudou. ${field.promptMessage}`);
          event(stepKey, field.name, 'collection_proposal_expired');
          return false;
        }
      } else if (negative(message)) {
        delete state.collectionProposal;
        state.status = 'waiting_input';
        messages.push(`Certo, não vou usar essa sugestão. ${field.promptMessage}`);
        event(stepKey, field.name, 'collection_proposal_rejected');
        return false;
      } else {
        // A new message replaces the proposed interpretation, never the customer's choice.
        delete state.collectionProposal;
      }
    }
    if (directAnswer && !alreadyPresent && isGreetingOnly(message)) {
      state.status = 'waiting_input';
      messages.push(`Olá! Podemos continuar de onde paramos. ${field.promptMessage}`);
      event(stepKey, field.name, 'collection_resumed');
      return false;
    }
    const answerQuestion = async () => {
      // A question pauses collection. It must never consume a validation attempt
      // or authorize downstream actions, including after a long session pause.
      let answer: string | null = null;
      try {
        answer = await deps.knowledge(message, document.resolveStage.knowledgeCollectionIds, {
          requireSources: true,
          collectionContext: { fieldName: field.name, options: field.options || [] },
        });
      } catch {
        deps.assertActive?.();
      }
      state.status = 'waiting_input';
      messages.push(answer?.trim() || 'Não tenho informação confirmada para responder a essa dúvida. Você pode pedir ajuda à equipe ou continuar quando preferir.');
      event(stepKey, field.name, answer?.trim() ? 'collection_question_answered' : 'collection_question_unanswered');
      return false;
    };
    if (directAnswer && !alreadyPresent && isStudioFieldQuestion(field, message)) return answerQuestion();
    let fieldInterpretation: StudioCollectionInterpretation | undefined;
    if (directAnswer && !alreadyPresent && (!turnDecision || turnDecision.kind === 'answer') && field.type !== 'single_select' && needsInterpretation(field)) {
      fieldInterpretation = await interpretCollection(field);
      if (fieldInterpretation.kind === 'question') return answerQuestion();
      if (fieldInterpretation.kind !== 'answer' && fieldInterpretation.kind !== 'boolean_value') {
        state.status = 'waiting_input'; messages.push(`Não entendi com segurança se você está respondendo ou quer esclarecer uma dúvida. ${field.promptMessage}`);
        event(stepKey, field.name, 'collection_needs_clarification'); return false;
      }
    }
    if (directAnswer && !alreadyPresent && field.type === 'single_select' && !confirmedProposal) {
      const resolution = resolveStudioOption(field.options || [], message);
      if (resolution.kind === 'ambiguous') {
        state.status = 'waiting_input';
        messages.push(`Essa resposta corresponde a mais de uma opção. Qual delas você prefere?\n${resolution.options.map((option) => `${(field.options || []).indexOf(option) + 1}. ${option}`).join('\n')}`);
        event(stepKey, field.name, 'collection_ambiguous');
        return false;
      }
      if (resolution.kind === 'selected') event(stepKey, `${field.name}: ${resolution.strategy}`, 'collection_option_matched');
      if (resolution.kind === 'unrecognized' && deps.interpretCollection && !field.isSensitive) {
        const interpretation = await interpretCollection(field);
        if (interpretation.kind === 'question') return answerQuestion();
        state.status = 'waiting_input';
        if (interpretation.kind === 'proposal' && field.options?.includes(interpretation.label)) {
          const value = options ? options.find((option) => option.label === interpretation.label)?.value : interpretation.label;
          if (value !== undefined) {
            state.collectionProposal = { stepKey, label: interpretation.label, valueSignature: JSON.stringify(value), at: now() };
            messages.push(`Você quer dizer ${interpretation.label}? Confirme com “sim” ou informe outra opção.`);
            event(stepKey, field.name, 'collection_interpretation_proposed');
            return false;
          }
        }
        messages.push(`Não consegui identificar sua escolha com segurança. Pode dizer o nome ou o número da opção desejada? Também posso esclarecer uma dúvida sobre ${field.name}.`);
        event(stepKey, field.name, interpretation.kind === 'unclear' || interpretation.kind === 'different_request' ? 'collection_needs_clarification' : 'collection_interpreter_unavailable');
        return false;
      }
    }
    let supplied = confirmedProposal ?? (fieldInterpretation?.kind === 'boolean_value' ? fieldInterpretation.value : directAnswer ? directCandidate(field) : extractStudioFieldCandidate(field, message, false));
    let source: 'customer' | 'contact_property' | 'flow_input' = 'customer';
    let reusable: unknown;
    if (!directAnswer && supplied === undefined && field.reuseFrom) {
      reusable = readStudioValue(field.reuseFrom.sourceType === 'contact_property' ? input.context?.contact : input.context?.input, field.reuseFrom.sourceValue);
      if (validateStudioField(field, reusable).valid) source = field.reuseFrom.sourceType;
      else reusable = undefined;
    }
    const candidate = alreadyPresent ? options
      ? field.type === 'multi_select' && Array.isArray(storedValue) ? storedValue.map((value) => options!.find((option) => JSON.stringify(option.value) === JSON.stringify(value))?.label)
        : options.find((option) => JSON.stringify(option.value) === JSON.stringify(storedValue))?.label
      : storedValue
      : field.type === 'file' ? input.attachment : options?.length === 1 && field.type === 'single_select' ? options[0].label : supplied ?? reusable;
    const validated = validateStudioField(field, candidate);
    if (!validated.valid) {
      if (!field.required && !directAnswer && candidate === undefined) return true;
      delete state.values[field.variableKey];
      delete state.valueOrigins![field.variableKey];
      if (directAnswer) { state.attempts[stepKey] = (state.attempts[stepKey] || 0) + 1; event(stepKey, field.name, 'validation_failed'); }
      if ((state.attempts[stepKey] || 0) >= field.maxAttempts) {
        interruptProcedure('validation_exhausted');
        messages.push(`Não consegui validar ${field.name} após algumas tentativas, então parei este procedimento sem transferir o atendimento. Você pode reformular o pedido, iniciar outro assunto ou pedir uma pessoa.`);
        event(stepKey, field.name, 'procedure_interrupted');
        return false;
      }
      state.pendingField = field.variableKey; state.status = 'waiting_input';
      const repeatedInvalidAnswer = directAnswer && (state.attempts[stepKey] || 0) > 1;
      messages.push(directAnswer
        ? repeatedInvalidAnswer
          ? `Ainda não consegui usar essa resposta para ${field.name}. ${validated.error} Se preferir parar este procedimento, diga “não precisa”.`
          : validated.error
        : [field.promptMessage, field.options?.map((option, index) => `${index + 1}. ${option}`).join('\n')].filter(Boolean).join('\n'));
      event(stepKey, field.name, 'waiting_input');
      return false;
    }
    state.values[field.variableKey] = options ? Array.isArray(validated.value)
      ? validated.value.map((label) => options!.find((option) => option.label === label)!.value)
      : options.find((option) => option.label === validated.value)!.value : validated.value;
    if (!alreadyPresent) state.valueOrigins![field.variableKey] = { source, confirmed: Boolean(confirmedProposal), stepId: stepKey, at: new Date(now()).toISOString() };
    if (field.requiresConfirmation && !state.valueOrigins![field.variableKey]?.confirmed && state.confirmation?.key !== `field:${stepKey}`) {
      state.pendingField = null;
      state.confirmation = { key: `field:${stepKey}`, signature: JSON.stringify(validated.value), at: now() };
      state.status = 'waiting_input';
      const isSecret = field.isSensitive && !['phone', 'email'].includes(field.type);
      messages.push(isSecret ? `Confirma que ${field.name} foi informado corretamente?` : `Confirma ${field.name}: ${String(validated.value)}?`);
      return false;
    }
    if (state.confirmation?.key === `field:${stepKey}`) {
      if (negative(message)) {
        delete state.values[field.variableKey]; delete state.valueOrigins![field.variableKey]; state.confirmation = null; state.pendingField = field.variableKey;
        messages.push(field.promptMessage); return false;
      }
      if (!affirmative(message) || now() - state.confirmation.at > 600_000) {
        state.confirmation.at = now(); messages.push(`Confirma a informação de ${field.name}? Responda sim ou não.`); return false;
      }
      state.confirmation = null;
      if (state.valueOrigins![field.variableKey]) state.valueOrigins![field.variableKey].confirmed = true;
    }
    state.pendingField = null; state.status = 'running';
    rememberField(field);
    event(stepKey, field.name, 'collected');
    return true;
  };
  const captureOfferedFields = (fields: Array<{ field: CollectedFieldDefinition; stepKey: string }>) => {
    if (!message.trim()) return;
    if (isStudioInformationQuestion(message)) return;
    const offered = fields.flatMap(({ field, stepKey }) => {
      if (state.unavailableFields?.[stepKey]) return [];
      if (field.variableKey === state.pendingField) return [];
      if (Object.hasOwn(state.values, field.variableKey) || field.optionsSourceKey || field.type === 'file') return [];
      const labelled = message.split(/[;\n]/).some((part) => part.includes(':') && matchesStudioFieldLabel(field, part.slice(0, part.indexOf(':'))));
      const candidate = extractStudioFieldCandidate(field, message, false);
      const validated = validateStudioField(field, candidate);
      return validated.valid ? [{ field, stepKey, labelled, value: validated.value }] : [];
    });
    for (const item of offered) {
      const competing = offered.filter((candidate) => !candidate.labelled && candidate.field.type === item.field.type);
      if (!item.labelled && competing.length > 1) continue;
      state.values[item.field.variableKey] = item.value;
      state.valueOrigins![item.field.variableKey] = { source: 'customer', confirmed: false, stepId: item.stepKey, at: new Date(now()).toISOString() };
    }
  };
  let actionDecisions = 0;
  const conductAdaptiveAction = async (): Promise<'continue' | 'selected' | 'answered'> => {
    if (!deps.planAction || state.adaptiveOperation || state.confirmation || state.collectionProposal) return 'continue';
    const question = turnDecision?.kind === 'question';
    const capabilities = availableStudioActions(document, state, context(), question);
    const evidence = studioVerifiedEvidence(document, state);
    const canAnswer = Boolean(Object.keys(evidence).length || question);
    if (actionDecisions >= 4) {
      if (!question) return 'continue';
      messages.push('As consultas deste turno foram limitadas. Seu pedido foi preservado para continuarmos com segurança.');
      state.status = 'waiting_input'; event('planning', 'Limite de decisões do turno', 'adaptive_budget_reached'); return 'answered';
    }
    if (!capabilities.length && !question) return 'continue';
    actionDecisions++;
    let decision: string | null = null;
    try { decision = await deps.planAction({ document, state: structuredClone(state), message: input.message, capabilities, canAnswer, question }); }
    catch { deps.assertActive?.(); }
    deps.assertActive?.();
    if (decision === 'continue' && !question) return 'continue';
    if ((decision === 'answer' || (decision === 'continue' && question)) && canAnswer) {
      let answer: string | null = null;
      try {
        answer = Object.keys(evidence).length && deps.answerFromEvidence
          ? await deps.answerFromEvidence({ question: input.message, values: evidence })
          : await deps.knowledge(input.message, document.resolveStage.knowledgeCollectionIds, { requireSources: true });
      } catch { deps.assertActive?.(); }
      deps.assertActive?.();
      messages.push(answer?.trim() || 'Não encontrei informação confirmada suficiente para responder. Seu pedido foi preservado.');
      state.status = 'waiting_input'; event('planning', 'Resposta com fontes verificadas', answer?.trim() ? 'adaptive_answered' : 'adaptive_evidence_missing');
      return 'answered';
    }
    const selected = availableStudioActions(document, state, context(), question).find((c) => c.id === decision);
    if (!selected) {
      messages.push('Não consegui decidir o próximo passo com segurança. Seu pedido foi preservado; pode esclarecer o que deseja fazer?');
      state.status = 'waiting_input'; event('planning', 'Ação não autorizada ou indisponível', 'adaptive_action_rejected'); return 'answered';
    }
    const targetProcedure = document.resolveStage.procedures.find((p) => p.steps.some((s) => s.id === selected.stepId)) || procedure;
    state.adaptiveOperation = { procedureId: targetProcedure?.id || selected.stepId, stepId: selected.stepId, returnIndex: state.stepIndex };
    state.stepIndex = selected.index; state.pendingField = null;
    event(selected.stepId, selected.title, 'adaptive_action_selected');
    return 'selected';
  };
  const conductCollection = async (window: NonNullable<ReturnType<typeof studioCollectionWindow>>): Promise<boolean> => {
    if (turnDecision?.kind === 'question' && deps.planAction) return await conductAdaptiveAction() === 'selected';
    const settled = window.fields.every(({ field, stepKey }) => Object.hasOwn(state.values, field.variableKey)
      || state.unavailableFields?.[stepKey] || state.deferredFields?.[stepKey]);
    const planned = settled ? { plan: { intent: 'contribute', nextFieldKey: null, deferFields: [] }, observations: [] } : await planWindow(window);
    if (!planned || planned.plan.intent !== 'contribute') {
      state.status = 'waiting_input';
      messages.push('Preciso esclarecer como continuar com seu pedido. Você quer acrescentar uma informação, tirar uma dúvida ou mudar o que deseja fazer?');
      event('planning', 'Plano conversacional indisponível ou inconclusivo', 'collection_plan_unavailable');
      return false;
    }
    event('planning', `Próximo campo: ${planned.plan.nextFieldKey || 'nenhum'}`, 'collection_planned');
    for (const observation of planned.observations) {
      if (observation.status === 'unavailable') {
        state.unavailableFields ||= {};
        state.unavailableFields[observation.stepKey] = { fieldKey: observation.fieldKey, at: new Date(now()).toISOString() };
        delete state.values[observation.fieldKey]; delete state.sessionFacts![observation.fieldKey]; delete state.valueOrigins![observation.fieldKey];
        event(observation.stepKey, window.fields.find((f) => f.field.variableKey === observation.fieldKey)!.field.name, 'field_unavailable');
      } else {
        state.values[observation.fieldKey] = observation.value;
        state.valueOrigins![observation.fieldKey] = { source: 'customer', confirmed: false, stepId: observation.stepKey, at: new Date(now()).toISOString() };
      }
      delete state.deferredFields?.[observation.stepKey];
    }
    for (const key of planned.plan.deferFields) {
      const entry = window.fields.find((f) => f.field.variableKey === key)!;
      state.deferredFields ||= {};
      state.deferredFields[entry.stepKey] = { fieldKey: key, at: new Date(now()).toISOString() };
      event(entry.stepKey, entry.field.name, 'field_deferred');
    }
    planningConsumedMessage = true;
    message = ''; state.pendingField = null;
    if (planned.observations.some((o) => o.status === 'unavailable')) messages.push('Tudo bem, podemos continuar com as informações disponíveis.');
    // Collected facts still pass validation/confirmation before any execution.
    for (const entry of window.fields) {
      if (!Object.hasOwn(state.values, entry.field.variableKey)) continue;
      if (state.phase === 'resolve') state.stepIndex = entry.index;
      if (!await collect(entry.field, entry.stepKey)) return false;
    }
    // Consult available sources before asking for another field. On completion
    // the normal executor returns here with verified results and a fresh plan.
    while (true) {
      const action = await conductAdaptiveAction();
      if (action !== 'continue') return action === 'selected';
      const missing = window.fields.filter(({ field, stepKey }) => !Object.hasOwn(state.values, field.variableKey)
        && !state.unavailableFields?.[stepKey] && !state.deferredFields?.[stepKey]);
      if (!missing.length) break;
      const next = missing.find((entry) => entry.field.variableKey === planned.plan.nextFieldKey) || missing[0];
      if (!next) {
        state.status = 'waiting_input';
        messages.push('Seu pedido foi preservado. Preciso esclarecer qual informação podemos obter para continuar.');
        event('planning', 'Próxima pergunta não autorizada', 'collection_plan_unavailable'); return false;
      }
      if (state.phase === 'resolve') state.stepIndex = next.index;
      const collected = await collect(next.field, next.stepKey);
      if (!collected) return false;
    }
    if (state.phase === 'resolve') state.stepIndex = window.end;
    await checkpoint();
    return true;
  };
  if (state.resumeProposal && !isStudioResumeRequest(message) && !affirmative(message) && !negative(message)) delete state.resumeProposal;
  if (isStudioResumeRequest(message) || state.resumeProposal) {
    if (state.resumeProposal && negative(message)) {
      delete state.resumeProposal; messages.push('Certo, não retomei o pedido anterior. Podemos continuar com o assunto atual.'); return finish();
    }
    const target = state.resumeProposal ? state.suspendedProcedures?.find((p) => p.procedureId === state.resumeProposal!.procedureId) : state.suspendedProcedures?.at(-1);
    if (!target || target.releaseId !== state.releaseId || now() < target.at || now() - target.at > STUDIO_RESUME_TTL
      || (state.resumeProposal && now() - state.resumeProposal.at > 600_000)) {
      delete state.resumeProposal; messages.push('Não há um pedido anterior que possa ser retomado com segurança. Informe novamente o que deseja fazer.');
      event('resume', 'Retomada indisponível ou expirada', 'resume_unavailable'); return finish();
    }
    if (state.phase !== 'conclude' && studioProcedureHasExecutedOperation(document, state)) {
      delete state.resumeProposal; messages.push('O pedido atual já teve uma operação executada. Precisamos concluir ou conferir esse resultado antes de retomar outro pedido.');
      event('resume', 'Operação atual exige conferência', 'resume_blocked'); return finish();
    }
    if (state.resumeProposal && affirmative(message)) {
      const targetId = target.procedureId;
      suspendStudioProcedure(document, state, now());
      if (restoreStudioProcedure(document, state, targetId, now())) {
        const restored = document.resolveStage.procedures.find((p) => p.id === targetId)!;
        messages.push(`Retomei ${restored.name}. ${restored.steps[state.stepIndex]?.collectField?.promptMessage || 'Diga como deseja continuar.'}`);
        event(targetId, restored.name, 'procedure_resumed'); return finish();
      }
      delete state.resumeProposal; messages.push('O pedido anterior não está mais disponível. Informe novamente o que precisa.'); return finish();
    }
    if (!isStudioResumeRequest(message)) {
      delete state.resumeProposal; // A new request is not consent to restore a task.
    } else {
      state.resumeProposal = { procedureId: target.procedureId, at: now() }; state.status = 'waiting_input';
      const name = document.resolveStage.procedures.find((p) => p.id === target.procedureId)?.name || 'o pedido anterior';
      messages.push(`Quer retomar ${name} de onde paramos? Dados sensíveis serão solicitados novamente. Responda sim ou não.`);
      event(target.procedureId, 'Confirmar retomada', 'resume_proposed'); return finish();
    }
  }
  let currentProcedure = document.resolveStage.procedures.find((item) => item.id === state.procedureId);
  let currentField = currentProcedure?.steps[state.stepIndex]?.collectField;
  if (currentField?.optionsSourceKey) {
    try { currentField = resolveStudioCollectionOptions(currentField, state.values).field; }
    catch { currentField = undefined; } // The collection step reports invalid configuration through its normal failure path.
  }
  const hasPendingSelection = currentField?.type === 'single_select'
    && state.pendingField === currentField.variableKey
    && !state.confirmation
    && resolveStudioOption(currentField.options || [], message).kind === 'selected';
  const hasPendingStructuredAnswer = currentField && !['text', 'file', 'single_select'].includes(currentField.type)
    && state.pendingField === currentField.variableKey && !state.confirmation && !isStudioFieldQuestion(currentField, message)
    && validateStudioField(currentField, directCandidate(currentField)).valid;
  const hasPendingAside = currentField && state.pendingField === currentField.variableKey
    && !Object.hasOwn(state.values, currentField.variableKey) && !state.confirmation && !state.topicChange
    && (isStudioFieldQuestion(currentField, message) || isGreetingOnly(message));
  const canInterpretPending = currentField && supportsInterpretation(currentField)
    && state.pendingField === currentField.variableKey && !state.confirmation && !state.topicChange
    && !Object.hasOwn(state.values, currentField.variableKey) && !matchProhibitedStudioField(currentField, document);
  if (!turnDecision && currentField && canInterpretPending && !hasPendingAside && !hasPendingSelection
    && !(state.collectionProposal && (affirmative(message) || negative(message)))
    && detectExplicitStudioConversationControl(message) === 'answer'
    && needsInterpretation(currentField)) {
    await interpretCollection(currentField);
  }
  const hasPendingInterpretation = canInterpretPending && (currentField?.type === 'single_select' || collectionInterpretation?.variableKey === currentField?.variableKey)
    && collectionInterpretation?.result.kind !== 'different_request';
  const procedures = document.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').sort((a, b) => b.priority - a.priority);
  const discardProcedureData = (procedureId: string) => {
    for (const key of Object.keys(state.values)) if (state.valueOrigins![key]?.stepId.startsWith(`${procedureId}:`)) {
      delete state.values[key]; delete state.valueOrigins![key];
    }
  };
  const rememberIntentOutcome = (procedureId: string, outcome: string) => {
    if (!state.activeIntent?.trim()) return;
    state.intentHistory = [...(state.intentHistory || []), {
      intent: state.activeIntent.trim().slice(0, 2000),
      procedureId,
      outcome,
      at: new Date(now()).toISOString(),
    }].slice(-20);
  };
  if (currentProcedure && (state.pendingField || state.confirmation || turnDecision?.kind === 'cancel' || turnDecision?.kind === 'change')) {
    const activeProcedure = currentProcedure;
    const pendingStep = activeProcedure.steps[state.stepIndex];
    const pendingField = pendingStep?.collectField;
    let control: StudioConversationControl = turnDecision
      ? (turnDecision.kind === 'cancel' ? 'cancel_procedure' : turnDecision.kind === 'change' ? 'change_intent' : 'answer')
      : detectExplicitStudioConversationControl(message);
    if (
      control === 'answer'
      && !turnDecision
      && !hasPendingSelection
      && !hasPendingStructuredAnswer
      && !hasPendingAside
      && !hasPendingInterpretation
      && collectionInterpretation?.result.kind !== 'different_request'
      && !affirmative(message)
      && !negative(message)
      && studioMessageMayContainConversationControl(message)
      && deps.classifyControl
    ) {
      try { control = await deps.classifyControl({ message, procedure: activeProcedure, pendingField }); }
      catch { control = 'answer'; }
    }
    if (control === 'request_human') {
      await handoff('O cliente pediu atendimento humano.'); return finish();
    }
    if (control === 'conclude') {
      rememberIntentOutcome(activeProcedure.id, 'concluded_by_customer');
      state.suspendedProcedures = state.suspendedProcedures?.filter((p) => p.procedureId !== activeProcedure.id);
      discardProcedureData(activeProcedure.id);
      state.procedureId = null;
      state.stepIndex = 0;
      state.phase = 'done';
      state.status = 'resolved';
      state.pendingField = null;
      state.confirmation = null;
      delete state.collectionProposal; delete state.topicChange; delete state.resumeProposal;
      delete state.activeIntent;
      messages.push(document.concludeStage.successClosingMessage);
      event(activeProcedure.id, activeProcedure.name, 'conversation_concluded');
      return finish();
    }
    if (control === 'cancel_procedure' || (control === 'skip_field' && pendingField?.required !== false)) {
      const completedEffects = activeProcedure.steps.some((step) => (
        (state.visits[`${activeProcedure.id}:${step.id}`] || 0) > 0
        && (step.type === 'native_action' || step.type === 'mcp_tool_call' || (step.httpRequest && step.httpRequest.method !== 'GET'))
      ));
      rememberIntentOutcome(activeProcedure.id, 'cancelled_by_customer');
      state.suspendedProcedures = state.suspendedProcedures?.filter((p) => p.procedureId !== activeProcedure.id);
      discardProcedureData(activeProcedure.id);
      state.procedureId = null;
      state.stepIndex = 0;
      state.phase = 'resolve';
      state.status = 'waiting_input';
      state.pendingField = null;
      state.confirmation = null;
      delete state.collectionProposal; delete state.topicChange; delete state.resumeProposal;
      delete state.activeIntent;
      messages.push(completedEffects
        ? 'Certo, parei este procedimento. As ações já concluídas não foram desfeitas. O que você gostaria de fazer agora?'
        : 'Certo, parei este procedimento. O que você gostaria de fazer agora?');
      event(activeProcedure.id, activeProcedure.name, 'procedure_cancelled');
      return finish();
    }
    if (control === 'skip_field' && pendingField?.required === false) {
      state.pendingField = null;
      state.confirmation = null;
      state.attempts[`${activeProcedure.id}:${pendingStep.id}`] = 0;
      state.stepIndex++;
      state.status = 'waiting_input';
      const nextField = activeProcedure.steps[state.stepIndex]?.collectField;
      if (nextField) state.pendingField = nextField.variableKey;
      messages.push(nextField
        ? `Certo, vamos pular ${pendingField.name}. ${nextField.promptMessage}`
        : `Certo, vamos pular ${pendingField.name}.`);
      event(pendingStep.id, pendingField.name, 'field_skipped');
      return finish();
    }
    if (control === 'change_intent') {
      const completedEffects = activeProcedure.steps.some((step) => (
        (state.visits[`${activeProcedure.id}:${step.id}`] || 0) > 0
        && (step.type === 'native_action' || step.type === 'mcp_tool_call' || (step.httpRequest && step.httpRequest.method !== 'GET'))
      ));
      if (completedEffects) {
        await handoff('O cliente mudou de solicitação após uma ação já executada. A equipe deve conferir a operação incompleta.');
        return finish();
      }
      rememberIntentOutcome(activeProcedure.id, 'changed_by_customer');
      suspendStudioProcedure(document, state, now());
      discardProcedureData(activeProcedure.id);
      state.procedureId = null;
      state.stepIndex = 0;
      state.phase = 'resolve';
      state.status = 'running';
      state.pendingField = null;
      state.confirmation = null;
      state.initialIntent = message;
      delete state.activeIntent;
      event(activeProcedure.id, activeProcedure.name, 'procedure_changed');
      currentProcedure = undefined;
    }
  }
  let switched = false;
  if (state.topicChange) {
    const target = procedures.find((procedure) => procedure.id === state.topicChange!.procedureId);
    if (!target || now() - state.topicChange.at > 600_000) {
      if (target) discardProcedureData(target.id);
      delete state.topicChange; messages.push('A confirmação de mudança expirou. Informe novamente o que precisa.'); return finish();
    }
    if (negative(message)) {
      discardProcedureData(target.id);
      delete state.topicChange;
      messages.push(`Certo, vamos continuar com ${currentProcedure?.name || 'a solicitação anterior'}.`);
      const pending = currentProcedure?.steps[state.stepIndex];
      messages.push(pending?.collectField?.promptMessage || (state.phase === 'conclude' ? document.concludeStage.confirmResolutionQuestion : 'Informe novamente como deseja continuar.'));
      return finish();
    }
    if (!affirmative(message)) { messages.push(`Posso seguir com ${naturalProcedureName(target.name)}? Responda sim ou não.`); return finish(); }
    if (state.phase !== 'conclude' && currentProcedure?.steps.some((step) => (state.visits[`${currentProcedure.id}:${step.id}`] || 0) > 0 &&
      (step.type === 'native_action' || step.type === 'mcp_tool_call' || (step.httpRequest && step.httpRequest.method !== 'GET')))) {
      discardProcedureData(target.id);
      delete state.topicChange; await handoff('Mudança de assunto durante um procedimento com alterações já executadas. A equipe deve conferir a operação incompleta.'); return finish();
    }
    const targetIntent = state.topicChange.intent || target.name;
    suspendStudioProcedure(document, state, now());
    clearProcedureData(target.id); delete state.topicChange; state.procedureId = target.id; state.activeIntent = targetIntent; state.phase = 'resolve'; state.status = 'running'; switched = true;
    event(target.id, target.name, 'procedure_selected');
    event(target.id, 'Mudança de assunto confirmada', 'topic_changed');
  }
  if (!turnDecision && !switched && currentProcedure && !hasPendingSelection && !hasPendingStructuredAnswer && !hasPendingAside && !hasPendingInterpretation && !/\b(corrigir|corrigindo|corrija|correto|correta|alterar meu|alterar minha)\b/.test(normalize(message)) && !affirmative(message) && !negative(message)) {
    const exactOther = procedures.find((procedure) => procedure.id !== currentProcedure.id && normalize(procedure.name) === normalize(message));
    const matches = procedures.filter((procedure) => procedure.triggerKeywords.some((keyword) => keyword.trim() && normalize(message).includes(normalize(keyword))));
    let targetId = exactOther?.id || (matches.length === 1 && matches[0].id !== currentProcedure.id ? matches[0].id : null);
    if (deps.chooseProcedure && (targetId || collectionInterpretation?.result.kind === 'different_request' || /\b(quero|preciso|gostaria|mudar de assunto|outro assunto)\b/.test(normalize(message)))) {
      try { const choice = await deps.chooseProcedure(procedures, message); targetId = typeof choice === 'string' ? choice : null; }
      catch { targetId = null; }
    }
    const target = procedures.find((procedure) => procedure.id === targetId && procedure.id !== currentProcedure.id);
    if (target) {
      captureOfferedFields(target.steps.flatMap((step) => step.collectField ? [{ field: step.collectField, stepKey: `${target.id}:${step.id}` }] : []));
      state.topicChange = { procedureId: target.id, at: now(), intent: message.slice(0, 2000) }; state.confirmation = null; state.status = 'waiting_input';
      messages.push(`Entendi — você quer ${naturalProcedureName(target.name)}. Posso seguir com isso?`);
      event(target.id, 'Confirmar mudança de assunto', 'waiting_confirmation'); return finish();
    }
  }
  if (turnDecision?.kind === 'correct' || (!turnDecision && /\b(corrigir|corrigindo|corrija|correto|correta|alterar meu|alterar minha)\b/.test(normalize(message)))) {
    const fields = [
      ...(document.understandStage.askInitialData ? document.understandStage.initialFields.map((field) => ({ field, index: -1 })) : []),
      ...(currentProcedure?.steps.flatMap((step, index) => step.collectField ? [{ field: step.collectField, index }] : []) || []),
    ].filter(({ field }) => (Object.hasOwn(state.values, field.variableKey) || Object.values(state.unavailableFields || {}).some((entry) => entry.fieldKey === field.variableKey)) && (turnDecision?.kind === 'correct'
      ? field.variableKey === turnDecision.fieldKey : [field.name, ...(field.aliases || [])].some((label) => normalize(message).includes(normalize(label)))));
    if (fields.length === 1) {
      const { field, index } = fields[0];
      const affected = currentProcedure?.steps.slice(Math.max(0, index)) || [];
      const wroteData = affected.some((step) => (state.visits[`${currentProcedure!.id}:${step.id}`] || 0) > 0 &&
        (step.type === 'native_action' || step.type === 'mcp_tool_call' || (step.type === 'http_request' && step.httpRequest?.method !== 'GET')));
      if (wroteData) {
        await handoff('O cliente pediu correção de um dado após uma ação já executada. É necessária revisão antes de repetir.'); return finish();
      }
      for (const step of affected) delete state.adaptiveCompletedSteps?.[`${currentProcedure!.id}:${step.id}`];
      delete state.adaptiveOperation;
      const invalidatedOutputKeys = new Set<string>();
      for (const step of affected) {
        for (const key of [
          ...(step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []).map((output) => output.chipKey),
          `knowledge_${step.id}`,
        ]) {
          invalidatedOutputKeys.add(key);
          delete state.values[key];
          delete state.valueOrigins![key];
          delete state.sessionFacts![key];
        }
      }
      for (const step of affected) {
        if (step.collectField) {
          const stepField = step.collectField;
          const isTargetField = stepField.variableKey === field.variableKey;
          const dependsOnInvalidatedSource = Boolean(stepField.optionsSourceKey && invalidatedOutputKeys.has(stepField.optionsSourceKey));
          if (isTargetField || dependsOnInvalidatedSource) {
            delete state.values[stepField.variableKey];
            delete state.valueOrigins![stepField.variableKey];
            delete state.sessionFacts![stepField.variableKey];
          }
        }
      }
      delete state.values[field.variableKey];
      delete state.valueOrigins![field.variableKey];
      delete state.sessionFacts![field.variableKey];
      for (const [key, entry] of Object.entries(state.unavailableFields || {})) if (entry.fieldKey === field.variableKey) delete state.unavailableFields![key];
      state.confirmation = null; state.pendingField = field.variableKey;
      if (index < 0) { state.phase = 'understand'; state.procedureId = null; state.initialIntent = currentProcedure?.name || state.initialIntent; }
      else { state.phase = 'resolve'; state.stepIndex = index; }
      event(field.id, field.name, 'correction_requested');
      if (turnDecision?.kind === 'correct') {
        state.status = 'waiting_input'; messages.push(field.promptMessage); return finish();
      }
    }
  }
  if (state.phase === 'understand') {
    state.initialIntent ??= message;
    const firstTurn = !state.lastTurn;
    if (firstTurn && isGreetingOnly(message)) messages.push(document.understandStage.welcomeMessage);
    if (document.understandStage.askInitialData) {
      if (!deps.planCollection) captureOfferedFields(document.understandStage.initialFields.map((field) => ({ field, stepKey: `initial:${field.id}` })));
      try {
        const initialWindow = deps.planCollection && !state.confirmation && !state.collectionProposal ? studioCollectionWindow(document, state) : null;
        if (initialWindow) {
          if (!await conductCollection(initialWindow)) return finish();
        } else for (const field of document.understandStage.initialFields) if (!await collect(field, `initial:${field.id}`)) return finish();
      } catch (error) {
        if (error instanceof StudioCheckpointError) throw error;
        await handoff('Não foi possível preparar a coleta inicial. A configuração precisa de revisão.'); return finish();
      }
    }
    state.phase = 'resolve';
    if (firstTurn && isGreetingOnly(message) && !document.understandStage.askInitialData) {
      delete state.initialIntent;
      state.status = 'waiting_input';
      event('greeting', 'Saudação inicial', 'waiting_input');
      return finish();
    }
  }
  if (state.phase === 'conclude') {
    if (turnDecision?.kind === 'confirm' || (!turnDecision && affirmative(message))) {
      state.phase = 'done'; state.status = 'resolved'; messages.push(document.concludeStage.successClosingMessage);
    } else if (turnDecision?.kind === 'reject' || (!turnDecision && literalNegative(message))) {
      await handoff('O cliente informou que a solicitação não foi resolvida.');
    } else if (turnDecision?.kind === 'handoff') {
      await handoff('O cliente solicitou atendimento humano.');
    } else {
      clearProcedureData(); state.phase = 'resolve'; state.procedureId = null;
    }
    if (state.phase === 'done') return finish();
  }
  if (!state.procedureId) {
    const routingMessage = state.initialIntent || message;
    delete state.initialIntent;
    if (isGreetingOnly(routingMessage)) {
      delete state.routingOptions;
      delete state.routingContext;
      state.status = 'waiting_input';
      if (!messages.length) messages.push(document.understandStage.welcomeMessage);
      event('greeting', 'Saudação', 'waiting_input');
      return finish();
    }
    const exact = procedures.find((procedure) => normalize(procedure.name) === normalize(routingMessage));
    const candidates = procedures.filter((procedure) => procedure.triggerKeywords.some((keyword) => keyword.trim() && normalize(routingMessage).includes(normalize(keyword))));
    const option = /^\d+$/.test(routingMessage.trim()) ? state.routingOptions?.[Number(routingMessage.trim()) - 1] : undefined;
    let selected = resolutionContinuationId || option || exact?.id || (candidates.length === 1 ? candidates[0].id : null);
    let ambiguous = !selected && candidates.length > 1 ? candidates.map((procedure) => procedure.id) : [];
    if (deps.chooseProcedure && !resolutionContinuationId) {
      // A concrete choice is stronger evidence than its explanation (e.g. a
      // usage profile). Do not restart recommendation after a product selection.
      const chosenOptions = proceduresMatchingChoice(procedures, routingMessage);
      const routingProcedures = option ? procedures.filter((p) => p.id === option) : chosenOptions.length ? chosenOptions : procedures;
      try { const choice = await deps.chooseProcedure(routingProcedures,
        option ? `Solicitação original: ${state.routingContext || ''}. O cliente escolheu: ${procedures.find((procedure) => procedure.id === option)?.name}. Verifique ainda as exclusões e a elegibilidade.` : routingMessage);
        selected = typeof choice === 'string' && routingProcedures.some((p) => p.id === choice) ? choice : null;
        ambiguous = choice && typeof choice === 'object' ? choice.candidates.filter((id) => routingProcedures.some((p) => p.id === id)) : []; }
      catch { await handoff('A identificação da solicitação está indisponível.'); return finish(); }
    }
    if (!procedures.some((procedure) => procedure.id === selected)) selected = null;
    if (!selected && ambiguous.length) {
      state.routingOptions = procedures.filter((procedure) => ambiguous.includes(procedure.id)).slice(0, 8).map((procedure) => procedure.id);
      state.routingContext ||= routingMessage;
      state.attempts.routing = (state.attempts.routing || 0) + 1;
      if (state.attempts.routing >= document.concludeStage.maxRetriesBeforeHandoff) await handoff('A solicitação continuou ambígua após as tentativas de esclarecimento.');
      else {
        const names = state.routingOptions.map((id) => procedures.find((procedure) => procedure.id === id)!.name);
        const naturalOptions = names.map((name) => `“${name}”`).join(names.length === 2 ? ' ou ' : ', ').replace(/, ([^,]+)$/, ' ou $1');
        const clarification = names.length <= 3
          ? `Só para eu entender melhor: você quer ${naturalOptions}?`
          : 'Pode me contar um pouco mais sobre o que você precisa? Assim consigo direcionar você da melhor forma.';
        state.status = 'waiting_input'; messages.push(clarification); event('routing', 'Esclarecer solicitação', 'waiting_input');
      }
      return finish();
    }
    if (!selected) {
      if (document.resolveStage.allowGeneralAiChat || document.resolveStage.knowledgeCollectionIds.length) {
        let response: string | null = null;
        try { response = await deps.knowledge(routingMessage, document.resolveStage.knowledgeCollectionIds); }
        catch { await handoff('A consulta às fontes está indisponível.'); return finish(); }
        if (response) { messages.push(response); state.status = 'waiting_input'; return finish(); }
      }
      state.attempts.routing = (state.attempts.routing || 0) + 1;
      if (state.attempts.routing >= document.concludeStage.maxRetriesBeforeHandoff) await handoff('Não foi possível identificar um procedimento adequado.');
      else { messages.push(document.understandStage.outOfScopeMessage); state.status = 'waiting_input'; }
      return finish();
    }
    state.procedureId = selected; state.stepIndex = 0; state.activeIntent = routingMessage.slice(0, 2000);
    // Selecting a procedure commits its entry path. A question-shaped request
    // must not generate a free-form collection question before that path runs.
    if (turnDecision?.kind === 'question') turnDecision = { kind: 'answer' };
    delete state.adaptiveOperation;
    for (const key of Object.keys(state.adaptiveCompletedSteps || {})) if (key.startsWith(`${selected}:`)) delete state.adaptiveCompletedSteps![key];
    for (const key of Object.keys(state.deferredFields || {})) if (key.startsWith(`${selected}:`)) delete state.deferredFields![key];
    delete state.routingOptions;
    delete state.routingContext;
    event(selected, procedures.find((procedure) => procedure.id === selected)!.name, 'procedure_selected');
  }
  const procedure = document.resolveStage.procedures.find((item) => item.id === state.procedureId);
  if (!procedure) throw new Error('O procedimento da sessão não existe nesta versão.');
  const procedureFields = procedure.steps.flatMap((step) => step.collectField ? [{ field: step.collectField, stepKey: `${procedure.id}:${step.id}` }] : []);
  reuseSessionFacts(procedureFields);
  if (deps.planCollection) captureOfferedFields(procedureFields.filter(({ field }) => field.type === 'single_select'));
  // Recover earlier contributions before asking again, including choices made
  // while a catalog was active and answers to legacy untracked questions.
  if (deps.recoverFacts && !state.confirmation && !state.collectionProposal && turnDecision?.kind !== 'question'
    && !studioCollectionWindow(document, state)) {
    const recovery = { document, state: structuredClone(state), message: input.message, fields: procedureFields };
    if (recoverableStudioFields(recovery).length) {
      try {
        const result = await deps.recoverFacts(recovery);
        deps.assertActive?.();
        for (const fact of validateStudioRecoveredFacts(result.plan, recovery, result.sources)) {
          state.values[fact.field.variableKey] = fact.value;
          state.valueOrigins![fact.field.variableKey] = { source: 'customer', confirmed: false, stepId: fact.stepKey, at: new Date(now()).toISOString() };
          event(fact.stepKey, fact.field.name, 'conversation_fact_recovered');
        }
      } catch { deps.assertActive?.(); }
    }
  }
  if (!deps.planCollection || !studioCollectionWindow(document, state)) captureOfferedFields(procedureFields);
  for (let count = 0; count < 50 && state.stepIndex < procedure.steps.length; count++) {
    if (deps.planAction && state.adaptiveCompletedSteps?.[`${procedure.id}:${procedure.steps[state.stepIndex].id}`]) { state.stepIndex++; continue; }
    const window = deps.planCollection && !state.confirmation && !state.collectionProposal ? studioCollectionWindow(document, state) : null;
    if (window) {
      if (!await conductCollection(window)) return finish();
      continue;
    }
    const action = await conductAdaptiveAction();
    if (action === 'answered') return finish();
    const step = procedure.steps[state.stepIndex];
    const key = `${procedure.id}:${step.id}`;
    if ((state.visits[key] || 0) >= 5) { await handoff('O procedimento atingiu o limite de repetições.'); return finish(); }
    let nextStepId = step.nextStepId;
    try {
      deps.assertActive?.();
      if (step.type === 'collect_data') {
        if (!step.collectField) throw new Error('Campo não configurado.');
        if (!await collect(step.collectField, key)) return finish();
        if (deps.planCollection) {
          // A confirmation/option reply belongs only to its own field. Re-enter
          // the whole window so confirming a later field cannot skip earlier gaps.
          cachedCollection = undefined; planningConsumedMessage = true; message = '';
          const remainingWindow = studioCollectionWindow(document, state);
          if (remainingWindow) { state.stepIndex = remainingWindow.start; continue; }
        }
      } else if (step.type === 'message' || step.type === 'respond') {
        const unavailableLabels = new Map([
          ...document.understandStage.initialFields.map((field) => ({ field, stepKey: `initial:${field.id}` })),
          ...procedureFields,
        ].filter(({ field, stepKey }) => state.unavailableFields?.[stepKey]?.fieldKey === field.variableKey
          || state.deferredFields?.[stepKey]?.fieldKey === field.variableKey)
          .map(({ field }) => [field.variableKey, field.name] as const));
        const response = renderMessage(step, context(), unavailableLabels);
        if (!response) throw new Error('Mensagem não configurada.');
        messages.push(response);
      } else if (step.type === 'handoff') {
        await handoff(step.handoffReason || procedure.name, step.handoffTeam); return finish();
      } else if (step.type === 'finish') {
        state.stepIndex = procedure.steps.length;
        break;
      } else if (step.type === 'knowledge_lookup') {
        const response = await deps.knowledge(step.subtitle || message, step.knowledgeCollectionId ? [step.knowledgeCollectionId] : document.resolveStage.knowledgeCollectionIds, { requireSources: true });
        if (!response) throw new Error('Não foi encontrada uma resposta nas fontes autorizadas.');
        state.values[`knowledge_${step.id}`] = response;
        messages.push(response);
      } else if (step.type === 'decision' || step.type === 'validate_data') {
        const branches = step.decisionBranches || [];
        let branch = branches.find((item) => item.condition && evaluateStudioCondition(item.condition, context()));
        if (!branch && branches.some((item) => !item.condition && !item.isDefault) && deps.decide) {
          const chosen = await deps.decide(step, context());
          // A model may only choose descriptive branches, never bypass a failed deterministic rule.
          branch = branches.find((item) => item.id === chosen && !item.condition && !item.isDefault);
        }
        branch ??= branches.find((item) => item.isDefault);
        if (!branch) throw new Error('Nenhum caminho seguro foi encontrado para esta decisão.');
        event(step.id, branch.conditionLabel, 'branch_selected');
        if (branch.actionType === 'handoff') { await handoff(branch.conditionLabel, branch.actionValue); return finish(); }
        if (branch.actionType === 'respond') messages.push(branch.actionValue || branch.conditionLabel);
        if (branch.actionType === 'collect_data' && !branch.nextStepId) throw new Error('Selecione a etapa de coleta para este caminho.');
        nextStepId = branch.nextStepId ?? (branch.actionType === 'respond' ? null : nextStepId);
      } else {
        const missing = [
          ...(step.httpRequest?.sentDataMappings || []).map((mapping) => ({ sourceType: mapping.sourceType, key: mapping.sourceValue })),
          ...(step.nativeDataMappings || []).map((mapping) => ({ sourceType: mapping.sourceType, key: mapping.sourceValue })),
          ...(step.mcpTool?.argumentMappings || []).map((mapping) => ({ sourceType: mapping.sourceType, key: mapping.sourceChipKey })),
        ].find((mapping) => (!mapping.sourceType || ['collected_field', 'step_output'].includes(mapping.sourceType))
          && Object.values(state.unavailableFields || {}).some((entry) => entry.fieldKey === mapping.key)
          && readStudioValue(state.values, mapping.key) === undefined);
        if (missing) {
          event(step.id, 'Operação depende de dado não informado', 'dependency_unavailable');
          await handoff('As informações disponíveis foram coletadas, mas esta operação depende de um dado que o cliente não sabe informar. A equipe precisa providenciar uma alternativa, sem repetir a pergunta.');
          return finish();
        }
        if (input.suggestionOnly) {
          state.status = 'waiting_input';
          messages.push(`Próximo passo: ${step.title}. A operação precisa ser executada no atendimento automático ou pela equipe antes de informar um resultado.`);
          event(step.id, step.title, 'awaiting_operator'); return finish();
        }
        const mustConfirm = step.type === 'http_request' ? step.httpRequest?.method !== 'GET' || Boolean(step.httpRequest.requiresConfirmation)
          : step.type === 'mcp_tool_call' ? Boolean(step.mcpTool?.requiresConfirmation) || step.mcpTool?.riskLevel !== 'read_only' : !STUDIO_SGP_ACTIONS.includes(step.nativeActionType || '');
        const requiresConfirmation = mustConfirm || await deps.needsConfirmation?.(step) || false;
        const signature = JSON.stringify({ step, values: state.values });
        if (requiresConfirmation) {
          const pending = state.confirmation;
          if (!pending || pending.key !== key || pending.signature !== signature || now() - pending.at > 600_000) {
            state.confirmation = { key, signature, at: now() }; state.status = 'waiting_input';
            messages.push(step.mcpTool?.confirmationPrompt || `Posso executar “${step.title}” com os dados informados? Responda sim ou não.`);
            event(step.id, step.title, 'waiting_confirmation'); return finish();
          }
          if (negative(message)) {
            interruptProcedure('operation_cancelled');
            messages.push('Operação cancelada. Não fiz a ação e não transferi o atendimento. O que você gostaria de fazer agora?');
            event(step.id, step.title, 'procedure_cancelled');
            return finish();
          }
          if (!affirmative(message)) { messages.push('Para autorizar esta operação, responda sim. Para cancelar, responda não.'); return finish(); }
        }
        const operationId = `${state.id}:${key}:${state.visits[key] || 0}`;
        if ((state.toolCallCount || 0) >= (document.rules.maxToolCallsPerSession || 10)) {
          event(step.id, 'Limite de ações da sessão', 'limit_reached');
          await handoff('A sessão atingiu o limite de ações permitido.'); return finish();
        }
        state.toolCallCount = (state.toolCallCount || 0) + 1;
        state.inFlight = { key: operationId, stepId: step.id };
        await checkpoint();
        const result = await deps.execute(step, context(), { id: operationId, confirmed: requiresConfirmation });
        if (state.adaptiveOperation && Object.entries(result.values || {}).some(([key, value]) =>
          Object.hasOwn(state.values, key) && state.valueOrigins?.[key]?.source !== 'integration'
          && Boolean(state.valueOrigins?.[key]) && JSON.stringify(state.values[key]) !== JSON.stringify(value))) {
          // A tool result is evidence, not permission to overwrite what the
          // customer supplied. Preserve both the operation outcome and old facts.
          state.inFlight = null; state.confirmation = null;
          state.adaptiveCompletedSteps ||= {}; state.adaptiveCompletedSteps[`${procedure.id}:${step.id}`] = true;
          delete state.adaptiveOperation;
          event(step.id, 'Resultado diverge de dado informado', 'adaptive_evidence_conflict');
          const fallback = step.httpRequest?.fallbackAction || step.mcpTool?.fallbackAction || 'handoff';
          if (fallback === 'message') {
            state.status = 'waiting_input';
            messages.push('Identifiquei uma divergência entre as informações consultadas e os dados informados. Pode confirmar qual informação devemos considerar?');
            return finish();
          }
          await handoff('O resultado da operação diverge de uma informação fornecida pelo cliente. É necessário conferir antes de substituir o dado.');
          return finish();
        }
        state.values = { ...state.values, ...result.values };
        for (const key of Object.keys(result.values || {})) state.valueOrigins![key] = { source: 'integration', confirmed: false, stepId: step.id, at: new Date(now()).toISOString() };
        for (const entry of procedureFields) if (Object.hasOwn(result.values || {}, entry.field.variableKey)
          && validateStudioField(entry.field, result.values![entry.field.variableKey]).valid) {
          delete state.unavailableFields?.[entry.stepKey]; delete state.deferredFields?.[entry.stepKey];
        }
        state.inFlight = null; state.confirmation = null;
        if (step.type === 'native_action' && step.nativeActionType === 'close_chat') {
          state.phase = 'done'; state.status = 'resolved'; state.stepIndex = procedure.steps.length;
          event(procedure.id, procedure.name, 'procedure_completed');
          event(step.id, step.title, 'completed'); return finish();
        }
      }
      state.visits[key] = (state.visits[key] || 0) + 1;
      event(step.id, step.title, 'completed');
      if (state.adaptiveOperation?.stepId === step.id && (state.adaptiveOperation.procedureId === procedure.id || document.resolveStage.procedures.some((p) => p.id === state.adaptiveOperation?.procedureId))) {
        state.adaptiveCompletedSteps ||= {}; state.adaptiveCompletedSteps[`${state.adaptiveOperation.procedureId}:${step.id}`] = true;
        state.stepIndex = state.adaptiveOperation.returnIndex;
        delete state.adaptiveOperation; cachedCollection = undefined; planningConsumedMessage = true; message = '';
      } else if (nextStepId === null) state.stepIndex = procedure.steps.length;
      else if (nextStepId) {
        const position = procedure.steps.findIndex((item) => item.id === nextStepId);
        if (position < 0) throw new Error('O próximo passo não existe.');
        state.stepIndex = position;
      } else state.stepIndex++;
      await checkpoint();
    } catch (error) {
      if (error instanceof StudioCheckpointError) throw error;
      event(step.id, step.title, state.inFlight ? 'outcome_unknown' : 'failed');
      const fallback = step.httpRequest?.fallbackAction || step.mcpTool?.fallbackAction || 'handoff';
      // Errors after dispatch do not prove absence of side effects. Keep the marker for review.
      if (fallback === 'message' || fallback === 'abort') {
        messages.push(step.onFailMessage || step.httpRequest?.fallbackMessage || 'Não consegui concluir esta operação.');
        state.status = 'failed'; state.phase = 'done';
      } else await handoff(error instanceof Error ? error.message : 'Falha no procedimento.', step.onFailHandoffTeam || step.mcpTool?.fallbackHandoffTeam || document.concludeStage.handoffTeam);
      return finish();
    }
  }
  if (state.stepIndex < procedure.steps.length) {
    await handoff('O procedimento atingiu o limite de etapas por atendimento.');
  } else {
    rememberIntentOutcome(procedure.id, 'completed');
    event(procedure.id, procedure.name, 'procedure_completed');
    state.phase = 'conclude'; state.status = 'waiting_input';
    state.resolutionPromptPending = true;
    if (document.concludeStage.confirmResolutionQuestion.trim()) messages.push(document.concludeStage.confirmResolutionQuestion);
    else { state.phase = 'done'; state.status = 'resolved'; messages.push(document.concludeStage.successClosingMessage); }
  }
  return finish();
}
