import { workflowNodeGeometry, workflowVisibleOutputs } from './workflow-node-geometry';
import { getWorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import type { WorkflowConnection, WorkflowNode } from '@/services/workflow-runtime/types';

export type WorkflowLayoutPosition = { x: number; y: number };

const GRID_SIZE = 16;
const LAYOUT_START_X = 80;
const LAYOUT_START_Y = 80;
const COLUMN_GAP_X = 96; // Compact horizontal gap between columns
const MIN_VERTICAL_GAP_Y = 48; // Clean, compact vertical gap between sibling cards
const EXECUTION_CONNECTION_TYPES = new Set(['main', 'error', 'event']);

const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

export function isAttachment(node: WorkflowNode): boolean {
  return getWorkflowNodeManifest(node.type)?.attachment === true;
}

export const getNodeDimensions = workflowNodeGeometry;

export function estimatedNodeHeight(node: WorkflowNode): number {
  return getNodeDimensions(node).height;
}

/**
 * Returns the estimated relative Y offset (from card top) of an output port on a node.
 */
function getSourcePortRelativeY(node: WorkflowNode, portId: string): number {
  const index = workflowVisibleOutputs(node).findIndex((port) => port.id === portId);
  return workflowNodeGeometry(node).portY(Math.max(0, index));
}

/**
 * Returns the 0-based visual index of an output port on the card (top-to-bottom).
 */
function getSourcePortVisualOrder(node: WorkflowNode, portId: string): number {
  const normalized = (portId || '').toLowerCase().trim();

  if (node.type === 'interaction.options' && Array.isArray(node.config.options)) {
    const options = node.config.options as Array<Record<string, unknown>>;
    const optIdx = options.findIndex((opt) => String(opt.id || opt.value || '') === portId);
    if (optIdx >= 0) return optIdx;
    if (normalized === 'default') return 100;
    if (normalized === 'expired') return 101;
    if (normalized === 'error') return 102;
  }

  if (node.type === 'logic.if') {
    if (normalized === 'true' || normalized === 'yes' || normalized === 'success') return 0;
    if (normalized === 'false' || normalized === 'no') return 1;
    if (normalized === 'error') return 2;
  }

  if (node.type === 'logic.switch' && Array.isArray(node.config.cases)) {
    const cases = node.config.cases as Array<Record<string, unknown>>;
    const caseIdx = cases.findIndex((c) => String(c.id || '') === portId);
    if (caseIdx >= 0) return caseIdx;
    if (normalized === 'default') return 100;
    if (normalized === 'error') return 101;
  }

  const portIndex = node.outputPorts.findIndex((p) => p.id === portId);
  return portIndex >= 0 ? portIndex : 50;
}

type LayoutEdge = {
  source: string;
  target: string;
  sourcePortId: string;
  sourceVisualOrder: number;
  connection: WorkflowConnection;
  order: number;
};

/**
 * Compact Layered Hierarchical DAG Layout (Dagre / Sugiyama Framework):
 * - Assigns columns based on topological longest path.
 * - Dynamic column pitch prevents wide option cards from overlapping adjacent columns.
 * - Sorts nodes within each layer by incoming parent port barycenter (minimizing edge crossings).
 * - Multi-pass compact coordinate relaxation keeps everything tight, aligned, and beautifully bounded.
 * - Secondary attachments are pinned compactly behind/below their host agents.
 */
export function createNativeWorkflowLayout(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): Map<string, WorkflowLayoutPosition> {
  const result = new Map<string, WorkflowLayoutPosition>();
  if (nodes.length === 0) return result;

  const executableNodes = nodes.filter((node) => !isAttachment(node));
  const executableById = new Map(executableNodes.map((node) => [node.id, node]));
  const attachments = nodes.filter(isAttachment);

  if (executableNodes.length === 0) {
    attachments.forEach((attachment, index) => {
      result.set(attachment.id, {
        x: snap(LAYOUT_START_X),
        y: snap(LAYOUT_START_Y + index * 140),
      });
    });
    return result;
  }

  // 1. Build filtered execution edges
  const executionEdges: LayoutEdge[] = [];
  connections.forEach((connection, order) => {
    if (
      EXECUTION_CONNECTION_TYPES.has(connection.connectionType)
      && connection.sourceNodeId !== connection.targetNodeId
      && executableById.has(connection.sourceNodeId)
      && executableById.has(connection.targetNodeId)
    ) {
      const sourceNode = executableById.get(connection.sourceNodeId)!;
      const sourceVisualOrder = getSourcePortVisualOrder(sourceNode, connection.sourcePortId);

      executionEdges.push({
        source: connection.sourceNodeId,
        target: connection.targetNodeId,
        sourcePortId: connection.sourcePortId,
        sourceVisualOrder,
        connection,
        order,
      });
    }
  });

  // Outgoing & incoming adjacency
  const rawOutgoing = new Map<string, LayoutEdge[]>();
  const rawIncoming = new Map<string, LayoutEdge[]>();
  executableNodes.forEach((node) => {
    rawOutgoing.set(node.id, []);
    rawIncoming.set(node.id, []);
  });
  executionEdges.forEach((edge) => {
    rawOutgoing.get(edge.source)?.push(edge);
    rawIncoming.get(edge.target)?.push(edge);
  });

  // 2. DFS Cycle Detection (Break feedback loops for ranking)
  const visitState = new Map<string, 0 | 1 | 2>();
  const forwardEdges: LayoutEdge[] = [];

  const dfsCycle = (nodeId: string) => {
    visitState.set(nodeId, 1);
    const edges = rawOutgoing.get(nodeId) || [];
    for (const edge of edges) {
      const state = visitState.get(edge.target) || 0;
      if (state !== 1) {
        forwardEdges.push(edge);
        if (state === 0) {
          dfsCycle(edge.target);
        }
      }
    }
    visitState.set(nodeId, 2);
  };

  const nodeOrder = (node: WorkflowNode) => (
    (node.type.startsWith('trigger.') ? -1_000_000 : 0) + (node.position.y || 0)
  );

  const sortedCandidates = [...executableNodes].sort(
    (a, b) => nodeOrder(a) - nodeOrder(b) || (a.position.x || 0) - (b.position.x || 0)
  );

  sortedCandidates.forEach((node) => {
    if (!visitState.get(node.id)) {
      dfsCycle(node.id);
    }
  });

  // 3. Build DAG forward adjacency
  const forwardOutgoing = new Map<string, LayoutEdge[]>();
  const forwardIncoming = new Map<string, LayoutEdge[]>();
  executableNodes.forEach((node) => {
    forwardOutgoing.set(node.id, []);
    forwardIncoming.set(node.id, []);
  });
  forwardEdges.forEach((edge) => {
    forwardOutgoing.get(edge.source)?.push(edge);
    forwardIncoming.get(edge.target)?.push(edge);
  });

  // 4. Compute Longest-Path Layer Ranks (Columns)
  const rank = new Map<string, number>();
  executableNodes.forEach((node) => rank.set(node.id, 0));

  const inDegree = new Map<string, number>();
  executableNodes.forEach((node) => {
    inDegree.set(node.id, forwardIncoming.get(node.id)?.length || 0);
  });

  const rankQueue = executableNodes
    .filter((node) => (inDegree.get(node.id) || 0) === 0)
    .map((node) => node.id);

  while (rankQueue.length > 0) {
    const currentId = rankQueue.shift()!;
    const currentRank = rank.get(currentId) || 0;
    const edges = forwardOutgoing.get(currentId) || [];
    for (const edge of edges) {
      const nextRank = Math.max(rank.get(edge.target) || 0, currentRank + 1);
      rank.set(edge.target, nextRank);
      const remaining = (inDegree.get(edge.target) || 1) - 1;
      inDegree.set(edge.target, remaining);
      if (remaining === 0) {
        rankQueue.push(edge.target);
      }
    }
  }

  // 5. Partition into Connected Subgraphs (Components)
  const componentVisited = new Set<string>();
  const components: string[][] = [];

  const traverseComponent = (startId: string, currentComponent: string[]) => {
    const queue = [startId];
    componentVisited.add(startId);
    while (queue.length > 0) {
      const id = queue.shift()!;
      currentComponent.push(id);

      const allNeighbors = [
        ...(rawOutgoing.get(id) || []).map((e) => e.target),
        ...(rawIncoming.get(id) || []).map((e) => e.source),
      ];

      for (const neighbor of allNeighbors) {
        if (!componentVisited.has(neighbor) && executableById.has(neighbor)) {
          componentVisited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  };

  sortedCandidates.forEach((node) => {
    if (!componentVisited.has(node.id)) {
      const comp: string[] = [];
      traverseComponent(node.id, comp);
      if (comp.length > 0) {
        components.push(comp);
      }
    }
  });

  // 6. Compute Dynamic Column X Positions
  const maxRank = Math.max(0, ...rank.values());
  const maxColumnWidth = new Map<number, number>();
  for (let r = 0; r <= maxRank; r++) {
    maxColumnWidth.set(r, 220);
  }
  executableNodes.forEach((node) => {
    const r = rank.get(node.id) || 0;
    const dim = getNodeDimensions(node);
    maxColumnWidth.set(r, Math.max(maxColumnWidth.get(r) || 0, dim.width));
  });

  const columnX = new Map<number, number>();
  let currentX = LAYOUT_START_X;
  for (let r = 0; r <= maxRank; r++) {
    columnX.set(r, currentX);
    const colW = maxColumnWidth.get(r) || 240;
    currentX += colW + COLUMN_GAP_X;
  }

  // 7. Compact Layer Ordering and Positioning per Component
  let componentBaseY = LAYOUT_START_Y;

  for (const component of components) {
    const compNodeSet = new Set(component);

    // Group nodes by layer rank within this component
    const layerMap = new Map<number, string[]>();
    component.forEach((id) => {
      const r = rank.get(id) || 0;
      const list = layerMap.get(r) || [];
      list.push(id);
      layerMap.set(r, list);
    });

    const compRanks = Array.from(layerMap.keys()).sort((a, b) => a - b);
    const nodeY = new Map<string, number>();

    // Initial root layer sorting
    if (compRanks.length > 0) {
      const rootRank = compRanks[0];
      const rootNodes = layerMap.get(rootRank)!;
      rootNodes.sort((a, b) => {
        const nodeA = executableById.get(a)!;
        const nodeB = executableById.get(b)!;
        return nodeOrder(nodeA) - nodeOrder(nodeB);
      });

      let initialRootY = componentBaseY;
      rootNodes.forEach((id) => {
        nodeY.set(id, initialRootY);
        const dim = getNodeDimensions(executableById.get(id)!);
        initialRootY += dim.height + MIN_VERTICAL_GAP_Y;
      });
    }

    // Forward sweep: Order layers by incoming barycenter and position nodes
    for (let i = 1; i < compRanks.length; i++) {
      const r = compRanks[i];
      const layerNodes = layerMap.get(r)!;

      // Calculate incoming barycenter weight for each node in this layer
      const weights = new Map<string, number>();
      layerNodes.forEach((id) => {
        const incomingEdges = (forwardIncoming.get(id) || []).filter((e) => compNodeSet.has(e.source));
        if (incomingEdges.length === 0) {
          weights.set(id, nodeY.get(id) || componentBaseY);
        } else {
          let sumY = 0;
          incomingEdges.forEach((edge) => {
            const parentNode = executableById.get(edge.source)!;
            const parentY = nodeY.get(edge.source) || componentBaseY;
            const portRelY = getSourcePortRelativeY(parentNode, edge.sourcePortId);
            sumY += parentY + portRelY;
          });
          weights.set(id, sumY / incomingEdges.length);
        }
      });

      // Sort nodes in this layer by barycenter weight
      layerNodes.sort((a, b) => (weights.get(a) || 0) - (weights.get(b) || 0));

      // Compact downward placement
      let cursorY = componentBaseY;
      layerNodes.forEach((id, idx) => {
        const dim = getNodeDimensions(executableById.get(id)!);
        const preferredY = (weights.get(id) || componentBaseY) - dim.height / 2;

        const targetY = idx === 0
          ? Math.max(componentBaseY, preferredY)
          : Math.max(cursorY, preferredY);

        nodeY.set(id, targetY);
        cursorY = targetY + dim.height + MIN_VERTICAL_GAP_Y;
      });
    }

    // Backward relaxation sweep: Pull parents towards children midpoints
    for (let i = compRanks.length - 2; i >= 0; i--) {
      const r = compRanks[i];
      const layerNodes = layerMap.get(r)!;

      layerNodes.forEach((id) => {
        const outgoingEdges = (forwardOutgoing.get(id) || []).filter((e) => compNodeSet.has(e.target));
        if (outgoingEdges.length > 0) {
          const selfNode = executableById.get(id)!;
          const selfDim = getNodeDimensions(selfNode);

          let sumChildY = 0;
          outgoingEdges.forEach((edge) => {
            const childY = nodeY.get(edge.target) || componentBaseY;
            const childDim = getNodeDimensions(executableById.get(edge.target)!);
            sumChildY += childY + childDim.height / 2;
          });
          const avgChildCenter = sumChildY / outgoingEdges.length;
          const preferredTop = avgChildCenter - selfDim.height / 2;

          const currentY = nodeY.get(id) || componentBaseY;
          nodeY.set(id, (currentY * 0.4 + preferredTop * 0.6));
        }
      });

      // Re-pack layer downwards to prevent overlap
      let cursorY = componentBaseY;
      layerNodes.forEach((id, idx) => {
        const dim = getNodeDimensions(executableById.get(id)!);
        const y = nodeY.get(id) || componentBaseY;
        const targetY = idx === 0 ? Math.max(componentBaseY, y) : Math.max(cursorY, y);
        nodeY.set(id, targetY);
        cursorY = targetY + dim.height + MIN_VERTICAL_GAP_Y;
      });
    }

    // Final forward alignment pass for single linear continuations (exact horizontal line)
    for (let i = 0; i < compRanks.length - 1; i++) {
      const r = compRanks[i];
      const layerNodes = layerMap.get(r)!;

      layerNodes.forEach((id) => {
        const outgoingEdges = (forwardOutgoing.get(id) || []).filter((e) => compNodeSet.has(e.target));
        if (outgoingEdges.length === 1) {
          const childId = outgoingEdges[0].target;
          const childIncoming = (forwardIncoming.get(childId) || []).filter((e) => compNodeSet.has(e.source));

          if (childIncoming.length === 1) {
            const childRank = rank.get(childId) || 0;
            const childLayerNodes = layerMap.get(childRank) || [];
            const childIdx = childLayerNodes.indexOf(childId);

            // If child is the first node or has room, align exactly to parent top Y
            const parentY = nodeY.get(id)!;
            const prevChild = childIdx > 0 ? childLayerNodes[childIdx - 1] : null;
            const minAllowedY = prevChild
              ? (nodeY.get(prevChild)! + getNodeDimensions(executableById.get(prevChild)!).height + MIN_VERTICAL_GAP_Y)
              : componentBaseY;

            if (parentY >= minAllowedY) {
              nodeY.set(childId, parentY);
            }
          }
        }
      });
    }

    // Measure component bounds & write final coordinates
    let compMinY = Number.POSITIVE_INFINITY;
    let compMaxY = Number.NEGATIVE_INFINITY;

    component.forEach((id) => {
      const r = rank.get(id) || 0;
      const rawX = columnX.get(r) || (LAYOUT_START_X + r * 320);
      const rawY = nodeY.get(id) || componentBaseY;
      const dim = getNodeDimensions(executableById.get(id)!);

      const posX = snap(rawX);
      const posY = snap(rawY);

      result.set(id, { x: posX, y: posY });

      compMinY = Math.min(compMinY, posY);
      compMaxY = Math.max(compMaxY, posY + dim.height);
    });

    // Advance componentBaseY for next independent subgraph
    componentBaseY = Number.isFinite(compMaxY)
      ? compMaxY + MIN_VERTICAL_GAP_Y * 2
      : componentBaseY + 400;
  }

  // 8. Place Secondary Attachments (Models, Knowledge, Tools, Memory, Guardrails)
  const attachmentsByHost = new Map<string, WorkflowNode[]>();
  for (const attachment of attachments) {
    const hostId = connections.find(
      (c) =>
        c.sourceNodeId === attachment.id
        && !EXECUTION_CONNECTION_TYPES.has(c.connectionType)
        && executableById.has(c.targetNodeId)
    )?.targetNodeId;

    if (hostId) {
      const list = attachmentsByHost.get(hostId) || [];
      list.push(attachment);
      attachmentsByHost.set(hostId, list);
    }
  }

  attachmentsByHost.forEach((hostAttachments, hostId) => {
    const hostPos = result.get(hostId);
    if (!hostPos) return;

    hostAttachments
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .forEach((attachment, index) => {
        result.set(attachment.id, {
          x: snap(hostPos.x - 240),
          y: snap(hostPos.y + index * 96),
        });
      });
  });

  // Orphan attachments
  attachments
    .filter((a) => !result.has(a.id))
    .forEach((attachment, index) => {
      result.set(attachment.id, {
        x: snap(LAYOUT_START_X),
        y: snap(componentBaseY + index * 120),
      });
    });

  return result;
}




