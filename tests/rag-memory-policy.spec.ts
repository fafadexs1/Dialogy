import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateDocumentQueryEmbedding: vi.fn(),
  searchSimilarDocuments: vi.fn(),
  searchKeywordDocuments: vi.fn(),
  searchSimilarCaseMemories: vi.fn(),
}));

vi.mock('@/lib/embeddings', () => ({
  generateDocumentQueryEmbedding: mocks.generateDocumentQueryEmbedding,
}));

vi.mock('@/lib/vector-store', () => ({
  VectorStore: {
    searchSimilarDocuments: mocks.searchSimilarDocuments,
    searchKeywordDocuments: mocks.searchKeywordDocuments,
    searchSimilarCaseMemories: mocks.searchSimilarCaseMemories,
  },
}));

import { isLocalRagQueryEmbeddingEnabled, retrieveSupportContext } from '@/services/rag/retrieval';

describe('RAG production memory policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED = 'false';
    mocks.searchKeywordDocuments.mockResolvedValue([{
      id: 'chunk-1',
      document_id: 'document-1',
      document_name: 'Catalogo de planos',
      content: 'O plano de 1000 mega inclui Wi-Fi 6.',
      metadata: { category: 'product_or_service_catalog' },
      similarity: 0,
      keyword_score: 8,
    }]);
  });

  it('keeps keyword retrieval active without loading the local embedding model', async () => {
    const result = await retrieveSupportContext({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'config-1',
      query: 'plano de 1000 mega',
    });

    expect(mocks.generateDocumentQueryEmbedding).not.toHaveBeenCalled();
    expect(mocks.searchSimilarDocuments).not.toHaveBeenCalled();
    expect(mocks.searchSimilarCaseMemories).not.toHaveBeenCalled();
    expect(mocks.searchKeywordDocuments).toHaveBeenCalledOnce();
    expect(result.knowledgeBaseDocuments).toEqual([
      expect.objectContaining({
        id: 'document-1',
        source: 'keyword',
        content: 'O plano de 1000 mega inclui Wi-Fi 6.',
      }),
    ]);
    expect(result.diagnostics).toMatchObject({
      localQueryEmbeddingEnabled: false,
      queryVectorLength: 0,
      vectorMatches: 0,
      keywordMatches: 1,
      caseMatches: 0,
    });
  });

  it('keeps lexical retrieval available if semantic query embedding is temporarily unavailable', async () => {
    process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED = 'true';
    mocks.generateDocumentQueryEmbedding.mockRejectedValueOnce(new Error('model warmup failed'));

    const result = await retrieveSupportContext({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'config-1',
      query: 'plano de 1000 mega',
    });

    expect(mocks.searchKeywordDocuments).toHaveBeenCalledOnce();
    expect(mocks.searchSimilarDocuments).not.toHaveBeenCalled();
    expect(result.knowledgeBaseDocuments).toEqual([
      expect.objectContaining({ id: 'document-1', source: 'keyword' }),
    ]);
    expect(result.diagnostics).toMatchObject({
      localQueryEmbeddingEnabled: true,
      queryVectorLength: 0,
      queryEmbeddingError: 'model warmup failed',
    });
  });

  it('uses semantic retrieval by default unless a deployment explicitly disables it', () => {
    const previous = process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED;
    delete process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED;
    try {
      expect(isLocalRagQueryEmbeddingEnabled()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED;
      else process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED = previous;
    }
  });
});
