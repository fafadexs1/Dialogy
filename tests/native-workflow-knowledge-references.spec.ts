import { describe, expect, it } from 'vitest';

import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import {
  removeNativeKnowledgeReferences,
  selectNativeKnowledgeDocuments,
} from '@/services/workflow-runtime/native-knowledge-references';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';

function definitionWithRetriever(): WorkflowDefinition {
  const retriever = createWorkflowNode('knowledge.rag_retriever', {
    id: 'knowledge',
    position: { x: 0, y: 0 },
    config: {
      documentIds: ['doc-a', 'doc-b'],
      filters: { collectionIds: ['collection-a', 'collection-b'], category: 'support' },
    },
  });
  return {
    id: 'workflow',
    workspaceId: 'workspace',
    version: 'draft',
    name: 'Knowledge references',
    status: 'draft',
    nodes: [retriever],
    connections: [],
    settings: {
      executionTimeoutMs: 120_000,
      maxSteps: 100,
      maxModelCalls: 15,
      maxToolCalls: 20,
      maxAgentTurnsPerNode: 8,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 100_000,
      maxTotalOutputTokens: 20_000,
      concurrencyLimit: 1,
    },
    inputSchema: {},
    outputSchema: {},
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('native workflow knowledge references', () => {
  it('removes deleted document IDs while preserving the remaining scope', () => {
    const next = removeNativeKnowledgeReferences(definitionWithRetriever(), { documentId: 'doc-a' });
    expect(next.nodes[0].config.documentIds).toEqual(['doc-b']);
    expect((next.nodes[0].config.filters as Record<string, unknown>).collectionIds).toEqual(['collection-a', 'collection-b']);
  });

  it('removes deleted collection IDs without discarding other filters', () => {
    const next = removeNativeKnowledgeReferences(definitionWithRetriever(), { collectionId: 'collection-a' });
    expect(next.nodes[0].config.filters).toEqual({ collectionIds: ['collection-b'], category: 'support' });
    expect(next.nodes[0].config.documentIds).toEqual(['doc-a', 'doc-b']);
  });

  it('turns the last explicit reference into an empty selection instead of a stale ID', () => {
    const definition = definitionWithRetriever();
    definition.nodes[0].config.documentIds = ['doc-a'];
    definition.nodes[0].config.filters = { collectionIds: ['collection-a'] };
    const next = removeNativeKnowledgeReferences(definition, {
      documentId: 'doc-a',
      collectionId: 'collection-a',
    });
    expect(next.nodes[0].config.documentIds).toEqual([]);
    expect((next.nodes[0].config.filters as Record<string, unknown>).collectionIds).toEqual([]);
  });

  it('scopes sandbox retrieval to the documents selected by the native retriever', () => {
    const definition = definitionWithRetriever();
    const selected = selectNativeKnowledgeDocuments(definition.nodes, [
      { id: 'doc-a', name: 'A', content: 'A', collectionIds: ['collection-a'] },
      { id: 'doc-b', name: 'B', content: 'B', collectionIds: ['collection-b'] },
      { id: 'doc-c', name: 'C', content: 'C', collectionIds: ['collection-a'] },
    ]);
    expect(selected.map((document) => document.id)).toEqual(['doc-a', 'doc-b']);
  });
});
