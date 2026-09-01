import { describe, expect, it } from 'vitest';
import { planStudioMigration } from '@/services/agent-studio/migration';

describe('read-only legacy transition planning', () => {
  const row = { id: 'agent', workspace_id: 'workspace', name: 'Raquel', is_active: true,
    gemini_api_key: 'must-not-copy', knowledge_base: 'Instruções anteriores', default_fallback_reply: 'Vou verificar.',
    flow_graph: { nodes: [{ id: 'node', kind: 'tool', title: 'Consultar pedido' }], edges: [] }, enabled_tool_names: ['lookup'],
    knowledge_collections: [{ id: 'collection', name: 'Manual' }] };
  it('preserves basic settings without pretending tool graphs were converted', () => {
    const original = structuredClone(row); const result = planStudioMigration(row);
    expect(row).toEqual(original); expect(result.document.name).toBe('Raquel');
    expect(result.document.resolveStage.knowledgeCollectionIds).toEqual(['collection']);
    expect(result.document.resolveStage.procedures).toEqual([]);
    expect(result.report.items.filter((item) => item.status === 'review').map((item) => item.key)).toEqual(['knowledge', 'legacy-node-0', 'tools', 'activation']);
    expect(JSON.stringify(result)).not.toContain('must-not-copy');
  });
  it('detects source changes but ignores object property ordering', () => {
    expect(planStudioMigration(row).report.sourceHash).toBe(planStudioMigration({ ...row, flow_graph: { edges: [], nodes: row.flow_graph.nodes } }).report.sourceHash);
    expect(planStudioMigration(row).report.sourceHash).not.toBe(planStudioMigration({ ...row, default_fallback_reply: 'Alterada' }).report.sourceHash);
  });
  it('does not introduce a sample invoice or review blockers into an empty inactive agent', () => {
    const result = planStudioMigration({ id: 'empty', workspace_id: 'workspace', name: 'Novo' });
    expect(result.report.requiresReview).toBe(false); expect(result.document.resolveStage.procedures).toEqual([]);
  });
  it('includes exact consumer counts without making them part of the mutable legacy hash', () => {
    const inventory = { conversations: 12, systemAgents: 2, webchatWidgets: 1, publishedWorkflowReferences: 3 };
    const result = planStudioMigration(row, inventory);
    expect(result.report.inventory).toEqual(inventory);
    expect(result.report.items.find((item) => item.key === 'channels')?.detail).toContain('12 conversa(s)');
    expect(result.report.sourceHash).toBe(planStudioMigration(row).report.sourceHash);
  });
});
