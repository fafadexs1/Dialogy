import { describe, expect, it, vi } from 'vitest';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { connect, workflowDefinition } from './workflow-runtime-fixtures';

describe('toolbox continuity and reference workflows', () => {
  it('resumes an opted-in wait with a new executor after its active timeout', async () => {
    const start = createWorkflowNode('trigger.manual', { id: 'start', position: { x: 0, y: 0 } });
    const wait = createWorkflowNode('logic.wait', { id: 'wait', position: { x: 0, y: 0 }, config: { mode: 'event', resumeEvent: 'payment_confirmed', pauseTimeoutWhileWaiting: true } });
    const end = createWorkflowNode('output.end', { id: 'end', position: { x: 0, y: 0 } });
    const workflow = workflowDefinition([start, wait, end], [connect(start, 'started', wait, 'main'), connect(wait, 'resumed', end, 'main')]);
    const persistence = new InMemoryWorkflowPersistence();
    const first = await new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry()).start({ workflow, input: {} });
    expect(first.status).toBe('waiting');
    const later = Date.now() + workflow.settings.executionTimeoutMs + 1000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      const resumed = await new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry()).resume({ resumeToken: first.resumeToken!, input: { confirmed: true } });
      expect(resumed.status).toBe('completed');
      expect(Number(resumed.context.__automationPausedMs)).toBeGreaterThan(workflow.settings.executionTimeoutMs);
    } finally { now.mockRestore(); }
  });
  it('bounds regular expressions and returns individual captures', async () => {
    const handler = createDefaultNodeHandlerRegistry().get('data.operation')!;
    const node = createWorkflowNode('data.operation', { id: 'regex', position: { x: 0, y: 0 }, config: { operation: 'regex', source: 'Plano: 500; preço: 149', pattern: '(\\d+)' } });
    const input = { node, workflow: workflowDefinition([node], []), execution: { variables: {}, input: {}, context: {}, nodeResults: {} }, input: {}, attachments: {}, signal: new AbortController().signal };
    const result = await handler.execute(input as Parameters<typeof handler.execute>[0]);
    expect(result.output?.result).toEqual([{ match: '500', groups: ['500'], named: {} }, { match: '149', groups: ['149'], named: {} }]);
    node.config.source = 'a'.repeat(30000) + '!'; node.config.pattern = '(a+)+$';
    await expect(handler.execute(input as Parameters<typeof handler.execute>[0])).rejects.toThrow('timed out');
  });
  it('expires an explicit customer-message wait after restart without an incoming message', async () => {
    const start = createWorkflowNode('trigger.manual', { id: 'start', position: { x: 0, y: 0 } });
    const wait = createWorkflowNode('logic.wait', { id: 'wait', position: { x: 0, y: 0 }, config: { mode: 'message', expireEvents: true, timeoutMs: 100, pauseTimeoutWhileWaiting: true } });
    const end = createWorkflowNode('output.end', { id: 'end', position: { x: 0, y: 0 } });
    const workflow = workflowDefinition([start, wait, end], [connect(start, 'started', wait, 'main'), connect(wait, 'resumed', end, 'main'), connect(wait, 'expired', end, 'main')]);
    expect(validateWorkflowDefinition(workflow).valid).toBe(true);
    const persistence = new InMemoryWorkflowPersistence();
    const waiting = await new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry()).start({ workflow, input: {} });
    expect(waiting.waitingReason).toBe('message');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);
    try {
      const completed = await new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry()).runExecution(waiting.executionId);
      expect(completed.status).toBe('completed');
      expect(completed.nodeResults.wait?.selectedOutput).toBe('expired');
    } finally { clock.mockRestore(); }
  });
  it.each(['sales', 'sales_webhook'] as const)('creates an editable %s draft with valid ports and mandatory setup', template => {
    const definition = createStandaloneNexusWorkflow({ id: 'sales-fixture', workspaceId: '40000000-0000-4000-8000-000000000001', name: 'Vendas', template });
    expect(definition.status).toBe('draft');
    const validation = validateWorkflowDefinition(definition);
    expect(validation.errors.filter(issue => /port|connection.*invalid|cycle/i.test(issue.code))).toEqual([]);
    expect(validation.valid).toBe(false);
    expect(definition.metadata?.automationReference).toMatchObject({ homologatedWithRealProviders: false });
    expect(definition.nodes.map(node => node.type)).toEqual(expect.arrayContaining(['logic.switch', 'audio.transcribe', 'ai.studio_agent', 'logic.approval', 'audio.elevenlabs', 'output.media', 'dialogy.crm_update', 'logic.wait']));
    expect(definition.metadata?.flowBuilderUi).toMatchObject({ version: 1 });
  });
});
