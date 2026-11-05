export type WorkflowDebugNodeState =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'skipped'
  | 'cancelled'
  | 'thinking'
  | 'running_tool'
  | 'completed'
  | 'waiting'
  | 'failed';

export type WorkflowDebugEventLike = {
  sequence: number;
  type: string;
  nodeId?: string;
};

export type WorkflowDebugExecutionLike = {
  status: string;
  currentNodeId?: string | null;
  nodeResults?: Record<string, Record<string, unknown>>;
  executionPath?: Array<Record<string, unknown> & { nodeId?: string }>;
};

/**
 * Projects the sanitized event stream into the latest visible state of each
 * canvas node. Events without a node id never leak execution-wide state into
 * unrelated blocks.
 */
export function deriveWorkflowDebugNodeStates(
  execution: WorkflowDebugExecutionLike,
  events: WorkflowDebugEventLike[],
): Record<string, WorkflowDebugNodeState> {
  const states: Record<string, WorkflowDebugNodeState> = {};
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);

  for (const event of ordered) {
    if (!event.nodeId) continue;
    if (event.type === 'node.queued') states[event.nodeId] = 'queued';
    else if (event.type === 'node.started') states[event.nodeId] = 'running';
    else if (event.type === 'node.retrying') states[event.nodeId] = 'retrying';
    else if (event.type === 'agent.thinking.started') states[event.nodeId] = 'thinking';
    else if (event.type === 'tool.requested' || event.type === 'tool.started') states[event.nodeId] = 'running_tool';
    else if (event.type === 'node.completed') states[event.nodeId] = 'completed';
    else if (event.type === 'node.failed' || event.type === 'tool.failed' || event.type === 'tool.rejected') states[event.nodeId] = 'failed';
  }

  // A skipped result is evidence; an unvisited branch alone is not.
  for (const [nodeId, result] of Object.entries(execution.nodeResults || {})) {
    if (result.status === 'skipped' && (!states[nodeId] || states[nodeId] === 'completed')) states[nodeId] = 'skipped';
  }

  const currentNodeId = execution.currentNodeId || undefined;
  if (currentNodeId && execution.status === 'waiting') states[currentNodeId] = 'waiting';
  if (currentNodeId && execution.status === 'failed') states[currentNodeId] = 'failed';
  if (currentNodeId && execution.status === 'cancelled' && !['completed', 'skipped', 'failed'].includes(states[currentNodeId])) states[currentNodeId] = 'cancelled';
  return states;
}

/** Only explicit output selections in the recorded path identify traversed edges. */
export function confirmedWorkflowExecutionEdges(execution: WorkflowDebugExecutionLike, connections: Array<{ id: string; sourceNodeId: string; sourcePortId: string; targetNodeId: string }>): Set<string> {
  const confirmed = new Set<string>();
  const path = execution.executionPath || [];
  for (let index = 0; index < path.length; index++) {
    const step = path[index];
    if (!step.nodeId || typeof step.selectedOutput !== 'string') continue;
    const next = path[index + 1];
    for (const connection of connections) {
      if (connection.sourceNodeId === step.nodeId && connection.sourcePortId === step.selectedOutput && connection.targetNodeId === next?.nodeId) confirmed.add(connection.id);
    }
  }
  return confirmed;
}

