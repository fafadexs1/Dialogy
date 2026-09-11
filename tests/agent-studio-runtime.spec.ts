import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotConfig, Contact } from '@/lib/types';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema, HttpRequestStepConfigSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import type { StudioSession } from '@/services/agent-studio/engine';
const mocks = vi.hoisted(() => ({ query: vi.fn(), model: vi.fn(), rag: vi.fn(), http: vi.fn(), mcp: vi.fn(), resolveMcp: vi.fn(), contactAction: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/ai/flows/procedure-runtime', () => ({ generateProcedureRuntimeOutput: mocks.model }));
vi.mock('@/services/rag/hybrid-retrieval', () => ({ retrieveHybridSupportContext: mocks.rag }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: mocks.http, executeStudioMcp: mocks.mcp, resolveStudioMcpTool: mocks.resolveMcp }));
vi.mock('@/services/agent-studio/native-actions', () => ({ executeStudioContactAction: mocks.contactAction }));
import { runStudioConversation, type StudioRuntimeInput } from '@/services/agent-studio/runtime';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace'); document.concludeStage.handoffTeam = 'Support';
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'invoice', name: 'Fatura', whenToUse: 'Segunda via', whenNotToUse: 'Contestação', updatedAt: '2026-08-27', steps: [
    { id: 'collect', order: 1, title: 'CPF', type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({ id: 'cpf', name: 'CPF', variableKey: 'cpf', type: 'cpf', promptMessage: 'Qual seu CPF?' }) },
    { id: 'api', order: 2, title: 'Consultar fatura', type: 'http_request', httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consultar', connectionId: 'connection', url: '/invoices', outputMappings: [{ chipKey: 'invoice', chipLabel: 'Fatura', jsonPath: 'invoice' }] }) },
    { id: 'reply', order: 3, title: 'Responder', type: 'respond', messageDataKeys: ['invoice'] },
  ] })];
  const release: AgentReleaseManifest = { agentId: document.id, workspaceId: document.workspaceId, releaseId: 'release', version: 1, agentSnapshot: document,
    publishedProcedures: document.resolveStage.procedures, referencedConnectionIds: ['connection'], connectionFingerprints: { connection: 'pinned-identity' },
    mcpServerToolFingerprints: {}, runtimeVersion: 'studio-v1', runtimeConfig: { aiModel: 'published-model' }, createdAt: '2026-08-27' };
  const config = { id: 'agent', workspace_id: 'workspace', ai_model: 'changed-model', knowledge_base_documents: [{ name: 'Current', content: 'New unpublished content' }] } as AutopilotConfig;
  let state: StudioSession | null = null, messageCounter = 0;
  const native = vi.fn(async () => {}), assertCurrent = vi.fn(async () => {}), checkpoint = vi.fn(async (next: StudioSession) => { state = next; });
  const send = (message: string, signal?: AbortSignal, messageId = String(++messageCounter), overrides: Partial<StudioRuntimeInput> = {}) => runStudioConversation({ release, config, state, chatId: 'chat', contact: { id: 'contact', name: 'Cliente' } as Contact,
    messageId, message, signal, checkpoint, runNative: native, assertCurrent, ...overrides });
  return { release, config, send, native, assertCurrent, checkpoint, get state() { return state; } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.rag.mockImplementation(async ({ staticDocuments }) => ({ knowledgeBaseDocuments: staticDocuments }));
  mocks.model.mockResolvedValue({ decision: 'invoice' });
  mocks.http.mockResolvedValue({ values: { invoice: 'Fatura confirmada' } });
});

describe('production Studio orchestration with controlled model and integration adapters', () => {
  it.each([false, true])('plans a ready lookup before another question with the same published model in preview=%s', async (preview) => {
    const f = fixture(); f.release.agentSnapshot.resolveStage.conversationMode = 'adaptive';
    f.release.agentSnapshot.resolveStage.procedures[0].steps = [
      ...['postal', 'address'].map((key, i) => ({ id: key, order: i + 1, title: key, type: 'collect_data' as const,
        collectField: CollectedFieldDefinitionSchema.parse({ id: key, variableKey: key, name: key, type: 'text', promptMessage: `Informe ${key}` }) })),
      { id: 'api', order: 3, title: 'Consultar código postal', type: 'http_request', httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Localizar', connectionId: 'connection', method: 'GET', url: '/location',
        sentDataMappings: [{ apiField: 'address', sourceType: 'collected_field', sourceValue: 'address' }], outputMappings: [{ chipKey: 'postal', chipLabel: 'Código', jsonPath: 'postal' }] }) },
      { id: 'reply', order: 4, title: 'Resultado', type: 'respond', messageText: 'Resultado:', messageDataKeys: ['postal'] },
    ];
    mocks.model.mockImplementation(async (request) => {
      if (request.mode === 'collection_plan') return { collectionPlan: { intent: 'contribute', observations: [
        { fieldKey: 'postal', status: 'unavailable', value: null, evidence: 'Não sei o CEP' },
        { fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' },
      ], deferFields: [], nextFieldKey: null } };
      if (request.procedure.prompt.startsWith('Escolha o próximo trabalho')) return { decision: 'step:api' };
      if (request.procedure.prompt.startsWith('Interprete o sentido')) return { decision: 'turn_answer' };
      return { decision: 'invoice' };
    });
    mocks.http.mockResolvedValue({ values: { postal: '72800000' } });
    const result = await f.send('Não sei o CEP, moro na Rua Azul', undefined, 'lookup', preview ? { preview: { samples: { api: '{"postal":"72800000"}' } } } : {});
    expect(result.response).toContain('Resultado:\n72800000'); expect(result.state.adaptiveCompletedSteps?.['invoice:api']).toBe(true);
    expect(mocks.http).toHaveBeenCalledTimes(preview ? 0 : 1); expect(f.native).not.toHaveBeenCalled();
    expect(mocks.model).toHaveBeenCalledWith(expect.objectContaining({ model: 'published-model', fixedModel: true,
      procedure: expect.objectContaining({ prompt: expect.stringContaining('Escolha o próximo trabalho') }) }));
  });
  it.each([false, true])('applies the same multi-field goal plan in preview=%s', async (preview) => {
    const f = fixture();
    f.release.agentSnapshot.resolveStage.conversationMode = 'adaptive';
    f.release.agentSnapshot.resolveStage.procedures[0].steps = ['name', 'postal', 'address'].map((key, index) => ({
      id: key, order: index + 1, title: key, type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({
        id: key, name: key, variableKey: key, type: 'text', promptMessage: `Informe ${key}` }),
    }));
    const mode = preview ? { preview: { samples: {} } } : {};
    mocks.model.mockImplementation(async (request) => {
      if (request.mode === 'collection_plan') return { collectionPlan: {
        intent: 'contribute', deferFields: [], nextFieldKey: request.customerMessage.includes('Sou Ana') ? null : 'address',
        observations: request.customerMessage.includes('Sou Ana') ? [
          { fieldKey: 'name', status: 'provided', value: 'Ana', evidence: 'Sou Ana' },
          { fieldKey: 'postal', status: 'unavailable', value: null, evidence: 'não sei o CEP' },
          { fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'moro na Rua Azul' },
        ] : [],
      } };
      if (request.procedure.prompt.startsWith('Interprete o sentido')) return { decision: 'turn_answer' };
      return { decision: 'invoice' };
    });
    expect((await f.send('Preciso de atendimento', undefined, 'start', mode)).state.pendingField).toBe('address');
    const result = await f.send('Sou Ana, não sei o CEP, moro na Rua Azul', undefined, 'facts', mode);
    expect(result.state.values).toMatchObject({ name: 'Ana', address: 'Rua Azul' });
    expect(result.state.values.postal).toBeUndefined();
    expect(result.state.unavailableFields?.['invoice:postal']).toBeDefined();
    expect(result.state.phase).toBe('conclude');
    expect(mocks.model).toHaveBeenCalledWith(expect.objectContaining({ mode: 'collection_plan', model: 'published-model', fixedModel: true }));
    expect(mocks.http).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
  });
  it.each([false, true])('shares adaptive interpretation and verified handoff in preview=%s', async (preview) => {
    const f = fixture();
    f.release.agentSnapshot.resolveStage.conversationMode = 'adaptive';
    f.release.agentSnapshot.resolveStage.procedures[0].steps = [
      { id: 'phone', order: 1, title: 'Telefone', type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({
        id: 'phone', name: 'Telefone', variableKey: 'phone', type: 'phone', promptMessage: 'Qual telefone?', requiresConfirmation: true }) },
      { id: 'postal', order: 2, title: 'Endereço', type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({
        id: 'postal', name: 'Código postal', variableKey: 'postal', type: 'cep', promptMessage: 'Qual código postal?' }) },
    ];
    const mode: Partial<StudioRuntimeInput> = { contact: { id: 'contact', name: 'Cliente', phone_number_jid: '5561999999999@s.whatsapp.net' } as Contact,
      ...(preview ? { preview: { samples: {} } } : {}) };
    mocks.model.mockImplementation(async (request) => {
      if (request.procedure.prompt.startsWith('Escolha a próxima informação pendente')) return { decision: request.procedure.branchOptions[0].condition };
      if (request.mode === 'collection_plan') {
        const planning = JSON.parse(request.procedure.prompt.split('\n').at(-1));
        return { collectionPlan: { intent: 'contribute', observations: [], deferFields: [],
          nextFieldKey: planning.fields.find((field: { known: boolean; unavailable: boolean }) => !field.known && !field.unavailable)?.key || null } };
      }
      if (!request.procedure.prompt.startsWith('Interprete o sentido')) return { decision: 'invoice' };
      const kind = ({ 'Este mesmo': 'contact_reference', positivo: 'confirm', 'Não sei informar': 'unable', encaminha: 'handoff' } as Record<string, string>)[request.customerMessage] || 'answer';
      return { decision: request.procedure.branchOptions.find((branch: { condition: string }) =>
        branch.condition === `turn_${kind}` || branch.condition.startsWith(`turn_${kind}_`))?.condition };
    });
    await f.send('Preciso de atendimento', undefined, 'start', mode);
    expect((await f.send('Este mesmo', undefined, 'reference', mode)).state.confirmation).not.toBeNull();
    expect((await f.send('positivo', undefined, 'confirm', mode)).state.pendingField).toBe('postal');
    const missing = await f.send('Não sei informar', undefined, 'unknown', mode);
    expect(missing.state.procedureId).toBe('invoice'); expect(missing.state.attempts).toEqual({});
    const transferred = await f.send('encaminha', undefined, 'handoff', mode);
    expect(transferred.state.status).toBe('transferred'); expect(transferred.state.pendingField).toBeNull();
    expect(f.native).toHaveBeenCalledTimes(preview ? 0 : 1);
    if (!preview) expect(f.native).toHaveBeenCalledWith(expect.objectContaining({ type: 'transfer_chat' }), expect.objectContaining({ confirmed: false }));
    expect(mocks.model.mock.calls.every(([request]) => request.model === 'published-model' && request.fixedModel)).toBe(true);
    expect(mocks.http).not.toHaveBeenCalled();
  });
  it.each([false, true])('uses the published model for sector-neutral interpretation in preview=%s', async (preview) => {
    const f = fixture();
    const field = f.release.agentSnapshot.resolveStage.procedures[0].steps[0];
    field.collectField = CollectedFieldDefinitionSchema.parse({ id: 'service', name: 'Serviço', variableKey: 'service',
      type: 'single_select', promptMessage: 'Qual serviço?', options: ['Essencial', 'Completo + acompanhamento'] });
    f.release.agentSnapshot.resolveStage.procedures[0].steps[1].httpRequest!.method = 'POST';
    const mode = preview ? { preview: { samples: { api: '{"invoice":"Confirmado"}' } } } : {};
    await f.send('Preciso do serviço', undefined, 'begin', mode);
    mocks.model.mockResolvedValue({ decision: 'option_1' });
    const calls = mocks.model.mock.calls.length;
    const proposed = await f.send('aquele com acompanhamento', undefined, 'proposal', mode);
    expect(proposed.state.values.service).toBeUndefined();
    expect(proposed.response).toContain('Você quer dizer Completo + acompanhamento?');
    expect(mocks.model).toHaveBeenCalledTimes(calls + 1);
    expect(mocks.model).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'published-model', fixedModel: true,
      procedure: expect.objectContaining({ prompt: expect.stringContaining('Qual serviço?'),
        branchOptions: expect.arrayContaining([{ condition: 'option_1', nextStepId: 'option_1' }]) }) }));
    expect(mocks.http).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
    const confirmed = await f.send('sim', undefined, 'confirm-choice', mode);
    expect(confirmed.state.values.service).toBe('Completo + acompanhamento');
    // Confirming an interpretation is not permission to execute a business action.
    expect(confirmed.response).toContain('Posso executar');
    expect(mocks.http).not.toHaveBeenCalled(); expect(mocks.model).toHaveBeenCalledTimes(calls + 1);
    await f.send('sim', undefined, 'confirm-action', mode);
    expect(mocks.http).toHaveBeenCalledTimes(preview ? 0 : 1);
  });
  it.each([false, true])('recovers from invalid interpretation equally in preview=%s', async (preview) => {
    const f = fixture();
    f.release.agentSnapshot.resolveStage.procedures[0].steps[0].collectField = CollectedFieldDefinitionSchema.parse({
      id: 'service', name: 'Serviço', variableKey: 'service', type: 'single_select', promptMessage: 'Qual serviço?', options: ['Essencial', 'Completo'],
    });
    const mode = preview ? { preview: { samples: {} } } : {};
    await f.send('Preciso do serviço', undefined, 'begin', mode);
    mocks.model.mockResolvedValue({ decision: 'Inventado' });
    const result = await f.send('o que você falou', undefined, 'uncertain', mode);
    expect(result.state.values.service).toBeUndefined(); expect(result.state.attempts).toEqual({});
    expect(result.state.events.at(-1)?.kind).toBe('collection_interpreter_unavailable');
    expect(result.response).toContain('com segurança'); expect(mocks.http).not.toHaveBeenCalled();
  });
  it.each([false, true])('answers a pending-field doubt and accepts a short plan in preview=%s', async (preview) => {
    const f = fixture();
    const document = f.release.agentSnapshot;
    document.resolveStage.allowGeneralAiChat = false;
    document.resolveStage.procedures[0].steps = ProcedureDocumentSchema.parse({ id: 'invoice', name: 'Contratar', updatedAt: '2026-09-05', steps: [
      { id: 'plan', title: 'Plano', type: 'collect_data', order: 1, collectField: CollectedFieldDefinitionSchema.parse({
        id: 'plan', name: 'Plano desejado', variableKey: 'plan', type: 'single_select', promptMessage: 'Qual plano?',
        options: ['500 MEGA — R$ 99,90', '600 MEGA + TV — R$ 109,90'],
      }) },
      { id: 'phone', title: 'Telefone', type: 'collect_data', order: 2, collectField: CollectedFieldDefinitionSchema.parse({
        id: 'phone', name: 'Telefone', variableKey: 'phone', type: 'phone', promptMessage: 'Qual telefone com DDD?',
      }) },
    ] }).steps;
    const mode = preview ? { preview: { samples: {} } } : {};
    await f.send('Quero contratar', undefined, 'begin', mode);
    mocks.model.mockResolvedValue({ response: 'O plano de 600 MEGA inclui TV.' });
    const answer = await f.send('Qual inclui TV?', undefined, 'doubt', mode);
    expect(answer.response).toBe('O plano de 600 MEGA inclui TV.');
    expect(answer.state.pendingField).toBe('plan');
    expect(answer.state.attempts).toEqual({});
    expect(mocks.model).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'response', model: 'published-model', fixedModel: true,
      procedure: expect.objectContaining({ prompt: expect.stringContaining('600 MEGA + TV — R$ 109,90') }) }));
    const callsBeforeSelection = mocks.model.mock.calls.length;
    const chosen = await f.send('500', undefined, 'selection', mode);
    expect(chosen.state.values.plan).toBe('500 MEGA — R$ 99,90');
    expect(chosen.response).toBe('Qual telefone com DDD?');
    expect(mocks.model).toHaveBeenCalledTimes(callsBeforeSelection);
    expect(mocks.http).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
  });
  it.each([undefined, ''])('normalizes the direct WhatsApp JID fallback when phone is %j', async (phone) => {
    const f = fixture();
    await f.send('Quero fatura 529.982.247-25', undefined, 'whatsapp-phone', {
      contact: { id: 'contact', name: 'Cliente', phone, phone_number_jid: '5511999999999@s.whatsapp.net' } as Contact,
    });
    expect(mocks.http).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ contact: expect.objectContaining({ phone: '5511999999999' }) }),
    }));
  });
  it('answers in the preview using the real model adapter, selected sources and conversation history', async () => {
    const f = fixture(); f.release.agentSnapshot.resolveStage.procedures = [];
    f.release.agentSnapshot.resolveStage.knowledgeCollectionIds = ['manual-document'];
    f.release.knowledgeSnapshot = [{ id: 'manual-document', name: 'Manual', content: 'Informação autorizada', collectionIds: ['manual'] }];
    mocks.model.mockImplementation(async (request) => request.mode === 'decision' ? { decision: 'none' } : { response: 'Resposta contextual da IA' });
    const result = await f.send('E como funciona?', undefined, 'preview-1', { preview: { samples: {} }, chatHistory: 'Cliente: Quero saber sobre suporte' });
    expect(result.response).toContain('Resposta contextual da IA');
    expect(mocks.model).toHaveBeenCalledWith(expect.objectContaining({ mode: 'response', model: 'published-model', fixedModel: true,
      chatHistory: 'Cliente: Quero saber sobre suporte', procedure: expect.objectContaining({ prompt: expect.stringContaining('Informação autorizada') }) }));
    expect(mocks.rag).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace', autopilotConfigId: 'agent', query: 'E como funciona?', allowedDocumentIds: ['manual-document'],
    }));
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
  });
  it('maps fictitious integration results without executing HTTP, MCP or contact actions', async () => {
    const f = fixture();
    const result = await f.send('Quero fatura 529.982.247-25', undefined, 'preview-2', { preview: { samples: { api: '{"invoice":"Fatura fictícia"}' } } });
    expect(result.response).toContain('Fatura fictícia'); expect(mocks.model).toHaveBeenCalled();
    expect(mocks.http).not.toHaveBeenCalled(); expect(mocks.mcp).not.toHaveBeenCalled(); expect(mocks.contactAction).not.toHaveBeenCalled(); expect(f.assertCurrent).not.toHaveBeenCalled();
  });
  it('simulates handoffs without transferring a customer', async () => {
    const f = fixture();
    const result = await f.send('quero falar com humano', undefined, 'preview-3', { preview: { samples: {} } });
    expect(result.state.status).toBe('transferred'); expect(f.native).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('uses the same interruption governor in Studio preview without calling tools or transferring', async () => {
    const f = fixture();
    const sandbox = { preview: { samples: {} } };
    expect((await f.send('Quero minha fatura', undefined, 'preview-governor-start', sandbox)).response).toContain('Qual seu CPF?');
    const cancelled = await f.send('não precisa', undefined, 'preview-governor-cancel', sandbox);
    expect(cancelled.response).toContain('parei este procedimento');
    expect(cancelled.state.procedureId).toBeNull();
    expect(cancelled.state.status).toBe('waiting_input');
    expect(mocks.http).not.toHaveBeenCalled();
    expect(f.native).not.toHaveBeenCalled();
  });
  it('does not mutate contact data or close real chats when testing native steps', async () => {
    const f = fixture();
    f.release.agentSnapshot.resolveStage.procedures[0].steps = ProcedureDocumentSchema.parse({ id: 'invoice', name: 'Fatura', updatedAt: '2026-08-27', steps: [
      { id: 'tag', order: 1, title: 'Etiquetar', type: 'native_action', nativeActionType: 'add_tag' },
      { id: 'close', order: 2, title: 'Encerrar', type: 'native_action', nativeActionType: 'close_chat' },
    ] }).steps;
    const sandbox = { preview: { samples: {} } };
    expect((await f.send('Fatura', undefined, 'preview-native', sandbox)).state.status).toBe('waiting_input');
    expect((await f.send('sim', undefined, 'preview-tag', sandbox)).state.status).toBe('waiting_input');
    const result = await f.send('sim', undefined, 'preview-close', sandbox);
    expect(result.state.status).toBe('resolved'); expect(mocks.contactAction).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
  });
  it('reports an unavailable model instead of presenting a canned reply as an AI answer', async () => {
    const f = fixture(); mocks.model.mockResolvedValue({});
    await expect(f.send('Preciso de ajuda', undefined, 'preview-4', { preview: { samples: {} } })).rejects.toThrow('A IA não retornou uma resposta válida');
    expect(f.native).not.toHaveBeenCalled();
  });
  it('uses the published model, waits, resumes and passes the pinned connection identity before responding', async () => {
    const f = fixture(); expect((await f.send('Quero fatura')).response).toContain('Qual seu CPF?'); expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.model.mock.calls[0][0].config.ai_model).toBe('published-model');
    expect(mocks.model.mock.calls[0][0]).toMatchObject({ model: 'published-model', fixedModel: true });
    expect(mocks.model.mock.calls[0][0].procedure.prompt).toContain('Contestação');
    const second = await f.send('529.982.247-25'); expect(second.response).toContain('Fatura confirmada');
    expect(mocks.http.mock.calls[0][0]).toMatchObject({ workspaceId: 'workspace', expectedConnectionFingerprint: 'pinned-identity', context: { values: { cpf: '52998224725' } } });
    expect(f.assertCurrent).toHaveBeenCalledOnce(); expect((await f.send('sim')).state.status).toBe('resolved');
    expect((await f.send('Quero fatura', undefined, '1')).replay).toBe(true); expect(mocks.http).toHaveBeenCalledOnce();
  });
  it('does not run a connection omitted from the immutable capability list', async () => {
    const f = fixture(); f.release.referencedConnectionIds = [];
    expect((await f.send('Quero fatura 529.982.247-25')).state.status).toBe('transferred');
    expect(mocks.http).not.toHaveBeenCalled(); expect(f.native).toHaveBeenCalledWith(expect.objectContaining({ type: 'transfer_chat' }), expect.anything());
  });
  it('uses only published knowledge revisions and ignores current mutable documents', async () => {
    const f = fixture(); f.release.agentSnapshot.resolveStage.procedures = []; f.release.agentSnapshot.resolveStage.knowledgeCollectionIds = ['manual'];
    f.release.knowledgeSnapshot = [{ name: 'Original', content: 'Conteúdo publicado exato', collectionIds: ['manual'] }];
    mocks.model.mockImplementation(async (request) => request.mode === 'decision' ? { decision: 'none' } : { response: 'Resposta das fontes' });
    expect((await f.send('Qual a política?')).response).toContain('Resposta das fontes');
    const call = mocks.model.mock.calls.find(([request]) => request.mode === 'response')![0];
    expect(call).toMatchObject({ model: 'published-model', fixedModel: true });
    expect(call.procedure.prompt).toContain('Conteúdo publicado exato'); expect(call.procedure.prompt).not.toContain('New unpublished content');
  });
  it('honors cancellation before loading context or invoking model and tools', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(f.send('fatura', controller.signal)).rejects.toThrow('cancelled');
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled();
  });
});
