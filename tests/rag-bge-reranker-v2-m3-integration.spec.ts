import { beforeEach, describe, expect, it, vi } from 'vitest';

import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';

const mocks = vi.hoisted(() => ({
  retrieveSupportContext: vi.fn(),
  rerankKnowledgeCandidatesWithBgeV2M3: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/services/rag/retrieval', () => ({
  retrieveSupportContext: mocks.retrieveSupportContext,
}));

vi.mock('@/services/rag/bge-reranker-v2-m3', () => ({
  rerankKnowledgeCandidatesWithBgeV2M3: mocks.rerankKnowledgeCandidatesWithBgeV2M3,
}));

vi.mock('@/lib/db', () => ({
  db: { query: mocks.dbQuery },
}));

const noCategoryIntent = {
  intent: 'catalog_request',
  knowledgeCategories: [],
} as any;

describe('hybrid RAG always-on BGE Reranker v2 M3', () => {
  beforeEach(() => {
    mocks.retrieveSupportContext.mockReset();
    mocks.rerankKnowledgeCandidatesWithBgeV2M3.mockReset();
    mocks.rerankKnowledgeCandidatesWithBgeV2M3.mockImplementation(async (_query, candidates) => ({
      documents: candidates.map((candidate: any, index: number) => ({
        ...candidate,
        rerankerScore: candidates.length - index,
      })),
      diagnostics: { model: 'bge-reranker-v2-m3', precision: 'q8', candidates: candidates.length, elapsedMs: 10 },
    }));
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it('neural-reranks close candidates when deterministic scores are ambiguous', async () => {
    const first = { id: 'a', name: 'Fluxo geral', content: 'Orientacao geral.', source: 'vector', priority: 10 };
    const second = { id: 'b', name: 'Dados obrigatorios', content: 'Colete CPF.', source: 'vector', priority: 9 };
    mocks.retrieveSupportContext.mockResolvedValue({
      knowledgeBaseDocuments: [first, second],
      resolvedCases: [],
    });
    mocks.rerankKnowledgeCandidatesWithBgeV2M3.mockResolvedValue({
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

    expect(mocks.rerankKnowledgeCandidatesWithBgeV2M3).toHaveBeenCalledOnce();
    expect(result.selected.map((document) => document.id)).toEqual(['b', 'a']);
  });

  it('uses BGE Reranker v2 M3 even when an exact intent category already leads', async () => {
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

    expect(mocks.rerankKnowledgeCandidatesWithBgeV2M3).toHaveBeenCalledOnce();
    expect(result.selected[0].id).toBe('billing');
  });

  it('performs only one corrective retrieval when the first search has low coverage', async () => {
    mocks.retrieveSupportContext
      .mockResolvedValueOnce({ knowledgeBaseDocuments: [], resolvedCases: [] })
      .mockResolvedValueOnce({
        knowledgeBaseDocuments: [{
          id: 'support',
          name: 'Diagnostico de suporte',
          category: 'support',
          content: 'Valide o equipamento e a conexao.',
          source: 'vector',
          priority: 100,
        }],
        resolvedCases: [],
      });

    const result = await retrieveHybridSupportContext({
      workspaceId: 'workspace',
      query: 'nao funciona',
      intent: { intent: 'support_request', knowledgeCategories: ['support'] } as any,
    });

    expect(mocks.retrieveSupportContext).toHaveBeenCalledTimes(2);
    expect(result.knowledgeBaseDocuments[0].id).toBe('support');
    expect(result.diagnostics?.correctiveRetrieval).toMatchObject({
      attempted: true,
      recoveredDocuments: 1,
    });
  });
});
