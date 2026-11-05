import { describe, expect, it } from 'vitest';

import {
  bindStandaloneNexusWorkflow,
  createStandaloneNexusWorkflow,
  duplicateStandaloneNexusWorkflow,
  type NexusWorkflowTemplate,
} from '@/modules/nexus/services/standalone-workflows';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

describe('standalone Nexus workflows', () => {
  const templates: NexusWorkflowTemplate[] = ['blank', 'message', 'webhook', 'schedule'];

  it.each(templates)('creates a valid %s workflow without an agent', (template) => {
    const definition = createStandaloneNexusWorkflow({
      id: `flow-${template}`,
      workspaceId: 'workspace-1',
      name: `Fluxo ${template}`,
      template,
      now: '2026-08-25T12:00:00.000Z',
    });

    expect(definition.metadata).toMatchObject({ kind: 'standalone', editor: 'nexus' });
    expect(definition.nodes.some((node) => node.type === 'ai.agent')).toBe(false);
    expect(definition.nodes.some((node) => node.type.startsWith('trigger.'))).toBe(true);
    expect(definition.nodes.some((node) => node.type === 'output.end')).toBe(true);
    expect(validateWorkflowDefinition(definition).valid).toBe(true);
  });

  it('rebases imported definitions onto the standalone identity', () => {
    const source = createStandaloneNexusWorkflow({
      id: 'old',
      workspaceId: 'workspace-old',
      name: 'Importado',
      template: 'blank',
    });
    const rebound = bindStandaloneNexusWorkflow({
      definition: source,
      id: 'new',
      workspaceId: 'workspace-new',
      name: 'Meu processo',
      now: '2026-08-25T13:00:00.000Z',
    });

    expect(rebound.id).toBe('nexus:new');
    expect(rebound.workspaceId).toBe('workspace-new');
    expect(rebound.name).toBe('Meu processo');
    expect(rebound.status).toBe('draft');
    expect(rebound.version).toBe('draft');
    expect(rebound.metadata?.nexusWorkflowId).toBe('new');
  });

  it('duplicates a flow as an independent draft while preserving its graph', () => {
    const source = createStandaloneNexusWorkflow({
      id: 'original',
      workspaceId: 'workspace-1',
      name: 'Original',
      template: 'message',
      now: '2026-08-25T12:00:00.000Z',
    });
    const copy = duplicateStandaloneNexusWorkflow({
      definition: source,
      id: 'copy',
      workspaceId: 'workspace-1',
      name: 'Cópia de Original',
      now: '2026-08-26T12:00:00.000Z',
    });

    expect(copy.id).toBe('nexus:copy');
    expect(copy.name).toBe('Cópia de Original');
    expect(copy.version).toBe('draft');
    expect(copy.status).toBe('draft');
    expect(copy.nodes).toEqual(source.nodes);
    expect(copy.connections).toEqual(source.connections);
    expect(copy.metadata).toMatchObject({
      nexusWorkflowId: 'copy',
      duplicatedFromWorkflowId: 'original',
    });
    expect(copy.createdAt).toBe('2026-08-26T12:00:00.000Z');
  });
});
