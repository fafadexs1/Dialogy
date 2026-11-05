import { describe, expect, it } from 'vitest';
import { InMemoryWorkflowPersistence, WorkflowExecutor, createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';
import { effectiveWorkflowLimits } from '@/services/workflow-runtime/runtime-limits';
import { markWorkflowSensitivePaths } from '@/services/workflow-runtime/sensitive-data';
import { redactWorkflowValue } from '@/services/workflow-runtime/events';

describe('invocation limits and sensitive data', () => {
  it('can tighten limits, including zero, without weakening or changing published limits', () => {
    const definition = workflowDefinition([], []); const before = structuredClone(definition.settings);
    expect(effectiveWorkflowLimits(definition.settings, { maxModelCalls: 0, maxToolCalls: 10000 }).maxModelCalls).toBe(0);
    expect(effectiveWorkflowLimits(definition.settings, { maxToolCalls: 10000 }).maxToolCalls).toBe(before.maxToolCalls);
    expect(definition.settings).toEqual(before);
  });
  it('persists runtime caps separately and supplies effective limits to handlers', async () => {
    const trigger = workflowNode('trigger.manual', 'start'), agent = workflowNode('ai.studio_agent', 'agent', { agentId: 'agent', releaseId: 'release' }), end = workflowNode('output.end', 'end');
    const definition = workflowDefinition([trigger, agent, end], [connect(trigger, 'started', agent, 'main'), connect(agent, 'completed', end, 'main')]);
    const persistence = new InMemoryWorkflowPersistence(); let actualLimit: number | undefined;
    const executor = new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry({ executeStudioFlow: async ({ workflow }) => { actualLimit = workflow.settings.maxModelCalls; return { status: 'route', selectedOutput: 'completed', metrics: { durationMs: 1, modelCalls: 1 } }; } }));
    const result = await executor.start({ workflow: definition, input: {} }, { limits: { maxModelCalls: 2 } });
    expect(result.status).toBe('completed'); expect(actualLimit).toBe(2);
    expect((await persistence.getWorkflowDefinition(definition.id, definition.version))?.settings.maxModelCalls).toBe(definition.settings.maxModelCalls);
    expect(result.context.__workflowRuntimeCaps).toMatchObject({ maxModelCalls: 2 });
  });
  it('redacts declared nested fields and response echoes without changing operational data', () => {
    const value = markWorkflowSensitivePaths({ data: { client: { code: 'private-123', public: 'keep' } }, response: 'Código private-123' }, ['data.client.code']);
    expect(redactWorkflowValue(value)).toEqual({ data: { client: { code: '[REDACTED]', public: 'keep' } }, response: 'Código [REDACTED]' });
    expect(value.data.client.code).toBe('private-123');
    const malicious = markWorkflowSensitivePaths({ safe: 'keep' }, ['__proto__.polluted']); expect(malicious).toEqual({ safe: 'keep' });
  });
  it('carries sensitive source paths through executor clones and persisted snapshots', async () => {
    const trigger = workflowNode('trigger.manual', 'start'), agent = workflowNode('ai.studio_agent', 'agent', { agentId: 'agent', releaseId: 'release' }), end = workflowNode('output.end', 'end');
    const definition = workflowDefinition([trigger, agent, end], [connect(trigger, 'started', agent, 'main'), connect(agent, 'completed', end, 'main')]);
    const persistence = new InMemoryWorkflowPersistence();
    const executor = new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry({ executeStudioFlow: async () => ({ status: 'route', selectedOutput: 'completed', sensitiveData: { inputPaths: ['message'], initialInputPaths: ['message'], variablePaths: ['cliente.codigo'] }, output: { ok: true } }) }));
    const result = await executor.start({ workflow: definition, input: { message: 'private-message' }, variables: { cliente: { codigo: 'private-code' } } });
    expect(result.input.message).toBe('private-message');
    expect(redactWorkflowValue(result.input)).toMatchObject({ message: '[REDACTED]' });
    expect(redactWorkflowValue(result.variables)).toMatchObject({ cliente: { codigo: '[REDACTED]' } });
    const step = result.executionPath.find((entry) => entry.nodeId === agent.id)!;
    expect(redactWorkflowValue(step.input)).toMatchObject({ message: '[REDACTED]' });
    expect(redactWorkflowValue(step.stateBefore)).toMatchObject({ cliente: { codigo: '[REDACTED]' } });
  });
});
