import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublishedStudioSandboxExecutor } from '@/services/agent-studio/workflow-sandbox';
import { createAuroraSalesAgent } from '@/modules/nexus/services/aurora-sales-agent';
import { createStudioSession } from '@/services/agent-studio/engine';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import { workflowDefinition, workflowNode, connect } from './workflow-runtime-fixtures';

const mocks = vi.hoisted(() => ({ release: vi.fn(), config: vi.fn(), conversation: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));
vi.mock('@/services/agent-studio/repository', () => ({ loadStudioRelease: mocks.release }));
vi.mock('@/services/autopilot/runtime/config-service', () => ({ getAutopilotConfigService: mocks.config }));
vi.mock('@/services/agent-studio/runtime', () => ({ runStudioConversation: mocks.conversation }));

const agentId = 'bc053c26-6c89-4415-96bf-16592252afca';
const releaseId = '0c53b9dd-d1d6-4055-869b-13f9cd1392b3';
const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
function harness(sandbox = true) {
  const start = workflowNode('trigger.received_message', 'start');
  const agent = workflowNode('ai.published_agent', 'nina', { agentId, releaseId, inputMappings: [], outputKeys: [] });
  const workflow = workflowDefinition([start, agent], [connect(start, 'message', agent, 'main')], { workspaceId, status: 'draft' });
  const send = vi.fn(async () => ({ success: true, sandbox: true }));
  const execute = createPublishedStudioSandboxExecutor({ workspaceId, actorUserId: 'owner', sendResponse: send });
  const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({ executePublishedAgent: execute }));
  return { send, executor, start: () => executor.start({ workflow, input: { text: 'Trabalho oito horas sentado e tenho dois mil reais.' }, context: { sandbox } }) };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
  const document = createAuroraSalesAgent({ id: agentId, workspaceId, handoffTeam: 'Dialogy Comercial' });
  mocks.release.mockResolvedValue({ releaseId, agentId, workspaceId, version: 1, agentSnapshot: document });
  mocks.config.mockResolvedValue({ config: { id: agentId, workspace_id: workspaceId, user_id: 'owner', is_private: true, is_active: true } });
  mocks.conversation.mockImplementation(async (input) => {
    const state = input.state || createStudioSession(agentId, releaseId, 'preview-session');
    state.status = 'waiting_input'; state.toolCallCount = (state.toolCallCount || 0) + 1;
    state.conversationMemory = [...(state.conversationMemory || []), { messageId: input.messageId, customer: input.message, assistant: 'Vamos focar na cadeira, então.' }];
    return { state, response: 'Vamos focar na cadeira, então.' };
  });
});
describe('published Studio agent inside Nexus sandbox', () => {
  it('keeps a real conversational session across free-text turns using encrypted state', async () => {
    const h = harness(); const first = await h.start(); expect(first.status).toBe('waiting');
    expect(first.waitingReason).toBe('message'); expect(first.totalToolCalls).toBe(1);
    const stored = JSON.stringify(first.variables.__studioSandboxSessions);
    expect(stored).not.toContain('oito horas'); expect(stored).not.toContain('Vamos focar');
    const second = await h.executor.resume({ resumeToken: first.resumeToken!, input: { text: 'Minha mesa já é boa, não quero o kit.' } });
    expect(second.status).toBe('waiting'); expect(second.totalToolCalls).toBe(2); expect(h.send).toHaveBeenCalledTimes(2);
    const request = mocks.conversation.mock.calls[1][0];
    expect(request.state.conversationMemory[0].customer).toContain('oito horas');
    expect(request.message).toBe('Minha mesa já é boa, não quero o kit.');
    expect(request.preview).toEqual({ samples: {} });
    expect(request.contact.id).toBe('nexus-preview');
  });
  it('rejects execution outside the sandbox before invoking the model', async () => {
    expect((await harness(false).start()).status).toBe('failed'); expect(mocks.conversation).not.toHaveBeenCalled();
  });
  it('does not expose another user’s private agent', async () => {
    mocks.config.mockResolvedValue({ config: { id: agentId, is_active: true, is_private: true, user_id: 'someone-else' } });
    expect((await harness().start()).status).toBe('failed'); expect(mocks.conversation).not.toHaveBeenCalled();
  });
  it('does not run a paused or unavailable release', async () => {
    mocks.release.mockResolvedValue(null); expect((await harness().start()).status).toBe('failed'); expect(mocks.conversation).not.toHaveBeenCalled();
  });
  it('keeps the conversation open after resolving a request', async () => {
    mocks.conversation.mockImplementation(async input => {
      const state = input.state || createStudioSession(agentId, releaseId, 'preview-session'); state.status = 'resolved'; state.phase = 'done';
      return { state, response: 'Esses são os valores; ainda não confirmei nada.' };
    });
    const h = harness(); const first = await h.start(); expect(first.status).toBe('waiting');
    expect((await h.executor.resume({ resumeToken: first.resumeToken!, input: { text: 'E se eu trocar pelo kit?' } })).status).toBe('waiting');
    expect(h.send).toHaveBeenCalledTimes(2);
  });
});
