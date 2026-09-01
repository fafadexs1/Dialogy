import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAgentStudioDocument } from '@/services/agent-studio/types';
import { createStudioSession } from '@/services/agent-studio/engine';
const preview = vi.hoisted(() => vi.fn());
const configuredModels = vi.hoisted(() => vi.fn());
vi.mock('@/services/ai/workspace-ai-credentials', () => ({ listWorkspaceConfiguredAiModels: configuredModels }));
vi.mock('@/services/agent-studio/runtime', () => ({ runStudioConversation: preview }));
const m = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), query: vi.fn(), connect: vi.fn(), create: vi.fn(), http: vi.fn(), mcp: vi.fn(), resolveMcp: vi.fn() }));
vi.mock('@/actions/user', () => ({ getCurrentUser: m.user }));
vi.mock('@/actions/autopilot', () => ({ createAutopilotAgent: m.create }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission: m.permission }));
vi.mock('@/lib/db', () => ({ db: { query: m.query, connect: m.connect } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: m.http, executeStudioMcp: m.mcp, resolveStudioMcpTool: m.resolveMcp }));
vi.mock('@/modules/nexus/services/credentials', () => ({ listNexusCredentialSummaries: vi.fn(), saveNexusCredential: vi.fn() }));
vi.mock('@/services/mcp/store', () => ({ getMcpWorkspaceConfig: vi.fn() }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: vi.fn() }));
import { getAgentStudioDataAction, saveAgentStudioDraftAction, publishAgentStudioAction, listAgentMcpServersAction, testHttpRequestAction, getStudioVersionForDraftAction, validateStudioMcpSimulationAction, testAgentStudioConversationAction, startAgentStudioLiveTestAction, sendAgentStudioLiveTestAction, getAgentStudioLiveTestAction } from '@/actions/agent-studio';

const id = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const document = createDefaultAgentStudioDocument(id, workspaceId);
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: 'user', activeWorkspaceId: workspaceId }); m.permission.mockResolvedValue(true); m.query.mockResolvedValue({ rows: [] }); configuredModels.mockResolvedValue([{ id: 'configured-model', enabled: true }]); });
describe('Studio server action authorization', () => {
  it('previews the selected draft model instead of the production model', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId, ai_model: 'production-model', knowledge_base_documents: [] }] });
    configuredModels.mockResolvedValue([{ id: 'openai/selected-model', provider: 'openai', label: 'Selected', enabled: true }]);
    const state = createStudioSession(id, 'simulation', id);
    preview.mockResolvedValue({ state, response: 'Resposta', replay: false });
    const result = await testAgentStudioConversationAction(id, { document: { ...document, aiModel: 'openai/selected-model' }, state, message: 'Olá', messageId: id });
    expect(result).toMatchObject({ success: true, model: 'openai/selected-model' });
    expect(preview.mock.calls[0][0].release.runtimeConfig.aiModel).toBe('openai/selected-model');
    expect(configuredModels).toHaveBeenCalledWith(workspaceId);
  });
  it('rejects a model not registered in this workspace before saving, publishing or calling a provider', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    configuredModels.mockResolvedValue([]);
    const draft = { ...document, aiModel: 'googleai/gemini-2.5-flash-lite' };
    expect(await saveAgentStudioDraftAction(id, draft)).toMatchObject({ success: false, error: expect.stringContaining('modelo de IA') });
    expect(await publishAgentStudioAction(id, draft)).toMatchObject({ success: false, error: expect.stringContaining('Modelos de IA') });
    expect(await testAgentStudioConversationAction(id, { document: draft, state: createStudioSession(id, 'simulation', id), message: 'Olá', messageId: id })).toMatchObject({ success: false });
    expect(m.connect).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  });
  it.each([
    ['load', () => getAgentStudioDataAction(id)],
    ['save', () => saveAgentStudioDraftAction(id, document)],
    ['publish', () => publishAgentStudioAction(id, document)],
    ['list MCP', () => listAgentMcpServersAction(id)],
    ['restore', () => getStudioVersionForDraftAction(id, id)],
    ['preview', () => testAgentStudioConversationAction(id, {})],
    ['start live', () => startAgentStudioLiveTestAction(id, {})],
    ['send live', () => sendAgentStudioLiveTestAction(id, new FormData())],
    ['read live', () => getAgentStudioLiveTestAction(id, id)],
  ])('rejects unauthenticated %s without accessing data', async (_name, action) => {
    m.user.mockResolvedValue(null); const result = await action(); expect(result.success).toBe(false); expect(m.query).not.toHaveBeenCalled(); expect(m.connect).not.toHaveBeenCalled();
  });
  it('requires real-integration permission on every live request', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    m.permission.mockImplementation(async (_user, _workspace, permission) => permission !== 'workspace:settings:edit');
    expect((await startAgentStudioLiveTestAction(id, {})).success).toBe(false);
    expect((await sendAgentStudioLiveTestAction(id, new FormData())).success).toBe(false);
    expect(m.connect).not.toHaveBeenCalled(); expect(m.http).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  });
  it('does not start real operations from an unconfirmed or cross-workspace draft', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    const input = { document, sessionId: id, contact: { name: 'Teste' } };
    expect((await startAgentStudioLiveTestAction(id, input)).success).toBe(false);
    expect((await startAgentStudioLiveTestAction(id, { ...input, realExecutionConfirmed: true, document: { ...document, workspaceId: 'foreign' } })).success).toBe(false);
    expect(m.connect).not.toHaveBeenCalled(); expect(m.http).not.toHaveBeenCalled();
  });
  it('uses the authorized model with the unsaved draft and enables only sandbox effects', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId, ai_model: 'configured-model', knowledge_base_documents: [] }] });
    const draft = { ...document, objective: 'Objetivo ainda não salvo', inlineKnowledge: [{ id: 'source', name: 'Manual', content: 'Fonte ainda não salva' }] };
    const state = createStudioSession(id, 'simulation', id);
    preview.mockResolvedValue({ state, response: 'Resposta da IA', replay: false });
    const result = await testAgentStudioConversationAction(id, { document: draft, state, message: 'Olá', messageId: id });
    expect(result).toMatchObject({ success: true, response: 'Resposta da IA', model: 'configured-model' });
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ preview: { samples: {} },
      release: expect.objectContaining({ agentSnapshot: expect.objectContaining({ objective: 'Objetivo ainda não salvo' }),
        runtimeConfig: { aiModel: 'configured-model' }, knowledgeSnapshot: [expect.objectContaining({ content: 'Fonte ainda não salva', collectionIds: ['source'] })] }) }));
    expect(m.query).toHaveBeenCalledOnce(); expect(m.connect).not.toHaveBeenCalled(); expect(m.http).not.toHaveBeenCalled(); expect(m.mcp).not.toHaveBeenCalled();
  });
  it('rejects foreign scopes, production sessions and oversized input before invoking AI', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    const input = { document, state: createStudioSession(id, 'simulation', id), message: 'Olá', messageId: id };
    for (const invalid of [
      { ...input, document: { ...document, workspaceId: 'foreign' } },
      { ...input, state: { ...input.state, releaseId: 'production' } },
      { ...input, message: 'x'.repeat(900001) },
    ]) expect((await testAgentStudioConversationAction(id, invalid)).success).toBe(false);
    expect(preview).not.toHaveBeenCalled();
  });
  it('requires automation management before reading an agent', async () => {
    m.permission.mockResolvedValue(false); const result = await getAgentStudioDataAction(id);
    expect(result.success).toBe(false); expect(m.query).not.toHaveBeenCalled(); expect(m.permission).toHaveBeenCalledWith('user', workspaceId, 'automations:manage');
  });
  it('never reads a draft belonging to an agent outside the active workspace', async () => {
    const result = await getAgentStudioDataAction(id); expect(result.success).toBe(false);
    expect(m.query).toHaveBeenCalledTimes(1); expect(m.query.mock.calls[0][1]).toEqual([id, workspaceId]);
  });
  it('does not reveal private agents owned by another author', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId, is_private: true, user_id: 'another-user' }] });
    const result = await getAgentStudioDataAction(id);
    expect(result.success).toBe(false); expect(m.query).toHaveBeenCalledTimes(1);
  });
  it('refuses integration tests for authors without connection-management permission', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] }); m.permission.mockImplementation(async (_id, _workspace, permission) => permission === 'automations:manage');
    const result = await testHttpRequestAction(id, { name: 'Consulta', url: 'https://example.com', method: 'GET', authType: 'none', sentDataMappings: [], outputMappings: [], timeoutSeconds: 10, maxRetries: 0, fallbackAction: 'handoff' }, { values: {}, realExecutionConfirmed: true });
    expect(result.success).toBe(false); expect(m.http).not.toHaveBeenCalled();
  });
  it('requires explicit real-test confirmation, even for admins', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    const result = await testHttpRequestAction(id, { name: 'Consulta', url: 'https://example.com', method: 'GET', authType: 'none', sentDataMappings: [], outputMappings: [], timeoutSeconds: 10, maxRetries: 0, fallbackAction: 'handoff' }, { values: {} });
    expect(result.success).toBe(false); expect(m.http).not.toHaveBeenCalled();
  });
  it('validates MCP simulation against the synchronized input/output contracts without calling the server', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    m.resolveMcp.mockResolvedValue({ tool: { inputSchema: { type: 'object', required: ['customer'], properties: { customer: { type: 'object', required: ['cpf'], properties: { cpf: { type: 'string', pattern: '^\\d{11}$' } } } } }, outputSchema: { type: 'object', required: ['invoice'], properties: { invoice: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } } } } } });
    const step = { serverId: 'erp', qualifiedToolName: 'mcp:erp:invoice', friendlyToolName: 'Gerar fatura', argumentMappings: [{ argumentName: 'customer.cpf', sourceChipKey: 'cpf', sourceChipLabel: 'CPF' }], outputMappings: [{ chipKey: 'url', chipLabel: 'Link', jsonPath: 'invoice.url' }] };
    const valid = await validateStudioMcpSimulationAction(id, step as any, { values: { cpf: '52998224725' }, contact: {}, input: {} }, { invoice: { url: 'https://example.com/invoice.pdf' } });
    expect(valid).toEqual({ success: true, values: { url: 'https://example.com/invoice.pdf' } });
    expect(m.mcp).not.toHaveBeenCalled();
    expect((await validateStudioMcpSimulationAction(id, step as any, { values: { cpf: 'invalid' }, contact: {}, input: {} }, { invoice: { url: 'https://example.com' } })).success).toBe(false);
    expect((await validateStudioMcpSimulationAction(id, step as any, { values: { cpf: '52998224725' }, contact: {}, input: {} }, { invoice: { url: 'not-a-url' } })).success).toBe(false);
  });
  it('rejects malformed or excessive simulation data before any MCP network execution', async () => {
    m.query.mockResolvedValue({ rows: [{ id, workspace_id: workspaceId }] });
    const oversized = 'x'.repeat(200_001);
    const result = await validateStudioMcpSimulationAction(id, {} as any, { values: { oversized }, contact: {}, input: {} }, {});
    expect(result.success).toBe(false); expect(m.resolveMcp).not.toHaveBeenCalled(); expect(m.mcp).not.toHaveBeenCalled();
  });
});
