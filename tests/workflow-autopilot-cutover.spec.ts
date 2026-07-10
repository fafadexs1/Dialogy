import { describe, expect, it } from 'vitest';
import { buildAutopilotCutoverPreview } from '@/services/workflow-runtime';
import type { AutopilotFlowGraph } from '@/lib/types';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  user_id: '33333333-3333-4333-8333-333333333333',
  name: 'Atendimento',
  ai_model: 'googleai/gemini-2.5-flash',
  knowledge_base: 'Persona original, sem reescrita.',
  knowledge_base_documents: [{ id: 'doc-1' }],
  knowledge_collections: [{ id: 'collection-1' }],
  enabled_tool_names: ['consultar_cliente', 'mcp:crm:buscar_contato'],
};

describe('autopilot native cutover', () => {
  it('creates a valid single-agent workflow and preserves global capabilities when no graph exists', () => {
    const result = buildAutopilotCutoverPreview({ ...base, flow_graph: null });
    expect(result.strategy).toBe('single_agent_template');
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.diff).toMatchObject({
      personaPreserved: true,
      modelPreserved: true,
      tools: ['consultar_cliente', 'mcp:crm:buscar_contato'],
      collectionIds: ['collection-1'],
      documentIds: ['doc-1'],
    });
    const agent = result.workflow.nodes.find((node) => node.type === 'ai.agent');
    expect(result.workflow.connections.filter((edge) => edge.targetNodeId === agent?.id && edge.connectionType === 'tool')).toHaveLength(2);
  });

  it('faithfully migrates an existing graph instead of replacing it with a template', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', title: 'Início', subtitle: '', position: { x: 0, y: 0 }, config: {} },
        { id: 'specialist', kind: 'sub_agent', title: 'Especialista legado', subtitle: '', position: { x: 300, y: 0 }, config: { instructions: 'Diagnostique.' } },
        { id: 'end', kind: 'end', title: 'Fim', subtitle: '', position: { x: 600, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'a', source: 'start', target: 'specialist' },
        { id: 'b', source: 'specialist', target: 'end' },
      ],
    };
    const result = buildAutopilotCutoverPreview({ ...base, flow_graph: graph });
    expect(result.strategy).toBe('legacy_graph');
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.workflow.nodes.some((node) => node.name === 'Especialista legado')).toBe(true);
    expect(result.diff.personaPreserved).toBe(true);
  });

  it('produces a stable source hash for the same legacy inputs', () => {
    const first = buildAutopilotCutoverPreview({ ...base, flow_graph: null });
    const second = buildAutopilotCutoverPreview({ ...base, flow_graph: null });
    expect(second.sourceHash).toBe(first.sourceHash);
  });

  it('falls back safely when a legacy graph cannot be published', () => {
    const broken: AutopilotFlowGraph = {
      version: 1,
      nodes: [{ id: 'orphan', kind: 'message', title: 'Órfão', subtitle: '', position: { x: 0, y: 0 }, config: { message: 'Oi' } }],
      edges: [],
    };
    const result = buildAutopilotCutoverPreview({ ...base, flow_graph: broken });
    expect(result.strategy).toBe('single_agent_fallback');
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.warnings.some((warning) => warning.startsWith('legacy_graph_fallback:'))).toBe(true);
    expect(result.workflow.metadata?.legacyMigrationFallback).toBe(true);
    expect(result.diff).toMatchObject({ personaPreserved: true, modelPreserved: true });
  });
});
