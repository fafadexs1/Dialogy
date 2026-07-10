import { describe, expect, it } from 'vitest';
import { deriveWorkflowDebugNodeStates } from '@/components/workflow/workflow-debug-state';

describe('workflow canvas debugger state projection', () => {
  it('projects the latest operational state for each node', () => {
    expect(deriveWorkflowDebugNodeStates(
      { status: 'running', currentNodeId: 'agent' },
      [
        { sequence: 4, type: 'tool.started', nodeId: 'agent' },
        { sequence: 1, type: 'node.queued', nodeId: 'trigger' },
        { sequence: 2, type: 'node.completed', nodeId: 'trigger' },
        { sequence: 3, type: 'agent.thinking.started', nodeId: 'agent' },
      ],
    )).toEqual({ trigger: 'completed', agent: 'running_tool' });
  });

  it('marks the current node waiting or failed from execution state', () => {
    expect(deriveWorkflowDebugNodeStates(
      { status: 'waiting', currentNodeId: 'approval' },
      [{ sequence: 1, type: 'node.queued', nodeId: 'approval' }],
    )).toEqual({ approval: 'waiting' });
    expect(deriveWorkflowDebugNodeStates(
      { status: 'failed', currentNodeId: 'agent' },
      [{ sequence: 1, type: 'agent.thinking.started', nodeId: 'agent' }],
    )).toEqual({ agent: 'failed' });
  });

  it('ignores execution-wide events without a node id', () => {
    expect(deriveWorkflowDebugNodeStates(
      { status: 'completed', currentNodeId: null },
      [{ sequence: 1, type: 'execution.completed' }],
    )).toEqual({});
  });
});
