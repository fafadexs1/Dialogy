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
import { hasKnowledgeDocumentIndexChanged, toCanonicalKnowledgeMarkdown } from '@/services/rag/knowledge-document';

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
    expect(mocks.deleteDocumentEmbeddings).toHaveBeenCalledWith({
      documentId: 'document-1',
      workspaceId: 'workspace-1',
      autopilotConfigId: 'agent-1',
    });
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
    expect(mocks.deleteDocumentEmbeddings).toHaveBeenCalledWith({
      documentId: 'document-2',
      workspaceId: 'workspace-1',
      autopilotConfigId: 'agent-1',
    });
    expect(mocks.generateDocumentPassageEmbedding).toHaveBeenCalledWith(
      '# Procedimento de segunda via\n\nPara emitir segunda via, valide o CPF e consulte a fatura em aberto.',
    );
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
        contentFormat: 'markdown',
        sourceFormat: 'markdown',
        category: 'commercial_plan_catalog',
        contextRole: 'fact',
        status: 'active',
        validUntilTimestamp: '2026-12-31T00:00:00.000Z',
      }),
    }));
  });

  it('preserves an existing Markdown title instead of adding a duplicate', () => {
    expect(toCanonicalKnowledgeMarkdown({
      name: 'Catalogo.md',
      content: '# Planos oficiais\n\n500 MEGA - R$99,90.',
    })).toBe('# Planos oficiais\n\n500 MEGA - R$99,90.');
  });

  it('reindexes when embedding-relevant document metadata changes', () => {
    const previous = {
      id: 'catalog-1',
      name: 'Catalogo',
      content: '500 MEGA - R$99,90.',
      category: 'commercial_plan_catalog',
    };

    expect(hasKnowledgeDocumentIndexChanged(previous, {
      ...previous,
      category: 'pricing',
    })).toBe(true);
  });

  it('stores the parent Markdown section for long procedures', async () => {
    const steps = Array.from({ length: 18 }, (_, index) => `${index + 1}. Execute a validacao operacional detalhada do passo ${index + 1}.`).join('\n');
    await ingestKnowledgeBaseDocument({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'agent-1',
      documentId: 'procedure-1',
      documentName: 'Troca de senha',
      content: `# Troca de senha\n\n## Procedimento\n\n${steps}`,
      document: {
        id: 'procedure-1',
        name: 'Troca de senha',
        category: 'tool_procedure',
        contextRole: 'procedure',
        content: `# Troca de senha\n\n## Procedimento\n\n${steps}`,
      },
    });

    expect(mocks.addDocumentEmbedding).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        parentHeading: 'Procedimento',
        parentContent: expect.stringContaining('Execute a validacao operacional'),
      }),
    }));
  });
});
