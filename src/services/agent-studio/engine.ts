import { z } from 'zod';
import type { AgentStudioDocument, CollectedFieldDefinition, ProcedureDocument, ProcedureStep } from './types';
import { extractStudioFieldCandidate, matchesStudioFieldLabel, validateStudioField } from './collection';
import { readStudioValue, type StudioDataContext } from './data-mapping';
import { matchExcludedStudioTopic, matchProhibitedStudioField } from './policy';

export const StudioSessionSchema = z.object({
  id: z.string(), agentId: z.string(), releaseId: z.string(),
  phase: z.enum(['understand', 'resolve', 'conclude', 'done']),
  status: z.enum(['running', 'waiting_input', 'resolved', 'transferred', 'failed', 'cancelled']),
  procedureId: z.string().nullable(), stepIndex: z.number().int().nonnegative(),
  values: z.record(z.unknown()), attempts: z.record(z.number()), visits: z.record(z.number()),
  valueOrigins: z.record(z.object({ source: z.enum(['customer', 'contact_property', 'flow_input', 'integration']), confirmed: z.boolean(), stepId: z.string(), at: z.string() })).optional(),
  sessionFacts: z.record(z.object({ value: z.unknown(), fieldType: z.string(), labels: z.array(z.string()), source: z.enum(['customer', 'contact_property', 'flow_input']), confirmed: z.boolean(), isSensitive: z.boolean(), at: z.string() })).optional(),
  procedureStats: z.array(z.object({ id: z.string(), name: z.string(), selected: z.number(), completed: z.number(), failed: z.number(), collectionFailures: z.number(), integrationFailures: z.number() })).optional(),
  initialIntent: z.string().optional(),
  routingOptions: z.array(z.string()).optional(),
  routingContext: z.string().optional(),
  turnCount: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  processedMessageIds: z.array(z.string()).max(200).optional(),
  topicChange: z.object({ procedureId: z.string(), at: z.number() }).optional(),
  pendingField: z.string().nullable(),
  confirmation: z.object({ key: z.string(), signature: z.string(), at: z.number() }).nullable(),
  inFlight: z.object({ key: z.string(), stepId: z.string() }).nullable(),
  events: z.array(z.object({ stepId: z.string(), label: z.string(), kind: z.string(), at: z.string() })),
  lastTurn: z.object({ messageId: z.string(), response: z.string(), outcome: z.string() }).optional(),
});
export type StudioSession = z.infer<typeof StudioSessionSchema>;
export type StudioEngineDependencies = {
  assertActive?: () => void;
  checkpoint?: (state: StudioSession) => Promise<void>;
  chooseProcedure?: (procedures: ProcedureDocument[], message: string) => Promise<string | null | { candidates: string[] }>;
  decide?: (step: ProcedureStep, context: StudioDataContext) => Promise<string | null>;
  execute: (step: ProcedureStep, context: StudioDataContext, operation: { id: string; confirmed: boolean }) => Promise<{ values?: Record<string, unknown> }>;
  knowledge: (query: string, collectionIds: string[], options?: { requireSources: boolean }) => Promise<string | null>;
  handoff: (team: string, reason: string, context: StudioDataContext, operationId: string) => Promise<void | { message?: string }>;
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
const affirmative = (text: string) => /^(sim|confirmo|pode|pode sim|pode continuar|ok|correto|isso|yes)[.!\s]*$/.test(normalize(text));
const negative = (text: string) => /^(nao|cancelar|cancela|nao quero|no)[.!\s]*$/.test(normalize(text));
const announcesTransfer = (text: string) => /\b(encaminh|transfer|direcion|equipe|atendente|especialista)/i.test(normalize(text));
const safeHandoffMessage = (team: string) => /^[0-9a-f-]{36}$/i.test(team)
  ? 'Vou encaminhar seu atendimento para a equipe responsável continuar com você.'
  : `Vou encaminhar seu atendimento para a equipe ${team} continuar com você.`;
class StudioCheckpointError extends Error {}

function renderMessage(step: ProcedureStep, context: StudioDataContext): string {
  const text = step.messageText || '';
  const values = (step.messageDataKeys || []).map((key) => readStudioValue(context.values, key));
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
  const { document, dependencies: deps, message } = input;
  deps.assertActive?.();
  const state = structuredClone(input.state);
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
    const response = messages.filter(Boolean).join('\n\n');
    state.lastTurn = { messageId: input.messageId, response, outcome: state.status };
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
      const handoffResult = await deps.handoff(team, reason, context(), `${state.id}:handoff`);
      state.status = 'transferred';
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
  if (state.phase === 'done') return { state, response: '', replay: false };
  if (state.inFlight) {
    event(state.inFlight.stepId, 'Operação interrompida', 'outcome_unknown');
    // A crash/timeout may have occurred after a side effect. Never repeat it blindly.
    await handoff('Uma operação anterior ficou sem confirmação de resultado. É necessária conferência antes de repetir.');
    return finish();
  }
  if (/\b(quero|preciso|falar com|chama|chamar)\b.{0,30}\b(humano|atendente|pessoa|equipe)\b/.test(normalize(message)) && !/\bnao (quero|preciso)\b/.test(normalize(message))) {
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
  if (document.rules.operatingHoursEnabled) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: document.rules.timeZone || 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now()));
    const part = (name: string) => parts.find((value) => value.type === name)?.value || '';
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
    const time = `${part('hour')}:${part('minute')}`;
    const start = document.rules.operatingHoursStart, end = document.rules.operatingHoursEnd;
    const within = start < end ? time >= start && time < end : time >= start || time < end;
    const operatingDay = start > end && time < end ? (day + 6) % 7 : day;
    if (!(document.rules.operatingDays || [1, 2, 3, 4, 5]).includes(operatingDay) || !within) {
      state.status = 'waiting_input'; messages.push(document.rules.outOfHoursMessage); return finish();
    }
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
  const collect = async (field: CollectedFieldDefinition, stepKey: string): Promise<boolean> => {
    const prohibited = matchProhibitedStudioField(field, document);
    if (prohibited) { await handoff(`A configuração tentou solicitar um dado proibido: ${prohibited}.`); return false; }
    let options: Array<{ label: string; value: unknown }> | undefined;
    if (field.optionsSourceKey && ['single_select', 'multi_select'].includes(field.type)) {
      const source = readStudioValue(state.values, field.optionsSourceKey);
      if (!Array.isArray(source) || !source.length || source.length > 100) throw new Error('A lista de opções está indisponível ou excede 100 itens.');
      options = source.map((item) => ({
        label: String(field.optionLabelPath ? readStudioValue(item, field.optionLabelPath) ?? '' : item),
        value: field.optionValuePath ? readStudioValue(item, field.optionValuePath) : item,
      }));
      if (options.some((option) => !option.label.trim() || option.value === undefined) || new Set(options.map((option) => option.label)).size !== options.length) throw new Error('A lista possui opções incompletas ou nomes repetidos.');
      field = { ...field, options: options.map((option) => option.label) };
    }
    const alreadyPresent = Object.hasOwn(state.values, field.variableKey);
    const directAnswer = state.pendingField === field.variableKey;
    const storedValue = state.values[field.variableKey];
    const supplied = extractStudioFieldCandidate(field, message, directAnswer);
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
      if ((state.attempts[stepKey] || 0) >= field.maxAttempts) { await handoff(`Limite de tentativas para ${field.name}.`); return false; }
      state.pendingField = field.variableKey; state.status = 'waiting_input';
      messages.push(directAnswer ? validated.error : [field.promptMessage, field.options?.map((option, index) => `${index + 1}. ${option}`).join('\n')].filter(Boolean).join('\n'));
      event(stepKey, field.name, 'waiting_input');
      return false;
    }
    state.values[field.variableKey] = options ? Array.isArray(validated.value)
      ? validated.value.map((label) => options!.find((option) => option.label === label)!.value)
      : options.find((option) => option.label === validated.value)!.value : validated.value;
    if (!alreadyPresent) state.valueOrigins![field.variableKey] = { source, confirmed: false, stepId: stepKey, at: new Date(now()).toISOString() };
    if (field.requiresConfirmation && !state.valueOrigins![field.variableKey]?.confirmed && state.confirmation?.key !== `field:${stepKey}`) {
      state.pendingField = null;
      state.confirmation = { key: `field:${stepKey}`, signature: JSON.stringify(validated.value), at: now() };
      state.status = 'waiting_input';
      messages.push(field.isSensitive ? `Confirma que ${field.name} foi informado corretamente?` : `Confirma ${field.name}: ${String(validated.value)}?`);
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
    const offered = fields.flatMap(({ field, stepKey }) => {
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
  const currentProcedure = document.resolveStage.procedures.find((item) => item.id === state.procedureId);
  const procedures = document.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').sort((a, b) => b.priority - a.priority);
  const clearProcedureData = (preserveProcedureId?: string) => {
    for (const key of Object.keys(state.values)) {
      const originStepId = state.valueOrigins![key]?.stepId || '';
      const belongsToTarget = Boolean(preserveProcedureId && originStepId.startsWith(`${preserveProcedureId}:`));
      if (!originStepId.startsWith('initial:') && !belongsToTarget) {
        delete state.values[key]; delete state.valueOrigins![key];
      }
    }
    state.pendingField = null; state.confirmation = null; state.stepIndex = 0; delete state.initialIntent;
  };
  const discardProcedureData = (procedureId: string) => {
    for (const key of Object.keys(state.values)) if (state.valueOrigins![key]?.stepId.startsWith(`${procedureId}:`)) {
      delete state.values[key]; delete state.valueOrigins![key];
    }
  };
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
    clearProcedureData(target.id); delete state.topicChange; state.procedureId = target.id; state.phase = 'resolve'; state.status = 'running'; switched = true;
    event(target.id, target.name, 'procedure_selected');
    event(target.id, 'Mudança de assunto confirmada', 'topic_changed');
  }
  if (!switched && currentProcedure && !/\b(corrigir|corrigindo|corrija|correto|correta|alterar meu|alterar minha)\b/.test(normalize(message)) && !affirmative(message) && !negative(message)) {
    const exactOther = procedures.find((procedure) => procedure.id !== currentProcedure.id && normalize(procedure.name) === normalize(message));
    const matches = procedures.filter((procedure) => procedure.triggerKeywords.some((keyword) => keyword.trim() && normalize(message).includes(normalize(keyword))));
    let targetId = exactOther?.id || (matches.length === 1 && matches[0].id !== currentProcedure.id ? matches[0].id : null);
    if (deps.chooseProcedure && (targetId || /\b(quero|preciso|gostaria|mudar de assunto|outro assunto)\b/.test(normalize(message)))) {
      try { const choice = await deps.chooseProcedure(procedures, message); targetId = typeof choice === 'string' ? choice : null; }
      catch { targetId = null; }
    }
    const target = procedures.find((procedure) => procedure.id === targetId && procedure.id !== currentProcedure.id);
    if (target) {
      captureOfferedFields(target.steps.flatMap((step) => step.collectField ? [{ field: step.collectField, stepKey: `${target.id}:${step.id}` }] : []));
      state.topicChange = { procedureId: target.id, at: now() }; state.confirmation = null; state.status = 'waiting_input';
      messages.push(`Entendi — você quer ${naturalProcedureName(target.name)}. Posso seguir com isso?`);
      event(target.id, 'Confirmar mudança de assunto', 'waiting_confirmation'); return finish();
    }
  }
  if (/\b(corrigir|corrigindo|corrija|correto|correta|alterar meu|alterar minha)\b/.test(normalize(message))) {
    const fields = [
      ...(document.understandStage.askInitialData ? document.understandStage.initialFields.map((field) => ({ field, index: -1 })) : []),
      ...(currentProcedure?.steps.flatMap((step, index) => step.collectField ? [{ field: step.collectField, index }] : []) || []),
    ].filter(({ field }) => Object.hasOwn(state.values, field.variableKey) && [field.name, ...(field.aliases || [])].some((label) => normalize(message).includes(normalize(label))));
    if (fields.length === 1) {
      const { field, index } = fields[0];
      const affected = currentProcedure?.steps.slice(Math.max(0, index)) || [];
      const wroteData = affected.some((step) => (state.visits[`${currentProcedure!.id}:${step.id}`] || 0) > 0 &&
        (step.type === 'native_action' || step.type === 'mcp_tool_call' || (step.type === 'http_request' && step.httpRequest?.method !== 'GET')));
      if (wroteData) {
        await handoff('O cliente pediu correção de um dado após uma ação já executada. É necessária revisão antes de repetir.'); return finish();
      }
      // Conservatively invalidate all downstream values, not only directly mapped outputs.
      for (const step of affected) for (const key of [
        ...(step.collectField ? [step.collectField.variableKey] : []),
        ...(step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []).map((output) => output.chipKey), `knowledge_${step.id}`,
      ]) { delete state.values[key]; delete state.valueOrigins![key]; }
      delete state.values[field.variableKey]; delete state.valueOrigins![field.variableKey];
      state.confirmation = null; state.pendingField = field.variableKey;
      if (index < 0) { state.phase = 'understand'; state.procedureId = null; state.initialIntent = currentProcedure?.name || state.initialIntent; }
      else { state.phase = 'resolve'; state.stepIndex = index; }
      event(field.id, field.name, 'correction_requested');
    }
  }
  if (state.phase === 'understand') {
    state.initialIntent ??= message;
    const firstTurn = !state.lastTurn;
    if (firstTurn && isGreetingOnly(message)) messages.push(document.understandStage.welcomeMessage);
    if (document.understandStage.askInitialData) {
      captureOfferedFields(document.understandStage.initialFields.map((field) => ({ field, stepKey: `initial:${field.id}` })));
      try {
        for (const field of document.understandStage.initialFields) if (!await collect(field, `initial:${field.id}`)) return finish();
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
    if (affirmative(message)) { state.phase = 'done'; state.status = 'resolved'; messages.push(document.concludeStage.successClosingMessage); }
    else if (negative(message)) await handoff('O cliente informou que a solicitação não foi resolvida.');
    else { clearProcedureData(); state.phase = 'resolve'; state.procedureId = null; }
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
    let selected = option || exact?.id || (candidates.length === 1 ? candidates[0].id : null);
    let ambiguous = !selected && candidates.length > 1 ? candidates.map((procedure) => procedure.id) : [];
    if (deps.chooseProcedure) {
      try { const choice = await deps.chooseProcedure(option ? procedures.filter((procedure) => procedure.id === option) : procedures,
        option ? `Solicitação original: ${state.routingContext || ''}. O cliente escolheu: ${procedures.find((procedure) => procedure.id === option)?.name}. Verifique ainda as exclusões e a elegibilidade.` : routingMessage);
        selected = typeof choice === 'string' ? choice : null; ambiguous = choice && typeof choice === 'object' ? choice.candidates : []; }
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
    state.procedureId = selected; state.stepIndex = 0;
    delete state.routingOptions;
    delete state.routingContext;
    event(selected, procedures.find((procedure) => procedure.id === selected)!.name, 'procedure_selected');
  }
  const procedure = document.resolveStage.procedures.find((item) => item.id === state.procedureId);
  if (!procedure) throw new Error('O procedimento da sessão não existe nesta versão.');
  const procedureFields = procedure.steps.flatMap((step) => step.collectField ? [{ field: step.collectField, stepKey: `${procedure.id}:${step.id}` }] : []);
  reuseSessionFacts(procedureFields);
  captureOfferedFields(procedureFields);
  for (let count = 0; count < 50 && state.stepIndex < procedure.steps.length; count++) {
    const step = procedure.steps[state.stepIndex];
    const key = `${procedure.id}:${step.id}`;
    if ((state.visits[key] || 0) >= 5) { await handoff('O procedimento atingiu o limite de repetições.'); return finish(); }
    let nextStepId = step.nextStepId;
    try {
      deps.assertActive?.();
      if (step.type === 'collect_data') {
        if (!step.collectField) throw new Error('Campo não configurado.');
        if (!await collect(step.collectField, key)) return finish();
      } else if (step.type === 'message' || step.type === 'respond') {
        const response = renderMessage(step, context());
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
        if (input.suggestionOnly) {
          state.status = 'waiting_input';
          messages.push(`Próximo passo: ${step.title}. A operação precisa ser executada no atendimento automático ou pela equipe antes de informar um resultado.`);
          event(step.id, step.title, 'awaiting_operator'); return finish();
        }
        const mustConfirm = step.type === 'http_request' ? step.httpRequest?.method !== 'GET' || Boolean(step.httpRequest.requiresConfirmation)
          : step.type === 'mcp_tool_call' ? Boolean(step.mcpTool?.requiresConfirmation) || step.mcpTool?.riskLevel !== 'read_only' : true;
        const requiresConfirmation = mustConfirm || await deps.needsConfirmation?.(step) || false;
        const signature = JSON.stringify({ step, values: state.values });
        if (requiresConfirmation) {
          const pending = state.confirmation;
          if (!pending || pending.key !== key || pending.signature !== signature || now() - pending.at > 600_000) {
            state.confirmation = { key, signature, at: now() }; state.status = 'waiting_input';
            messages.push(step.mcpTool?.confirmationPrompt || `Posso executar “${step.title}” com os dados informados? Responda sim ou não.`);
            event(step.id, step.title, 'waiting_confirmation'); return finish();
          }
          if (negative(message)) { state.confirmation = null; messages.push('Operação cancelada.'); await handoff('O cliente cancelou a operação.'); return finish(); }
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
        state.values = { ...state.values, ...result.values };
        for (const key of Object.keys(result.values || {})) state.valueOrigins![key] = { source: 'integration', confirmed: false, stepId: step.id, at: new Date(now()).toISOString() };
        state.inFlight = null; state.confirmation = null;
        if (step.type === 'native_action' && step.nativeActionType === 'close_chat') {
          state.phase = 'done'; state.status = 'resolved'; state.stepIndex = procedure.steps.length;
          event(procedure.id, procedure.name, 'procedure_completed');
          event(step.id, step.title, 'completed'); return finish();
        }
      }
      state.visits[key] = (state.visits[key] || 0) + 1;
      event(step.id, step.title, 'completed');
      if (nextStepId === null) state.stepIndex = procedure.steps.length;
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
    event(procedure.id, procedure.name, 'procedure_completed');
    state.phase = 'conclude'; state.status = 'waiting_input';
    if (document.concludeStage.confirmResolutionQuestion.trim()) messages.push(document.concludeStage.confirmResolutionQuestion);
    else { state.phase = 'done'; state.status = 'resolved'; messages.push(document.concludeStage.successClosingMessage); }
  }
  return finish();
}
