import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addDocumentEmbedding: vi.fn(),
  deleteDocumentEmbeddings: vi.fn(),
  getDocumentEmbeddingStats: vi.fn(),
  generateDocumentPassageEmbedding: vi.fn(),
}));

vi.mock('@/lib/vector-store', () => ({
  VectorStore: {
    addDocumentEmbedding: mocks.addDocumentEmbedding,
    deleteDocumentEmbeddings: mocks.deleteDocumentEmbeddings,
    getDocumentEmbeddingStats: mocks.getDocumentEmbeddingStats,
  },
}));

vi.mock('@/lib/embeddings', () => ({
  DOCUMENT_EMBEDDING_MODEL: 'bge-m3',
  DOCUMENT_EMBEDDING_DIMENSIONS: 1024,
  generateDocumentPassageEmbedding: mocks.generateDocumentPassageEmbedding,
}));

import { ingestKnowledgeBaseDocument } from '@/services/rag/document-ingestion';

describe('RAG document ingestion safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentEmbeddingStats.mockResolvedValue([]);
    mocks.generateDocumentPassageEmbedding.mockResolvedValue(Array(1024).fill(0.1));
  });

  it('quarantines conversation exports without generating embeddings', async () => {
    const result = await ingestKnowledgeBaseDocument({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'agent-1',
      documentId: 'document-1',
      documentName: 'Conversa - Cliente - 20/05/2026',
      content: 'Cliente: Oi\nAtendente: Ola',
    });

    expect(result).toMatchObject({ status: 'skipped_unsafe', chunks: 0 });
    expect(mocks.deleteDocumentEmbeddings).toHaveBeenCalledWith('document-1');
    expect(mocks.generateDocumentPassageEmbedding).not.toHaveBeenCalled();
    expect(mocks.addDocumentEmbedding).not.toHaveBeenCalled();
  });

  it('continues indexing valid knowledge documents', async () => {
    const result = await ingestKnowledgeBaseDocument({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'agent-1',
      documentId: 'document-2',
      documentName: 'Procedimento de segunda via',
      content: 'Para emitir segunda via, valide o CPF e consulte a fatura em aberto.',
    });

    expect(result.status).toBe('indexed');
    expect(mocks.generateDocumentPassageEmbedding).toHaveBeenCalled();
    expect(mocks.addDocumentEmbedding).toHaveBeenCalled();
  });

  it('indexes document validity and factual role into each chunk metadata', async () => {
    await ingestKnowledgeBaseDocument({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'agent-1',
      documentId: 'catalog-1',
      documentName: 'Catalogo de planos',
      content: '500 MEGA - R$99,90.',
      document: {
        id: 'catalog-1',
        name: 'Catalogo de planos',
        category: 'commercial_plan_catalog',
        status: 'active',
        validUntil: '2026-12-31',
        content: '500 MEGA - R$99,90.',
      },
    });

    expect(mocks.addDocumentEmbedding).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        category: 'commercial_plan_catalog',
        contextRole: 'fact',
        status: 'active',
        validUntilTimestamp: '2026-12-31T00:00:00.000Z',
      }),
    }));
  });
});
