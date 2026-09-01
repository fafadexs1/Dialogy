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
  it.each([undefined, ''])('preserves the existing WhatsApp JID fallback when phone is %j', async (phone) => {
    const f = fixture();
    await f.send('Quero fatura 529.982.247-25', undefined, 'whatsapp-phone', {
      contact: { id: 'contact', name: 'Cliente', phone, phone_number_jid: '5511999999999@s.whatsapp.net' } as Contact,
    });
    expect(mocks.http).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ contact: expect.objectContaining({ phone: '5511999999999@s.whatsapp.net' }) }),
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
