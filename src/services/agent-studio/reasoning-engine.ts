import { createHash } from 'node:crypto';
import type { AgentStudioDocument } from './types';
import { studioHasUncertainOperation, type StudioSession, type StudioEngineDependencies } from './engine';
import { StudioReasoningDecisionSchema, type StudioReasoningState } from './reasoning-contract';
import { compileStudioReasoningCapabilities, studioStepIsReadOnly } from './reasoning-capabilities';
import { resolveStudioCollectionOptions, validateStudioField } from './collection';
import { matchProhibitedStudioField } from './policy';
import { studioMemoryContext, studioMemoryEventContext, type StudioMemoryEvent, type StudioMemoryPage, type StudioMemoryRecord } from './durable-memory';
import { resolveStudioMapping, type StudioDataContext } from './data-mapping';
import { studioReasoningPaths } from './reasoning-paths';
import { resolveStudioCatalogImage, StudioCatalogImageSchema } from './catalog-media';

type Source = { messageId: string; content: string; fromMe: boolean };
export type StudioReasoningInput = {
  document: AgentStudioDocument; state: StudioSession; message: string; messageId: string;
  context: Omit<StudioDataContext, 'values'>; sources: Source[]; memory: StudioMemoryPage;
  maxDecisions?: number;
  mediaAnalysisContext?: string;
  suggestionOnly?: boolean;
  historyCursor?: string | null;
  dependencies: Pick<StudioEngineDependencies, 'execute' | 'needsConfirmation' | 'knowledge' | 'handoff' | 'assertActive' | 'now'> & {
    checkpoint: (state: StudioSession, memory: StudioMemoryEvent[]) => Promise<void>;
    decide: (context: Record<string, unknown>) => Promise<unknown>;
    recall: (cursor: string | null) => Promise<StudioMemoryPage>;
    recallSessionOperations?: (sessionId: string) => Promise<{ releaseId: string; operations: StudioReasoningState['operations'] } | null>;
    priorRequestOperations?: (requestId: string) => Promise<Array<{ releaseId: string; operations: StudioReasoningState['operations'] }>>;
    recallHistory?: (cursor: string) => Promise<{ sources: Source[]; nextCursor: string | null }>;
    consult?: (context: Record<string, unknown>) => Promise<string>;
  };
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
};
const signature = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

/** Model-owned conversation loop. Code validates effects; it does not classify customer language. */
export async function advanceStudioReasoningSession(input: StudioReasoningInput) {
  const { document, dependencies: deps } = input;
  const state = structuredClone(input.state);
  if (state.agentId !== document.id) throw new Error('A sessão não pertence a este agente.');
  if (state.lastTurn?.messageId === input.messageId) return { state, response: state.lastTurn.response, replay: true };
  if (state.processedMessageIds?.includes(input.messageId)) return { state, response: '', replay: true };
  if (state.status === 'transferred') return { state, response: '', replay: false };
  if (state.status === 'resolved') {
    state.phase = 'resolve';
    state.status = 'running';
  }
  state.reasoning ||= { version: 2, requests: [], operations: [], pendingAction: null };
  const startedAt = Date.now();
  const initialToolCalls = state.toolCallCount || 0;
  let modelDecisions = 0;
  let providerRecoveryAttempts = 0;
  let budgetReached = false;
  const now = () => new Date((deps.now || Date.now)()).toISOString();
  const observations: unknown[] = [];
  const historicalOperations = new Map<string, StudioReasoningState['operations'][number]>();
  const operationSummary = (operation: StudioReasoningState['operations'][number]) => ({
    id: operation.id, requestId: operation.requestId, memoryRequestId: operation.memoryRequestId,
    capabilityId: operation.capabilityId, title: operation.title, status: operation.status, readOnly: operation.readOnly, at: operation.at,
    presentedProduct: operation.presentedProduct, resultKeys: Object.keys(operation.values),
  });
  const memory: StudioMemoryRecord[] = [...input.memory.records];
  let memoryCursor = state.reasoning.recallCursor || input.memory.nextCursor;
  let historyCursor = state.reasoning.historyCursor || input.historyCursor;
  let pendingMemory: StudioMemoryEvent[] = [];
  const savedThisTurn = new Map<string, StudioMemoryEvent>();
  const memoryEntity = (event: StudioMemoryEvent) => JSON.stringify([event.requestId, event.kind, event.key]);
  const visibleStoredMemory = () => memory.filter(({ event }) => !savedThisTurn.has(memoryEntity(event)));
  const sources = [...input.sources, { messageId: input.messageId, content: input.message, fromMe: false }];
  const checkpoint = async () => {
    if (!input.suggestionOnly) await deps.checkpoint(structuredClone(state), pendingMemory);
    for (const revision of pendingMemory) savedThisTurn.set(memoryEntity(revision), revision);
    pendingMemory = [];
  };
  const event = (label: string, kind: string) => {
    state.events = [...state.events, { stepId: 'reasoning-v2', label, kind, at: now() }].slice(-150);
  };
  if (input.state.status === 'resolved') {
    deps.assertActive?.();
    event('Conversa retomada após nova mensagem', 'reasoning_reopened');
    await checkpoint();
  }
  // A stopped read has no business effect to reconcile. Keep uncertain writes
  // untouched and make the interrupted consultation eligible for a fresh attempt.
  let recoveredRead = false;
  for (const operation of state.reasoning.operations) {
    if (operation.status !== 'unknown') continue;
    const owner = state.reasoning.requests.find((request) => request.id === operation.requestId);
    const step = owner && document.resolveStage.procedures.find((procedure) => procedure.id === owner.procedureId)?.steps
      .find((candidate) => `${owner.procedureId}:${candidate.id}` === operation.capabilityId);
    if (operation.readOnly === false || !step || !studioStepIsReadOnly(step)) continue;
    operation.status = 'failed';
    if (owner) for (const output of step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []) delete owner.integrationValues[output.chipKey];
    if (state.inFlight?.key === operation.id) state.inFlight = null;
    recoveredRead = true;
  }
  if (recoveredRead) {
    observations.push({ result: 'interrupted_reads_recovered', detail: 'Consultas anteriores foram interrompidas sem resultado. Consulte novamente se necessário; não presuma dados atualizados.' });
    event('Consultas interrompidas disponíveis para nova tentativa', 'reasoning_read_recovered');
    await checkpoint();
  }
  const finish = async (response: string) => {
    state.reasoning!.lastTurnMetrics = {
      messageId: input.messageId, durationMs: Date.now() - startedAt, modelDecisions,
      toolCalls: (state.toolCallCount || 0) - initialToolCalls,
      activeRequests: state.reasoning!.requests.filter((request) => request.status === 'active').length,
      pausedRequests: state.reasoning!.requests.filter((request) => request.status === 'paused').length,
      resolvedRequests: state.reasoning!.requests.filter((request) => request.status === 'resolved').length,
      uncertainOperations: state.reasoning!.operations.filter((operation) => operation.status === 'unknown').length,
      transferred: state.status === 'transferred', budgetReached,
    };
    state.lastTurn = { messageId: input.messageId, response, outcome: state.status };
    state.processedMessageIds = [...(state.processedMessageIds || []), input.messageId].slice(-200);
    state.conversationMemory = [...(state.conversationMemory || []), { messageId: input.messageId,
      customer: input.message.slice(0, 4000), assistant: response.slice(0, 4000) }].slice(-40);
    await checkpoint();
    return { state, response, replay: false };
  };
  const currentChoiceValues = (request: StudioReasoningState['requests'][number]) => {
    const values = { ...request.values };
    const procedure = document.resolveStage.procedures.find((p) => p.id === request.procedureId);
    for (const step of procedure?.steps || []) {
      const field = step.collectField;
      if (!field?.optionsSourceKey) continue;
      delete values[field.variableKey];
      try {
        const resolved = resolveStudioCollectionOptions(field, request.integrationValues || {});
        const validation = validateStudioField(resolved.field, request.choiceLabels?.[field.variableKey]);
        if (validation.valid && resolved.options) values[field.variableKey] = Array.isArray(validation.value)
          ? validation.value.map((label) => resolved.options!.find((option) => option.label === label)!.value)
          : resolved.options.find((option) => option.label === validation.value)!.value;
      } catch { /* The model sees the unavailable input and can refresh the catalog or clarify. */ }
    }
    return values;
  };
  const requestContext = (request: StudioReasoningState['requests'][number]) => ({ ...input.context,
    values: { ...currentChoiceValues(request), ...(request.integrationValues || {}) } });
  const durableRequestId = (request: StudioReasoningState['requests'][number]) => request.memoryRequestId || `${state.id}:${request.id}`;
  const operationBelongsTo = (operation: StudioReasoningState['operations'][number], request: StudioReasoningState['requests'][number]) =>
    (operation.memoryRequestId || `${state.id}:${operation.requestId}`) === durableRequestId(request);
  const completedSteps = (request: StudioReasoningState['requests'][number]) => {
    const latest = new Map<string, StudioReasoningState['operations'][number]>();
    for (const operation of state.reasoning!.operations) if (operationBelongsTo(operation, request)) latest.set(operation.capabilityId, operation);
    return new Set([...latest.values()].filter((operation) => operation.status === 'succeeded')
      .map((operation) => operation.capabilityId.slice((request.procedureId?.length || 0) + 1)));
  };
  const branchSignature = (request: StudioReasoningState['requests'][number]) => signature([input.messageId, requestContext(request)]);
  const selectedBranches = (request: StudioReasoningState['requests'][number]) => Object.fromEntries(Object.entries(request.branchSelections || {})
    .filter(([, selection]) => selection.signature === branchSignature(request)).map(([key, selection]) => [key, selection.branchId]));
  const businessPaths = (request: StudioReasoningState['requests'][number]) => {
    const procedure = document.resolveStage.procedures.find((procedure) => procedure.id === request.procedureId);
    return procedure ? studioReasoningPaths(procedure, requestContext(request), completedSteps(request), selectedBranches(request)) : null;
  };
  const capabilities = (request: StudioReasoningState['requests'][number]) => compileStudioReasoningCapabilities(document,
    request.procedureId, requestContext(request), completedSteps(request), selectedBranches(request));
  const promptContext = (): Record<string, unknown> => ({
    objective: document.objective, message: input.message, messageId: input.messageId, suggestionOnly: Boolean(input.suggestionOnly),
    mediaAnalysis: input.mediaAnalysisContext?.trim() ? {
      sourceMessageId: input.messageId, content: input.mediaAnalysisContext.slice(0, 24000),
      source: 'automated_media_interpretation',
    } : undefined,
    supportAvailable: Boolean(deps.consult),
    historicalOperationsAvailable: Boolean(deps.recallSessionOperations),
    executionBudget: {
      remainingToolCalls: Math.max(0, (document.rules.maxToolCallsPerSession ?? 50) - (state.toolCallCount || 0)),
      remainingDecisions: Math.max(0, (input.maxDecisions ?? 8) - modelDecisions),
      scope: 'tool_limit_per_session_decision_limit_per_message',
    },
    requests: state.reasoning!.requests.map((request) => {
      const procedure = document.resolveStage.procedures.find((p) => p.id === request.procedureId);
      const sensitive = new Set(procedure?.steps.flatMap((s) => [
        ...(s.collectField?.isSensitive ? [s.collectField.variableKey] : []),
        ...(s.httpRequest?.outputMappings || s.mcpTool?.outputMappings || []).filter((o) => o.sensitive).map((o) => o.chipKey),
      ]) || []);
      return { ...request, values: Object.fromEntries(Object.entries(currentChoiceValues(request)).filter(([key]) => !sensitive.has(key))),
        choiceLabels: Object.fromEntries(Object.entries(request.choiceLabels || {}).filter(([key]) => !sensitive.has(key))),
        integrationValues: Object.fromEntries(Object.entries(request.integrationValues || {}).filter(([key]) => !sensitive.has(key))),
        availableChoices: procedure?.steps.flatMap((step) => {
          if (!step.collectField?.optionsSourceKey || step.collectField.isSensitive) return [];
          try { return [{ key: step.collectField.variableKey, options: resolveStudioCollectionOptions(step.collectField, request.integrationValues || {}).field.options }]; }
          catch { return [{ key: step.collectField.variableKey, options: undefined }]; }
        }),
        businessDecisions: businessPaths(request)?.decisions, publishedResponses: businessPaths(request)?.responses,
        publishedHandoffs: businessPaths(request)?.handoffs,
        sensitiveFieldsAvailable: Object.keys(request.values).filter((key) => sensitive.has(key)) };
    }),
    operations: state.reasoning!.operations.map(operationSummary),
    pendingAction: state.reasoning!.pendingAction,
    procedures: document.resolveStage.procedures.filter((p) => p.status !== 'archived').map((p) => ({
      id: p.id, name: p.name, objective: p.objective, whenToUse: p.whenToUse, whenNotToUse: p.whenNotToUse,
      capabilities: compileStudioReasoningCapabilities(document, p.id, { ...input.context, values: {} }, new Set()),
      fields: p.steps.flatMap((s) => s.collectField ? [{ key: s.collectField.variableKey, name: s.collectField.name,
        required: s.collectField.required, options: s.collectField.options, optionsSourceKey: s.collectField.optionsSourceKey,
        sensitive: s.collectField.isSensitive }] : []),
    })),
    capabilities: state.reasoning!.requests.flatMap((r) => capabilities(r).map((c) => ({ ...c, requestId: r.id }))),
    choices: [...studioMemoryContext(visibleStoredMemory()),
      ...[...savedThisTurn.values()].filter((event) => !event.sensitive).map(studioMemoryEventContext)],
    hasOlderMemory: Boolean(memoryCursor),
    hasOlderHistory: Boolean(historyCursor && deps.recallHistory),
    recentMessages: sources, observations,
  });

  for (let iteration = 0; iteration < (input.maxDecisions ?? 8); iteration++) {
    deps.assertActive?.();
    let raw: unknown;
    try { modelDecisions++; raw = await deps.decide(promptContext()); }
    catch (error) {
      deps.assertActive?.();
      const code = (error as { code?: string })?.code;
      const status = (error as { status?: number })?.status;
      const transientProviderFailure = status === 429 || (typeof status === 'number' && status >= 500 && status <= 599)
        || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code || '');
      if (transientProviderFailure && providerRecoveryAttempts < 1 && modelDecisions < (input.maxDecisions ?? 8)) {
        providerRecoveryAttempts++;
        event('Nova tentativa após indisponibilidade temporária do modelo', 'reasoning_provider_retry');
        observations.push({ result: 'decision_provider_retry', detail: 'A tentativa anterior não retornou decisão. Nenhuma ferramenta foi executada por essa tentativa. Continue usando o estado e os resultados confirmados.' });
        continue;
      }
      if (code !== 'INVALID_STRUCTURED_OUTPUT' && code !== 'MODEL_SCHEMA_VALIDATION_FAILED') throw error;
      observations.push({ error: 'invalid_decision', detail: 'A proposta não validou o contrato. Corrija o formato, envie apenas uma decisão com os campos definidos. Nenhuma ação dessa proposta foi executada.' });
      continue;
    }
    deps.assertActive?.();
    const parsed = StudioReasoningDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      observations.push({ error: 'invalid_decision', detail: 'Retorne uma decisão válida no contrato fornecido, com no máximo uma atualização por pedido e por escolha de cada pedido.' });
      continue;
    }
    const decision = parsed.data;
    // Validate the entire memory/request proposal before applying any part of it.
    const proposed: StudioReasoningState = structuredClone(state.reasoning!);
    const writes: StudioMemoryEvent[] = [];
    try {
      for (const update of decision.requests) {
        if (update.procedureId && !document.resolveStage.procedures.some((p) => p.id === update.procedureId && p.status !== 'archived')) throw new Error('Procedimento não publicado.');
        const existing = proposed.requests.find((r) => r.id === update.id);
        if (existing && existing.procedureId !== update.procedureId) throw new Error('Use outro pedido para um procedimento diferente.');
        let memoryRequestId = existing?.memoryRequestId || `${state.id}:${update.id}`;
        if (update.resumeFrom && update.resumeFrom !== memoryRequestId) {
          if (!memory.some(({ event }) => event.requestId === update.resumeFrom && event.source.procedureId === update.procedureId)) throw new Error('Recupere a memória do pedido antes de retomá-lo.');
          if (existing && (Object.keys(existing.values).length || existing.unavailable.length
            || Object.keys(existing.integrationValues).length || Object.keys(existing.branchSelections || {}).length
            || proposed.pendingAction?.requestId === existing.id
            || proposed.operations.some((operation) => operation.requestId === existing.id))) throw new Error('Este pedido já tem escolhas, contexto ou operações. Retome o pedido antigo com outro identificador local.');
          if (proposed.requests.some((request) => request.id !== update.id && request.memoryRequestId === update.resumeFrom)) throw new Error('O pedido recuperado já está no contexto. Atualize o pedido existente.');
          if (existing) {
            // Retire only the empty provisional identity; the recovered request remains intact.
            // Keep this revision in the same atomic proposal as the new binding.
            writes.push({ version: 1, requestId: memoryRequestId, kind: 'request', key: 'request',
              label: existing.objective.slice(0, 500),
              value: { objective: existing.objective, supersededBy: update.resumeFrom },
              status: 'cancelled', sensitive: false,
              source: { sessionId: state.id, releaseId: state.releaseId, procedureId: existing.procedureId,
                messageId: input.messageId, quote: input.message.slice(0, 4000), at: now() } });
          }
          memoryRequestId = update.resumeFrom;
        }
        if (update.status === 'resolved' && proposed.operations.some((operation) => operation.status === 'unknown'
          && (operation.memoryRequestId || `${state.id}:${operation.requestId}`) === memoryRequestId)) {
          throw new Error('O pedido tem uma operação sem resultado confirmado. Preserve-o ativo ou pausado e explique o que ainda precisa ser verificado; não registre resolução.');
        }
        if (update.status === 'resolved' && !memoryRequestId.startsWith(`${state.id}:`) && deps.priorRequestOperations) {
          let prior: Awaited<ReturnType<NonNullable<typeof deps.priorRequestOperations>>>;
          try { prior = await deps.priorRequestOperations(memoryRequestId); }
          catch {
            deps.assertActive?.();
            throw new Error('Não foi possível verificar as operações do pedido retomado. Preserve a pendência e explique a limitação antes de registrar resolução.');
          }
          deps.assertActive?.();
          const uncertain = prior.flatMap((entry) => entry.operations).filter((operation) => operation.status === 'unknown' && operation.readOnly !== true);
          if (uncertain.length) {
            for (const operation of uncertain) historicalOperations.set(operation.id, operation);
            observations.push({ result: 'historical_request_outcome_unknown', requestId: update.id, operations: uncertain.map(operationSummary) });
            throw new Error('O pedido retomado tem uma operação anterior sem resultado confirmado. Consulte o status antes de registrar resolução.');
          }
        }
        const changed = !existing || existing.objective !== update.objective || existing.status !== update.status
          || memoryRequestId !== (existing.memoryRequestId || `${state.id}:${update.id}`);
        if (existing) Object.assign(existing, update, { memoryRequestId });
        else proposed.requests.push({ ...update, memoryRequestId, values: {}, integrationValues: {}, choiceLabels: {}, unavailable: [] });
        if (changed) {
          // Request journal also records pause/resolution, separately from choice revisions.
          writes.push({ version: 1, requestId: memoryRequestId, kind: 'request', key: 'request', label: update.objective.slice(0, 500),
            value: update.objective, status: update.status, sensitive: false,
            source: { sessionId: state.id, releaseId: state.releaseId, procedureId: update.procedureId,
              messageId: input.messageId, quote: input.message.slice(0, 4000), at: now() } });
        }
      }
      for (const choice of decision.choices) {
        const request = proposed.requests.find((r) => r.id === choice.requestId);
        if (!request) throw new Error('Escolha sem pedido identificado.');
        const source = sources.find((s) => !s.fromMe && s.messageId === choice.sourceMessageId && s.content.includes(choice.quote));
        const field = document.resolveStage.procedures.find((p) => p.id === request.procedureId)?.steps.find((s) => s.collectField?.variableKey === choice.key)?.collectField;
        const outputKeys = document.resolveStage.procedures.find((p) => p.id === request.procedureId)?.steps.flatMap((s) =>
          (s.httpRequest?.outputMappings || s.mcpTool?.outputMappings || []).map((o) => o.chipKey)) || [];
        if (outputKeys.includes(choice.key)) throw new Error('Resultados de integração não podem ser preenchidos por escolhas do cliente.');
        if (field && matchProhibitedStudioField(field, document)) throw new Error('Este dado não pode ser coletado.');
        let value: unknown = choice.value;
        let memoryValue: unknown = choice.value;
        if (choice.status === 'active' && field) {
          // Only an actual integration result can supply dynamic IDs. Remember the display choice,
          // then bind it to the current catalog instead of carrying an old operational identifier.
          const resolved = resolveStudioCollectionOptions(field, request.integrationValues || {});
          const validation = validateStudioField(resolved.field, value);
          if (!validation.valid) throw new Error('A escolha não é válida para o campo publicado.');
          value = validation.value;
          memoryValue = validation.value;
          if (resolved.options) value = Array.isArray(validation.value)
            ? validation.value.map((label) => resolved.options!.find((option) => option.label === label)!.value)
            : resolved.options.find((option) => option.label === validation.value)!.value;
        }
        // Compare the validated display value, not the model's textual encoding
        // or a current catalog ID. Stored numbers and lists retain their types.
        const remembered = [...savedThisTurn.values(), ...visibleStoredMemory().map(({ event }) => event)].find((e) => e.kind === 'choice'
          && e.requestId === (request.memoryRequestId || `${state.id}:${request.id}`)
          && e.source.procedureId === request.procedureId && e.status === choice.status
          && e.source.messageId === choice.sourceMessageId && e.source.quote.includes(choice.quote)
          && e.key === choice.key && canonical(e.value) === canonical(choice.status === 'active' ? memoryValue : null));
        if (!source && !remembered) throw new Error('Escolha sem evidência nas mensagens do cliente ou na memória recuperada.');
        if (choice.status === 'active') {
          request.values[choice.key] = value; request.unavailable = request.unavailable.filter((k) => k !== choice.key);
          if (field?.optionsSourceKey) { request.choiceLabels ||= {}; request.choiceLabels[choice.key] = memoryValue; }
        } else {
          delete request.values[choice.key]; if (request.choiceLabels) delete request.choiceLabels[choice.key];
          if (!request.unavailable.includes(choice.key)) request.unavailable.push(choice.key);
        }
        writes.push({ version: 1, requestId: request.memoryRequestId || `${state.id}:${request.id}`, kind: 'choice', key: choice.key, label: choice.label,
          value: choice.status === 'active' ? memoryValue : null, status: choice.status, sensitive: Boolean(field?.isSensitive),
          source: { sessionId: state.id, releaseId: state.releaseId, procedureId: request.procedureId,
            messageId: choice.sourceMessageId, quote: choice.quote, at: remembered?.source.at || now() } });
      }
      if (proposed.pendingAction) {
        const pendingRequest = proposed.requests.find((request) => request.id === proposed.pendingAction!.requestId);
        if (pendingRequest?.status === 'cancelled' || pendingRequest?.status === 'resolved') proposed.pendingAction = null;
      }
      if (proposed.requests.length > 20) {
        const touched = new Set([...decision.requests.filter((request) => request.status === 'active').map((request) => request.id),
          ...decision.choices.map((choice) => choice.requestId), decision.action.requestId, proposed.pendingAction?.requestId]);
        const removable = proposed.requests.filter((request) => request.status !== 'active' && request.memoryRequestId && !touched.has(request.id)
          && !proposed.operations.some((operation) => operationBelongsTo(operation, request) && operation.status === 'unknown'));
        const removeIds = new Set(removable.slice(0, proposed.requests.length - 20).map((request) => request.id));
        proposed.requests = proposed.requests.filter((request) => !removeIds.has(request.id));
        if (proposed.requests.length > 20) throw new Error('O contexto tem 20 pedidos em andamento. Pause pedidos que podem aguardar; suas escolhas permanecem na memória.');
      }
    } catch (error) {
      deps.assertActive?.();
      observations.push({ error: 'proposal_rejected', detail: error instanceof Error ? error.message : 'Proposta inválida.' });
      continue;
    }
    state.reasoning = proposed;
    pendingMemory.push(...writes);
    // Persist choices before another model call, including responses that ask a clarifying question.
    if (pendingMemory.length) await checkpoint();
    const action = decision.action;
    if (input.suggestionOnly && ['tool', 'handoff'].includes(action.kind)) {
      observations.push({ error: 'suggestion_only', detail: 'Este atendimento está em modo de sugestão; responda sem executar operações.' }); continue;
    }
    if (action.kind === 'respond') {
      if (!action.response?.trim()) { observations.push({ error: 'empty_response' }); continue; }
      delete state.reasoning.recallCursor;
      delete state.reasoning.historyCursor;
      const complete = state.reasoning.requests.length > 0 && state.reasoning.requests.every((r) => ['resolved', 'cancelled'].includes(r.status))
        && !studioHasUncertainOperation(state) && !state.reasoning.pendingAction;
      state.phase = complete ? 'done' : 'resolve'; state.status = complete ? 'resolved' : 'waiting_input';
      event('Resposta do agente', complete ? 'reasoning_resolved' : 'reasoning_waiting_input');
      const published = state.reasoning.requests.filter((request) => (request.status === 'active' || decision.requests.some((update) => update.id === request.id)) && (!action.requestId || request.id === action.requestId))
        .flatMap((request) => businessPaths(request)?.responses || []);
      return finish([action.response.trim(), ...published.filter((text) => text && !action.response!.includes(text))].join('\n\n'));
    }
    if (action.kind === 'branch') {
      const request = state.reasoning.requests.find((request) => request.id === action.requestId && request.status === 'active');
      const stepId = request && action.capabilityId?.startsWith(`${request.procedureId}:`) ? action.capabilityId.slice(request.procedureId!.length + 1) : null;
      const available = request && businessPaths(request)?.decisions.find((decision) => decision.id === stepId && !decision.waitingFor.length);
      const branch = available?.branches.find((branch) => branch.id === action.query && !branch.condition);
      if (!request || !stepId || !branch) { observations.push({ error: 'business_branch_unavailable', detail: 'Escolha apenas uma situação descritiva publicada e disponível. Condições de dados são verificadas pelo servidor.' }); continue; }
      request.branchSelections ||= {};
      request.branchSelections[stepId] = { branchId: branch.id, signature: branchSignature(request) };
      await checkpoint();
      observations.push({ result: 'business_branch_selected', stepId, branchId: branch.id });
      continue;
    }
    if (action.kind === 'recall_history') {
      if (!historyCursor || !deps.recallHistory) { observations.push({ result: 'history_exhausted' }); continue; }
      const requestedCursor = historyCursor;
      let page: Awaited<ReturnType<NonNullable<typeof deps.recallHistory>>>;
      try { page = await deps.recallHistory(requestedCursor); }
      catch {
        deps.assertActive?.();
        observations.push({ error: 'history_temporarily_unavailable', detail: 'A consulta do histórico falhou; isso não significa ausência de escolhas antigas. Preserve o cursor, use o contexto disponível e explique a limitação se ela impedir continuar.' });
        continue;
      }
      deps.assertActive?.();
      const seen = new Set(sources.map((source) => source.messageId));
      sources.unshift(...page.sources.filter((source) => !seen.has(source.messageId)));
      historyCursor = page.nextCursor;
      state.reasoning.historyCursor = requestedCursor;
      await checkpoint();
      observations.push({ result: 'history_loaded', count: page.sources.length });
      continue;
    }
    if (action.kind === 'recall') {
      if (action.query?.startsWith('session:')) {
        const sessionId = action.query.slice('session:'.length);
        const knownSession = memory.some(({ event }) => event.source.sessionId === sessionId);
        if (!knownSession || !deps.recallSessionOperations) {
          observations.push({ error: 'historical_session_unavailable', detail: 'Recupere primeiro uma memória com sourceSessionId desta sessão. A consulta deve estar disponível neste atendimento.' });
          continue;
        }
        let archived: Awaited<ReturnType<NonNullable<typeof deps.recallSessionOperations>>>;
        try { archived = await deps.recallSessionOperations(sessionId); }
        catch {
          deps.assertActive?.();
          observations.push({ error: 'historical_session_temporarily_unavailable', detail: 'Não foi possível consultar as operações antigas. Isso não prova que uma ação deixou de acontecer.' });
          continue;
        }
        deps.assertActive?.();
        if (archived) for (const operation of archived.operations) historicalOperations.set(operation.id, operation);
        observations.push(archived ? { result: 'historical_session_operations', sessionId, releaseId: archived.releaseId,
          operations: archived.operations.map(operationSummary),
          detail: 'Evidência histórica. Não é consentimento, não atualiza o pedido atual e não prova disponibilidade ou preços atuais.' }
          : { result: 'historical_session_not_retained', sessionId, detail: 'Sem snapshot disponível; não conclua que não houve operações.' });
        continue;
      }
      if (action.query?.startsWith('operation:')) {
        const operationId = action.query.slice('operation:'.length);
        const operation = state.reasoning.operations.find((entry) => entry.id === operationId) || historicalOperations.get(operationId);
        observations.push(operation ? { result: 'historical_operation_loaded', operation,
          detail: 'Registro histórico de execução; não prova que os dados continuam atuais nem autoriza repetir a ação.' }
          : { error: 'historical_operation_not_found' });
        continue;
      }
      if (!memoryCursor) { observations.push({ result: 'memory_exhausted' }); continue; }
      const requestedCursor = memoryCursor;
      let page: Awaited<ReturnType<typeof deps.recall>>;
      try { page = await deps.recall(requestedCursor); }
      catch {
        deps.assertActive?.();
        observations.push({ error: 'memory_temporarily_unavailable', detail: 'A consulta de memória falhou; não conclua que o cliente nunca escolheu. Preserve escolhas conhecidas e avalie outra forma de avançar sem inventar o conteúdo ausente.' });
        continue;
      }
      deps.assertActive?.();
      memory.push(...page.records); memoryCursor = page.nextCursor;
      // Re-read the last loaded page after a budget boundary: its evidence may not have been
      // consumed by the model yet. Earlier pages need not be scanned from the beginning again.
      state.reasoning.recallCursor = requestedCursor;
      await checkpoint();
      observations.push({ result: 'memory_loaded', count: page.records.length });
      continue;
    }
    if (action.kind === 'knowledge') {
      try { observations.push({ kind: 'knowledge', query: action.query,
        result: await deps.knowledge(action.query || input.message, document.resolveStage.knowledgeCollectionIds, { requireSources: true }) }); }
      catch { observations.push({ kind: 'knowledge', result: 'unavailable' }); }
      deps.assertActive?.(); continue;
    }
    if (action.kind === 'consult') {
      if (!deps.consult) observations.push({ result: 'stronger_model_not_configured' });
      else {
        try { observations.push({ kind: 'advice', result: await deps.consult({ ...promptContext(), question: action.query }) }); }
        catch { observations.push({ result: 'stronger_model_unavailable' }); }
      }
      deps.assertActive?.(); continue;
    }
    if (action.kind === 'handoff') {
      const targetRequest = state.reasoning.requests.find((request) => request.id === action.requestId && request.status === 'active');
      const publishedHandoff = targetRequest ? businessPaths(targetRequest)?.handoffs[0] : undefined;
      const operationId = `${state.id}:handoff`;
      if (state.reasoning.operations.some((op) => op.id === operationId)) {
        observations.push({ error: 'handoff_already_attempted', detail: 'Não repita uma transferência já solicitada.' }); continue;
      }
      // Preserve any business operation requiring reconciliation when a customer asks for a person.
      const priorInFlight = state.inFlight;
      const transfer: StudioReasoningState['operations'][number] = { id: operationId, requestId: '_handoff', capabilityId: '_handoff',
        signature: operationId, status: 'unknown', readOnly: false, title: 'Transferir atendimento', values: {}, at: now() };
      state.reasoning.operations.push(transfer);
      state.inFlight = priorInFlight || { key: operationId, stepId: 'handoff' }; await checkpoint();
      let result: Awaited<ReturnType<typeof deps.handoff>>;
      try {
        result = await deps.handoff(publishedHandoff?.team || document.concludeStage.handoffTeam, action.reason || publishedHandoff?.reason || '', { ...input.context, values: {} }, operationId);
      } catch {
        deps.assertActive?.();
        observations.push({ error: 'handoff_outcome_unknown', detail: 'A transferência não teve confirmação. Não anuncie que o cliente foi encaminhado, não repita a transferência e preserve pedidos pendentes. Explique o impedimento; consultas sem alteração ainda podem ajudar.' });
        event('Transferência sem confirmação de resultado', 'outcome_unknown');
        await checkpoint();
        continue;
      }
      deps.assertActive?.(); transfer.status = 'succeeded'; state.inFlight = priorInFlight; state.phase = 'done'; state.status = 'transferred';
      event('Transferência executada', 'transferred');
      return finish(result?.message || document.concludeStage.handoffMessage);
    }
    const request = state.reasoning.requests.find((r) => r.id === action.requestId && r.status === 'active');
    const capability = request && capabilities(request).find((c) => c.id === action.capabilityId);
    if (!request || !capability?.ready) { observations.push({ error: 'capability_unavailable', detail: capability?.blockedReason }); continue; }
    const step = document.resolveStage.procedures.find((p) => p.id === request.procedureId)!.steps.find((s) => s.id === capability.stepId)!;
    const context = requestContext(request);
    const mappings = [...(step.httpRequest?.sentDataMappings || []), ...(step.nativeActionType === 'show_catalog_image' && step.nativeActionPayload?.selectionMode === 'recommendation' ? [] : step.nativeDataMappings || []),
      ...(step.mcpTool?.argumentMappings || []).map((m) => ({ sourceType: m.sourceType, sourceValue: m.sourceChipKey, valueType: m.valueType }))];
    const resolvedInputs = mappings.map((m) => resolveStudioMapping(m, context));
    let catalogProductId: string | number | undefined;
    if (step.nativeActionType === 'show_catalog_image' && step.nativeActionPayload?.selectionMode === 'recommendation') {
      try {
        const selected: unknown = JSON.parse(action.query || 'null');
        const image = resolveStudioCatalogImage(StudioCatalogImageSchema.parse(step.nativeActionPayload), selected, request.integrationValues || {});
        catalogProductId = image.productId as string | number;
        resolvedInputs.push(catalogProductId);
      } catch {
        observations.push({ error: 'catalog_product_unavailable', detail: 'Informe em query o identificador JSON exato de um produto do catálogo consultado, sem registrar uma escolha do cliente.' });
        continue;
      }
    }
    // Presenting a product is repeatable in response to a new customer message.
    // Keep dispatch idempotent within that message, including retries after restart.
    const isCatalogPresentation = step.nativeActionType === 'show_catalog_image';
    const operationIdentity = [state.releaseId, durableRequestId(request), capability.id, resolvedInputs, step.nativeActionPayload || null];
    const operationSignature = signature(isCatalogPresentation ? [...operationIdentity, input.messageId] : operationIdentity);
    const consentSignature = signature([operationSignature, context]);
    if (!capability.readOnly && deps.priorRequestOperations) {
      let history: Awaited<ReturnType<NonNullable<typeof deps.priorRequestOperations>>>;
      try { history = await deps.priorRequestOperations(durableRequestId(request)); }
      catch {
        deps.assertActive?.();
        observations.push({ error: 'prior_operations_unavailable', detail: 'Não foi possível verificar as ações anteriores deste pedido. A alteração não foi executada; consulte informações sem alteração ou explique a pendência.' });
        continue;
      }
      deps.assertActive?.();
      const earlier = history.flatMap((entry) => entry.operations.filter((operation) => (operation.status === 'unknown' && operation.readOnly !== true)
        || (operation.readOnly !== true && operation.capabilityId === capability.id && !isCatalogPresentation && operation.status === 'succeeded'
          && (operation.signature === signature([entry.releaseId, durableRequestId(request), capability.id, resolvedInputs, step.nativeActionPayload || null])
            || operation.signature === signature([entry.releaseId, operation.requestId, capability.id, resolvedInputs, step.nativeActionPayload || null])))));
      if (earlier.length) {
        for (const operation of earlier) historicalOperations.set(operation.id, operation);
        observations.push({ result: 'prior_operation_already_attempted', operations: earlier.map(operationSummary),
          detail: 'O mesmo pedido tem uma execução equivalente já realizada ou uma operação anterior sem resultado confirmado. Nenhuma nova alteração foi executada. Consulte o status disponível e explique o resultado conhecido ou a verificação ainda necessária.' });
        continue;
      }
    }
    const previous = state.reasoning.operations.find((op) => op.status !== 'failed' && (op.signature === operationSignature
      || (!isCatalogPresentation && operationBelongsTo(op, request) && op.signature === signature([state.releaseId, op.requestId, capability.id, resolvedInputs, step.nativeActionPayload || null]))
      || (isCatalogPresentation && op.status === 'unknown' && operationBelongsTo(op, request) && op.capabilityId === capability.id)));
    if (previous && !capability.readOnly) { observations.push({ result: 'operation_already_attempted', operation: previous }); continue; }
    if (studioHasUncertainOperation(state) && !capability.readOnly) { observations.push({ error: 'operation_outcome_unknown' }); continue; }
    // Keep the newest consultation per request/capability, including failures. Business effects
    // and unknown outcomes remain intact for duplicate prevention and reconciliation.
    if (state.reasoning.operations.length >= 90) {
      const retainedReads = new Set<string>();
      state.reasoning.operations = [...state.reasoning.operations].reverse().filter((operation) => {
        if (operation.status === 'unknown' || operation.id === state.inFlight?.key) return true;
        // The published definition may change. Never reinterpret a recorded effect
        // as a disposable consultation using today's capability configuration.
        if (operation.readOnly !== true) return true;
        const owner = state.reasoning!.requests.find((entry) => operationBelongsTo(operation, entry));
        const source = owner && document.resolveStage.procedures.find((entry) => entry.id === owner.procedureId)?.steps
          .find((entry) => `${owner.procedureId}:${entry.id}` === operation.capabilityId);
        if (!source || !studioStepIsReadOnly(source)) return true;
        const key = JSON.stringify([operation.memoryRequestId || operation.requestId, operation.capabilityId]);
        if (retainedReads.has(key)) return false;
        retainedReads.add(key); return true;
      }).reverse();
    }
    if (state.reasoning.operations.length >= 100 || (state.toolCallCount || 0) >= (document.rules.maxToolCallsPerSession ?? 50)) {
      budgetReached = true;
      observations.push({ error: 'operation_budget_exhausted', detail: 'Preserve os pedidos e explique o que ainda falta, sem alegar resolução.' }); continue;
    }
    const needsConfirmation = capability.requiresConfirmation || Boolean(await deps.needsConfirmation?.(step));
    deps.assertActive?.();
    const pending = state.reasoning.pendingAction;
    const confirmed = needsConfirmation && pending?.signature === consentSignature && pending.proposedMessageId !== input.messageId
      && action.consent === 'approve' && Boolean(action.consentQuote?.trim() && input.message.includes(action.consentQuote));
    if (needsConfirmation && !confirmed) {
      if (action.consent === 'decline' && pending?.signature === consentSignature) {
        state.reasoning.pendingAction = null; observations.push({ result: 'operation_declined' }); continue;
      }
      if (!action.response?.trim()) {
        observations.push({ result: 'confirmation_proposal_required', requestId: request.id, capabilityId: capability.id,
          detail: 'Esta ação exige confirmação. Repita a proposta com response contendo uma pergunta clara sobre a ação e os dados relevantes já verificados. Nada foi executado. Não apresente informações sensíveis nem diga que a ação foi concluída.' });
        continue;
      }
      state.reasoning.pendingAction = { requestId: request.id, capabilityId: capability.id, signature: consentSignature,
        proposedMessageId: input.messageId, proposalText: action.response.trim() };
      state.phase = 'resolve'; state.status = 'waiting_input';
      return finish(action.response.trim());
    }
    const operationId = `${state.id}:${operationSignature}${capability.readOnly ? `:read-${state.toolCallCount || 0}` : ''}`;
    const operation: StudioReasoningState['operations'][number] = { id: operationId, requestId: request.id, memoryRequestId: durableRequestId(request),
      capabilityId: capability.id, title: capability.title.slice(0, 500), signature: operationSignature, status: 'unknown', readOnly: capability.readOnly, values: {}, at: now() };
    state.reasoning.operations.push(operation); state.toolCallCount = (state.toolCallCount || 0) + 1;
    // A concurrent turn cannot pass this durable reservation; failure to checkpoint stops dispatch.
    const priorInFlight = state.inFlight;
    // A recovery read must not replace the durable pointer to an unresolved effect:
    // the process may stop before its finally-equivalent restoration checkpoint.
    state.inFlight = priorInFlight || { key: operationId, stepId: step.id }; await checkpoint();
    try {
      const result = await deps.execute(step, context, { id: operationId, confirmed: Boolean(confirmed), catalogProductId });
      deps.assertActive?.();
      operation.status = 'succeeded';
      if (step.nativeActionType === 'show_catalog_image' && result.presentedProduct) operation.presentedProduct = result.presentedProduct;
      operation.values = Object.fromEntries(Object.entries(result.values || {}).filter(([key]) => capability.outputs.includes(key)));
      // A later lookup refreshes operational facts without overwriting customer choices.
      const refreshedValues = { ...(request.integrationValues || {}) };
      for (const output of step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []) delete refreshedValues[output.chipKey];
      request.integrationValues = { ...refreshedValues, ...(result.values || {}) };
      state.inFlight = priorInFlight;
      if (state.reasoning.pendingAction?.requestId === request.id && state.reasoning.pendingAction.capabilityId === capability.id) {
        state.reasoning.pendingAction = null;
      }
      observations.push({ kind: 'tool', operation });
      event(capability.title, 'reasoning_tool_succeeded');
    } catch {
      deps.assertActive?.();
      operation.status = capability.readOnly ? 'failed' : 'unknown';
      if (capability.readOnly) for (const output of step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []) delete request.integrationValues[output.chipKey];
      if (capability.readOnly) state.inFlight = priorInFlight;
      observations.push({ kind: 'tool', operation, detail: capability.readOnly
        ? 'Consulta falhou. Avalie outra consulta, esclarecimento ou nova tentativa útil.'
        : 'Resultado da alteração desconhecido. Consulte o status antes de qualquer repetição.' });
      event(capability.title, capability.readOnly ? 'reasoning_tool_failed' : 'outcome_unknown');
    }
    await checkpoint();
  }
  state.phase = 'resolve'; state.status = 'waiting_input';
  event('Orçamento de raciocínio do turno', 'reasoning_budget_reached');
  budgetReached = true;
  return finish('Seu pedido e suas escolhas estão preservados. Ainda não consegui concluir a verificação.');
}
