import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowExecutionSchema, type NodeRuntimeInput } from '@/services/workflow-runtime';
import { workflowDefinition, workflowNode } from './workflow-runtime-fixtures';
import { studioFlowRelease } from './fixtures/studio-flow-fixture';
import { createStudioFlowState } from '@/services/agent-studio/flow-execution';

const mock = vi.hoisted(() => ({ states: new Map<string, unknown>(), outputs: [] as unknown[], approval: vi.fn(), effect: vi.fn(), browser: vi.fn(), page: vi.fn(), script: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [{ is_active: true }] })) } }));
vi.mock('@/services/agent-studio/repository', () => ({ loadStudioRelease: vi.fn(async () => studioFlowRelease()) }));
vi.mock('@/services/agent-studio/contact-crm', () => ({ loadStudioContactCrm: async () => ({}) }));
vi.mock('@/services/autopilot/runtime/stale-source-guard', () => ({ assertAutopilotSourceMessageCurrent: async () => {} }));
vi.mock('@/services/workflow-runtime/autopilot-primary', () => ({ modelChainForNode: async () => ({ generateStructured: async ({ schema }: { schema: { parse: (value: unknown) => unknown } }) => ({ output: schema.parse(mock.outputs.shift()), selected: { config: { model: 'fixture' } } }) }) }));
vi.mock('@/modules/nexus/services/tool-registry', async importOriginal => ({ ...(await importOriginal()), createNexusToolRegistry: () => ({ list: () => [] }) }));
vi.mock('@/modules/nexus/services/browser-agent', async importOriginal => ({ ...(await importOriginal()), runNetworklessBrowser: mock.browser, loadBrowserPage: mock.page, loadBrowserScript: mock.script }));
vi.mock('@/modules/nexus/services/automation-approvals', () => ({ requestAutomationApproval: mock.approval }));
vi.mock('@/modules/nexus/services/durable-effects', () => ({ executeDurableEffect: mock.effect, nodeInvocationKey: () => 'key' }));
vi.mock('@/services/agent-studio/flow-store', () => ({ studioFlowInvocationStore: async (scope: { invocationId: string }) => ({ state: mock.states.has(scope.invocationId) ? structuredClone(mock.states.get(scope.invocationId)) : undefined, checkpoint: async (state: unknown) => { mock.states.set(scope.invocationId, structuredClone(state)); } }) }));
import { createStudioFlowNodeExecutor } from '@/services/agent-studio/flow-runtime';

function input(): NodeRuntimeInput {
  const release = studioFlowRelease();
  const node = workflowNode('ai.studio_agent', 'agent', { agentId: release.agentId, releaseId: release.releaseId, mode: 'task', outputKey: 'result' });
  const workflow = workflowDefinition([node], [], { workspaceId: release.workspaceId });
  const execution = WorkflowExecutionSchema.parse({ executionId: 'execution', workflowId: workflow.id, workflowVersion: workflow.version, status: 'running', currentNodeId: node.id, previousNodeId: null, pendingNodeIds: [], input: {}, context: {}, variables: {}, nodeResults: {}, executionPath: [], totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, startedAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z' });
  return { workflow, node, execution, input: {}, attachments: { tool: [workflowNode('tool.browser', 'browser', {})] }, signal: new AbortController().signal, emit: vi.fn(async () => {}) };
}
const runner = () => createStudioFlowNodeExecutor({ config: {} as never, sendResponse: vi.fn(), retrieveKnowledge: async () => [], loadMemory: async () => ({}) });
const pending = { status: 'waiting', resumeToken: 'approval', output: { approvalId: 'a', waitingSince: '2026-11-04T10:00:00Z', expiresAt: '2026-11-05T10:00:00Z' } };
function seedBrowser() { const state = createStudioFlowState(studioFlowRelease().releaseId); state.children['browser:browser'] = { url: 'https://example.com/', html: '<script src="/app.js"></script>' }; mock.states.set('execution:agent:visit:0', state); }

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('DIALOGY_AGENT_BROWSER_JS', 'true'); mock.states.clear(); mock.outputs.length = 0;
  mock.approval.mockReset().mockResolvedValue(null); mock.effect.mockReset().mockImplementation(async (_workspace, _id, _args, operation) => operation());
});
afterEach(() => vi.unstubAllEnvs());

describe('aprovações do navegador do Studio', () => {
  it('pausa antes de navegar e usa exatamente a mesma URL após aprovação', async () => {
    mock.approval.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    mock.page.mockResolvedValue({ url: 'https://example.com/path', html: '<p>Olá</p>' });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'open', url: 'https://example.com/path' } }, { kind: 'completed', data: { answer: 'ok' } });
    const request = input(), execute = runner();
    const first = await execute(request); expect(first.error?.message).toBeUndefined(); expect(first).toMatchObject({ status: 'waiting', waitingReason: 'approval' });
    expect(mock.page).not.toHaveBeenCalled();
    const second = await execute(request); expect(second.error?.message).toBeUndefined(); expect(second.selectedOutput).toBe('completed');
    expect(mock.approval.mock.calls[0][1]).toEqual(mock.approval.mock.calls[1][1]);
    expect(mock.page).toHaveBeenCalledWith({ url: 'https://example.com/path', method: 'GET' }, expect.any(AbortSignal));
  });
  it('exige aprovação separada para um script declarado antes de baixá-lo', async () => {
    seedBrowser(); mock.browser.mockResolvedValue({ urls: ['https://example.com/app.js'] });
    mock.approval.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    mock.script.mockResolvedValue({ url: 'https://example.com/app.js', content: 'document.title="ok"' });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'load_script', url: 'https://example.com/app.js' } }, { kind: 'completed', data: { answer: 'ok' } });
    const request = input(), execute = runner();
    const first = await execute(request); expect(first.error?.message).toBeUndefined(); expect(first).toMatchObject({ status: 'waiting', waitingReason: 'approval' });
    expect(mock.script).not.toHaveBeenCalled();
    const second = await execute(request); expect(second.error?.message).toBeUndefined(); expect(second.selectedOutput).toBe('completed');
    expect(mock.approval.mock.calls[0][1]).toEqual({ action: 'load_script', url: 'https://example.com/app.js', pageUrl: 'https://example.com/' });
    expect(mock.approval.mock.calls[0][1]).toEqual(mock.approval.mock.calls[1][1]);
    expect(mock.script).toHaveBeenCalledOnce();
  });
  it('não baixa scripts não declarados na página', async () => {
    seedBrowser(); mock.browser.mockResolvedValue({ urls: ['https://example.com/app.js'] });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'load_script', url: 'https://example.com/other.js' } });
    const result = await runner()(input());
    expect(result.error?.message).toContain('declarado'); expect(mock.script).not.toHaveBeenCalled(); expect(mock.approval).not.toHaveBeenCalled();
  });
  it('permite script declarado de CDN somente após aprovação explícita', async () => {
    seedBrowser(); mock.browser.mockResolvedValue({ urls: ['https://cdn.example/app.js'] });
    mock.approval.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    mock.script.mockResolvedValue({ url: 'https://cdn.example/app.js', content: 'document.title="ok"' });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'load_script', url: 'https://cdn.example/app.js' } }, { kind: 'completed', data: { answer: 'ok' } });
    const request = input(), execute = runner();
    expect(await execute(request)).toMatchObject({ status: 'waiting', waitingReason: 'approval' }); expect(mock.script).not.toHaveBeenCalled();
    expect((await execute(request)).selectedOutput).toBe('completed');
    expect(mock.approval.mock.calls[0][1]).toEqual({ action: 'load_script', url: 'https://cdn.example/app.js', pageUrl: 'https://example.com/' });
    expect(mock.script).toHaveBeenCalledOnce();
  });
  it('não segue automaticamente um redirecionamento após aprovação da URL inicial', async () => {
    mock.page.mockResolvedValue({ url: 'https://example.com/start', redirect: { url: 'https://example.com/next', status: 302, previousMethod: 'GET' } });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'open', url: 'https://example.com/start' } }, { kind: 'completed', data: { answer: 'ok' } });
    expect((await runner()(input())).selectedOutput).toBe('completed');
    expect(mock.page).toHaveBeenCalledOnce();
    expect(mock.approval).toHaveBeenCalledOnce();
  });
  it('exige uma nova aprovação para seguir o destino de redirecionamento', async () => {
    mock.page.mockReset().mockResolvedValueOnce({ url: 'https://example.com/start', redirect: { url: 'https://example.com/next', status: 302, previousMethod: 'GET' } }).mockResolvedValueOnce({ url: 'https://example.com/next', html: '<p>ok</p>' });
    mock.approval.mockResolvedValueOnce(null).mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'open', url: 'https://example.com/start' } }, { kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'open', url: 'https://example.com/next' } }, { kind: 'completed', data: { answer: 'ok' } });
    const request = input(), execute = runner();
    expect(await execute(request)).toMatchObject({ status: 'waiting', waitingReason: 'approval' });
    expect(mock.page).toHaveBeenCalledOnce();
    expect(mock.approval.mock.calls[0][1]).toEqual({ action: 'open', navigation: { url: 'https://example.com/start', method: 'GET' } });
    expect(mock.approval.mock.calls[1][1]).toEqual({ action: 'open', navigation: { url: 'https://example.com/next', method: 'GET' } });
    expect((await execute(request)).selectedOutput).toBe('completed');
    expect(mock.page).toHaveBeenCalledTimes(2);
  });
  it('submete intenção gerada pelo clique a aprovação antes de executar POST', async () => {
    seedBrowser(); mock.browser.mockResolvedValue({ networkIntent: { target: 'https://example.com/send', method: 'POST', body: 'message=hello', contentType: 'application/x-www-form-urlencoded' } });
    mock.approval.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    mock.page.mockResolvedValue({ url: 'https://example.com/send', html: '<p>ok</p>' });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'click', selector: '#send' } }, { kind: 'completed', data: { answer: 'ok' } });
    const request = input(), execute = runner();
    expect(await execute(request)).toMatchObject({ status: 'waiting', waitingReason: 'approval' });
    expect(mock.page).not.toHaveBeenCalled();
    const resumed = await execute(request); expect(resumed.error?.message).toBeUndefined();
    expect(mock.approval.mock.calls[0][1]).toEqual({ action: 'click', navigation: { url: 'https://example.com/send', method: 'POST', body: 'message=hello' } });
    expect(mock.approval.mock.calls[0][1]).toEqual(mock.approval.mock.calls[1][1]);
    expect(mock.page).toHaveBeenCalledOnce();
  });
  it('bloqueia GET gerado por JavaScript com token na URL antes da aprovação', async () => {
    seedBrowser(); mock.browser.mockResolvedValue({ networkIntent: { target: 'https://example.com/send?access_token=secret', method: 'GET', body: '', contentType: '' } });
    mock.outputs.push({ kind: 'tool_call', toolName: 'isolated_browser', arguments: { action: 'click', selector: '#send' } });
    const result = await runner()(input());
    expect(result.error?.message).toContain('parâmetros protegidos');
    expect(mock.approval).not.toHaveBeenCalled(); expect(mock.page).not.toHaveBeenCalled();
  });
});
