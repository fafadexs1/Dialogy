import { beforeEach, describe, expect, it, vi } from 'vitest';

import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';

const mocks = vi.hoisted(() => ({
  retrieveSupportContext: vi.fn(),
  rerankKnowledgeCandidates: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/services/rag/retrieval', () => ({
  retrieveSupportContext: mocks.retrieveSupportContext,
}));

vi.mock('@/services/rag/cross-encoder-reranker', () => ({
  rerankKnowledgeCandidates: mocks.rerankKnowledgeCandidates,
}));

vi.mock('@/lib/db', () => ({
  db: { query: mocks.dbQuery },
}));

const noCategoryIntent = {
  intent: 'catalog_request',
  knowledgeCategories: [],
} as any;

describe('hybrid RAG cross-encoder gate', () => {
  beforeEach(() => {
    mocks.retrieveSupportContext.mockReset();
    mocks.rerankKnowledgeCandidates.mockReset();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it('neural-reranks close candidates when deterministic scores are ambiguous', async () => {
    const first = { id: 'a', name: 'Fluxo geral', content: 'Orientacao geral.', source: 'vector', priority: 10 };
    const second = { id: 'b', name: 'Dados obrigatorios', content: 'Colete CPF.', source: 'vector', priority: 9 };
    mocks.retrieveSupportContext.mockResolvedValue({
      knowledgeBaseDocuments: [first, second],
      resolvedCases: [],
    });
    mocks.rerankKnowledgeCandidates.mockResolvedValue({
      documents: [
        { document: second, originalScore: 64, rerankerScore: 4.2 },
        { document: first, originalScore: 65, rerankerScore: -1.1 },
      ],
      diagnostics: { model: 'test', precision: 'q8', candidates: 2, elapsedMs: 10 },
    });

    const result = await retrieveHybridSupportContext({
      workspaceId: 'workspace',
      query: 'quais planos voces possuem',
      intent: noCategoryIntent,
    });

    expect(mocks.rerankKnowledgeCandidates).toHaveBeenCalledOnce();
    expect(result.selected.map((document) => document.id)).toEqual(['b', 'a']);
  });

  it('does not call the neural reranker when an exact intent category already leads', async () => {
    const billing = { id: 'billing', name: 'Financeiro', category: 'billing', content: 'Resolva pagamento.', source: 'vector', priority: 10 };
    const broad = { id: 'broad', name: 'Diagnostico', content: 'Pode existir bloqueio.', source: 'vector', priority: 9 };
    mocks.retrieveSupportContext.mockResolvedValue({
      knowledgeBaseDocuments: [billing, broad],
      resolvedCases: [],
    });

    const result = await retrieveHybridSupportContext({
      workspaceId: 'workspace',
      query: 'bloqueado por falta de pagamento',
      intent: { intent: 'billing_or_payment', knowledgeCategories: ['billing'] } as any,
    });

    expect(mocks.rerankKnowledgeCandidates).not.toHaveBeenCalled();
    expect(result.selected[0].id).toBe('billing');
  });
});
