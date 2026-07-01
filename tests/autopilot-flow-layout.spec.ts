import { describe, expect, it } from 'vitest';

import {
  autoLayoutFlowNodes,
  findFlowLayoutOverlaps,
  type FlowLayoutEdge,
  type FlowLayoutNode,
} from '@/services/autopilot/flow-layout';

function node(id: string, kind: FlowLayoutNode['kind']): FlowLayoutNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
  };
}

describe('autopilot flow layout', () => {
  it('organizes a dense branched flow without overlapping main, knowledge or tool nodes', () => {
    const nodes: FlowLayoutNode[] = [
      node('start', 'start'),
      node('welcome', 'message'),
      node('triage', 'decision'),
      node('collect-order', 'collect'),
      node('collect-billing', 'collect'),
      node('collect-schedule', 'collect'),
      node('agent-order', 'sub_agent'),
      node('agent-billing', 'sub_agent'),
      node('agent-schedule', 'sub_agent'),
      node('human', 'handoff'),
      node('done', 'end'),
      node('knowledge-order', 'knowledge'),
      node('knowledge-billing', 'knowledge'),
      node('knowledge-schedule', 'knowledge'),
      node('tool-order-status', 'tool'),
      node('tool-billing', 'tool'),
      node('tool-schedule', 'tool'),
      node('tool-note', 'tool'),
    ];
    const edges: FlowLayoutEdge[] = [
      { source: 'start', target: 'welcome' },
      { source: 'welcome', target: 'triage' },
      { source: 'triage', target: 'collect-order' },
      { source: 'triage', target: 'collect-billing' },
      { source: 'triage', target: 'collect-schedule' },
      { source: 'collect-order', target: 'agent-order' },
      { source: 'collect-billing', target: 'agent-billing' },
      { source: 'collect-schedule', target: 'agent-schedule' },
      { source: 'agent-order', target: 'done' },
      { source: 'agent-billing', target: 'human' },
      { source: 'agent-schedule', target: 'done' },
      { source: 'knowledge-order', target: 'agent-order' },
      { source: 'knowledge-billing', target: 'agent-billing' },
      { source: 'knowledge-schedule', target: 'agent-schedule' },
      { source: 'agent-order', target: 'tool-order-status' },
      { source: 'agent-billing', target: 'tool-billing' },
      { source: 'agent-schedule', target: 'tool-schedule' },
      { source: 'human', target: 'tool-note' },
    ];

    const organized = autoLayoutFlowNodes(nodes, edges);

    expect(findFlowLayoutOverlaps(organized)).toEqual([]);
    expect(organized.every((item) => Number.isFinite(item.position.x) && Number.isFinite(item.position.y))).toBe(true);
    expect(organized.every((item) => item.position.x >= 60 && item.position.y >= 60)).toBe(true);
  });

  it('keeps cyclic and disconnected graphs collision-free', () => {
    const nodes: FlowLayoutNode[] = [
      node('a', 'start'),
      node('b', 'message'),
      node('c', 'decision'),
      node('d', 'sub_agent'),
      node('e', 'tool'),
      node('f', 'knowledge'),
      node('orphan-1', 'message'),
      node('orphan-2', 'sub_agent'),
      node('orphan-tool', 'tool'),
    ];
    const edges: FlowLayoutEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
      { source: 'd', target: 'b' },
      { source: 'd', target: 'e' },
      { source: 'f', target: 'd' },
      { source: 'orphan-1', target: 'orphan-2' },
      { source: 'orphan-2', target: 'orphan-tool' },
    ];

    const organized = autoLayoutFlowNodes(nodes, edges);

    expect(findFlowLayoutOverlaps(organized)).toEqual([]);
    expect(new Set(organized.map((item) => `${item.position.x}:${item.position.y}`)).size).toBe(organized.length);
  });
});
