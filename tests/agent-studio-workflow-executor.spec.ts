import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryWorkflowPersistence, WorkflowExecutor, createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema, HttpRequestStepConfigSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
const mocks = vi.hoisted(() => ({ release: vi.fn(), config: vi.fn(), query: vi.fn(), http: vi.fn(), model: vi.fn(), current: vi.fn() }));
vi.mock('@/services/agent-studio/repository', () => ({ loadStudioRelease: mocks.release }));
vi.mock('@/services/autopilot/runtime/config-service', () => ({ getAutopilotConfigService: mocks.config }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/ai/flows/procedure-runtime', () => ({ generateProcedureRuntimeOutput: mocks.model }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: mocks.http, executeStudioMcp: vi.fn(), resolveStudioMcpTool: vi.fn() }));
vi.mock('@/services/agent-studio/native-actions', () => ({ executeStudioContactAction: vi.fn() }));
vi.mock('@/services/autopilot/runtime/stale-source-guard', () => ({ assertAutopilotSourceMessageCurrent: mocks.current }));
import { executePublishedStudioNode, stopPublishedStudioNode } from '@/services/agent-studio/workflow-adapter';
import { openStudioSession } from '@/services/agent-studio/session-store';
const agentId = '11111111-1111-4111-8111-111111111111';
const releaseId = '22222222-2222-4222-8222-222222222222';

function release() {
  const document = createDefaultAgentStudioDocument(agentId, 'workspace'); document.concludeStage.handoffTeam = 'Support';
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'invoice', name: 'Fatura', triggerKeywords: ['fatura'], updatedAt: '2026-08-27', steps: [
    { id: 'cpf', order: 1, type: 'collect_data', title: 'CPF', collectField: CollectedFieldDefinitionSchema.parse({ id: 'cpf', name: 'CPF', variableKey: 'cpf', type: 'cpf', promptMessage: 'Qual seu CPF?' }) },
    { id: 'api', order: 2, type: 'http_request', title: 'Consultar', httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consulta', connectionId: 'connection', url: '/invoices' }) },
    { id: 'reply', order: 3, type: 'respond', title: 'Responder', messageText: 'Fatura localizada.' },
  ] })];
  return { agentId, workspaceId: 'workspace', releaseId, version: 1, agentSnapshot: document, publishedProcedures: document.resolveStage.procedures,
    referencedConnectionIds: ['connection'], connectionFingerprints: { connection: 'fingerprint' }, mcpServerToolFingerprints: {}, createdAt: '2026-08-27', runtimeVersion: 'studio-v1' } satisfies AgentReleaseManifest;
}
function graph() {
  const trigger = workflowNode('trigger.manual', 'trigger');
  const agent = workflowNode('ai.published_agent', 'agent-node', { agentId, releaseId, outputKeys: [] });
  return workflowDefinition([trigger, agent], [connect(trigger, 'started', agent, 'main')], { workspaceId: 'workspace' });
}

beforeEach(() => {
  vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'studio-workflow-test-key-isolated');
  vi.resetAllMocks(); const published = release();
  mocks.release.mockImplementation(async (_workspace: string, _agent: string, requested: string) => requested === releaseId ? published : null);
  mocks.config.mockResolvedValue({ config: { id: agentId, workspace_id: 'workspace', is_active: true, ai_model: 'test-model' } });
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM contacts') ? [{ id: 'contact', workspace_id: 'workspace', name: 'Cliente' }] : [] }));
  mocks.http.mockResolvedValue({ values: {} }); mocks.model.mockResolvedValue({ decision: 'invoice' }); mocks.current.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('published agent through the complete normal workflow executor', () => {
  it('waits and resumes at the same node until the fixed release completes', async () => {
    let studioState: any = null; const sent = vi.fn(async () => ({ success: true }));
    const persistence = new InMemoryWorkflowPersistence();
    const handlers = createDefaultNodeHandlerRegistry({ stopPublishedAgent: stopPublishedStudioNode, executePublishedAgent: (input) => {
      // Bind the real adapter to a deterministic isolated session store via its public input effects.
      return executePublishedStudioNode(input, { send: sent, native: vi.fn(async () => {}) });
    } });
    // The adapter imports its store statically, so supply a minimal conversation metadata table through db calls.
    const metadata = new Map<string, any>();
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM contacts')) return { rows: [{ id: 'contact', workspace_id: 'workspace', name: 'Cliente' }] };
      if (sql.includes('WITH saved AS')) { const next = JSON.parse(String(params[3])); metadata.set('state', next); studioState = next; return { rows: [{ chat_id: 'chat' }] }; }
      if (sql.includes("metadata->'agent_studio'")) return { rows: [{ studio: metadata.get('state') || null }] };
      return { rows: [] };
    });
    const executor = new WorkflowExecutor(persistence, handlers);
    let execution = await executor.start({ workflow: graph(), input: { message: 'Quero fatura', sourceMessageId: 'm1' }, context: { sourceMessageId: 'm1' }, conversationId: 'chat' });
    expect(execution.status, JSON.stringify(execution.failure)).toBe('waiting'); expect(execution.currentNodeId).toBe('agent-node'); expect(sent).toHaveBeenLastCalledWith(expect.stringContaining('Qual seu CPF?'));
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { message: '529.982.247-25', sourceMessageId: 'm2' } });
    expect(execution.status).toBe('waiting'); expect(sent).toHaveBeenLastCalledWith(expect.stringContaining('Conseguiu resolver'));
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { message: 'sim', sourceMessageId: 'm3' } });
    expect(execution.status, JSON.stringify({ failure: execution.failure, context: execution.context, replies: sent.mock.calls, stored: { status: studioState.status, phase: studioState.phase } })).toBe('completed'); expect(execution.previousNodeId).toBe('agent-node'); expect(mocks.http).toHaveBeenCalledOnce();
    expect(mocks.release.mock.calls.every((call) => call[2] === releaseId)).toBe(true); expect(studioState.releaseId).toBe(releaseId);
  });
  it('cancels while waiting without executing a pending integration', async () => {
    const persistence = new InMemoryWorkflowPersistence(); const handlers = createDefaultNodeHandlerRegistry({ stopPublishedAgent: stopPublishedStudioNode, executePublishedAgent: (input) => executePublishedStudioNode(input, { send: async () => ({ success: true }), native: async () => {} }) });
    const metadata = new Map<string, any>(); mocks.query.mockImplementation(async (sql: string, params: unknown[]) => sql.includes('FROM contacts') ? { rows: [{ id: 'contact' }] }
      : sql.includes('WITH saved AS') ? (metadata.set('state', JSON.parse(String(params[3]))), { rows: [{ chat_id: 'chat' }] }) : sql.includes("metadata->'agent_studio'") ? { rows: [{ studio: metadata.get('state') || null }] } : { rows: [] });
    const executor = new WorkflowExecutor(persistence, handlers); const waiting = await executor.start({ workflow: graph(), input: { message: 'fatura', sourceMessageId: 'm1' }, context: { sourceMessageId: 'm1' }, conversationId: 'chat' });
    expect(waiting.status, JSON.stringify(waiting.failure)).toBe('waiting');
    expect((await executor.cancel(waiting.executionId, 'Cliente cancelou')).status).toBe('cancelled'); expect(mocks.http).not.toHaveBeenCalled();
    const stopped = openStudioSession({ workspaceId: 'workspace', agentId, chatId: 'chat', contextId: `${waiting.executionId}:agent-node` }, metadata.get('state').encrypted);
    expect(stopped).toMatchObject({ phase: 'done', status: 'cancelled', pendingField: null, confirmation: null });
    expect(stopped.events.at(-1)?.kind).toBe('cancelled');
    await expect(executor.resume({ resumeToken: waiting.resumeToken!, input: { message: '52998224725', sourceMessageId: 'm2' } })).rejects.toThrow();
    const next = await executor.start({ workflow: graph(), input: { message: 'fatura', sourceMessageId: 'new-request' }, conversationId: 'chat' });
    expect(next.status, JSON.stringify(next.failure)).toBe('waiting'); expect(mocks.http).not.toHaveBeenCalled();
  });
  it('expires an unanswered autonomous-agent invocation safely', async () => {
    const metadata = new Map<string, any>();
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM contacts')) return { rows: [{ id: 'contact' }] };
      if (sql.includes('WITH saved AS')) { metadata.set('state', JSON.parse(String(params[3]))); return { rows: [{ chat_id: 'chat' }] }; }
      return { rows: [{ studio: metadata.get('state') || null }] };
    });
    const persistence = new InMemoryWorkflowPersistence();
    const executor = new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry({ stopPublishedAgent: stopPublishedStudioNode,
      executePublishedAgent: (input) => executePublishedStudioNode(input, { send: async () => ({ success: true }), native: async () => {} }),
    }));
    const waiting = await executor.start({ workflow: graph(), input: { message: 'fatura', sourceMessageId: 'm1' }, conversationId: 'chat' });
    expect(waiting.status).toBe('waiting');
    const persisted = (await persistence.getExecution(waiting.executionId))!;
    persisted.nodeResults['agent-node'].output!.expiresAt = '2020-01-01T00:00:00Z';
    await persistence.saveExecution(persisted, persisted.version);
    const expired = await (executor as unknown as { expireTimeWait: (token: string) => Promise<typeof waiting | null> }).expireTimeWait(waiting.resumeToken!);
    expect(expired?.status).toBe('failed');
    expect(expired?.failure?.code).toBe('WAIT_EXPIRED');
    expect(metadata.get('state')).toMatchObject({ phase: 'done', status: 'failed' }); expect(mocks.http).not.toHaveBeenCalled();
  });
});
