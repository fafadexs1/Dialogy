import type { AutopilotFlowNodeKind } from '@/lib/types';

export type FlowLayoutPoint = { x: number; y: number };

export type FlowLayoutNode = {
  id: string;
  kind: AutopilotFlowNodeKind;
  position: FlowLayoutPoint;
};

export type FlowLayoutEdge = {
  source: string;
  target: string;
};

export type FlowLayoutOverlap = {
  leftId: string;
  rightId: string;
};

const MAIN_NODE_W = 220;
const MAIN_NODE_H = 156;
const ATTACHMENT_NODE_W = 156;
const ATTACHMENT_NODE_H = 156;
const MIN_X = 60;
const MIN_Y = 60;
const LAYER_GAP_X = 96;
const LAYER_GAP_Y = 92;
const SATELLITE_OFFSET_X = 284;
const SATELLITE_GAP_Y = 72;
const COLLISION_GAP_X = 42;
const COLLISION_GAP_Y = 44;

const SATELLITE_KINDS = new Set<AutopilotFlowNodeKind>(['knowledge', 'tool']);

function isSatelliteKind(kind: AutopilotFlowNodeKind) {
  return SATELLITE_KINDS.has(kind);
}

function isAgentKind(kind: AutopilotFlowNodeKind) {
  return kind === 'sub_agent';
}

function nodeDimensions(kind: AutopilotFlowNodeKind) {
  if (kind === 'knowledge') return { width: ATTACHMENT_NODE_W, height: ATTACHMENT_NODE_H };
  return { width: MAIN_NODE_W, height: MAIN_NODE_H };
}

function nodeBox(node: Pick<FlowLayoutNode, 'kind'> & { position: FlowLayoutPoint }) {
  const dimensions = nodeDimensions(node.kind);
  return {
    x: node.position.x,
    y: node.position.y,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function boxesOverlap(
  left: ReturnType<typeof nodeBox>,
  right: ReturnType<typeof nodeBox>,
) {
  return !(
    left.x + left.width + COLLISION_GAP_X <= right.x ||
    right.x + right.width + COLLISION_GAP_X <= left.x ||
    left.y + left.height + COLLISION_GAP_Y <= right.y ||
    right.y + right.height + COLLISION_GAP_Y <= left.y
  );
}

export function findFlowLayoutOverlaps(nodes: FlowLayoutNode[]): FlowLayoutOverlap[] {
  const overlaps: FlowLayoutOverlap[] = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      if (boxesOverlap(nodeBox(nodes[leftIndex]), nodeBox(nodes[rightIndex]))) {
        overlaps.push({
          leftId: nodes[leftIndex].id,
          rightId: nodes[rightIndex].id,
        });
      }
    }
  }
  return overlaps;
}

function edgeKey(source: string, target: string) {
  return `${source}->${target}`;
}

function buildBackEdges(nodes: FlowLayoutNode[], children: Map<string, string[]>, roots: FlowLayoutNode[]) {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const backEdges = new Set<string>();

  const dfs = (nodeId: string) => {
    visited.add(nodeId);
    stack.add(nodeId);
    for (const childId of children.get(nodeId) || []) {
      if (stack.has(childId)) {
        backEdges.add(edgeKey(nodeId, childId));
      } else if (!visited.has(childId)) {
        dfs(childId);
      }
    }
    stack.delete(nodeId);
  };

  for (const root of roots) {
    if (!visited.has(root.id)) dfs(root.id);
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id);
  }

  return backEdges;
}

function chooseRootNodes(nodes: FlowLayoutNode[], parents: Map<string, string[]>) {
  const roots = nodes.filter((node) => (parents.get(node.id)?.length || 0) === 0);
  if (roots.length > 0) return roots;
  const start = nodes.find((node) => node.kind === 'start');
  return start ? [start] : nodes.slice(0, 1);
}

function mainNodeSort(left: FlowLayoutNode, right: FlowLayoutNode) {
  const priority = (kind: AutopilotFlowNodeKind) => {
    if (kind === 'start') return 0;
    if (kind === 'message') return 1;
    if (kind === 'collect') return 2;
    if (kind === 'decision') return 3;
    if (kind === 'sub_agent') return 4;
    if (kind === 'handoff') return 7;
    if (kind === 'end') return 8;
    return 5;
  };
  return priority(left.kind) - priority(right.kind) ||
    left.position.x - right.position.x ||
    left.position.y - right.position.y ||
    left.id.localeCompare(right.id);
}

function assignLayers(mainNodes: FlowLayoutNode[], edges: FlowLayoutEdge[]) {
  const mainIds = new Set(mainNodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const node of mainNodes) {
    children.set(node.id, []);
    parents.set(node.id, []);
  }
  for (const edge of edges) {
    if (!mainIds.has(edge.source) || !mainIds.has(edge.target)) continue;
    children.get(edge.source)?.push(edge.target);
    parents.get(edge.target)?.push(edge.source);
  }
  for (const values of children.values()) values.sort();
  for (const values of parents.values()) values.sort();

  const roots = chooseRootNodes(mainNodes, parents);
  const backEdges = buildBackEdges(mainNodes, children, roots);
  const layer = new Map<string, number>();
  const queue: string[] = [];

  for (const root of roots.sort(mainNodeSort)) {
    layer.set(root.id, 0);
    queue.push(root.id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layer.get(current)!;
    for (const childId of children.get(current) || []) {
      if (backEdges.has(edgeKey(current, childId))) continue;
      const nextLayer = currentLayer + 1;
      const existing = layer.get(childId);
      if (existing === undefined || existing < nextLayer) {
        if (nextLayer < mainNodes.length + 1) {
          layer.set(childId, nextLayer);
          queue.push(childId);
        }
      }
    }
  }

  let maxLayer = Math.max(0, ...layer.values());
  for (const node of mainNodes.sort(mainNodeSort)) {
    if (!layer.has(node.id)) {
      maxLayer += 1;
      layer.set(node.id, maxLayer);
    }
  }

  return layer;
}

function preferredSatelliteParent(
  satellite: FlowLayoutNode,
  mainNodes: FlowLayoutNode[],
  edges: FlowLayoutEdge[],
) {
  for (const edge of edges) {
    if (edge.target === satellite.id && mainNodes.some((node) => node.id === edge.source)) return edge.source;
    if (edge.source === satellite.id && mainNodes.some((node) => node.id === edge.target)) return edge.target;
  }
  return mainNodes.find((node) => isAgentKind(node.kind))?.id || mainNodes[0]?.id || null;
}

function resolveCollisions(nodes: FlowLayoutNode[]) {
  const placed: FlowLayoutNode[] = [];
  const ordered = [...nodes].sort((left, right) => (
    left.position.y - right.position.y ||
    left.position.x - right.position.x ||
    (isSatelliteKind(left.kind) ? 1 : 0) - (isSatelliteKind(right.kind) ? 1 : 0) ||
    left.id.localeCompare(right.id)
  ));

  for (const node of ordered) {
    const dimensions = nodeDimensions(node.kind);
    let next = {
      ...node,
      position: {
        x: Math.max(MIN_X, Math.round(node.position.x)),
        y: Math.max(MIN_Y, Math.round(node.position.y)),
      },
    };

    let guard = 0;
    const maxGuard = Math.max(80, nodes.length * nodes.length * 2);
    while (placed.some((candidate) => boxesOverlap(nodeBox(next), nodeBox(candidate))) && guard < maxGuard) {
      const blockers = placed.filter((candidate) => boxesOverlap(nodeBox(next), nodeBox(candidate)));
      const pushBelow = Math.max(
        ...blockers.map((candidate) => (
          candidate.position.y + nodeDimensions(candidate.kind).height + COLLISION_GAP_Y
        )),
      );
      next = {
        ...next,
        position: {
          x: next.position.x,
          y: Math.max(next.position.y + dimensions.height + COLLISION_GAP_Y, pushBelow),
        },
      };
      guard += 1;
    }

    if (guard >= maxGuard && placed.some((candidate) => boxesOverlap(nodeBox(next), nodeBox(candidate)))) {
      const row = placed.length;
      next = {
        ...next,
        position: {
          x: MIN_X + (row % 6) * (MAIN_NODE_W + LAYER_GAP_X),
          y: MIN_Y + Math.floor(row / 6) * (MAIN_NODE_H + LAYER_GAP_Y),
        },
      };
      while (placed.some((candidate) => boxesOverlap(nodeBox(next), nodeBox(candidate)))) {
        next = {
          ...next,
          position: {
            x: next.position.x,
            y: next.position.y + MAIN_NODE_H + COLLISION_GAP_Y,
          },
        };
      }
    }

    placed.push(next);
  }

  return nodes.map((node) => placed.find((candidate) => candidate.id === node.id) || node);
}

export function autoLayoutFlowNodes<TNode extends FlowLayoutNode>(
  nodes: TNode[],
  edges: FlowLayoutEdge[],
): TNode[] {
  if (nodes.length === 0) return nodes;

  const mainNodes = nodes.filter((node) => !isSatelliteKind(node.kind));
  const satelliteNodes = nodes.filter((node) => isSatelliteKind(node.kind));
  const layer = assignLayers(mainNodes, edges);
  const layerGroups = new Map<number, FlowLayoutNode[]>();

  for (const node of mainNodes) {
    const layerIndex = layer.get(node.id) || 0;
    layerGroups.set(layerIndex, [...(layerGroups.get(layerIndex) || []), node]);
  }

  const positioned = new Map<string, FlowLayoutPoint>();
  for (const layerIndex of [...layerGroups.keys()].sort((left, right) => left - right)) {
    const group = [...(layerGroups.get(layerIndex) || [])].sort(mainNodeSort);
    const totalWidth = group.length * MAIN_NODE_W + Math.max(0, group.length - 1) * LAYER_GAP_X;
    let x = Math.max(MIN_X, 840 - totalWidth / 2);
    const y = MIN_Y + layerIndex * (MAIN_NODE_H + LAYER_GAP_Y);
    for (const node of group) {
      positioned.set(node.id, { x, y });
      x += MAIN_NODE_W + LAYER_GAP_X;
    }
  }

  const satelliteCountByParent = new Map<string, number>();
  for (const satellite of satelliteNodes.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))) {
    const parentId = preferredSatelliteParent(satellite, mainNodes, edges);
    const parentPosition = parentId ? positioned.get(parentId) : null;
    const countKey = parentId || '__orphan__';
    const index = satelliteCountByParent.get(countKey) || 0;
    satelliteCountByParent.set(countKey, index + 1);
    const side = satellite.kind === 'knowledge' ? -1 : 1;
    positioned.set(satellite.id, {
      x: (parentPosition?.x ?? MIN_X) + side * SATELLITE_OFFSET_X,
      y: (parentPosition?.y ?? MIN_Y) + index * (ATTACHMENT_NODE_H + SATELLITE_GAP_Y),
    });
  }

  const layoutNodes = nodes.map((node): FlowLayoutNode => ({
    id: node.id,
    kind: node.kind,
    position: positioned.get(node.id) || node.position,
  }));
  const collisionFreeNodes = resolveCollisions(layoutNodes);
  const positionById = new Map(collisionFreeNodes.map((node) => [node.id, node.position]));

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) || node.position,
  }));
}
