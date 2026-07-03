import { describe, expect, it } from 'vitest';
import {
  InMemoryWorkflowPersistence,
  WorkflowExecutionLockError,
  WorkflowExecutor,
  WorkflowNodeHandlerRegistry,
  createDefaultNodeHandlerRegistry,
  type NodeHandler,
  type WorkflowExecution,
} from '@/services/workflow-runtime';
import {
  connect,
  linearWorkflow,
  workflowDefinition,
  workflowNode,
} from './workflow-runtime-fixtures';

function runtime(options: { validateBeforeRun?: boolean } = {}) {
  const persistence = new InMemoryWorkflowPersistence();
  const handlers = createDefaultNodeHandlerRegistry({
    sendResponse: async (message) => ({ delivered: true, message }),
    handoff: async () => ({ transferred: true }),
    loadState: async () => ({ loaded: true }),
    saveState: async () => ({ saved: true }),
    executeSubflow: async () => ({ subflow: true }),
  });
  const executor = new WorkflowExecutor(persistence, handlers, options);
  return { persistence, handlers, executor };
}

describe('workflow executor', () => {
  it('executes a linear workflow and persists chronological events', async () => {
    const { executor, persistence } = runtime();
    const execution = await executor.start({
      workflow: linearWorkflow(),
      input: { message: 'hello' },
    });
    expect(execution.status).toBe('completed');
    expect(execution.totalSteps).toBe(2);
    const events = await persistence.listEvents(execution.executionId);
    expect(events.map((event) => event.type)).toEqual([
      'execution.started',
      'node.queued',
      'node.started',
      'node.completed',
      'node.queued',
      'node.started',
      'node.completed',
      'execution.completed',
    ]);
  });

  it.each([
    [true, 'end-true'],
    [false, 'end-false'],
  ])('routes IF input %s deterministically', async (flag, expectedEnd) => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const condition = workflowNode('logic.if', 'if', {
      left: '$.input.flag',
      operator: 'equals',
      right: true,
    });
    const trueEnd = workflowNode('output.end', 'end-true');
    const falseEnd = workflowNode('output.end', 'end-false');
    const workflow = workflowDefinition(
      [trigger, condition, trueEnd, falseEnd],
      [
        connect(trigger, 'started', condition, 'main'),
        connect(condition, 'true', trueEnd, 'main'),
        connect(condition, 'false', falseEnd, 'main'),
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: { flag } });
    expect(execution.previousNodeId).toBe(expectedEnd);
    expect(execution.nodeResults.if?.selectedOutput).toBe(flag ? 'true' : 'false');
  });

  it.each([
    ['commercial', 'commercial'],
    ['unknown', 'default'],
  ])('routes Switch value %s to %s', async (route, expectedOutput) => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const switchNode = workflowNode('logic.switch', 'switch', {
      value: '$.input.route',
      cases: [{ output: 'commercial', operator: 'equals', value: 'commercial' }],
      defaultOutput: 'default',
    });
    switchNode.outputPorts.splice(0, 0, {
      id: 'commercial',
      label: 'Commercial',
      direction: 'output',
      connectionType: 'main',
      required: true,
      multiple: false,
    });
    const commercialEnd = workflowNode('output.end', 'commercial-end');
    const defaultEnd = workflowNode('output.end', 'default-end');
    const workflow = workflowDefinition(
      [trigger, switchNode, commercialEnd, defaultEnd],
      [
        connect(trigger, 'started', switchNode, 'main'),
        connect(switchNode, 'commercial', commercialEnd, 'main'),
        connect(switchNode, 'default', defaultEnd, 'main'),
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: { route } });
    expect(execution.nodeResults.switch?.selectedOutput).toBe(expectedOutput);
  });

  it('retries a temporary node failure and then succeeds', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const custom = workflowNode('data.set', 'retry');
    custom.type = 'custom.retry';
    custom.retryPolicy = {
      maxAttempts: 3,
      initialDelayMs: 0,
      backoffMultiplier: 2,
      maxDelayMs: 10,
      retryableErrorCodes: ['TEMPORARY'],
    };
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, custom, end],
      [
        connect(trigger, 'started', custom, 'main'),
        connect(custom, 'success', end, 'main'),
      ],
    );
    let attempts = 0;
    const handler: NodeHandler = {
      type: 'custom.retry',
      execute: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: 'error',
            error: { code: 'TEMPORARY', message: 'try again', retryable: true },
          };
        }
        return { status: 'success', output: { ok: true } };
      },
    };
    const { executor, handlers } = runtime({ validateBeforeRun: false });
    handlers.register(handler);
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.status).toBe('completed');
    expect(execution.nodeResults.retry?.metrics?.attempts).toBe(2);
  });

  it('routes a permanent failure to the error handler', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const custom = workflowNode('data.set', 'failure');
    custom.type = 'custom.failure';
    custom.outputPorts.push({
      id: 'error',
      label: 'Error',
      direction: 'output',
      connectionType: 'error',
      required: false,
      multiple: false,
    });
    const handlerNode = workflowNode('error.handler', 'handler', { mode: 'recover' });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, custom, handlerNode, end],
      [
        connect(trigger, 'started', custom, 'main'),
        connect(custom, 'error', handlerNode, 'error', 'error'),
        connect(handlerNode, 'recovered', end, 'main'),
      ],
    );
    const { executor, handlers } = runtime({ validateBeforeRun: false });
    handlers.register({
      type: 'custom.failure',
      execute: async () => ({
        status: 'error',
        error: { code: 'PERMANENT', message: 'no retry', retryable: false },
      }),
    });
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.status).toBe('completed');
    expect(execution.nodeResults.handler?.output?.recovered).toBe(true);
  });

  it('persists a waiting execution and resumes it by token', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const wait = workflowNode('logic.wait', 'wait', {
      mode: 'event',
      resumeEvent: 'approval.completed',
      timeoutMs: 5_000,
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, wait, end],
      [
        connect(trigger, 'started', wait, 'main'),
        connect(wait, 'resumed', end, 'main'),
      ],
    );
    const { executor, persistence } = runtime();
    const waiting = await executor.start({ workflow, input: { request: 'approve' } });
    expect(waiting.status).toBe('waiting');
    expect(waiting.resumeToken).toBeTruthy();

    const resumed = await executor.resume({
      resumeToken: waiting.resumeToken!,
      input: { approved: true },
    });
    expect(resumed.status).toBe('completed');
    expect((await persistence.getExecution(waiting.executionId))?.status).toBe('completed');
  });

  it('cancels a persisted waiting execution', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const wait = workflowNode('logic.wait', 'wait', {
      mode: 'event',
      resumeEvent: 'external',
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, wait, end],
      [
        connect(trigger, 'started', wait, 'main'),
        connect(wait, 'resumed', end, 'main'),
      ],
    );
    const { executor } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    const cancelled = await executor.cancel(waiting.executionId, 'test cancellation');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.failure?.code).toBe('EXECUTION_CANCELLED');
  });

  it('prevents two workers from executing the same locked run', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const wait = workflowNode('logic.wait', 'wait', {
      mode: 'event',
      resumeEvent: 'external',
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, wait, end],
      [
        connect(trigger, 'started', wait, 'main'),
        connect(wait, 'resumed', end, 'main'),
      ],
    );
    const { executor, persistence } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    expect(await persistence.acquireExecutionLock(waiting.executionId, 'worker-a', 60_000)).toBeTruthy();
    await expect(executor.runExecution(waiting.executionId, { workerId: 'worker-b' }))
      .rejects.toBeInstanceOf(WorkflowExecutionLockError);
    await persistence.releaseExecutionLock(waiting.executionId, 'worker-a');
  });

  it('executes parallel branches and waits for Merge', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const parallel = workflowNode('logic.parallel', 'parallel', {
      outputs: ['branches'],
      joinMode: 'wait_all',
    });
    const branchA = workflowNode('data.set', 'branch-a', { assignments: { a: 1 } });
    const branchB = workflowNode('data.set', 'branch-b', { assignments: { b: 2 } });
    const merge = workflowNode('logic.merge', 'merge', { mode: 'wait_all' });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, parallel, branchA, branchB, merge, end],
      [
        connect(trigger, 'started', parallel, 'main'),
        connect(parallel, 'branches', branchA, 'main', 'main', 'parallel-a'),
        connect(parallel, 'branches', branchB, 'main', 'main', 'parallel-b'),
        connect(branchA, 'success', merge, 'branches', 'main', 'a-merge'),
        connect(branchB, 'success', merge, 'branches', 'main', 'b-merge'),
        connect(merge, 'success', end, 'main'),
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.status).toBe('completed');
    expect(execution.variables).toMatchObject({ a: 1, b: 2 });
    expect(execution.nodeResults.merge?.output?.branches).toMatchObject({
      'branch-a': { a: 1 },
      'branch-b': { b: 2 },
    });
  });

  it('fails safely when persistence fails after node execution', async () => {
    class FailingPersistence extends InMemoryWorkflowPersistence {
      override async saveExecution(
        execution: WorkflowExecution,
        expectedVersion: number,
      ): Promise<WorkflowExecution> {
        if (execution.totalSteps > 0) throw new Error('storage unavailable');
        return super.saveExecution(execution, expectedVersion);
      }
    }
    const persistence = new FailingPersistence();
    const handlers = createDefaultNodeHandlerRegistry();
    const executor = new WorkflowExecutor(persistence, handlers);
    await expect(executor.start({ workflow: linearWorkflow(), input: {} }))
      .rejects.toThrow('storage unavailable');
  });

  it('enforces the global step limit', async () => {
    const workflow = linearWorkflow();
    workflow.settings.maxSteps = 1;
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.status).toBe('failed');
    expect(execution.failure?.code).toBe('MAX_STEPS_REACHED');
  });

  it('allows deterministic workflows when model, tool, and token budgets are zero', async () => {
    const workflow = linearWorkflow();
    workflow.settings.maxModelCalls = 0;
    workflow.settings.maxToolCalls = 0;
    workflow.settings.maxTotalInputTokens = 0;
    workflow.settings.maxTotalOutputTokens = 0;
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.status).toBe('completed');
    expect(execution.totalModelCalls).toBe(0);
    expect(execution.totalToolCalls).toBe(0);
  });
});

describe('handler registry', () => {
  it('refuses duplicate node handler registration', () => {
    const registry = new WorkflowNodeHandlerRegistry();
    registry.register({ type: 'one', execute: async () => ({ status: 'success' }) });
    expect(() => registry.register({ type: 'one', execute: async () => ({ status: 'success' }) }))
      .toThrow('already registered');
  });
});
