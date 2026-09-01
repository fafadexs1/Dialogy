import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowExecutionSchema, type NodeRuntimeInput } from '@/services/workflow-runtime';
import { workflowDefinition, workflowNode } from './workflow-runtime-fixtures';
import { createDefaultAgentStudioDocument, CollectedFieldDefinitionSchema } from '@/services/agent-studio/types';
import { createStudioSession } from '@/services/agent-studio/engine';

const mocks = vi.hoisted(() => ({ release: vi.fn(), config: vi.fn(), query: vi.fn(), store: vi.fn(), run: vi.fn(), assertCurrent: vi.fn() }));
vi.mock('@/services/agent-studio/repository', () => ({ loadStudioRelease: mocks.release }));
vi.mock('@/services/autopilot/runtime/config-service', () => ({ getAutopilotConfigService: mocks.config }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/services/agent-studio/session-store', () => ({ studioSessionStore: mocks.store }));
vi.mock('@/services/agent-studio/runtime', () => ({ runStudioConversation: mocks.run }));
vi.mock('@/services/autopilot/runtime/stale-source-guard', () => ({ assertAutopilotSourceMessageCurrent: mocks.assertCurrent }));
import { executePublishedStudioNode } from '@/services/agent-studio/workflow-adapter';

function input(): NodeRuntimeInput {
  const node = workflowNode('ai.published_agent', 'published-agent', { agentId: 'agent', releaseId: 'release', outputKeys: ['invoice'] });
  const workflow = workflowDefinition([node], [], { status: 'published', workspaceId: 'workspace' });
  const execution = WorkflowExecutionSchema.parse({ executionId: 'execution', workflowId: workflow.id, workflowVersion: workflow.version, conversationId: 'chat', status: 'running', currentNodeId: node.id, previousNodeId: null, pendingNodeIds: [], input: { message: 'Preciso da fatura' }, context: { sourceMessageId: 'message-1' }, variables: {}, nodeResults: {}, executionPath: [], startedAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z', totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0 });
  return { node, workflow, execution, input: execution.input, attachments: {}, emit: async () => {}, signal: new AbortController().signal };
}
const effects = () => ({ send: vi.fn(async () => ({ success: true })), native: vi.fn(async () => {}) });
beforeEach(() => {
  vi.resetAllMocks();
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.understandStage.askInitialData = true;
  document.understandStage.initialFields = [CollectedFieldDefinitionSchema.parse({ id: 'invoice', name: 'Fatura', variableKey: 'invoice', promptMessage: 'Qual fatura?' })];
  mocks.release.mockResolvedValue({ releaseId: 'release', version: 3, workspaceId: 'workspace', agentId: 'agent', agentSnapshot: document });
  mocks.config.mockResolvedValue({ config: { id: 'agent', is_active: true } });
  mocks.query.mockResolvedValue({ rows: [{ id: 'contact' }] });
  mocks.store.mockResolvedValue({ state: null, checkpoint: vi.fn() });
  mocks.run.mockResolvedValue({ state: { ...createStudioSession('agent', 'release', 'session'), status: 'waiting_input' }, response: 'Qual seu CPF?' });
});
describe('published Studio agent in an unchanged normal workflow', () => {
  it('rejects undeclared outputs before running the agent or loading customer data', async () => {
    const request = input(); request.node.config.outputKeys = ['secret'];
    expect((await executePublishedStudioNode(request, effects())).status).toBe('error');
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('pins a release and waits at the same node for customer data', async () => {
    const fx = effects(); const result = await executePublishedStudioNode(input(), fx);
    expect(result.status).toBe('waiting'); expect(result.output).toMatchObject({ releaseId: 'release', version: 3, resumeMode: 'reexecute', expirationOutput: 'error' });
    expect(mocks.release).toHaveBeenCalledWith('workspace', 'agent', 'release');
    expect(mocks.store).toHaveBeenCalledWith({ workspaceId: 'workspace', agentId: 'agent', chatId: 'chat', contextId: 'execution:published-agent' });
    expect(fx.send).toHaveBeenCalledWith('Qual seu CPF?');
  });
  it('resumes with the new source message, without replacing the conversation state', async () => {
    const request = input(); request.execution.context.__resumeInput = { message: '52998224725', sourceMessageId: 'message-2' };
    const state = createStudioSession('agent', 'release', 'session'); mocks.store.mockResolvedValue({ state, checkpoint: vi.fn() });
    await executePublishedStudioNode(request, effects());
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ state, message: '52998224725', messageId: 'message-2' });
  });
  it.each([['resolved', 'completed'], ['transferred', 'handoff']])('finishes autonomously as %s without requiring a downstream block', async (status, port) => {
    mocks.run.mockResolvedValue({ response: 'Pronto', state: { ...createStudioSession('agent', 'release', 'session'), status, values: { invoice: 7, cpf: '52998224725' } } });
    const result = await executePublishedStudioNode(input(), effects());
    expect(result.status).toBe('completed'); expect(result.selectedOutput).toBe(port); expect(result.output?.data).toEqual({ invoice: 7 });
  });
  it('refuses a paused agent before executing actions', async () => {
    mocks.config.mockResolvedValue({ config: { id: 'agent', is_active: false } });
    expect((await executePublishedStudioNode(input(), effects())).status).toBe('error'); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('refuses changing versions during a suspended conversation', async () => {
    mocks.store.mockResolvedValue({ state: createStudioSession('agent', 'old-release', 'session'), checkpoint: vi.fn() });
    expect((await executePublishedStudioNode(input(), effects())).status).toBe('error'); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('does not run real tools when a normal workflow is only a draft', async () => {
    const request = input(); request.workflow.status = 'draft';
    expect((await executePublishedStudioNode(request, effects())).status).toBe('error'); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('marks delivery failures nonretryable instead of blindly repeating actions', async () => {
    const fx = { ...effects(), send: vi.fn(async () => ({ success: false })) };
    const result = await executePublishedStudioNode(input(), fx); expect(result.status).toBe('error'); expect(result.error?.retryable).toBe(false);
  });
  it('does not deliver a stale model answer after a newer customer message', async () => {
    mocks.assertCurrent.mockRejectedValueOnce(new Error('Mensagem desatualizada'));
    const fx = effects(); const result = await executePublishedStudioNode(input(), fx);
    expect(result.status).toBe('error'); expect(fx.send).not.toHaveBeenCalled();
  });
});
