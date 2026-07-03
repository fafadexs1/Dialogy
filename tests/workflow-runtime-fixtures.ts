import {
  createWorkflowNode,
  type ConnectionType,
  type WorkflowConnection,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@/services/workflow-runtime';

export function workflowNode(
  type: string,
  id: string,
  config: Record<string, unknown> = {},
  position = { x: 0, y: 0 },
): WorkflowNode {
  return createWorkflowNode(type, {
    id,
    name: id,
    position,
    config,
  });
}

export function connect(
  source: WorkflowNode,
  sourcePortId: string,
  target: WorkflowNode,
  targetPortId: string,
  connectionType: ConnectionType = 'main',
  id = `${source.id}_${sourcePortId}_${target.id}_${targetPortId}`,
): WorkflowConnection {
  return {
    id,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    connectionType,
  };
}

export function workflowDefinition(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  const timestamp = '2026-07-02T12:00:00.000Z';
  return {
    id: overrides.id || 'workflow-test',
    name: overrides.name || 'Workflow test',
    version: overrides.version || '1.0.0',
    status: overrides.status || 'published',
    nodes,
    connections,
    settings: overrides.settings || {
      executionTimeoutMs: 30_000,
      maxSteps: 100,
      maxModelCalls: 15,
      maxToolCalls: 20,
      maxAgentTurnsPerNode: 8,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 100_000,
      maxTotalOutputTokens: 20_000,
      concurrencyLimit: 1,
    },
    inputSchema: overrides.inputSchema,
    outputSchema: overrides.outputSchema,
    metadata: overrides.metadata,
    workspaceId: overrides.workspaceId,
    createdAt: overrides.createdAt || timestamp,
    updatedAt: overrides.updatedAt || timestamp,
  };
}

export function linearWorkflow() {
  const trigger = workflowNode('trigger.manual', 'trigger');
  const end = workflowNode('output.end', 'end', { output: { ok: true } }, { x: 0, y: 200 });
  return workflowDefinition(
    [trigger, end],
    [connect(trigger, 'started', end, 'main')],
  );
}

