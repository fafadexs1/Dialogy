import { createWorkflowNode, getWorkflowNodeManifest } from './catalog';
import type {
  ModelConfiguration,
  WorkflowConnection,
  WorkflowNode,
} from './types';

type WorkflowGraphParts = {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
};

function defaultId() {
  return globalThis.crypto.randomUUID();
}

export function createPrivateAgentResourceBundle(input: {
  agent: WorkflowNode;
  position: { x: number; y: number };
  model: ModelConfiguration;
  createId?: () => string;
}): WorkflowGraphParts {
  const createId = input.createId || defaultId;
  const specifications = [
    {
      type: 'ai.model',
      connectionType: 'model',
      y: input.position.y - 110,
      config: input.model,
    },
    {
      type: 'knowledge.rag_retriever',
      connectionType: 'knowledge',
      y: input.position.y + 20,
      config: {},
    },
    {
      type: 'memory.session',
      connectionType: 'memory',
      y: input.position.y + 150,
      config: {},
    },
    {
      type: 'guardrail.policy',
      connectionType: 'guardrail',
      y: input.position.y + 280,
      config: { name: 'Políticas da automação', checks: [], onViolation: 'route_to_error' },
    },
  ] as const;

  const nodes: WorkflowNode[] = [];
  const connections: WorkflowConnection[] = [];
  for (const specification of specifications) {
    const attachment = createWorkflowNode(specification.type, {
      id: `${specification.type.replace('.', '_')}_${createId()}`,
      position: { x: input.position.x - 290, y: specification.y },
      config: specification.config,
    });
    const sourcePort = attachment.outputPorts.find((port) => port.connectionType === specification.connectionType);
    const targetPort = input.agent.inputPorts.find((port) => port.connectionType === specification.connectionType);
    if (!sourcePort || !targetPort) {
      throw new Error(`Não foi possível anexar ${specification.connectionType} ao agente ${input.agent.id}.`);
    }
    nodes.push(attachment);
    connections.push({
      id: `conn_${createId()}`,
      sourceNodeId: attachment.id,
      sourcePortId: sourcePort.id,
      targetNodeId: input.agent.id,
      targetPortId: targetPort.id,
      connectionType: specification.connectionType,
    });
  }
  return { nodes, connections };
}

export function pruneOrphanedWorkflowAttachments(input: WorkflowGraphParts & {
  candidateNodeIds: Iterable<string>;
}): WorkflowGraphParts {
  const candidates = new Set(input.candidateNodeIds);
  const stillConnected = new Set(input.connections.map((connection) => connection.sourceNodeId));
  const removed = new Set(input.nodes
    .filter((node) => (
      candidates.has(node.id)
      && getWorkflowNodeManifest(node.type)?.attachment === true
      && !stillConnected.has(node.id)
    ))
    .map((node) => node.id));
  if (removed.size === 0) return { nodes: input.nodes, connections: input.connections };
  return {
    nodes: input.nodes.filter((node) => !removed.has(node.id)),
    connections: input.connections.filter((connection) => (
      !removed.has(connection.sourceNodeId) && !removed.has(connection.targetNodeId)
    )),
  };
}

export function detachWorkflowConnectionsAndPrune(input: WorkflowGraphParts & {
  shouldDetach: (connection: WorkflowConnection) => boolean;
}): WorkflowGraphParts {
  const detached = input.connections.filter(input.shouldDetach);
  const connections = input.connections.filter((connection) => !input.shouldDetach(connection));
  return pruneOrphanedWorkflowAttachments({
    nodes: input.nodes,
    connections,
    candidateNodeIds: detached.map((connection) => connection.sourceNodeId),
  });
}

export function deleteWorkflowNodesAndPrivateAttachments(input: WorkflowGraphParts & {
  nodeIds: Iterable<string>;
}): WorkflowGraphParts {
  const removedNodeIds = new Set(input.nodeIds);
  const privateAttachmentCandidates = input.connections
    .filter((connection) => removedNodeIds.has(connection.targetNodeId))
    .map((connection) => connection.sourceNodeId);
  const nodes = input.nodes.filter((node) => !removedNodeIds.has(node.id));
  const connections = input.connections.filter((connection) => (
    !removedNodeIds.has(connection.sourceNodeId) && !removedNodeIds.has(connection.targetNodeId)
  ));
  return pruneOrphanedWorkflowAttachments({
    nodes,
    connections,
    candidateNodeIds: privateAttachmentCandidates,
  });
}
