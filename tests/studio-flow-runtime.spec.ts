import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowExecutionSchema, type NodeRuntimeInput, type WorkflowNode } from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';
import { studioFlowRelease } from './fixtures/studio-flow-fixture';
import type { StudioFlowState } from '@/services/agent-studio/flow-execution';
import { createStudioFlowState } from '@/services/agent-studio/flow-execution';

const mocks = vi.hoisted(() => ({ load: vi.fn(), query: vi.fn(), model: vi.fn(), prompts: [] as string[], outputs: [] as unknown[], states: new Map<string, unknown>(), send: vi.fn(), http: vi.fn(), mcp: vi.fn(), native: vi.fn(), tools: vi.fn(), loadConnector: vi.fn(), executeConnector: vi.fn(), mcpConfig: vi.fn(), schedule: vi.fn(), notification: vi.fn(), approval: vi.fn(), effect: vi.fn(), httpOperation: vi.fn(), databaseOperation: vi.fn(), whatsapp:vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/services/agent-studio/repository', () => ({ loadStudioRelease: mocks.load }));
vi.mock('@/services/agent-studio/contact-crm', () => ({ loadStudioContactCrm: async () => ({}) }));
vi.mock('@/services/autopilot/runtime/stale-source-guard', () => ({ assertAutopilotSourceMessageCurrent: async () => {} }));
vi.mock('@/services/workflow-runtime/autopilot-primary', () => ({ modelChainForNode: mocks.model }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: mocks.http, executeStudioMcp: mocks.mcp }));
vi.mock('@/services/agent-studio/native-actions', () => ({ executeStudioContactAction: mocks.native }));
vi.mock('@/modules/nexus/services/tool-registry', async (importOriginal) => ({ ...(await importOriginal()), createNexusToolRegistry: mocks.tools }));
vi.mock('@/modules/nexus/services/integration-executors', () => ({ executeNexusDatabaseOperation: mocks.databaseOperation }));
vi.mock('@/modules/nexus/services/connectors', () => ({ loadConnector: mocks.loadConnector, executeConnectorStep: mocks.executeConnector }));
vi.mock('@/services/mcp/store', () => ({ getMcpWorkspaceConfig: mocks.mcpConfig }));
vi.mock('@/modules/nexus/services/agent-scheduler', () => ({ scheduleAgentWorkflow: mocks.schedule }));
vi.mock('@/modules/nexus/services/agent-notification', () => ({ sendAgentNotification: mocks.notification }));
vi.mock('@/modules/nexus/services/automation-approvals', () => ({ requestAutomationApproval: mocks.approval }));
vi.mock('@/modules/nexus/services/durable-effects', () => ({ executeDurableEffect: mocks.effect, nodeInvocationKey: () => 'key' }));
vi.mock('@/modules/nexus/services/http-executor', () => ({ executeNexusHttpOperation: mocks.httpOperation }));
vi.mock('@/modules/nexus/services/whatsapp-agent',()=>({sendWhatsappAgentReply:mocks.whatsapp,readWhatsappAgentHistory:vi.fn(),whatsappReplyJsonSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}));
vi.mock('@/services/agent-studio/flow-store', () => ({ studioFlowInvocationStore: async (scope: { invocationId: string }) => ({ state: mocks.states.has(scope.invocationId) ? structuredClone(mocks.states.get(scope.invocationId)) : undefined, checkpoint: async (state: unknown) => { mocks.states.set(scope.invocationId, structuredClone(state)); } }) }));
import { createStudioFlowNodeExecutor } from '@/services/agent-studio/flow-runtime';

function input(config: Record<string, unknown> = {}): NodeRuntimeInput {
  const release = studioFlowRelease();
  const node = workflowNode('ai.studio_agent', 'agent', { agentId: release.agentId, releaseId: release.releaseId, mode: 'task', outputKey: 'result', ...config });
  const workflow = workflowDefinition([node], [], { workspaceId: release.workspaceId });
  const execution = WorkflowExecutionSchema.parse({ executionId: 'execution', workflowId: workflow.id, workflowVersion: workflow.version, status: 'running', currentNodeId: node.id, previousNodeId: null, pendingNodeIds: [], input: { message: 'Consultar cadastro' }, context: { sourceMessageId: 'm1' }, variables: {}, nodeResults: {}, executionPath: [], totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, startedAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z' });
  return { workflow, node, execution, input: execution.input, attachments: {}, signal: new AbortController().signal, emit: vi.fn(async () => {}) };
}
const runner = () => createStudioFlowNodeExecutor({ config: {} as never, sendResponse: mocks.send, retrieveKnowledge: async () => [], loadMemory: async () => ({}) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.outputs.length = 0; mocks.prompts.length = 0; mocks.states.clear();
  mocks.load.mockResolvedValue(studioFlowRelease()); mocks.query.mockImplementation(async (query: string) => ({ rows: [query.includes('SELECT credential_type, encrypted_payload') ? { credential_type: 'database', encrypted_payload: 'encrypted-fixture' } : { is_active: true }] }));
  mocks.send.mockResolvedValue({ success: true }); mocks.tools.mockReturnValue({ list: () => [] });
  mocks.mcpConfig.mockResolvedValue({ servers: [] });
  mocks.approval.mockReset().mockResolvedValue(null); mocks.effect.mockReset().mockImplementation(async (_workspace, _id, _args, operation) => operation()); mocks.httpOperation.mockResolvedValue({ status: 200, data: { saved: true } });
  mocks.databaseOperation.mockResolvedValue({ operation: 'update', rowCount: 1 });
  mocks.model.mockResolvedValue({ generateStructured: async (request: { schema: { parse: (value: unknown) => unknown }; messages: unknown }) => { mocks.prompts.push(JSON.stringify(request.messages)); return { output: request.schema.parse(mocks.outputs.shift()), selected: { config: { model: 'fixture' } } }; } });
});

describe('Studio flow runtime wiring', () => {
  it('pauses the attached WhatsApp reply for approval before completing the agent task',async()=>{
    mocks.whatsapp.mockReset().mockResolvedValueOnce({status:'waiting',resumeToken:'approve',output:{approvalId:'a',waitingSince:'2026-11-04T10:00:00Z',expiresAt:'2026-11-05T10:00:00Z'}}).mockResolvedValueOnce({status:'success',output:{accepted:true}});
    const request=input();request.execution.conversationId='chat';request.attachments.tool=[workflowNode('tool.whatsapp_reply','whatsapp')];
    mocks.outputs.push({kind:'tool_call',toolName:'reply_whatsapp_business',arguments:{text:'Olá'}},{kind:'completed',data:{answer:'enviado'}});
    const execute=runner();expect((await execute(request)).status).toBe('waiting');expect(mocks.send).not.toHaveBeenCalled();
    expect((await execute(request)).selectedOutput).toBe('completed');expect(mocks.whatsapp).toHaveBeenCalledTimes(2);
  });
  it('rejects model arguments that do not match an attached tool schema', async () => {
    const executeSafely = vi.fn();
    mocks.tools.mockReturnValue({ list: () => [{ name: 'consulta', description: 'Consulta', inputJsonSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }], executeSafely });
    mocks.outputs.push({ kind: 'tool_call', toolName: 'consulta', arguments: { id: 42 } });
    const result = await runner()(input());
    expect(result.error?.message).toContain('contrato da ferramenta');
    expect(executeSafely).not.toHaveBeenCalled();
  });
  it('pauses database writes and resumes the same approved filters and values once', async () => {
    mocks.approval.mockResolvedValueOnce({ status: 'waiting', resumeToken: 'approval-db', output: { approvalId: 'approval', waitingSince: '2026-11-04T10:00:00Z', expiresAt: '2026-11-05T10:00:00Z' } }).mockResolvedValueOnce(null);
    const request = input(); request.attachments.tool = [workflowNode('tool.database', 'write-db', { name: 'update_order', description: 'Atualiza pedido', operation: 'update', table: 'orders', credentialId: 'database-credential', values: { status: '{{arguments.data.status}}' }, inputSchema: { type: 'object', properties: { filter_column: { type: 'string' }, filter_value: { type: 'string' }, data: { type: 'object' } }, required: ['filter_column', 'filter_value', 'data'] } })];
    mocks.outputs.push({ kind: 'tool_call', toolName: 'update_order', arguments: { filter_column: 'id', filter_value: '123', data: { status: 'ready' } } }, { kind: 'completed', data: { answer: 'ok' } });
    const execute = runner(); const pending = await execute(request); expect(pending.error?.message).toBeUndefined(); expect(pending).toMatchObject({ status: 'waiting', waitingReason: 'approval' });
    expect(mocks.databaseOperation).not.toHaveBeenCalled();
    request.execution.variables = { status: 'changed' }; request.execution.input = { id: '456' };
    expect((await execute(request)).selectedOutput).toBe('completed');
    expect(mocks.databaseOperation).toHaveBeenCalledWith(expect.objectContaining({ preResolved: true, runtimeSource: {}, credentialId: 'database-credential', config: expect.objectContaining({ table: 'orders', values: { status: 'ready' }, filters: [{ column: 'id', operator: 'eq', value: '123' }] }) }));
    expect(mocks.approval.mock.calls[0][1]).toEqual(mocks.approval.mock.calls[1][1]);
    await execute(request); expect(mocks.databaseOperation).toHaveBeenCalledOnce();
  });
  it('invalidates a database approval when the workspace credential changes', async () => {
    let encrypted = 'credential-before';
    mocks.query.mockImplementation(async (query: string) => ({ rows: [query.includes('SELECT credential_type, encrypted_payload') ? { credential_type: 'database', encrypted_payload: encrypted } : { is_active: true }] }));
    let approvedFingerprint = '';
    mocks.approval.mockImplementation(async (_input, proposal) => {
      if (!approvedFingerprint) { approvedFingerprint = proposal.credentialFingerprint; return { status: 'waiting', resumeToken: 'approval-db', output: { approvalId: 'approval', waitingSince: '2026-11-04T10:00:00Z', expiresAt: '2026-11-05T10:00:00Z' } }; }
      if (proposal.credentialFingerprint !== approvedFingerprint) throw new Error('Os argumentos mudaram. A autorização anterior não pode ser reutilizada.');
      return null;
    });
    const request = input(); request.attachments.tool = [workflowNode('tool.database', 'write-db', { name: 'update_order', description: 'Atualiza pedido', operation: 'update', table: 'orders', credentialId: 'database-credential', values: { status: 'ready' }, filters: [{ column: 'id', operator: 'eq', value: '123' }] })];
    mocks.outputs.push({ kind: 'tool_call', toolName: 'update_order', arguments: {} });
    const execute = runner(); expect(await execute(request)).toMatchObject({ status: 'waiting', waitingReason: 'approval' });
    encrypted = 'credential-after';
    expect((await execute(request)).error?.message).toContain('argumentos mudaram');
    expect(mocks.databaseOperation).not.toHaveBeenCalled();
  });
  it('waits for approval before a mutating HTTP call and resumes the same arguments once', async () => {
    mocks.approval.mockResolvedValueOnce({ status: 'waiting', resumeToken: 'approval-http', output: { approvalId: 'approval', waitingSince: '2026-11-04T10:00:00Z', expiresAt: '2026-11-05T10:00:00Z' } }).mockResolvedValueOnce(null);
    const request = input();
    request.attachments.tool = [workflowNode('tool.http', 'write-http', { name: 'write_order', description: 'Atualiza pedido', method: 'POST', url: 'https://example.com/order', bodyType: 'json', body: { orderId: '{{arguments.orderId}}' }, inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'], additionalProperties: false } })];
    mocks.outputs.push({ kind: 'tool_call', toolName: 'write_order', arguments: { orderId: '123' } }, { kind: 'completed', data: { answer: 'ok' } });
    const execute = runner();
    expect(await execute(request)).toMatchObject({ status: 'waiting', waitingReason: 'approval', resumeToken: 'approval-http' });
    expect(mocks.httpOperation).not.toHaveBeenCalled();
    request.execution.variables = { orderId: '456' }; request.execution.input = { orderId: '456' };
    expect((await execute(request)).selectedOutput).toBe('completed');
    expect(mocks.httpOperation).toHaveBeenCalledOnce();
    expect(mocks.httpOperation).toHaveBeenCalledWith(expect.objectContaining({ preResolved: true, runtimeSource: {}, config: expect.objectContaining({ body: { orderId: '123' } }) }));
    expect(mocks.approval.mock.calls[0][1]).toEqual(mocks.approval.mock.calls[1][1]);
    expect(mocks.approval.mock.calls[0][3]).toBe(mocks.approval.mock.calls[1][3]);
    await execute(request); expect(mocks.httpOperation).toHaveBeenCalledOnce();
  });
  it.each([['tool.schedule_workflow', 'schedule_workflow', 'schedule'], ['tool.email_notification', 'send_email_notification', 'notification']] as const)('pauses %s for exact approval before completing', async (type, name, method) => {
    mocks[method].mockResolvedValueOnce({ status: 'waiting', resumeToken: 'approval', output: { approvalId: 'approval', waitingSince: '2026-11-04T10:00:00Z', expiresAt: '2026-11-05T10:00:00Z' } });
    const request = input(); request.attachments.tool = [workflowNode(type, 'agent-tool', { name })];
    mocks.outputs.push({ kind: 'tool_call', toolName: name, arguments: { example: 'value' } });
    const result = await runner()(request);
    expect(result).toMatchObject({ status: 'waiting', waitingReason: 'approval', resumeToken: 'approval' });
    expect(mocks[method]).toHaveBeenCalledOnce();
  });
  it('does not offer a disconnected MCP capability or its in-session observations to the model', async () => {
    const name = 'mcp:inactive:calendar';
    mocks.tools.mockReturnValue({ list: () => [{ name, description: 'Agenda', inputJsonSchema: {} }] });
    const request = input(); request.attachments.tool = [workflowNode('tool.mcp', 'mcp', { name, description: 'Agenda' })];
    const state = createStudioFlowState(studioFlowRelease().releaseId);
    state.observations.push({ name, observedAt: new Date().toISOString(), result: { status: 'completed', response: '', data: { private: 'old-calendar' } } });
    mocks.states.set('execution:agent:visit:0', state);
    mocks.outputs.push({ kind: 'completed', data: { answer: 'ok' } });
    expect((await runner()(request)).selectedOutput).toBe('completed');
    expect(mocks.prompts.join('')).not.toContain(name);
    expect(mocks.prompts.join('')).not.toContain('old-calendar');
  });
  it('registers each connector exactly once through its approval-aware executor', async () => {
    mocks.loadConnector.mockResolvedValue({ name: 'Consulta', description: 'Consulta', inputSchema: { type: 'object' }, http: {} });
    mocks.executeConnector.mockResolvedValue({ status: 'success', output: { value: 'ok' } });
    const request = input(); const connector = workflowNode('tool.connector', 'connector', { connectorId: 'c', version: 1, name: 'consulta' });
    request.attachments.tool = [connector];
    mocks.outputs.push({ kind: 'tool_call', toolName: 'consulta', arguments: {} }, { kind: 'completed', data: { answer: 'ok' } });
    expect((await runner()(request)).selectedOutput).toBe('completed');
    expect(mocks.executeConnector).toHaveBeenCalledOnce();
    expect(mocks.tools).toHaveBeenCalledWith(expect.objectContaining({ toolNodes: [] }));
  });
  it('executes a task without a chat, returning data to the graph and never delivering a message', async () => {
    mocks.outputs.push({ kind: 'completed', response: 'Pronto', data: { answer: 'confirmado' } });
    const result = await runner()(input());
    expect(result).toMatchObject({ status: 'route', selectedOutput: 'completed', statePatch: { result: { answer: 'confirmado' } }, metrics: { modelCalls: 1 } });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled();
  });
  it('does not pass unmapped workflow data through task messages or template expressions', async () => {
    const request = input({ task: 'Classifique {{input.hidden}}', inputMappings: [{ inputKey: 'request', sourceType: 'input', sourcePath: 'allowed' }] });
    request.execution.input = { hidden: 'private-unmapped-data', message: 'private-unmapped-message', allowed: 'pedido público' };
    request.input = request.execution.input;
    mocks.outputs.push({ kind: 'completed', data: { answer: 'classificado' } });
    expect((await runner()(request)).selectedOutput).toBe('completed');
    expect(mocks.prompts.join('')).toContain('pedido público');
    expect(mocks.prompts.join('')).not.toContain('private-unmapped');
  });
  it('rejects conversation mode without a real conversation before generating', async () => {
    expect(await runner()(input({ mode: 'conversation' }))).toMatchObject({ status: 'error', error: { message: expect.stringContaining('atendimento ativo') } });
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('waits, resumes and delivers each response once even if the same message is replayed', async () => {
    mocks.outputs.push({ kind: 'needs_input', response: 'Qual assunto?', data: {} }, { kind: 'completed', response: 'Resolvido.', data: { answer: 'financeiro' } });
    const request = input({ mode: 'conversation' }); request.execution.conversationId = 'chat';
    const execute = runner();
    expect((await execute(request)).status).toBe('waiting'); expect((await execute(request)).status).toBe('waiting');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    request.execution.context.__resumeInput = { sourceMessageId: 'm2', message: 'Financeiro' };
    request.execution.context.sourceMessageId = 'm2';
    expect(await execute(request)).toMatchObject({ status: 'route', selectedOutput: 'completed' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect((mocks.states.values().next().value as StudioFlowState).modelCalls).toBe(2);
  });
  it('isolates reentry into the same node in a loop from a previous completed invocation', async () => {
    mocks.outputs.push({ kind: 'completed', data: { answer: 'primeiro' } }, { kind: 'completed', data: { answer: 'segundo' } });
    const request = input(); const execute = runner();
    expect((await execute(request)).output?.data).toEqual({ answer: 'primeiro' });
    request.execution.executionPath.push({ nodeId: request.node.id, status: 'route' } as NodeRuntimeInput['execution']['executionPath'][number]);
    expect((await execute(request)).output?.data).toEqual({ answer: 'segundo' }); expect(mocks.states.size).toBe(2);
  });
  it('does not resend an unconfirmed delivery', async () => {
    mocks.outputs.push({ kind: 'completed', response: 'Resposta', data: { answer: 'resultado' } }); mocks.send.mockResolvedValueOnce({ success: false });
    const request = input({ mode: 'conversation' }); request.execution.conversationId = 'chat'; const execute = runner();
    expect((await execute(request)).status).toBe('error'); expect((await execute(request)).status).toBe('error'); expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('supports specialist delegation and shares the parent model budget', async () => {
    const parent = studioFlowRelease(), child = studioFlowRelease();
    child.agentId = '20000000-0000-4000-8000-000000000002'; child.agentSnapshot.id = child.agentId; child.releaseId = '20000000-0000-4000-8000-000000000003';
    mocks.load.mockImplementation(async (_workspace: string, id: string) => id === parent.agentId ? parent : child);
    mocks.outputs.push({ kind: 'tool_call', toolName: 'especialista', arguments: {} }, { kind: 'completed', data: { answer: 'especialista confirmou' } }, { kind: 'completed', data: { answer: 'resultado final' } });
    const request = input(); const specialist = workflowNode('tool.studio_agent', 'specialist', { agentId: child.agentId, releaseId: child.releaseId, name: 'especialista', description: 'Consultar financeiro' });
    request.attachments.tool = [specialist]; request.workflow.nodes.push(specialist);
    request.workflow.connections.push(connect(specialist, 'tool', request.node, 'tools', 'tool'));
    const result = await runner()(request);
    expect(result).toMatchObject({ selectedOutput: 'completed', metrics: { modelCalls: 3, toolCalls: 1 } }); expect(mocks.states.size).toBe(2); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('prevents a specialist from bypassing the root budget', async () => {
    const parent = studioFlowRelease(), child = studioFlowRelease(); parent.flowContract!.maxModelCalls = 2;
    child.agentId = '20000000-0000-4000-8000-000000000002'; child.agentSnapshot.id = child.agentId; child.releaseId = '20000000-0000-4000-8000-000000000003';
    mocks.load.mockImplementation(async (_workspace: string, id: string) => id === parent.agentId ? parent : child);
    mocks.outputs.push({ kind: 'tool_call', toolName: 'especialista', arguments: {} }, { kind: 'completed', data: { answer: 'especialista' } });
    const request = input(); request.attachments.tool = [workflowNode('tool.studio_agent', 'specialist', { agentId: child.agentId, releaseId: child.releaseId, name: 'especialista' })];
    expect(await runner()(request)).toMatchObject({ selectedOutput: 'limit_reached', metrics: { modelCalls: 2 } });
  });
  it('keeps internal skill responses with the coordinator and delivers only the final main-agent response', async () => {
    const request = input({ mode: 'conversation' }); request.execution.conversationId = 'chat';
    mocks.outputs.push({ kind: 'tool_call', toolName: 'studio_procedure_0', arguments: {} }, { kind: 'completed', response: 'Resposta do agente principal', data: { answer: 'resultado' } });
    mocks.http.mockResolvedValue({ values: { answer: 'confirmado' } });
    expect((await runner()(request)).selectedOutput).toBe('completed');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0]).toBe('Resposta do agente principal');
  });
  it('cancels a delegated call and blocks an uncertain effect from being invoked again', async () => {
    const request = input(); const controller = new AbortController(); request.signal = controller.signal;
    mocks.outputs.push({ kind: 'tool_call', toolName: 'studio_procedure_0', arguments: {} });
    mocks.http.mockImplementationOnce(async () => { controller.abort(); return { values: { answer: 'late' } }; });
    expect((await runner()(request)).error?.code).toBe('STUDIO_FLOW_CANCELLED');
    request.signal = new AbortController().signal;
    expect((await runner()(request)).error?.message).toContain('sem resultado confirmado');
    expect(mocks.http).toHaveBeenCalledTimes(1);
  });
  it('marks declared sensitive input and output paths for debugger redaction without changing operational data', async () => {
    const release = studioFlowRelease(); release.flowContract!.inputs[0].sensitive = true; release.flowContract!.outputs[0].sensitive = true; mocks.load.mockResolvedValue(release);
    mocks.outputs.push({ kind: 'completed', response: 'Resposta', data: { answer: 'private' } });
    const request = input({ inputMappings: [{ inputKey: 'request', sourceType: 'input', sourcePath: 'message' }] });
    const result = await runner()(request);
    expect(result.sensitiveData).toMatchObject({ initialInputPaths: ['message'] });
    expect(result.statePatch).toMatchObject({ result: { answer: 'private' }, __studioSensitivePaths: ['result.answer'] });
    expect(result.output?.__studioSensitivePaths).toContain('data.answer');
  });
  it('rejects unauthorized extensions and circular delegation', async () => {
    const release = studioFlowRelease(); release.flowContract!.extensions = []; mocks.load.mockResolvedValueOnce(release);
    const request = input(); request.attachments.tool = [workflowNode('tool.http', 'http', { name: 'http' })];
    expect((await runner()(request)).error?.message).toContain('não autoriza');
    mocks.outputs.push({ kind: 'tool_call', toolName: 'self', arguments: {} });
    request.attachments.tool = [workflowNode('tool.studio_agent', 'self', { agentId: release.agentId, releaseId: release.releaseId, name: 'self' })];
    expect((await runner()(request)).error?.message).toContain('circular');
  });
  it('simulates a published skill using an explicit fixture and blocks real external adapters', async () => {
    const request = input(); request.node.type = 'integration.studio_procedure'; request.node.config.procedureId = 'consulta'; request.execution.context.sandbox = true;
    request.execution.context.studioFixtures = { api: { output: { answer: 'fixture' } } };
    expect(await runner()(request)).toMatchObject({ selectedOutput: 'completed', output: { data: { answer: 'fixture' } } });
    expect(mocks.http).not.toHaveBeenCalled(); expect(mocks.mcp).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('refuses paused or unavailable published agents', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ is_active: false }] });
    expect((await runner()(input())).error?.message).toContain('pausado'); expect(mocks.model).not.toHaveBeenCalled();
  });
  it('returns missing task input as a route without premature execution-waiting or node-completed events', async () => {
    const release = studioFlowRelease(); release.flowContract!.inputs[0].required = true; mocks.load.mockResolvedValue(release);
    const request = input();
    expect(await runner()(request)).toMatchObject({ status: 'route', selectedOutput: 'needs_input' });
    expect(vi.mocked(request.emit).mock.calls.map(([event]) => event.type)).not.toContain('execution.waiting');
    expect(vi.mocked(request.emit).mock.calls.map(([event]) => event.type)).not.toContain('node.completed');
  });
  it('passes typed subflow arguments and remaining budgets, accounting for child usage', async () => {
    const request = input();
    request.attachments.tool = [workflowNode('tool.subflow', 'subflow', { name: 'consultar', description: 'Consultar', workflowId: 'target', inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } }, outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } } })];
    mocks.outputs.push({ kind: 'tool_call', toolName: 'consultar', arguments: { code: '123' } }, { kind: 'completed', data: { answer: 'feito' } });
    const executeSubflow = vi.fn(async (_input: NodeRuntimeInput) => ({ output: { answer: 'confirmado' }, metrics: { modelCalls: 1, toolCalls: 2 } }));
    const execute = createStudioFlowNodeExecutor({ config: {} as never, sendResponse: mocks.send, retrieveKnowledge: async () => [], loadMemory: async () => ({}), executeSubflow });
    expect(await execute(request)).toMatchObject({ selectedOutput: 'completed', metrics: { modelCalls: 3, toolCalls: 3 } });
    expect(executeSubflow.mock.calls[0][0]).toMatchObject({ input: { code: '123' }, execution: { context: { studioBudgetRemaining: { modelCalls: 7, toolCalls: 19 } } } });
  });
  it('rejects incompatible subflow output before the main agent can declare success', async () => {
    const request = input(); request.attachments.tool = [workflowNode('tool.subflow', 'subflow', { name: 'consultar', workflowId: 'target', outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } } })];
    mocks.outputs.push({ kind: 'tool_call', toolName: 'consultar', arguments: {} });
    const execute = createStudioFlowNodeExecutor({ config: {} as never, sendResponse: mocks.send, retrieveKnowledge: async () => [], loadMemory: async () => ({}), executeSubflow: async () => ({ output: { answer: 123 } }) });
    expect((await execute(request)).status).toBe('error');
  });
});
