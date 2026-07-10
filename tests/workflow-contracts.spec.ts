import { describe, expect, it } from 'vitest';
import {
  AgentDecisionSchema,
  NodeExecutionResultSchema,
  WorkflowDefinitionSchema,
  createWorkflowNode,
  listWorkflowNodeManifests,
  redactWorkflowValue,
} from '@/services/workflow-runtime';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime';
import { linearWorkflow } from './workflow-runtime-fixtures';

describe('workflow runtime contracts', () => {
  it('keeps published workflow definitions immutable', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const definition = linearWorkflow();
    await persistence.saveWorkflowDefinition(definition);
    await expect(persistence.saveWorkflowDefinition({ ...definition, name: 'Changed' }))
      .rejects.toThrow('immutable');
  });
  it('redacts sensitive debugger values recursively', () => {
    expect(redactWorkflowValue({
      nested: { password: 'secret', apiKey: 'key' },
      safe: 'visible',
    })).toEqual({
      nested: { password: '[REDACTED]', apiKey: '[REDACTED]' },
      safe: 'visible',
    });
  });
  it('accepts a valid universal workflow definition', () => {
    expect(WorkflowDefinitionSchema.parse(linearWorkflow()).nodes).toHaveLength(2);
  });

  it('requires a resume token for waiting results', () => {
    expect(NodeExecutionResultSchema.safeParse({
      status: 'waiting',
      waitingReason: 'user',
    }).success).toBe(false);
  });

  it('requires standardized error details for error results', () => {
    expect(NodeExecutionResultSchema.safeParse({ status: 'error' }).success).toBe(false);
  });

  it('rejects simultaneous single and multiple route selections', () => {
    expect(NodeExecutionResultSchema.safeParse({
      status: 'route',
      selectedOutput: 'a',
      selectedOutputs: ['b'],
    }).success).toBe(false);
  });

  it('accepts every agent decision variant', () => {
    expect(AgentDecisionSchema.parse({
      type: 'tool_call',
      toolName: 'find_customer',
      arguments: { document: '123' },
      purposeSummary: 'Consultar o cadastro.',
    }).type).toBe('tool_call');
    expect(AgentDecisionSchema.parse({
      type: 'final',
      response: 'Concluído.',
      completionStatus: 'completed',
    }).type).toBe('final');
  });

  it('publishes the complete mandatory block catalog', () => {
    const manifests = listWorkflowNodeManifests();
    expect(manifests.length).toBeGreaterThanOrEqual(40);
    expect(manifests.some((item) => item.type === 'ai.agent')).toBe(true);
    expect(manifests.some((item) => item.type === 'tool.mcp')).toBe(true);
    expect(manifests.some((item) => item.type === 'logic.parallel')).toBe(true);
  });

  it('creates independent config and port copies from the catalog', () => {
    const left = createWorkflowNode('ai.agent', {
      id: 'left',
      position: { x: 0, y: 0 },
    });
    const right = createWorkflowNode('ai.agent', {
      id: 'right',
      position: { x: 1, y: 1 },
    });
    left.config.name = 'Changed';
    expect(right.config.name).toBe('Agente');
    expect(left.inputPorts).not.toBe(right.inputPorts);
  });
});
