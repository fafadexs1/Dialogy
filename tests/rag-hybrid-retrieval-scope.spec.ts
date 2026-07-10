import { beforeEach, describe, expect, it, vi } from 'vitest';

import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';

const mocks = vi.hoisted(() => ({
  retrieveSupportContext: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/services/rag/retrieval', () => ({
  retrieveSupportContext: mocks.retrieveSupportContext,
}));

vi.mock('@/lib/db', () => ({
  db: { query: mocks.dbQuery },
}));

describe('hybrid RAG document scope', () => {
  beforeEach(() => {
    mocks.retrieveSupportContext.mockReset();
    mocks.retrieveSupportContext.mockResolvedValue({
      knowledgeBaseDocuments: [],
      resolvedCases: [],
    });
    mocks.dbQuery.mockReset();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it('does not merge a static document outside the active knowledge-step allowlist', async () => {
    const result = await retrieveHybridSupportContext({
      workspaceId: 'workspace',
      query: 'Como emitir a fatura?',
      allowedDocumentIds: ['billing-only'],
      staticDocuments: [
        {
          id: 'billing-only',
          name: 'Segunda via de fatura',
          category: 'billing',
          content: 'A segunda via da fatura fica disponivel no portal do cliente.',
        },
        {
          id: 'out-of-scope-sales',
          name: 'Tabela comercial',
          category: 'pricing',
          content: 'Plano especial fora do escopo desta etapa.',
        },
      ],
    });

    expect(result.knowledgeBaseDocuments.map((document) => document.id)).toEqual(['billing-only']);
    expect(result.selected.map((document) => document.id)).toEqual(['billing-only']);
    expect(result.retrieved.staticDocuments).toBe(1);
    expect(mocks.retrieveSupportContext).toHaveBeenCalledWith(expect.objectContaining({
      allowedDocumentIds: ['billing-only'],
    }));
  });
});
