import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotConfig, Contact } from '@/lib/types';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, HttpRequestStepConfigSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import type { StudioSession } from '@/services/agent-studio/engine';
import type { StudioMemoryEvent } from '@/services/agent-studio/durable-memory';
const mocks = vi.hoisted(() => ({ platform: vi.fn(), query: vi.fn(), legacy: vi.fn(), model: vi.fn(), credentials: vi.fn(), usage: vi.fn(),
  memory: vi.fn(), http: vi.fn(), mcp: vi.fn(), resolveMcp: vi.fn(), rag: vi.fn(), toolMemoryRead: vi.fn(), toolMemoryContent: vi.fn(), toolMemoryWrite: vi.fn(), toolMemoryReset: vi.fn() }));
vi.mock('@/services/ai/platform-config',()=>({platformModel:mocks.platform,platformApiKey:async()=>'platform-key'}));
vi.mock('@/services/ai/platform-json',()=>({requestPlatformJson:mocks.model}));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/actions/autopilot', () => ({ logAutopilotUsage: mocks.usage }));
vi.mock('@/ai/flows/procedure-runtime', () => ({ generateProcedureRuntimeOutput: mocks.legacy }));
vi.mock('@/services/ai/openai-compatible', () => ({ requestOpenAiCompatibleJson: mocks.model, isOpenAiCompatibleModel: (model: string) => /^(openai|deepseek)\//.test(model) }));
vi.mock('@/services/ai/workspace-ai-credentials', () => ({ loadWorkspaceAiCredentialRecords: mocks.credentials }));
vi.mock('@/services/agent-studio/durable-memory-store', () => ({ readStudioDurableMemory: mocks.memory }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: mocks.http, executeStudioMcp: mocks.mcp, resolveStudioMcpTool: mocks.resolveMcp }));
vi.mock('@/services/agent-studio/tool-memory-store', () => ({ readStudioToolMemory: mocks.toolMemoryRead, readStudioToolMemoryContent: mocks.toolMemoryContent, writeStudioToolMemory: mocks.toolMemoryWrite, readStudioToolMemoryReset: mocks.toolMemoryReset }));
vi.mock('@/services/agent-studio/native-actions', () => ({ executeStudioContactAction: vi.fn() }));
vi.mock('@/services/rag/hybrid-retrieval', () => ({ retrieveHybridSupportContext: mocks.rag }));
import { runStudioConversation } from '@/services/agent-studio/runtime';
import { studioConnectionFingerprint } from '@/services/agent-studio/integration-identity';

const response = (text: string) => ({ requests: [], choices: [], action: { kind: 'respond', requestId: null, capabilityId: null,
  query: null, response: text, consent: 'none', consentQuote: null, reason: '' } });
function fixture(preview = false) {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.conversationMode = 'adaptive';
  document.resolveStage.reasoning = { enabled: true, effort: 'medium', supportModel: null, maxDecisions: 8, maxTurnMs: 90_000 };
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'support', name: 'Suporte', updatedAt: '2026-09-08', steps: [
    { id: 'lookup', order: 1, type: 'http_request', title: 'Consultar conexão', adaptiveAccess: { enabled: true, requiresSteps: [] },
      httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consultar', method: 'GET', url: '/status', connectionId: 'connection',
        outputMappings: [{ chipKey: 'status', chipLabel: 'Status', jsonPath: 'status' }] }) },
  ] })];
  const release: AgentReleaseManifest = { releaseId: 'release', agentId: 'agent', workspaceId: 'workspace', version: 2, agentSnapshot: document,
    publishedProcedures: document.resolveStage.procedures, referencedConnectionIds: ['connection'], connectionFingerprints: { connection: 'published-fingerprint' },
    mcpServerToolFingerprints: {}, runtimeVersion: 'studio-v1', runtimeConfig: { aiModel: 'deepseek/deepseek-v4-flash' }, createdAt: '2026-09-08' };
  let state: StudioSession | null = null;
  const saved: StudioMemoryEvent[] = [];
  const checkpoint = vi.fn(async (next: StudioSession, events?: StudioMemoryEvent[]) => { state = structuredClone(next); saved.push(...(events || [])); });
  const runNative = vi.fn().mockResolvedValue(undefined), assertCurrent = vi.fn().mockResolvedValue(undefined), sendCatalogImage = vi.fn().mockResolvedValue(undefined);
  const send = (message: string, id: string, suggestionOnly = false) => runStudioConversation({ release,
    config: { id: 'agent', workspace_id: 'workspace', ai_model: 'unpublished-model' } as AutopilotConfig,
    state, message, messageId: id, chatId: 'chat', contact: { id: 'contact', name: 'Cliente', phone: 'webchat:identity' } as Contact,
    checkpoint, runNative, assertCurrent, suggestionOnly, sendCatalogImage,
    ...(preview ? { preview: { samples: { lookup: '{"status":"online"}' } } } : {}),
  });
  return { release, send, saved, checkpoint, runNative, assertCurrent, sendCatalogImage, get state() { return state; } };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.platform.mockResolvedValue({id:'deepseek/deepseek-v4-flash',enabled:true}); mocks.query.mockResolvedValue({ rows: [] }); mocks.memory.mockResolvedValue({ records: [], nextCursor: null });
  mocks.credentials.mockResolvedValue([{ aiModel: 'deepseek/deepseek-v4-flash', apiKey: 'synthetic', isActive: true }]);
  mocks.usage.mockResolvedValue(undefined); mocks.http.mockResolvedValue({ values: { status: 'online' } });
  mocks.toolMemoryRead.mockResolvedValue([]); mocks.toolMemoryWrite.mockResolvedValue(undefined); mocks.toolMemoryReset.mockResolvedValue(null);
  mocks.model.mockResolvedValue(response('Como posso ajudar?'));
});
afterEach(() => vi.unstubAllEnvs());

describe('new reasoning engine through runStudioConversation', () => {
  it('retrieves a bounded page of complete API memory only for the active connection', async () => {
    const f = fixture();
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    const id = 'a'.repeat(64); mocks.toolMemoryContent.mockResolvedValue({ content: 'página 2', page: 1, nextPage: 2 });
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'recall', query: `app:{"toolName":"support:lookup","contentId":"${id}","page":1}` } }).mockImplementationOnce(async (call) => {
      expect(JSON.parse(call.userPrompt).observations.at(-1)).toMatchObject({ result: 'application_memory_content', toolName: 'support:lookup', contentId: id, content: 'página 2', nextPage: 2 });
      return response('Consultei o conteúdo.');
    });
    expect((await f.send('Leia o resultado completo', 'm1')).response).toBe('Consultei o conteúdo.');
    expect(mocks.toolMemoryContent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', contactId: 'contact' }), expect.any(String), id, 1);
  });
  it('does not expose a complete-memory page when the credential is revoked during its read', async () => {
    const f = fixture(); let revoked = false;
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') && !revoked ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    mocks.toolMemoryContent.mockImplementationOnce(async () => { revoked = true; return { content: 'conteúdo privado', page: 0, nextPage: null }; });
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'recall', query: `app:{"toolName":"support:lookup","contentId":"${'a'.repeat(64)}","page":0}` } }).mockImplementationOnce(async (call) => {
      expect(call.userPrompt).not.toContain('conteúdo privado');
      expect(JSON.parse(call.userPrompt).observations.at(-1)).toMatchObject({ error: 'application_memory_unavailable' });
      return response('A conexão foi revogada.');
    });
    expect((await f.send('Leia o resultado completo', 'm1')).response).toBe('A conexão foi revogada.');
  });
  it('discards an in-flight decision and provider continuation when application memory is cleared', async () => {
    const f = fixture();
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    mocks.toolMemoryRead.mockResolvedValue([{ name: 'support:lookup', observedAt: '2026-11-04T10:00:00.000Z', result: { status: 'completed', response: '', data: { status: 'private-value' } } }]);
    let cleared = false;
    mocks.toolMemoryReset.mockImplementation(async () => cleared ? '2026-11-04T11:00:00.000Z' : null);
    mocks.model.mockImplementationOnce(async (call) => {
      expect(call.userPrompt).toContain('private-value');
      cleared = true;
      return response('private-value');
    }).mockImplementationOnce(async (call) => {
      expect(call.userPrompt).not.toContain('private-value');
      expect(JSON.parse(call.userPrompt).historicalToolObservations).toEqual([]);
      return response('A memória foi limpa.');
    });
    expect((await f.send('O que estava salvo?', 'm1')).response).toBe('A memória foi limpa.');
  });
  it('paginates older application observations for the active connection using the same contact scope', async () => {
    const f = fixture();
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    const page = Array.from({ length: 11 }, (_, index) => ({ name: 'support:lookup', observedAt: `2026-11-04T10:${String(index).padStart(2, '0')}:00Z`, result: { status: 'completed', response: '', data: { index } } }));
    mocks.toolMemoryRead.mockResolvedValueOnce([]).mockResolvedValueOnce(page);
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'recall', query: 'app:{"toolName":"support:lookup","offset":20,"limit":10}' } }).mockImplementationOnce(async (call) => {
      const context = JSON.parse(call.userPrompt);
      expect(context.historicalToolCapabilities).toEqual(['support:lookup']);
      expect(context.observations.at(-1)).toMatchObject({ result: 'application_memory_loaded', toolName: 'support:lookup', nextOffset: 30, results: page.slice(1) });
      return response('Consultei o histórico.');
    });
    expect((await f.send('O que a integração respondeu antes?', 'm1')).response).toBe('Consultei o histórico.');
    expect(mocks.toolMemoryRead).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'workspace', contactId: 'contact', agentId: 'agent', releaseId: 'release' }), expect.any(Map), { offset: 20, limit: 11 });
  });
  it('refuses application memory when the connection is revoked during the turn', async () => {
    const f = fixture();
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    let reads = 0;
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') && ++reads <= 2 ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'recall', query: 'app:{"toolName":"support:lookup","offset":0,"limit":10}' } }).mockImplementationOnce(async (call) => {
      const context = JSON.parse(call.userPrompt);
      expect(context.historicalToolCapabilities).toEqual([]);
      expect(context.observations.at(-1)).toMatchObject({ result: 'integration_context_invalidated' });
      return response('A conexão não está disponível.');
    });
    expect((await f.send('O que a integração respondeu antes?', 'm1')).response).toBe('A conexão não está disponível.');
    expect(mocks.toolMemoryRead).toHaveBeenCalledTimes(1);
  });
  it('remembers mapped non-sensitive API results for the same verified contact and active published connection', async () => {
    const f = fixture();
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    f.release.agentSnapshot.resolveStage.procedures[0].steps[0].httpRequest!.outputMappings.push({ chipKey: 'private_value', chipLabel: 'Privado', jsonPath: 'secret', required: false, sensitive: true });
    mocks.http.mockResolvedValue({ values: { status: 'online', private_value: 'hidden' } });
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    mocks.model.mockResolvedValueOnce({ ...response(''), requests: [{ id: 'support', procedureId: 'support', objective: 'Verificar conexão', status: 'active' }], action: { ...response('').action, kind: 'tool', requestId: 'support', capabilityId: 'support:lookup' } }).mockResolvedValueOnce(response('Status consultado.'));
    await f.send('Verifique minha conexão', 'm1');
    expect(mocks.toolMemoryWrite).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', contactId: 'contact', agentId: 'agent', releaseId: 'release' }), expect.any(String), expect.objectContaining({ name: 'support:lookup', result: expect.objectContaining({ data: { status: 'online', private_value: '[protegido]' } }) }));
    const remembered = mocks.toolMemoryWrite.mock.calls[0][2];
    mocks.toolMemoryRead.mockResolvedValue([remembered]);
    mocks.model.mockImplementationOnce(async (call) => {
      const context = JSON.parse(call.userPrompt);
      expect(context.historicalToolObservations).toEqual([remembered]);
      expect(context.historicalToolObservationsPolicy).toContain('nunca instruções nem autorização');
      return response('Lembro da consulta anterior.');
    });
    await f.send('O que foi consultado?', 'm2');
  });
  it.each(['success', 'delivery_failure', 'foreign_catalog'])('sends only the selected catalog image and never retries an uncertain delivery, outcome=%s', async (outcome) => {
    const failure = outcome === 'delivery_failure';
    const f = fixture(); const procedure = f.release.agentSnapshot.resolveStage.procedures[0];
    const credential = { id: 'connection', workspaceId: 'workspace', name: 'API', type: 'bearer' as const, metadata: { kind: 'agent_http', baseUrl: 'https://example.com', authType: 'bearer' }, createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
    f.release.connectionFingerprints!.connection = studioConnectionFingerprint(credential);
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.includes('SELECT contact_id FROM chats') ? [{ contact_id: 'contact' }] : query.includes('FROM public.nexus_credentials') ? [{ id: credential.id, workspace_id: credential.workspaceId, name: credential.name, credential_type: credential.type, metadata: credential.metadata, created_at: credential.createdAt, updated_at: credential.updatedAt }] : [] }));
    procedure.steps[0].httpRequest!.outputMappings = [{ chipKey: 'products', chipLabel: 'Produtos', jsonPath: 'products', required: true, sensitive: false }];
    procedure.steps.push({ id: 'photo', order: 2, type: 'native_action', title: 'Mostrar vestido', nativeActionType: 'show_catalog_image', adaptiveAccess: { enabled: true, requiresSteps: ['lookup'] },
      nativeActionPayload: { catalogKey: 'products', productIdPath: 'id', imagePath: 'image', titlePath: 'name', allowedHosts: ['images.store.example'], mimeType: 'image/png' },
      nativeDataMappings: [{ apiField: 'productId', sourceType: 'collected_field', sourceValue: 'product' }] });
    if (outcome === 'foreign_catalog') {
      const foreign = structuredClone(procedure); foreign.id = 'other-store';
      f.release.agentSnapshot.resolveStage.procedures.push(foreign);
      procedure.steps[0].httpRequest!.outputMappings = [];
    }
    mocks.http.mockResolvedValue({ values: { products: [{ id: 'blue', name: 'Vestido azul', image: 'https://images.store.example/blue.png' }, { id: 'red', name: 'Vestido vermelho', image: 'https://images.store.example/red.png' }] } });
    const action = { ...response('').action, kind: 'tool', requestId: 'shopping', capabilityId: 'support:photo' };
    mocks.model.mockResolvedValueOnce({ ...response(''), requests: [{ id: 'shopping', procedureId: 'support', objective: 'Mostrar vestido escolhido', status: 'active' }],
      choices: [{ requestId: 'shopping', key: 'product', label: 'Vestido', value: 'blue', status: 'active', sourceMessageId: 'm1', quote: 'azul' }],
      action: { ...action, capabilityId: 'support:lookup' } }).mockResolvedValueOnce({ ...response(''), action });
    if (failure) f.sendCatalogImage.mockRejectedValue(new Error('Provider timeout'));
    mocks.model.mockResolvedValueOnce({ ...response(''), action }).mockResolvedValueOnce(response('Conferi a solicitação.'));
    const result = await f.send('Mostre o vestido azul', 'm1');
    expect(result.state.reasoning?.pendingAction).toBeNull();
    if (outcome === 'foreign_catalog') {
      expect(f.sendCatalogImage).not.toHaveBeenCalled();
      return;
    }
    expect(f.sendCatalogImage).toHaveBeenCalledTimes(1);
    expect(f.sendCatalogImage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://images.store.example/blue.png', caption: 'Vestido azul', mimeType: 'image/png' }), expect.any(String));
    expect(result.state.reasoning?.operations.find((operation) => operation.capabilityId === 'support:photo')?.status).toBe(failure ? 'unknown' : 'succeeded');
    expect(result.state.reasoning?.operations.find((operation) => operation.capabilityId === 'support:photo')?.presentedProduct).toEqual(failure ? undefined : { productId: 'blue', caption: 'Vestido azul', url: 'https://images.store.example/blue.png' });
    expect(result.state.reasoning?.requests[0].values.product).toBe('blue');
    expect(f.runNative).not.toHaveBeenCalled();
  });
  it('connects older history recovery to the current chat and journals the recovered customer source', async () => {
    const f = fixture();
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('JOIN messages boundary')
      ? [{ id: 'old-choice', content: 'Prefiro sem mesh', from_me: false }]
      : sql.includes('SELECT content, from_me, id') ? Array.from({ length: 80 }, (_, index) => ({ id: `recent-${index}`, content: 'Conversa posterior', from_me: false })) : [] }));
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'recall_history' } })
      .mockImplementationOnce(async (call) => {
        const context = JSON.parse(call.userPrompt);
        expect(context.recentMessages.some((source: { messageId: string }) => source.messageId === 'old-choice')).toBe(true);
        return { ...response('Vamos continuar sem mesh.'), requests: [{ id: 'support', procedureId: 'support', objective: 'Retomar', status: 'active' }],
          choices: [{ requestId: 'support', key: 'preference', label: 'Mesh', value: 'sem mesh', status: 'active', sourceMessageId: 'old-choice', quote: 'Prefiro sem mesh' }] };
      });
    const result = await f.send('Vamos continuar o que escolhi', 'current');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('JOIN messages boundary'), ['workspace','chat','current','recent-0']);
    expect(result.state.reasoning?.requests[0].values.preference).toBe('sem mesh');
    expect(f.saved.some((event) => event.kind === 'choice' && event.source.messageId === 'old-choice')).toBe(true);
    expect(f.runNative).not.toHaveBeenCalled();
  });
  it.each([false, true])('uses the platform thinking model and common executor in preview=%s', async (preview) => {
    const f = fixture(preview);
    mocks.model.mockResolvedValueOnce({ ...response(''), requests: [{ id: 'support', procedureId: 'support', objective: 'Verificar conexão', status: 'active' }],
      action: { ...response('').action, kind: 'tool', requestId: 'support', capabilityId: 'support:lookup' } })
      .mockResolvedValueOnce(response('A consulta retornou conexão online.'));
    const result = await f.send('Verifique minha conexão', 'm1');
    expect(result.response).toContain('online'); expect(result.state.reasoning?.operations[0].status).toBe('succeeded');
    expect(mocks.model).toHaveBeenCalledWith(expect.objectContaining({ model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', signal: expect.any(AbortSignal) }));
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.http).toHaveBeenCalledTimes(preview ? 0 : 1);
    expect(mocks.memory).toHaveBeenCalledTimes(preview ? 0 : 1);
    expect(f.saved.length).toBe(preview ? 0 : 1);
    expect(result.state.conversationMemory?.at(-1)?.customer).toBe('Verifique minha conexão');
  });

  it('refuses to execute when platform configuration is unavailable', async () => {
    const f = fixture(); mocks.platform.mockRejectedValue(new Error('Plataforma sem modelo ativo'));
    await expect(f.send('Oi', 'm1')).rejects.toThrow('ativo');
    expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it('does not advertise or spend a duplicate consultation on the platform model', async () => {
    const f = fixture(); f.release.agentSnapshot.resolveStage.reasoning!.supportModel = 'openai/configured-support-model';
    mocks.credentials.mockResolvedValue([{ aiModel: 'deepseek/deepseek-v4-flash', apiKey: 'synthetic', isActive: true },
      { aiModel: 'openai/configured-support-model', apiKey: 'synthetic-support', isActive: true }]);
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'consult', query: 'Como investigar essa contradição?' } })
      .mockResolvedValueOnce(response('Vamos verificar o status atualizado.'));
    await f.send('Já paguei mas continua bloqueado', 'm1');
    expect(mocks.model.mock.calls.map(([call]) => call.model)).toEqual(['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash']);
    expect(JSON.parse(mocks.model.mock.calls[0][0].userPrompt).supportAvailable).toBe(false);
    expect(f.runNative).not.toHaveBeenCalled();
  });

  it('sends only the changed state in a DeepSeek continuation when the agent is in the compact canary', async () => {
    vi.stubEnv('LIA1_COMPACT_AGENT_IDS', 'agent');
    const f = fixture();
    mocks.model.mockResolvedValueOnce({ ...response(''), requests: [{ id: 'support', procedureId: 'support', objective: 'Verificar conexão', status: 'active' }],
      action: { ...response('').action, kind: 'tool', requestId: 'support', capabilityId: 'support:lookup' } })
      .mockResolvedValueOnce(response('Conexão verificada.'));
    await f.send('Verifique minha conexão', 'm1');
    const first = JSON.parse(mocks.model.mock.calls[0][0].userPrompt);
    const second = JSON.parse(mocks.model.mock.calls[1][0].userPrompt);
    expect(first.kind).toBeUndefined();
    expect(first.procedures[0].capabilities[0]).not.toHaveProperty('inputs');
    expect(second.kind).toBe('state_delta');
    expect(second.updates.procedures).toBeUndefined();
    expect(second.updates.observations.append).toHaveLength(1);
    expect(mocks.model.mock.calls[0][0].model).toBe('deepseek/deepseek-v4-flash');
  });

  it('starts a fresh compact snapshot when carrying provider reasoning would cost more than the state', async () => {
    vi.stubEnv('LIA1_COMPACT_AGENT_IDS', 'agent');
    const f = fixture();
    const lookup = { ...response(''), requests: [{ id: 'support', procedureId: 'support', objective: 'Verificar conexão', status: 'active' }],
      action: { ...response('').action, kind: 'tool', requestId: 'support', capabilityId: 'support:lookup' } };
    mocks.model.mockImplementationOnce(async (call) => {
      call.continuation.messages(call.systemPrompt, call.userPrompt);
      call.continuation.accept({ reasoning_content: 'reasoning'.repeat(3000), tool_calls: [{ id: 'decision-1', type: 'function',
        function: { name: call.schemaName, arguments: JSON.stringify(lookup) } }] }, call.schemaName);
      return lookup;
    }).mockResolvedValueOnce(response('Conexão verificada.'));
    await f.send('Verifique minha conexão', 'm1');
    expect(JSON.parse(mocks.model.mock.calls[1][0].userPrompt)).not.toHaveProperty('kind', 'state_delta');
    expect(mocks.model.mock.calls[1][0].continuation).not.toBe(mocks.model.mock.calls[0][0].continuation);
  });

  it('correlates token usage to the chat and reports a published-model mismatch without switching models', async () => {
    const f = fixture(); f.release.runtimeConfig = { aiModel: 'openai/published-model' };
    mocks.model.mockImplementationOnce(async (call) => {
      await call.onUsage({ inputTokens: 100, outputTokens: 25, totalTokens: 125 });
      return response('Posso ajudar.');
    });
    await f.send('Olá', 'm1');
    await vi.waitFor(() => expect(mocks.usage).toHaveBeenCalledTimes(1));
    expect(mocks.model.mock.calls[0][0].model).toBe('deepseek/deepseek-v4-flash');
    expect(mocks.usage.mock.calls[0][0]).toMatchObject({ chatId: 'chat', status: 'charged',
      metadata: { releaseId: 'release', messageId: 'm1', decisionIndex: 1, publishedModelMismatch: true } });
    expect(mocks.usage.mock.calls[0][0].metadata).not.toHaveProperty('content');
  });

  it('never dispatches tools or transfers in suggestion-only mode', async () => {
    const f = fixture();
    mocks.model.mockResolvedValueOnce({ ...response(''), action: { ...response('').action, kind: 'handoff', reason: 'Pedido humano' } })
      .mockResolvedValueOnce(response('Sugestão de resposta ao cliente.'));
    const result = await f.send('Preciso de uma pessoa', 'm1', true);
    expect(result.response).toContain('Sugestão'); expect(f.runNative).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled();
  });

  it('keeps preview choices available after a serialized reload on the next turn', async () => {
    const f = fixture(true);
    mocks.model.mockResolvedValueOnce({ ...response('Guardei sua preferência.'), requests: [{ id: 'support', procedureId: 'support', objective: 'Atender', status: 'active' }],
      choices: [{ requestId: 'support', key: 'preference', label: 'Preferência', value: 'sem mesh', status: 'active', sourceMessageId: 'm1', quote: 'sem mesh' }] });
    await f.send('Prefiro sem mesh', 'm1');
    await f.send('Vamos continuar', 'm2');
    const context = JSON.parse(mocks.model.mock.calls[1][0].userPrompt);
    expect(context.requests[0].values.preference).toBe('sem mesh');
    expect(context.recentMessages.some((m: { content: string }) => m.content === 'Prefiro sem mesh')).toBe(true);
    expect(mocks.memory).not.toHaveBeenCalled();
  });
});
