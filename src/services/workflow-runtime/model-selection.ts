import type { WorkflowDefinition } from './types';

function modelIdFromNode(node: WorkflowDefinition['nodes'][number] | undefined): string | null {
  const model = node?.config?.model;
  return typeof model === 'string' && model.trim().length > 0 ? model.trim() : null;
}

/**
 * Resolves the workflow's primary model. Prefer the model attachment connected
 * to the first agent because a workflow may also contain auxiliary model nodes.
 */
export function getPrimaryWorkflowModelId(
  definition: WorkflowDefinition | null | undefined,
): string | null {
  if (!definition) return null;

  const primaryAgent = definition.nodes.find((node) => node.type === 'ai.agent');
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
