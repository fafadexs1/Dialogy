import { describe, expect, it } from 'vitest';
import { confirmedWorkflowExecutionEdges, deriveWorkflowDebugNodeStates } from '@/components/workflow/workflow-debug-state';

describe('workflow canvas debugger state projection', () => {
  it('distinguishes started, retrying, explicitly skipped and interrupted operations', () => {
    expect(deriveWorkflowDebugNodeStates({ status: 'cancelled', currentNodeId: 'active', nodeResults: { skip: { status: 'skipped' } } }, [
      { sequence: 3, type: 'node.started', nodeId: 'active' },
      { sequence: 1, type: 'node.completed', nodeId: 'done' },
      { sequence: 2, type: 'node.retrying', nodeId: 'retry' },
    ])).toEqual({ active: 'cancelled', done: 'completed', retry: 'retrying', skip: 'skipped' });
    expect(deriveWorkflowDebugNodeStates({ status: 'cancelled', currentNodeId: 'done' }, [{ sequence: 1, type: 'node.completed', nodeId: 'done' }])).toEqual({ done: 'completed' });
  });

  it('does not infer successful routes or skipped branches without execution evidence', () => {
    const edges = [{ id: 'yes', sourceNodeId: 'if', sourcePortId: 'true', targetNodeId: 'yes' }, { id: 'no', sourceNodeId: 'if', sourcePortId: 'false', targetNodeId: 'no' }];
    expect(confirmedWorkflowExecutionEdges({ status: 'running', executionPath: [{ nodeId: 'if' }, { nodeId: 'yes' }] }, edges)).toEqual(new Set());
    expect(confirmedWorkflowExecutionEdges({ status: 'running', executionPath: [{ nodeId: 'if', selectedOutput: 'true' }, { nodeId: 'yes' }] }, edges)).toEqual(new Set(['yes']));
    expect(deriveWorkflowDebugNodeStates({ status: 'completed' }, [])).toEqual({});
  });
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
