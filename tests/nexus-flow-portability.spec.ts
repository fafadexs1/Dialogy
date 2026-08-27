import { describe, expect, it } from 'vitest';

import {
  createNexusPortableFlow,
  importNexusPortableFlow,
  NEXUS_PORTABLE_FLOW_FORMAT,
  nexusPortableFilename,
  parseNexusPortableFlow,
  serializeNexusPortableFlow,
} from '@/modules/nexus/services/flow-portability';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';

describe('Nexus native flow portability', () => {
  const source = createStandaloneNexusWorkflow({
    id: 'source-flow',
    workspaceId: 'workspace-source',
    name: 'Fluxo Comercial São Paulo',
    template: 'message',
    now: '2026-08-26T12:00:00.000Z',
  });

  it('exports a versioned native envelope without altering the definition', () => {
    const portable = createNexusPortableFlow(source, '2026-08-26T13:00:00.000Z');

    expect(portable).toMatchObject({
      format: NEXUS_PORTABLE_FLOW_FORMAT,
      formatVersion: 1,
      exportedAt: '2026-08-26T13:00:00.000Z',
      definition: source,
    });
    expect(JSON.parse(serializeNexusPortableFlow(source, portable.exportedAt))).toEqual(portable);
  });

  it('imports native envelopes and rebases identity onto the destination workspace', () => {
    const result = importNexusPortableFlow({
      raw: createNexusPortableFlow(source),
      workflowId: 'destination-flow',
      workspaceId: 'workspace-destination',
      name: 'Fluxo importado',
      now: '2026-08-26T14:00:00.000Z',
    });

    expect(result).not.toBeNull();
    expect(result!.workflow).toMatchObject({
      id: 'nexus:destination-flow',
      workspaceId: 'workspace-destination',
      name: 'Fluxo importado',
      version: 'draft',
      status: 'draft',
    });
    expect(result!.workflow.nodes).toHaveLength(source.nodes.length);
    expect(result!.workflow.connections).toHaveLength(source.connections.length);
    expect(result!.validation.valid).toBe(true);
  });

  it('also accepts a direct native definition and rejects unrelated JSON', () => {
    expect(parseNexusPortableFlow(source)).toEqual(source);
    expect(parseNexusPortableFlow({ nodes: [], connections: [] })).toBeNull();
  });

  it('uses a portable, recognizable filename', () => {
    expect(nexusPortableFilename(source.name)).toBe('fluxo-comercial-sao-paulo.dialogy-nexus.json');
  });
});
