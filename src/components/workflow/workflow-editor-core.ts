import type { NodePort, WorkflowConnection, WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';
import { workflowNodeGeometry } from './workflow-node-geometry';

export type WorkflowSection = { id: string; title: string; nodeIds: string[] };
export type WorkflowEditorUi = { version: 1; groups: WorkflowSection[] };
export type EditorHistory = { past: WorkflowDefinition[]; present: WorkflowDefinition; future: WorkflowDefinition[] };

export function readWorkflowEditorUi(definition: WorkflowDefinition): WorkflowEditorUi {
  const value = definition.metadata?.flowBuilderUi as Partial<WorkflowEditorUi> | undefined;
  const ids = new Set(definition.nodes.map((node) => node.id));
  const assigned = new Set<string>();
  const groupIds = new Set<string>();
  return { version: 1, groups: (value?.version === 1 && Array.isArray(value.groups) ? value.groups : []).flatMap((group) => {
    if (!group || typeof group.id !== 'string' || !group.id.trim() || groupIds.has(group.id) || typeof group.title !== 'string' || !group.title.trim() || !Array.isArray(group.nodeIds)) return [];
    groupIds.add(group.id);
    const nodeIds = group.nodeIds.filter((id) => {
      if (typeof id !== 'string' || !ids.has(id) || assigned.has(id)) return false;
      assigned.add(id); return true;
    });
    return nodeIds.length ? [{ id: group.id, title: group.title, nodeIds }] : [];
  }) };
}

export function withWorkflowSections(definition: WorkflowDefinition, groups: WorkflowSection[]): WorkflowDefinition {
  const next = { ...definition, metadata: { ...definition.metadata, flowBuilderUi: { version: 1, groups } }, updatedAt: new Date().toISOString() };
  return { ...next, metadata: { ...next.metadata, flowBuilderUi: readWorkflowEditorUi(next) } };
}

export function editorDefinitionKey(definition: WorkflowDefinition): string {
  return JSON.stringify(definition, (key, value) => key === 'updatedAt' ? undefined : value);
}

export function recordEditorChange(history: EditorHistory, next: WorkflowDefinition, merge = false): EditorHistory {
  if (editorDefinitionKey(history.present) === editorDefinitionKey(next)) return history;
  return { past: merge ? history.past : [...history.past, history.present].slice(-100), present: next, future: [] };
}

export function travelEditorHistory(history: EditorHistory, direction: 'undo' | 'redo'): EditorHistory {
  if (direction === 'undo') {
    const previous = history.past.at(-1);
    return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, 100) } : history;
  }
  const next = history.future[0];
  return next ? { past: [...history.past, history.present].slice(-100), present: next, future: history.future.slice(1) } : history;
}

export function connectionProblem(definition: Pick<WorkflowDefinition, 'nodes' | 'connections'>, sourceId: string, outputId: string, targetId: string, inputId: string, exceptId?: string): string | null {
  const source = definition.nodes.find((node) => node.id === sourceId);
  const target = definition.nodes.find((node) => node.id === targetId);
  const output = source?.outputPorts.find((port) => port.id === outputId);
  const input = target?.inputPorts.find((port) => port.id === inputId);
  if (!output || !input || output.direction !== 'output' || input.direction !== 'input' || output.connectionType !== input.connectionType) return 'Use portas compatíveis do mesmo tipo.';
  const connections = definition.connections.filter((connection) => connection.id !== exceptId);
  if (!output.multiple && connections.some((connection) => connection.sourceNodeId === sourceId && connection.sourcePortId === outputId)) return 'Esta saída já está conectada.';
  if (!input.multiple && connections.some((connection) => connection.targetNodeId === targetId && connection.targetPortId === inputId)) return 'Esta entrada já está conectada.';
  return null;
}

export function insertionPortPairs(node: WorkflowNode, connection: WorkflowConnection): Array<{ input: NodePort; output: NodePort }> {
  if (node.type.startsWith('trigger.')) return [];
  return node.inputPorts.filter((port) => port.connectionType === connection.connectionType).flatMap((input) =>
    node.outputPorts.filter((port) => port.connectionType === connection.connectionType && (port.connectionType !== 'error' || node.config.customErrorRoute === true)).map((output) => ({ input, output })));
}

export function insertWorkflowOperation(definition: WorkflowDefinition, connectionId: string, node: WorkflowNode, inputPortId: string, outputPortId: string, newConnectionId: string): WorkflowDefinition {
  const original = definition.connections.find((connection) => connection.id === connectionId);
  if (!original || !['main', 'error', 'event'].includes(original.connectionType)) throw new Error('Esta conexão não permite inserção.');
  if (definition.nodes.some((existing) => existing.id === node.id) || definition.connections.some((existing) => existing.id === newConnectionId)) throw new Error('Identificador já utilizado.');
  if (!insertionPortPairs(node, original).some((pair) => pair.input.id === inputPortId && pair.output.id === outputPortId)) throw new Error('A operação não possui continuação compatível.');
  const upstream = { ...original, id: newConnectionId, targetNodeId: node.id, targetPortId: inputPortId };
  const downstream = { ...original, sourceNodeId: node.id, sourcePortId: outputPortId };
  const next = { ...definition, nodes: [...definition.nodes, node], connections: definition.connections.flatMap((connection) => connection.id === connectionId ? [upstream, downstream] : [connection]), updatedAt: new Date().toISOString() };
  for (const connection of [upstream, downstream]) {
    const problem = connectionProblem(next, connection.sourceNodeId, connection.sourcePortId, connection.targetNodeId, connection.targetPortId, connection.id);
    if (problem) throw new Error(problem);
  }
  return next;
}

/** Reserve room for a new card without changing any manually placed operation. */
export function availableWorkflowPosition(node: WorkflowNode, existing: WorkflowNode[]): { x: number; y: number } {
  const size = workflowNodeGeometry(node);
  const position = { ...node.position };
  const obstacles = existing.map((other) => ({ ...other.position, ...workflowNodeGeometry(other) }));
  for (let attempt = 0; attempt <= obstacles.length; attempt++) {
    const collisions = obstacles.filter((other) => position.x < other.x + other.width + 32 && position.x + size.width + 32 > other.x && position.y < other.y + other.height + 48 && position.y + size.height + 48 > other.y);
    if (!collisions.length) return position;
    position.y = Math.ceil((Math.max(...collisions.map((other) => other.y + other.height)) + 48) / 16) * 16;
  }
  return position;
}

export function alignWorkflowNodes(nodes: WorkflowNode[], ids: Set<string>, operation: 'left' | 'top' | 'horizontal' | 'vertical'): WorkflowNode[] {
  const selected = nodes.filter((node) => ids.has(node.id));
  if (selected.length < 2) return nodes;
  const axis = operation === 'left' || operation === 'horizontal' ? 'x' : 'y';
  const sorted = [...selected].sort((a, b) => a.position[axis] - b.position[axis]);
  const start = sorted[0].position[axis];
  const extent = (node: WorkflowNode) => axis === 'x' ? workflowNodeGeometry(node).width : workflowNodeGeometry(node).height;
  const gap = (sorted.at(-1)!.position[axis] + extent(sorted.at(-1)!) - start - sorted.reduce((total, node) => total + extent(node), 0)) / (sorted.length - 1);
  let cursor = start;
  const positions = new Map(sorted.map((node) => {
    const coordinate = operation === 'left' || operation === 'top' ? start : cursor;
    cursor += extent(node) + gap;
    return [node.id, coordinate];
  }));
  return nodes.map((node) => positions.has(node.id) ? { ...node, position: { ...node.position, [axis]: positions.get(node.id)! } } : node);
}

/** Pack section envelopes as units; never move a node merely by opening an editor. */
export function separateWorkflowSections(nodes: WorkflowNode[], groups: WorkflowSection[], positions: Map<string, { x: number; y: number }>) {
  const result = new Map(positions);
  const grouped = new Set(groups.flatMap((group) => group.nodeIds));
  const box = (members: WorkflowNode[]) => ({
    left: Math.min(...members.map((node) => result.get(node.id)!.x)) - 24,
    right: Math.max(...members.map((node) => result.get(node.id)!.x + workflowNodeGeometry(node).width)) + 24,
    top: Math.min(...members.map((node) => result.get(node.id)!.y)) - 56,
    bottom: Math.max(...members.map((node) => result.get(node.id)!.y + workflowNodeGeometry(node).height)) + 24,
  });
  const occupied = nodes.filter((node) => !grouped.has(node.id) && result.has(node.id)).map((node) => box([node]));
  for (const group of groups) {
    const members = nodes.filter((node) => group.nodeIds.includes(node.id) && result.has(node.id));
    if (!members.length) continue;
    let bounds = box(members);
    const overlaps = () => occupied.filter((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top);
    let collisions = overlaps();
    while (collisions.length) {
      const shift = Math.ceil((Math.max(...collisions.map((other) => other.bottom)) + 48 - bounds.top) / 16) * 16;
      members.forEach((node) => { const position = result.get(node.id)!; result.set(node.id, { x: position.x, y: position.y + shift }); });
      bounds = box(members); collisions = overlaps();
    }
    occupied.push(bounds);
  }
  return result;
}
