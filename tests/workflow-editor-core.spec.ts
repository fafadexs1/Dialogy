import { describe, expect, it } from 'vitest';
import { createWorkflowNode, listStableWorkflowNodeManifests } from '@/services/workflow-runtime/catalog';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { alignWorkflowNodes, availableWorkflowPosition, connectionProblem, insertWorkflowOperation, insertionPortPairs, readWorkflowEditorUi, recordEditorChange, separateWorkflowSections, travelEditorHistory, withWorkflowSections, type EditorHistory } from '@/components/workflow/workflow-editor-core';
import { workflowFunctionalSignature, workflowLayoutSignature } from '@/services/workflow-runtime/signature';
import { workflowNodeGeometry } from '@/components/workflow/workflow-node-geometry';
import { createNativeWorkflowLayout } from '@/components/workflow/native-workflow-layout';
import { importNexusPortableFlow, createNexusPortableFlow } from '@/modules/nexus/services/flow-portability';

const fixture = () => createStandaloneNexusWorkflow({ id: 'editor', workspaceId: 'workspace', name: 'Editor', template: 'message' });

describe('workflow editor transactions', () => {
  it('inserts on one connection without rewriting another branch or existing node data', () => {
    const before = fixture();
    const original = before.connections[0];
    const node = createWorkflowNode('data.set', { id: 'inserted', position: { x: 300, y: 80 } });
    const pair = insertionPortPairs(node, original)[0];
    const after = insertWorkflowOperation(before, original.id, node, pair.input.id, pair.output.id, 'new-edge');
    expect(before.nodes.some((value) => value.id === node.id)).toBe(false);
    expect(after.nodes.slice(0, -1)).toEqual(before.nodes);
    expect(after.connections.find((value) => value.id === original.id)).toEqual({ ...original, sourceNodeId: node.id, sourcePortId: pair.output.id });
    expect(after.connections.find((value) => value.id === 'new-edge')).toEqual({ ...original, id: 'new-edge', targetNodeId: node.id, targetPortId: pair.input.id });
    expect(after.connections.filter((value) => ![original.id, 'new-edge'].includes(value.id))).toEqual(before.connections.slice(1));
  });

  it('rejects incompatible insertions and occupied ports without touching the source', () => {
    const before = fixture();
    const original = before.connections[0];
    const terminal = createWorkflowNode('output.end', { id: 'terminal', position: { x: 0, y: 0 } });
    expect(insertionPortPairs(terminal, original)).toEqual([]);
    expect(() => insertWorkflowOperation(before, original.id, terminal, 'main', 'missing', 'new')).toThrow();
    expect(connectionProblem(before, original.sourceNodeId, original.sourcePortId, original.targetNodeId, original.targetPortId)).toBeTruthy();
    expect(connectionProblem(before, original.sourceNodeId, original.sourcePortId, original.targetNodeId, original.targetPortId, original.id)).toBeNull();
    expect(connectionProblem(before, original.targetNodeId, original.targetPortId, original.sourceNodeId, original.sourcePortId)).toBeTruthy();
  });

  it('keeps branching choices explicit and disallows capability edge insertion', () => {
    const before = fixture();
    const branch = createWorkflowNode('logic.if', { id: 'branch', position: { x: 0, y: 0 } });
    expect(insertionPortPairs(branch, before.connections[0]).length).toBeGreaterThan(1);
    const edge = { ...before.connections[0], connectionType: 'model' as const };
    expect(() => insertWorkflowOperation({ ...before, connections: [edge] }, edge.id, branch, 'main', 'true', 'new')).toThrow();
  });

  it('restores complete snapshots including private agent resources and metadata', () => {
    const before = fixture();
    const resource = createWorkflowNode('memory.session', { id: 'private-memory', position: { x: 30, y: 40 } });
    const withResource = { ...before, nodes: [...before.nodes, resource] };
    let history: EditorHistory = { past: [], present: withResource, future: [] };
    history = recordEditorChange(history, before);
    history = travelEditorHistory(history, 'undo');
    expect(history.present).toEqual(withResource);
    history = travelEditorHistory(history, 'redo');
    expect(history.present).toEqual(before);
    history = travelEditorHistory(history, 'undo');
    history = recordEditorChange(history, { ...withResource, name: 'Another edit' });
    expect(history.future).toEqual([]);
  });

  it('bounds history and coalesces an edit transaction without losing its original value', () => {
    let history: EditorHistory = { past: [], present: fixture(), future: [] };
    for (let index = 0; index < 120; index++) history = recordEditorChange(history, { ...history.present, name: `Name ${index}` });
    expect(history.past).toHaveLength(100);
    const original = history.present;
    history = recordEditorChange(history, { ...history.present, name: 'T' });
    history = recordEditorChange(history, { ...history.present, name: 'Text' }, true);
    expect(travelEditorHistory(history, 'undo').present).toEqual(original);
    expect(recordEditorChange(history, { ...history.present, updatedAt: new Date().toISOString() })).toBe(history);
  });
});

describe('shared visual sections and geometry', () => {
  it('saves and transports sections without changing the runtime signature', () => {
    const before = fixture();
    const groups = [{ id: 'section', title: 'Atendimento', nodeIds: before.nodes.map((node) => node.id) }];
    const after = withWorkflowSections(before, groups);
    expect(workflowFunctionalSignature(after)).toBe(workflowFunctionalSignature(before));
    expect(workflowLayoutSignature(after)).not.toBe(workflowLayoutSignature(before));
    const imported = importNexusPortableFlow({ raw: createNexusPortableFlow(after), workflowId: 'import', workspaceId: 'workspace' });
    expect(readWorkflowEditorUi(imported!.workflow).groups).toEqual(groups);
    expect(workflowFunctionalSignature({ ...after, metadata: { ...after.metadata, senderSystemAgentId: 'different' } })).not.toBe(workflowFunctionalSignature(before));
  });

  it('drops deleted members, repeated memberships and malformed visual metadata', () => {
    const definition = fixture();
    const id = definition.nodes[0].id;
    expect(readWorkflowEditorUi(withWorkflowSections(definition, [
      { id: 'one', title: 'One', nodeIds: [id, id, 'deleted'] },
      { id: 'two', title: 'Two', nodeIds: [id] },
    ])).groups).toEqual([{ id: 'one', title: 'One', nodeIds: [id] }]);
    expect(readWorkflowEditorUi({ ...definition, metadata: { flowBuilderUi: { version: 99, groups: [] } } }).groups).toEqual([]);
  });

  it('places new cards without overlaps or moving existing positions', () => {
    const existing = fixture().nodes;
    const original = structuredClone(existing);
    const node = createWorkflowNode('data.set', { id: 'new', position: { ...existing[0].position } });
    const free = availableWorkflowPosition(node, existing);
    const size = workflowNodeGeometry(node);
    for (const other of existing) {
      const dimensions = workflowNodeGeometry(other);
      expect(free.x >= other.position.x + dimensions.width || free.x + size.width <= other.position.x || free.y >= other.position.y + dimensions.height || free.y + size.height <= other.position.y).toBe(true);
    }
    expect(existing).toEqual(original);
  });

  it('limits content geometry while leaving every output reachable', () => {
    const node = createWorkflowNode('output.respond', { id: 'message', position: { x: 0, y: 0 }, config: { message: 'Text' } });
    expect(workflowNodeGeometry(node)).toMatchObject({ width: 288 });
    const original = workflowNodeGeometry(node);
    expect(workflowNodeGeometry({ ...node, name: 'Long '.repeat(200), config: { ...node.config, message: 'Long '.repeat(5000) } })).toMatchObject({ width: original.width, height: original.height });
    for (const manifest of listStableWorkflowNodeManifests()) {
      const value = createWorkflowNode(manifest.type, { id: manifest.type, position: { x: 0, y: 0 }, config: { customErrorRoute: true } });
      const dimensions = workflowNodeGeometry(value);
      expect(dimensions.portY(Math.max(value.inputPorts.length, value.outputPorts.length, 1) - 1)).toBeLessThan(dimensions.height - 16);
    }
  });

  it('aligns selections without moving unselected nodes and packs section envelopes', () => {
    const definition = fixture();
    const ids = new Set(definition.nodes.slice(0, 2).map((node) => node.id));
    const aligned = alignWorkflowNodes(definition.nodes, ids, 'top');
    expect(aligned[0].position.y).toBe(aligned[1].position.y);
    expect(aligned[2]).toBe(definition.nodes[2]);
    const positions = new Map(definition.nodes.map((node) => [node.id, { x: 80, y: 80 }]));
    const packed = separateWorkflowSections(definition.nodes, [{ id: 'group', title: 'Group', nodeIds: [...ids] }], positions);
    expect(packed.get(definition.nodes[0].id)!.y).toBeGreaterThan(packed.get(definition.nodes[2].id)!.y + workflowNodeGeometry(definition.nodes[2]).height);
    expect(positions.get(definition.nodes[0].id)!.y).toBe(80);
  });

  it.each([300, 500])('lays out %i operations deterministically without overlaps or dropped nodes', (count) => {
    const nodes = Array.from({ length: count }, (_, index) => createWorkflowNode(index === 0 ? 'trigger.manual' : 'data.set', { id: `node-${index}`, position: { x: 0, y: 0 } }));
    const connections = nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, sourceNodeId: nodes[index].id, sourcePortId: nodes[index].outputPorts[0].id, targetNodeId: node.id, targetPortId: node.inputPorts[0].id, connectionType: 'main' as const }));
    const positions = createNativeWorkflowLayout(nodes, connections);
    expect(positions.size).toBe(count);
    expect(createNativeWorkflowLayout(nodes, connections)).toEqual(positions);
    nodes.slice(1).forEach((node, index) => expect(positions.get(node.id)!.x).toBeGreaterThanOrEqual(positions.get(nodes[index].id)!.x + workflowNodeGeometry(nodes[index]).width + 80));
  });
});
