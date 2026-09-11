import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { advanceStudioReasoningSession, type StudioReasoningInput } from '@/services/agent-studio/reasoning-engine';
import { createStudioSession, StudioSessionSchema } from '@/services/agent-studio/engine';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema, HttpRequestStepConfigSchema } from '@/services/agent-studio/types';
import type { StudioReasoningDecision } from '@/services/agent-studio/reasoning-contract';
import type { StudioMemoryEvent } from '@/services/agent-studio/durable-memory';
import { compileStudioReasoningCapabilities } from '@/services/agent-studio/reasoning-capabilities';

const decision = (kind: StudioReasoningDecision['action']['kind'], overrides: Partial<StudioReasoningDecision['action']> = {},
  updates: Partial<StudioReasoningDecision> = {}): StudioReasoningDecision => ({ requests: [], choices: [],
  action: { kind, requestId: null, capabilityId: null, query: null, response: null, consent: 'none', consentQuote: null, reason: '', ...overrides }, ...updates });
const request = (status = 'active') => ({ id: 'contract', procedureId: 'contract', objective: 'Contratar o plano escolhido', status }) as StudioReasoningDecision['requests'][number];
function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'contract', name: 'Contratar', updatedAt: '2026-09-08', steps: [
    { id: 'plan', type: 'collect_data', order: 1, title: 'Plano', collectField: CollectedFieldDefinitionSchema.parse({ id: 'plan', name: 'Plano', variableKey: 'plan', type: 'single_select', promptMessage: 'Qual plano?', options: ['700', '1000'] }) },
    ...['lookup', 'alternative', 'activate'].map((id, i) => ({ id, type: 'http_request', order: i + 2, title: id,
      adaptiveAccess: { enabled: true, requiresSteps: [] }, httpRequest: HttpRequestStepConfigSchema.parse({ name: id,
        method: id === 'activate' ? 'POST' : 'GET', url: 'https://example.test',
        outputMappings: [{ chipKey: 'result', chipLabel: 'Resultado', jsonPath: 'result' }] }) })),
  ] })];
  const memory: StudioMemoryEvent[] = [];
  const dependencies = { decide: vi.fn(), execute: vi.fn().mockResolvedValue({ values: { result: 'confirmed' } }),
    checkpoint: vi.fn(async (_state, events) => { memory.push(...events); }),
    knowledge: vi.fn().mockResolvedValue('published knowledge'), handoff: vi.fn().mockResolvedValue({ message: 'Transferência confirmada' }),
    recall: vi.fn().mockResolvedValue({ records: [], nextCursor: null }), assertActive: vi.fn(), now: () => Date.parse('2026-09-08T12:00:00.000Z') };
  const input: StudioReasoningInput = { document, state: createStudioSession('agent', 'release', 'session'), message: 'Quero 700, mas minha internet está ruim',
    messageId: 'm1', sources: [], context: { contact: { id: 'current-contact' } }, memory: { records: [], nextCursor: null }, dependencies };
  return { input, dependencies, memory };
}

describe('reasoning loop: controlled decisions and real orchestration', () => {
  it('requires a contextual proposal before accepting confirmation for a write', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', {
      requestId: 'contract', capabilityId: 'contract:activate', consent: 'approve', consentQuote: 'Sim',
    }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('respond', { response: 'Preciso confirmar qual ativação você deseja.' }));
    const result = await advanceStudioReasoningSession({ ...f.input, message: 'Sim' });
    expect(f.dependencies.execute).not.toHaveBeenCalled();
    expect(result.state.reasoning?.pendingAction).toBeNull();
    expect(f.dependencies.decide.mock.calls[1][0].observations).toContainEqual(expect.objectContaining({
      result: 'confirmation_proposal_required',
    }));
  });

  it('uses media interpretation as context without accepting it as a customer choice quotation', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Escolha anotada.' }, {
      requests: [request()], choices: [{ requestId: 'contract', key: 'plan', label: 'Plano', value: '700',
        status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' }],
    })).mockResolvedValueOnce(decision('respond', { response: 'Você quer o plano 700 mostrado na imagem?' }));
    const result = await advanceStudioReasoningSession({ ...f.input, message: 'Veja esta imagem', mediaAnalysisContext: 'Quero 700' });
    expect(f.dependencies.decide.mock.calls[0][0].mediaAnalysis).toMatchObject({
      content: 'Quero 700', source: 'automated_media_interpretation', sourceMessageId: 'm1',
    });
    expect(result.state.reasoning?.requests.flatMap((entry) => Object.keys(entry.values))).toEqual([]);
    expect(f.memory.filter((entry) => entry.kind === 'choice')).toEqual([]);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('does not borrow a published transfer team from another active request', async () => {
    const f = fixture();
    f.input.document.concludeStage.handoffTeam = 'general-team';
    const other = structuredClone(f.input.document.resolveStage.procedures[0]);
    other.id = 'support'; other.steps = [{ id: 'specialist', order: 1, type: 'handoff', title: 'Suporte', handoffTeam: 'support-team' }];
    f.input.document.resolveStage.procedures.push(other);
    f.dependencies.decide.mockResolvedValueOnce(decision('handoff', { requestId: 'contract', reason: 'Cliente pediu uma pessoa.' }, {
      requests: [request(), { id: 'technical', procedureId: 'support', objective: 'Revisar conexão', status: 'active' }],
    }));
    await advanceStudioReasoningSession(f.input);
    expect(f.dependencies.handoff).toHaveBeenCalledWith('general-team', expect.any(String), expect.any(Object), expect.any(String));
  });
  it('uses the published team only after the model elects to hand off the matching request', async () => {
    const f = fixture();
    f.input.document.resolveStage.procedures[0].steps = [{ id: 'specialist', order: 1, type: 'handoff', title: 'Revisão comercial', handoffTeam: 'sales-review', handoffReason: 'Revisão solicitada' }];
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Posso conferir as alternativas.' }, { requests: [request()] }));
    const first = await advanceStudioReasoningSession(f.input);
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
    f.dependencies.decide.mockResolvedValueOnce(decision('handoff', { requestId: 'contract', reason: 'Cliente pediu revisão humana.' }));
    await advanceStudioReasoningSession({ ...f.input, state: first.state, messageId: 'm2', message: 'Quero falar com uma pessoa' });
    expect(f.dependencies.handoff).toHaveBeenCalledWith('sales-review', 'Cliente pediu revisão humana.', expect.any(Object), expect.any(String));
  });
  it('blocks an ineligible business write and preserves the published denial when concluding the request', async () => {
    const f = fixture(); const procedure = f.input.document.resolveStage.procedures[0];
    procedure.steps[3].order = 5;
    procedure.steps.splice(3,0,{ id: 'eligibility', order: 4, type: 'decision', title: 'Elegibilidade', decisionBranches: [
      { id: 'allowed', conditionLabel: 'Elegível', condition: { fieldKey: 'result', operator: 'equals', value: 'allowed' }, actionType: 'continue', nextStepId: 'activate' },
      { id: 'denied', conditionLabel: 'Indisponível', isDefault: true, actionType: 'respond', actionValue: 'Oferta indisponível para este contrato.' },
    ] });
    f.dependencies.execute.mockResolvedValue({ values: { result: 'denied' } });
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate' }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }))
      .mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Consultei a elegibilidade.' }, { requests: [request('resolved')] }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
    expect(f.dependencies.execute.mock.calls[0][0].id).toBe('lookup');
    expect(result.response).toContain('Oferta indisponível para este contrato.');
    expect(result.state.reasoning?.pendingAction).toBeNull();
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });
  it('recognizes a completed write from the previous local-ID signature format', async () => {
    const f = fixture();
    f.input.state.reasoning = { version: 2, requests: [{ ...request(), values: {}, integrationValues: {}, choiceLabels: {}, unavailable: [] }], pendingAction: null,
      operations: [{ id: 'legacy-write', requestId: 'contract', capabilityId: 'contract:activate',
        signature: createHash('sha256').update('["release","contract","contract:activate",[],null]').digest('hex'),
        status: 'succeeded', values: {}, at: '2026-09-08T00:00:00.000Z' }] };
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Operação já concluída.' }));
    await advanceStudioReasoningSession(f.input);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
    expect(f.dependencies.decide.mock.calls[1][0].observations[0].result).toBe('operation_already_attempted');
  });

  it('keeps an inactive request with an unknown operation in context while archiving another request', async () => {
    const f = fixture();
    f.input.state.reasoning = { version: 2, requests: Array.from({ length: 20 }, (_, i) => ({ ...request('paused'), id: `request-${i}`, memoryRequestId: `${f.input.state.id}:request-${i}`,
      values: {}, integrationValues: {}, choiceLabels: {}, unavailable: [] })), pendingAction: null,
      operations: [{ id: 'uncertain', requestId: 'request-0', capabilityId: 'contract:activate', signature: 'uncertain', status: 'unknown', values: {}, at: '2026-09-08T00:00:00.000Z' }] };
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Novo pedido guardado.' }, { requests: [{ ...request('paused'), id: 'new-request' }] }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.reasoning?.requests).toHaveLength(20);
    expect(result.state.reasoning?.requests.some((request) => request.id === 'request-0')).toBe(true);
    expect(result.state.reasoning?.requests.some((request) => request.id === 'request-1')).toBe(false);
    expect(result.state.reasoning?.operations[0].status).toBe('unknown');
  });
  it('archives inactive requests beyond twenty and restores choices without repeating a completed write', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', response: 'Confirma a ativação do plano 700?' }, { requests: [request()], choices: [
      { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' },
    ] }));
    let result = await advanceStudioReasoningSession(f.input);
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', consent: 'approve', consentQuote: 'Sim' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Pedido pausado.' }, { requests: [request('paused')] }));
    result = await advanceStudioReasoningSession({ ...f.input, state: result.state, message: 'Sim', messageId: 'approved' });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 21; i++) {
      f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('respond', { response: 'Pedido guardado.' }, { requests: [{ id: `other-${i}`, procedureId: null, objective: `Outro pedido ${i}`, status: 'paused' }] }));
      result = await advanceStudioReasoningSession({ ...f.input, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(result.state))), message: `Outro pedido ${i}`, messageId: `other-${i}` });
    }
    expect(result.state.reasoning?.requests).toHaveLength(20);
    expect(result.state.reasoning?.requests.some((request) => request.id === 'contract')).toBe(false);
    const records = f.memory.map((event, index) => ({ sequence: String(index + 1), eventId: `event-${index}`, event }));
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('tool', { requestId: 'restored', capabilityId: 'contract:activate' }, {
      requests: [{ ...request(), id: 'restored', resumeFrom: `${f.input.state.id}:contract` }], choices: [
        { requestId: 'restored', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' },
      ],
    })).mockResolvedValueOnce(decision('respond', { response: 'Sua escolha está preservada e a operação já foi concluída.' }));
    result = await advanceStudioReasoningSession({ ...f.input, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(result.state))), message: 'Retome o primeiro pedido', messageId: 'resume', memory: { records, nextCursor: null } });
    expect(result.state.reasoning?.requests.find((request) => request.id === 'restored')?.values.plan).toBe('700');
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
    expect(result.state.reasoning?.pendingAction).toBeNull();
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });
  it('keeps revisions under the original durable request after resuming and correcting in a reloaded session', async () => {
    const f = fixture();
    f.input.memory.records = [{ sequence: '1', eventId: 'old', event: { version: 1, requestId: 'original-session:order', kind: 'choice', key: 'plan', label: 'Plano', value: '700', status: 'active', sensitive: false,
      source: { sessionId: 'original-session', releaseId: 'old-release', procedureId: 'contract', messageId: 'old-message', quote: 'Quero 700', at: '2026-01-01T00:00:00.000Z' } } }];
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Retomado.' }, { requests: [{ ...request(), resumeFrom: 'original-session:order' }], choices: [
      { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'old-message', quote: 'Quero 700' },
    ] }));
    const first = await advanceStudioReasoningSession(f.input);
    expect(first.state.reasoning?.requests[0].memoryRequestId).toBe('original-session:order');
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('respond', { response: 'Corrigido para 1000.' }, { requests: [{ ...request(), resumeFrom: null }], choices: [
      { requestId: 'contract', key: 'plan', label: 'Plano', value: '1000', status: 'active', sourceMessageId: 'm2', quote: 'Agora quero 1000' },
    ] }));
    const corrected = await advanceStudioReasoningSession({ ...f.input, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(first.state))), message: 'Agora quero 1000', messageId: 'm2' });
    expect(corrected.state.reasoning?.requests[0].values.plan).toBe('1000');
    expect(f.memory.every((event) => event.requestId === 'original-session:order')).toBe(true);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('rejects a durable request identifier absent from the scoped memory without partial writes', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Retomado' }, { requests: [{ ...request(), resumeFrom: 'another-chat:order' }] }))
      .mockResolvedValueOnce(decision('respond', { response: 'Preciso recuperar o pedido correto.' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.reasoning?.requests).toEqual([]); expect(f.memory).toEqual([]);
  });
  it('shows the model which input is missing without exposing configured static values', () => {
    const f = fixture(); const step = f.input.document.resolveStage.procedures[0].steps[3];
    step.httpRequest!.sentDataMappings = [
      { apiField: 'plan', sourceType: 'collected_field', sourceValue: 'plan', location: 'body', valueType: 'text' },
      { apiField: 'internal', sourceType: 'static_value', sourceValue: 'private-configured-value', location: 'body', valueType: 'text' },
    ];
    const capability = compileStudioReasoningCapabilities(f.input.document, 'contract', { values: {} }, new Set()).find((entry) => entry.stepId === 'activate')!;
    expect(capability.ready).toBe(false);
    expect(capability.inputs).toEqual([{ sourceType: 'collected_field', sourceKey: 'plan', ready: false }, { sourceType: 'static_value', sourceKey: null, ready: true }]);
    expect(JSON.stringify(capability)).not.toContain('private-configured-value');
  });
  it('refreshes the same read on a later turn while preserving customer choices and distinct execution reservations', async () => {
    const f = fixture();
    f.dependencies.execute.mockResolvedValueOnce({ values: { result: 'pending' } }).mockResolvedValueOnce({ values: { result: 'paid' } });
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()], choices: [
      { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' },
    ] })).mockResolvedValueOnce(decision('respond', { response: 'O pagamento ainda aparece pendente.' }));
    const first = await advanceStudioReasoningSession(f.input);
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Agora consta pago.' }));
    const next = await advanceStudioReasoningSession({ ...f.input, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(first.state))), messageId: 'm2', message: 'Já paguei, confira novamente' });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(2);
    expect(next.state.reasoning?.requests[0].integrationValues.result).toBe('paid');
    expect(next.state.reasoning?.requests[0].values.plan).toBe('700');
    expect(new Set(f.dependencies.execute.mock.calls.map((call) => call[2].id)).size).toBe(2);
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });

  it('does not retain outputs missing from a successful refresh of their source', async () => {
    const f = fixture();
    f.dependencies.execute.mockResolvedValueOnce({ values: { result: 'old' } }).mockResolvedValueOnce({ values: {} });
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }))
      .mockResolvedValueOnce(decision('respond', { response: 'A consulta atual não retornou esse dado.' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.reasoning?.requests[0].integrationValues.result).toBeUndefined();
    expect(result.state.reasoning?.operations).toHaveLength(2);
  });
  it('returns invalid provider structure to the reasoning loop without executing or transferring', async () => {
    const f = fixture();
    f.dependencies.decide.mockRejectedValueOnce(Object.assign(new Error('invalid provider structure'), { code: 'MODEL_SCHEMA_VALIDATION_FAILED' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Vamos continuar.' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.response).toBe('Vamos continuar.');
    expect(f.dependencies.decide.mock.calls[1][0].observations[0].error).toBe('invalid_decision');
    expect(f.dependencies.execute).not.toHaveBeenCalled(); expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });
  it('recovers a pre-journal choice from older chat messages and journals its actual source', async () => {
    const f = fixture();
    const recallHistory = vi.fn().mockResolvedValue({ sources: [{ messageId: 'old-choice', content: 'Fico com 700', fromMe: false }], nextCursor: null });
    f.dependencies.decide.mockResolvedValueOnce(decision('recall_history'))
      .mockImplementationOnce(async (context) => {
        const source = context.recentMessages.find((item: { messageId: string }) => item.messageId === 'old-choice');
        return decision('respond', { response: 'Vamos continuar com 700.' }, { requests: [request()], choices: [
          { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: source.messageId, quote: source.content },
        ] });
      });
    const result = await advanceStudioReasoningSession({ ...f.input, message: 'Vamos continuar', historyCursor: 'oldest-visible', dependencies: { ...f.dependencies, recallHistory } });
    expect(recallHistory).toHaveBeenCalledWith('oldest-visible');
    expect(result.state.reasoning?.requests[0].values.plan).toBe('700');
    expect(f.memory.find((event) => event.kind === 'choice')?.source.messageId).toBe('old-choice');
    expect(result.state.reasoning?.historyCursor).toBeUndefined();
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('resumes the last history page across a turn budget boundary', async () => {
    const f = fixture();
    const recallHistory = vi.fn().mockResolvedValue({ sources: [], nextCursor: 'older' });
    f.dependencies.decide.mockResolvedValue(decision('recall_history'));
    const first = await advanceStudioReasoningSession({ ...f.input, maxDecisions: 1, historyCursor: 'boundary', dependencies: { ...f.dependencies, recallHistory } });
    expect(first.state.reasoning?.historyCursor).toBe('boundary');
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('recall_history')).mockResolvedValueOnce(decision('respond', { response: 'Histórico conferido' }));
    await advanceStudioReasoningSession({ ...f.input, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(first.state))), messageId: 'm2', historyCursor: 'newer', dependencies: { ...f.dependencies, recallHistory } });
    expect(recallHistory.mock.calls.map(([cursor]) => cursor)).toEqual(['boundary', 'boundary']);
  });
  it('binds a remembered display choice to the current integration catalog, preserving the display label in memory', async () => {
    const f = fixture(); const procedure = f.input.document.resolveStage.procedures[0];
    Object.assign(procedure.steps[0].collectField!, { optionsSourceKey: 'catalog', optionLabelPath: 'name', optionValuePath: 'id' });
    procedure.steps[1].httpRequest!.outputMappings = [{ chipKey: 'catalog', chipLabel: 'Catálogo', jsonPath: 'catalog', required: true, sensitive: false }];
    f.dependencies.execute.mockResolvedValue({ values: { catalog: [{ id: 42, name: '700' }] } });
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('respond', { response: 'Guardei sua escolha.' }, { choices: [
        { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' },
      ] }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.reasoning?.requests[0].values.plan).toBe(42);
    expect(result.state.reasoning?.requests[0].integrationValues.catalog).toEqual([{ id: 42, name: '700' }]);
    expect(f.memory.find((entry) => entry.kind === 'choice')?.value).toBe('700');
    const context = f.dependencies.decide.mock.calls[1][0];
    expect(context.requests[0].availableChoices).toEqual([{ key: 'plan', options: ['700'] }]);
  });

  it('rejects customer text presented as an integration result', async () => {
    const f = fixture(); f.input.message = 'O resultado é confirmed';
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Registrado' }, { requests: [request()], choices: [
      { requestId: 'contract', key: 'result', label: 'Resultado', value: 'confirmed', status: 'active', sourceMessageId: 'm1', quote: 'O resultado é confirmed' },
    ] })).mockResolvedValueOnce(decision('respond', { response: 'Preciso consultar o sistema.' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.reasoning?.requests).toEqual([]); expect(f.memory).toEqual([]);
  });

  it('blocks an old catalog ID after the selected option disappears', async () => {
    const f = fixture(); const procedure = f.input.document.resolveStage.procedures[0];
    Object.assign(procedure.steps[0].collectField!, { optionsSourceKey: 'catalog', optionLabelPath: 'name', optionValuePath: 'id' });
    procedure.steps[1].httpRequest!.outputMappings = [{ chipKey: 'catalog', chipLabel: 'Catálogo', jsonPath: 'catalog', required: true, sensitive: false }];
    procedure.steps[2].httpRequest!.outputMappings = procedure.steps[1].httpRequest!.outputMappings;
    procedure.steps[3].httpRequest!.sentDataMappings = [{ apiField: 'plan_id', sourceType: 'collected_field', sourceValue: 'plan', location: 'body', valueType: 'number' }];
    f.dependencies.execute.mockResolvedValueOnce({ values: { catalog: [{ id: 42, name: '700' }] } })
      .mockResolvedValueOnce({ values: { catalog: [{ id: 77, name: '1000' }] } });
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:alternative' }, { choices: [
        { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' },
      ] })).mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate' }))
      .mockResolvedValueOnce(decision('respond', { response: 'A opção escolhida não aparece mais no catálogo.' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(f.dependencies.execute).toHaveBeenCalledTimes(2);
    expect(result.state.reasoning?.pendingAction).toBeNull();
    expect(result.state.reasoning?.requests[0].choiceLabels.plan).toBe('700');
    expect(f.dependencies.decide.mock.calls[2][0].requests[0].values.plan).toBeUndefined();
  });

  it('preserves several intentions and a choice in one turn, then reloads the state', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValue(decision('respond', { response: 'Guardei o plano de 700. Vamos verificar sua conexão.' }, {
      requests: [request(), { id: 'support', procedureId: null, objective: 'Resolver conexão', status: 'active' }],
      choices: [{ requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'm1', quote: 'Quero 700' }],
    }));
    const result = await advanceStudioReasoningSession(f.input);
    const reloaded = StudioSessionSchema.parse(JSON.parse(JSON.stringify(result.state)));
    expect(reloaded.reasoning?.requests).toHaveLength(2);
    expect(reloaded.reasoning?.requests[0].values.plan).toBe('700');
    expect(f.memory.some((e) => e.kind === 'choice' && e.value === '700')).toBe(true);
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });

  it('lets the model choose another tool after a failed lookup without transferring', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:alternative' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Consegui verificar pela consulta alternativa.' }));
    f.dependencies.execute.mockRejectedValueOnce(new Error('network failed')).mockResolvedValueOnce({ values: { result: 'confirmed' } });
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.response).toContain('alternativa'); expect(f.dependencies.execute).toHaveBeenCalledTimes(2);
    expect(result.state.reasoning?.operations.map((op) => op.status)).toEqual(['failed', 'succeeded']);
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });

  it('does not expose a legacy sequence tool as freely callable', async () => {
    const f = fixture(); delete f.input.document.resolveStage.procedures[0].steps[1].adaptiveAccess;
    f.dependencies.decide.mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()] }))
      .mockResolvedValueOnce(decision('respond', { response: 'Esta consulta precisa ser configurada.' }));
    await advanceStudioReasoningSession(f.input);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('requires a new confirmation and never repeats a successful mutation', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValue(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', response: 'Confirma a ativação solicitada?' }, { requests: [request()] }));
    const proposal = await advanceStudioReasoningSession(f.input);
    expect(proposal.response).toContain('Confirma'); expect(f.dependencies.execute).not.toHaveBeenCalled();
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', consent: 'approve', consentQuote: 'Sim, pode ativar' }))
      .mockResolvedValueOnce(decision('respond', { response: 'Ativação confirmada.' }, { requests: [request('resolved')] }));
    const result = await advanceStudioReasoningSession({ ...f.input, state: proposal.state, messageId: 'm2', message: 'Sim, pode ativar' });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1); expect(result.state.status).toBe('resolved');
    const replay = await advanceStudioReasoningSession({ ...f.input, state: result.state, messageId: 'm2', message: 'Sim, pode ativar' });
    expect(replay.replay).toBe(true); expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
    expect(f.memory.some((e) => e.kind === 'request' && e.status === 'resolved')).toBe(true);
  });

  it('invalidates consent if choices change after the proposal', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValue(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', response: 'Confirma a ativação solicitada?' }, { requests: [request()] }));
    const proposal = await advanceStudioReasoningSession(f.input);
    f.dependencies.decide.mockResolvedValue(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', consent: 'approve', consentQuote: 'Sim', response: 'Confirma a ativação do plano 1000?' }, {
      choices: [{ requestId: 'contract', key: 'plan', label: 'Plano', value: '1000', status: 'active', sourceMessageId: 'm2', quote: 'troque para 1000' }],
    }));
    const result = await advanceStudioReasoningSession({ ...f.input, state: proposal.state, messageId: 'm2', message: 'Sim, mas troque para 1000' });
    expect(result.response).toContain('Confirma'); expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('keeps an unknown mutation pending and does not retry it', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValue(decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', response: 'Confirma a ativação solicitada?' }, { requests: [request()] }));
    const proposal = await advanceStudioReasoningSession(f.input);
    f.dependencies.execute.mockRejectedValue(new Error('response lost'));
    const activate = decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', consent: 'approve', consentQuote: 'Sim' });
    f.dependencies.decide.mockReset().mockResolvedValueOnce(activate).mockResolvedValueOnce(activate)
      .mockResolvedValueOnce(decision('respond', { response: 'Ainda preciso confirmar o resultado.' }));
    const result = await advanceStudioReasoningSession({ ...f.input, state: proposal.state, messageId: 'm2', message: 'Sim' });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1); expect(result.state.inFlight).not.toBeNull();
    expect(result.state.status).toBe('waiting_input'); expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });

  it('does not repeat a mutation just because its result added fields to the request', async () => {
    const f = fixture();
    const activate = decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', response: 'Confirma a ativação solicitada?' }, { requests: [request()] });
    f.dependencies.decide.mockResolvedValue(activate);
    const proposal = await advanceStudioReasoningSession(f.input);
    const approved = decision('tool', { requestId: 'contract', capabilityId: 'contract:activate', consent: 'approve', consentQuote: 'Sim' });
    f.dependencies.decide.mockReset().mockResolvedValueOnce(approved).mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(decision('respond', { response: 'Operação já confirmada.' }));
    const result = await advanceStudioReasoningSession({ ...f.input, state: proposal.state, messageId: 'm2', message: 'Sim' });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
    expect(result.response).toBe('Operação já confirmada.');
  });

  it('allows a requested human handoff while preserving an uncertain business operation for review', async () => {
    const f = fixture();
    f.input.state.inFlight = { key: 'uncertain-activation', stepId: 'activate' };
    f.dependencies.decide.mockResolvedValue(decision('handoff', { reason: 'Cliente pediu uma pessoa para conferir a ativação.' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.status).toBe('transferred');
    expect(result.state.inFlight?.key).toBe('uncertain-activation');
    expect(f.dependencies.handoff).toHaveBeenCalledTimes(1);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('retrieves an old choice by memory pagination and uses its exact source', async () => {
    const f = fixture(); f.input.memory.nextCursor = '41';
    f.dependencies.recall.mockResolvedValue({ records: [{ sequence: '1', eventId: 'old-choice', event: {
      version: 1, requestId: 'older-session:contract', kind: 'choice', key: 'plan', label: 'Plano', value: '700', status: 'active', sensitive: false,
      source: { sessionId: 'older-session', releaseId: 'older-release', procedureId: 'contract', messageId: 'old-message', quote: 'Fico com 700', at: '2026-01-01T00:00:00.000Z' },
    } }], nextCursor: null });
    f.dependencies.decide.mockResolvedValueOnce(decision('recall'))
      .mockResolvedValueOnce(decision('respond', { response: 'Vamos continuar com 700.' }, { requests: [{ ...request(), resumeFrom: 'older-session:contract' }], choices: [
        { requestId: 'contract', key: 'plan', label: 'Plano', value: '700', status: 'active', sourceMessageId: 'old-message', quote: 'Fico com 700' },
      ] }));
    const result = await advanceStudioReasoningSession({ ...f.input, message: 'Vamos continuar aquela contratação' });
    expect(f.dependencies.recall).toHaveBeenCalledWith('41'); expect(result.state.reasoning?.requests[0].values.plan).toBe('700');
    expect(f.dependencies.decide.mock.calls[1][0].choices[0].sourceQuote).toBe('Fico com 700');
    expect(f.dependencies.execute).not.toHaveBeenCalled(); expect(result.state.reasoning?.pendingAction).toBeNull();
  });

  it('resumes memory pagination after a budget boundary without losing the last loaded page', async () => {
    const f = fixture(); f.input.memory.nextCursor = '101';
    f.dependencies.recall.mockResolvedValueOnce({ records: [], nextCursor: '61' })
      .mockResolvedValueOnce({ records: [], nextCursor: '21' });
    f.dependencies.decide.mockResolvedValue(decision('recall'));
    const partial = await advanceStudioReasoningSession({ ...f.input, maxDecisions: 2 });
    expect(partial.state.reasoning?.recallCursor).toBe('61');
    f.dependencies.recall.mockResolvedValue({ records: [], nextCursor: '21' });
    f.dependencies.decide.mockReset().mockResolvedValueOnce(decision('recall'))
      .mockResolvedValueOnce(decision('respond', { response: 'Conferi o histórico restante.' }));
    const result = await advanceStudioReasoningSession({ ...f.input, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(partial.state))),
      message: 'Pode continuar a busca', messageId: 'm2', maxDecisions: 2 });
    expect(f.dependencies.recall.mock.calls.map(([cursor]) => cursor)).toEqual(['101', '61', '61']);
    expect(result.state.reasoning?.recallCursor).toBeUndefined();
  });

  it('rejects invented and assistant-authored choices without partially modifying requests', async () => {
    const f = fixture(); f.input.sources = [{ messageId: 'assistant', content: 'Fico com 1000', fromMe: true }];
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', { response: 'Escolha registrada' }, { requests: [request()], choices: [
      { requestId: 'contract', key: 'plan', label: 'Plano', value: '1000', status: 'active', sourceMessageId: 'assistant', quote: 'Fico com 1000' },
    ] })).mockResolvedValueOnce(decision('respond', { response: 'Qual opção você prefere?' }));
    const result = await advanceStudioReasoningSession(f.input);
    expect(result.state.reasoning?.requests).toEqual([]); expect(f.memory).toEqual([]);
  });

  it('does not dispatch if the durable reservation fails', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValue(decision('tool', { requestId: 'contract', capabilityId: 'contract:lookup' }, { requests: [request()] }));
    f.dependencies.checkpoint.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('checkpoint failed'));
    await expect(advanceStudioReasoningSession(f.input)).rejects.toThrow('checkpoint failed');
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it('honors a model-interpreted human request without requiring failed tools', async () => {
    const f = fixture(); f.dependencies.decide.mockResolvedValue(decision('handoff', { reason: 'O cliente pediu uma pessoa.' }));
    const result = await advanceStudioReasoningSession({ ...f.input, message: 'Quero falar com uma pessoa' });
    expect(result.state.status).toBe('transferred'); expect(result.response).toBe('Transferência confirmada');
    expect(f.dependencies.execute).not.toHaveBeenCalled(); expect(f.dependencies.handoff).toHaveBeenCalledTimes(1);
  });

  it('concludes session with phase=done and status=resolved when model marks all requests as cancelled or resolved', async () => {
    const f = fixture();
    f.dependencies.decide.mockResolvedValueOnce(decision('respond', {
      response: 'Encerrando o atendimento com carinho. Até logo!',
    }, {
      requests: [{ ...request('cancelled'), id: 'contract' }],
    }));
    const result = await advanceStudioReasoningSession({
      ...f.input,
      message: 'Encerrar',
    });
    expect(result.state.phase).toBe('done');
    expect(result.state.status).toBe('resolved');
    expect(result.state.reasoning?.requests[0].status).toBe('cancelled');
    expect(result.response).toContain('Encerrando o atendimento com carinho.');
  });
});
