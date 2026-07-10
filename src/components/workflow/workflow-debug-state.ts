export type WorkflowDebugNodeState =
  | 'queued'
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
    else if (event.type === 'agent.thinking.started') states[event.nodeId] = 'thinking';
    else if (event.type === 'tool.requested' || event.type === 'tool.started') states[event.nodeId] = 'running_tool';
    else if (event.type === 'node.completed') states[event.nodeId] = 'completed';
    else if (event.type === 'node.failed' || event.type === 'tool.failed' || event.type === 'tool.rejected') states[event.nodeId] = 'failed';
  }

  const currentNodeId = execution.currentNodeId || undefined;
  if (currentNodeId && execution.status === 'waiting') states[currentNodeId] = 'waiting';
  if (currentNodeId && execution.status === 'failed') states[currentNodeId] = 'failed';
  return states;
}

