import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ToolRegistry,
  WorkflowExecutionSchema,
} from '@/services/workflow-runtime';
import {
  linearWorkflow,
  workflowNode,
} from './workflow-runtime-fixtures';

function toolContext(registry: ToolRegistry, input: Record<string, unknown>) {
  const workflow = linearWorkflow();
  const node = workflowNode('ai.agent', 'agent', {
    objective: 'test',
    completionCriteria: ['test'],
  });
  const execution = WorkflowExecutionSchema.parse({
    executionId: 'exec-tool',
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    status: 'running',
    currentNodeId: node.id,
    previousNodeId: null,
    pendingNodeIds: [],
    input: {},
    variables: {},
    context: {},
    nodeResults: {},
    executionPath: [],
    startedAt: '2026-07-02T12:00:00.000Z',
    updatedAt: '2026-07-02T12:00:00.000Z',
    totalSteps: 0,
    totalModelCalls: 0,
    totalToolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    version: 0,
  });
  return registry.executeSafely({
    toolName: 'test_tool',
    arguments: input,
    purposeSummary: 'Test the tool.',
    execution,
    workflow,
    node,
    signal: new AbortController().signal,
    emit: async () => undefined,
  });
}

function registerTool(
  execute: (input: { value: string }) => Promise<{ value: string }>,
  options: {
    attempts?: number;
    timeoutMs?: number;
    idempotent?: boolean;
  } = {},
  permission: ConstructorParameters<typeof ToolRegistry>[0] = () => true,
) {
  const registry = new ToolRegistry(permission);
  registry.register({
    name: 'test_tool',
    description: 'A test tool.',
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    timeoutMs: options.timeoutMs || 100,
    retryPolicy: {
      maxAttempts: options.attempts || 1,
      initialDelayMs: 0,
      backoffMultiplier: 2,
      maxDelayMs: 5,
      retryableErrorCodes: ['TEMPORARY'],
    },
    idempotent: options.idempotent ?? false,
    riskLevel: 'low',
    requiresConfirmation: false,
    execute,
  });
  return registry;
}

describe('safe tool runtime', () => {
  it('retries a temporary failure', async () => {
    let calls = 0;
    const registry = registerTool(async ({ value }) => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('temporary'), {
          code: 'TEMPORARY',
          retryable: true,
        });
      }
      return { value };
    }, { attempts: 2 });
    const result = await toolContext(registry, { value: 'ok' });
    expect(result.record.status).toBe('success');
    expect(calls).toBe(2);
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    const registry = registerTool(async () => {
      calls += 1;
      throw Object.assign(new Error('permanent'), {
        code: 'PERMANENT',
        retryable: false,
      });
    }, { attempts: 3 });
    const result = await toolContext(registry, { value: 'x' });
    expect(result.record.status).toBe('error');
    expect(calls).toBe(1);
  });

  it('times out a hanging tool', async () => {
    const registry = registerTool(
      async () => new Promise(() => undefined),
      { timeoutMs: 10 },
    );
    const result = await toolContext(registry, { value: 'x' });
    expect(result.record.status).toBe('error');
    expect(result.record.error?.code).toBe('TOOL_TIMEOUT');
  });

  it('rejects invalid tool output', async () => {
    const registry = registerTool(async () => ({ invalid: true } as never));
    const result = await toolContext(registry, { value: 'x' });
    expect(result.record.status).toBe('error');
  });

  it('rejects execution when permission is denied', async () => {
    const registry = registerTool(async ({ value }) => ({ value }), {}, () => false);
    const result = await toolContext(registry, { value: 'x' });
    expect(result.record.status).toBe('rejected');
    expect(result.record.error?.code).toBe('TOOL_PERMISSION_DENIED');
  });

  it('deduplicates idempotent calls with the same arguments', async () => {
    let calls = 0;
    const registry = registerTool(async ({ value }) => {
      calls += 1;
      return { value };
    }, { idempotent: true });
    const first = await toolContext(registry, { value: 'same' });
    const second = await toolContext(registry, { value: 'same' });
    expect(first.record.status).toBe('success');
    expect(second.record.status).toBe('success');
    expect(calls).toBe(1);
  });
});

