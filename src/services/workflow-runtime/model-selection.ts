import type { WorkflowDefinition } from './types';

export type WorkflowModelState = {
  ai_model?: string | null;
  workflow_builder_mode?: 'legacy' | 'native_v2' | null;
  workflow_definition?: WorkflowDefinition | null;
};

function modelIdFromNode(node: WorkflowDefinition['nodes'][number] | undefined): string | null {
  const model = node?.config?.model;
  return typeof model === 'string' && model.trim().length > 0 ? model.trim() : null;
}

export function getPrimaryWorkflowAgentId(
  definition: WorkflowDefinition | null | undefined,
): string | null {
  if (!definition) return null;
  const agents = definition.nodes.filter((node) => node.type === 'ai.agent');
  if (agents.length === 0) return null;

  const configuredId = typeof definition.metadata?.primaryAgentId === 'string'
    ? definition.metadata.primaryAgentId.trim()
    : '';
  if (configuredId && agents.some((agent) => agent.id === configuredId)) return configuredId;

  const executableConnections = definition.connections.filter((connection) => (
    connection.connectionType === 'main' || connection.connectionType === 'event'
  ));
  const adjacency = new Map<string, string[]>();
  for (const connection of executableConnections) {
    const targets = adjacency.get(connection.sourceNodeId) || [];
    targets.push(connection.targetNodeId);
    adjacency.set(connection.sourceNodeId, targets);
  }
  const distances = new Map<string, number>();
  const queue = definition.nodes
    .filter((node) => node.type.startsWith('trigger.'))
    .map((node) => ({ id: node.id, distance: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if ((distances.get(current.id) ?? Number.POSITIVE_INFINITY) <= current.distance) continue;
    distances.set(current.id, current.distance);
    for (const targetId of adjacency.get(current.id) || []) {
      queue.push({ id: targetId, distance: current.distance + 1 });
    }
  }

  return [...agents].sort((left, right) => {
    const leftDistance = distances.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightDistance = distances.get(right.id) ?? Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) {
      if (!Number.isFinite(leftDistance)) return 1;
      if (!Number.isFinite(rightDistance)) return -1;
      return leftDistance - rightDistance;
    }
    if (left.position.y !== right.position.y) return left.position.y - right.position.y;
    if (left.position.x !== right.position.x) return left.position.x - right.position.x;
    return left.id.localeCompare(right.id);
  })[0]?.id || null;
}

/**
 * Resolves the workflow's primary model. Prefer the model attachment connected
 * to the first agent because a workflow may also contain auxiliary model nodes.
 */
export function getPrimaryWorkflowModelId(
  definition: WorkflowDefinition | null | undefined,
): string | null {
  if (!definition) return null;

  const primaryAgentId = getPrimaryWorkflowAgentId(definition);
  const primaryAgent = definition.nodes.find((node) => node.id === primaryAgentId);
  if (primaryAgent) {
    const modelConnection = definition.connections.find((connection) => (
      connection.targetNodeId === primaryAgent.id && connection.connectionType === 'model'
    ));
    if (modelConnection) {
      const connectedModel = definition.nodes.find((node) => (
        node.id === modelConnection.sourceNodeId && node.type === 'ai.model'
      ));
      const connectedModelId = modelIdFromNode(connectedModel);
      if (connectedModelId) return connectedModelId;
    }
  }

  return modelIdFromNode(definition.nodes.find((node) => node.type === 'ai.model'));
}

/**
 * Keeps the denormalized `ai_model` column aligned with the authoritative
 * model attachment in a native workflow. Legacy workflows continue to use the
 * stored column because they do not have a native definition to inspect.
 */
export function resolveWorkflowAwareModelId(state: WorkflowModelState): string | null {
  const fallbackModel = typeof state.ai_model === 'string' && state.ai_model.trim().length > 0
    ? state.ai_model.trim()
    : null;

  if (state.workflow_builder_mode !== 'native_v2') return fallbackModel;
  return getPrimaryWorkflowModelId(state.workflow_definition) || fallbackModel;
}

/**
 * Applies the workflow-aware model invariant at persistence and hydration
 * boundaries. Returning the original value when it is already synchronized
 * avoids creating needless React state and database payload churn.
 */
export function synchronizeWorkflowModelState<T extends WorkflowModelState>(state: T): T {
  const resolvedModel = resolveWorkflowAwareModelId(state);
  if ((state.ai_model ?? null) === resolvedModel) return state;
  return { ...state, ai_model: resolvedModel };
}
