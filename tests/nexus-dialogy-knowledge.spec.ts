import { describe, expect, it } from 'vitest';

import {
  loadWorkspaceDialogyKnowledge,
  retrieveNexusDialogyKnowledge,
} from '@/modules/nexus/services/dialogy-knowledge';
import { WorkflowExecutionSchema, createWorkflowNode } from '@/services/workflow-runtime';

describe('Nexus Dialogy knowledge resources', () => {
  it('loads and deduplicates the native Dialogy knowledge library for the workspace', async () => {
    const database = {
      query: async () => ({
        rows: [
          {
            id: 'agent-1',
            name: 'Comercial',
            knowledge_collections: [{ id: 'plans', name: 'Planos' }],
            knowledge_base_documents: [
              { id: '11111111-1111-4111-8111-111111111111', name: 'Planos 2026', content: '500 mega por R$ 99,90.', collectionIds: ['plans'], status: 'active' },
            ],
          },
          {
            id: 'agent-2',
            name: 'Suporte',
            knowledge_collections: [],
            knowledge_base_documents: [
              { id: '22222222-2222-4222-8222-222222222222', name: 'Reiniciar roteador', content: 'Desligue por 30 segundos.', status: 'active' },
              { id: '33333333-3333-4333-8333-333333333333', name: 'Arquivado', content: 'Não usar.', status: 'archived' },
            ],
          },
        ],
      }),
    };
    const library = await loadWorkspaceDialogyKnowledge('workspace-1', database as never);
    expect(library.documents).toHaveLength(2);
    expect(library.documents[0]).toMatchObject({ owner: 'Comercial', collectionIds: ['plans'] });
    expect(library.documents[1]).toMatchObject({ owner: 'Suporte', collectionIds: ['general'] });
    expect(library.collections.map((collection) => collection.id)).toEqual(['general', 'plans']);
  });

  it('scopes retrieval to the documents selected in the native knowledge node', async () => {
    const node = createWorkflowNode('knowledge.rag_retriever', {
      id: 'knowledge',
      position: { x: 0, y: 0 },
      config: {
        documentIds: ['11111111-1111-4111-8111-111111111111'],
        filters: { collectionIds: ['plans'] },
        maxDocuments: 3,
      },
    });
    const execution = WorkflowExecutionSchema.parse({
      executionId: 'execution-1', workflowId: 'workflow-1', workflowVersion: 'v1',
      status: 'running', currentNodeId: 'agent', previousNodeId: null, pendingNodeIds: [],
      input: { customerMessage: 'Quais são os planos?' }, variables: {}, context: {}, nodeResults: {}, executionPath: [],
      startedAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
      totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0,
    });
    const documents = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Planos', content: '500 mega por R$ 99,90.', collectionIds: ['plans'] },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Suporte', content: 'Reinicie o roteador.', collectionIds: ['support'] },
    ];
    const calls: Array<Record<string, unknown>> = [];
    const result = await retrieveNexusDialogyKnowledge({
      workspaceId: 'workspace-1',
      execution,
      knowledgeNodes: [node],
      library: { documents, collections: [] },
      retrieve: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return {
          knowledgeBaseDocuments: [documents[0]], resolvedCases: [], provenance: [],
          strategy: 'static_documents', knowledgeCoverage: 'high', retrieved: { vectorDocuments: 0, staticDocuments: 1, resolvedCases: 0 },
          selected: [], discarded: [],
        };
      },
    });
    expect(calls[0]).toMatchObject({
      query: 'Quais são os planos?',
      allowedDocumentIds: ['11111111-1111-4111-8111-111111111111'],
      staticDocuments: [expect.objectContaining({ name: 'Planos' })],
    });
    expect(result).toEqual([expect.objectContaining({ name: 'Planos', content: '500 mega por R$ 99,90.' })]);
  });
});
