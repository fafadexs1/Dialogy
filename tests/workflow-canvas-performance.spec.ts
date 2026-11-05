import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Braces } from 'lucide-react';

import {
  canvasEdge,
  initialWorkflowViewportNodeIds,
  traceWorkflowRouteEdgeIds,
  visibleWorkflowOutputPorts,
  workflowNodeDisplayContent,
  workflowNodeIcon,
} from '@/components/workflow/native-workflow-builder';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { createWorkflowNode, listStableWorkflowNodeManifests } from '@/services/workflow-runtime/catalog';

describe('native workflow canvas performance', () => {
  it('virtualizes nodes outside the viewport in large workflows', () => {
    const builderSource = readFileSync('src/components/workflow/native-workflow-builder.tsx', 'utf8');
    expect(builderSource).toContain('onlyRenderVisibleElements={isLargeWorkflow}');
  });

  it('keeps connection names out of the edge DOM', () => {
    const definition = createStandaloneNexusWorkflow({
      id: 'performance-labels',
      workspaceId: 'workspace-1',
      name: 'Performance',
      template: 'message',
    });

    for (const connection of definition.connections) {
      const edge = canvasEdge(connection);
      expect(edge.label).toBeUndefined();
      expect(edge.labelStyle).toBeUndefined();
      expect(edge.labelBgStyle).toBeUndefined();
    }
  });

  it('opens a large workflow around the trigger and its main path', () => {
    const definition = createStandaloneNexusWorkflow({
      id: 'performance-viewport',
      workspaceId: 'workspace-1',
      name: 'Performance',
      template: 'message',
    });
    const ids = initialWorkflowViewportNodeIds(definition, 4);

    expect(ids[0]).toBe('message_received');
    expect(ids.slice(0, 3)).toEqual([
      'message_received',
      'send_message',
      'message_end',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('projects message text and option routes into read-only card content', () => {
    const response = createWorkflowNode('output.respond', {
      id: 'response',
      position: { x: 0, y: 0 },
      config: { message: 'Olá, {{contact.name}}!' },
    });
    const menu = createWorkflowNode('interaction.options', {
      id: 'menu',
      position: { x: 300, y: 0 },
      config: {
        prompt: 'Como podemos ajudar?',
        options: [
          { id: 'sales', value: 'sales', label: 'Falar com vendas' },
          { id: 'support', value: 'support', label: 'Pedir suporte' },
        ],
      },
    });
    menu.outputPorts.push(
      { id: 'sales', label: 'Falar com vendas', direction: 'output', connectionType: 'main', required: false, multiple: false },
      { id: 'support', label: 'Pedir suporte', direction: 'output', connectionType: 'main', required: false, multiple: false },
    );

    expect(workflowNodeDisplayContent(response)).toEqual({
      text: 'Olá, {{contact.name}}!',
      options: [],
    });
    expect(workflowNodeDisplayContent(menu)).toEqual({
      text: 'Como podemos ajudar?',
      options: [
        { id: 'sales', label: 'Falar com vendas', portId: 'sales' },
        { id: 'support', label: 'Pedir suporte', portId: 'support' },
      ],
    });
  });

  it('hides the error output until the block enables its custom error path', () => {
    const response = createWorkflowNode('output.respond', {
      id: 'response-error-path',
      position: { x: 0, y: 0 },
    });

    expect(visibleWorkflowOutputPorts(response).some((port) => port.connectionType === 'error')).toBe(false);
    response.config.customErrorRoute = true;
    expect(visibleWorkflowOutputPorts(response).some((port) => port.connectionType === 'error')).toBe(true);
  });

  it('uses every icon declared by the block catalog instead of collapsing to a generic symbol', () => {
    const manifests = listStableWorkflowNodeManifests();
    const declaredIcons = new Set(manifests.map((manifest) => manifest.icon));
    const renderedIcons = new Set(manifests.map((manifest) => workflowNodeIcon(manifest.type)));

    // Categories may deliberately share an icon; each declared icon must still render.
    expect(declaredIcons.size).toBeGreaterThan(1);
    expect(renderedIcons.size).toBe(declaredIcons.size);
    for (const manifest of manifests) {
      if (manifest.icon !== 'Braces') expect(workflowNodeIcon(manifest.type), manifest.type).not.toBe(Braces);
    }
  });

  it('traces only the selected connection and its downstream path', () => {
    const definition = createStandaloneNexusWorkflow({
      id: 'route-trace',
      workspaceId: 'workspace-1',
      name: 'Route trace',
      template: 'message',
    });
    const first = definition.connections.find((connection) => connection.sourceNodeId === 'message_received')!;
    const second = definition.connections.find((connection) => connection.sourceNodeId === 'send_message')!;

    expect(traceWorkflowRouteEdgeIds(definition, first.sourceNodeId, first.sourcePortId)).toEqual(
      new Set([first.id, second.id]),
    );
    expect(traceWorkflowRouteEdgeIds(definition, second.sourceNodeId, second.sourcePortId)).toEqual(
      new Set([second.id]),
    );
  });
});
