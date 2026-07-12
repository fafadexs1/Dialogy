import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { query: mocks.dbQuery },
}));

vi.mock('@/lib/embeddings', () => ({
  DOCUMENT_EMBEDDING_MODEL: 'bge-m3',
  DOCUMENT_EMBEDDING_DIMENSIONS: 1024,
}));

import { VectorStore } from '@/lib/vector-store';

describe('RAG document embedding deletion tenant isolation', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.dbQuery.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('scopes a document deletion by workspace and agent configuration', async () => {
    await VectorStore.deleteDocumentEmbeddings({
      documentId: 'shared-document-id',
      workspaceId: 'workspace-a',
      autopilotConfigId: 'agent-a',
    });

    const [sql, params] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain('document_id = $1');
    expect(sql).toContain('workspace_id = $2');
    expect(sql).toContain('autopilot_config_id = $3');
    expect(params).toEqual(['shared-document-id', 'workspace-a', 'agent-a']);
  });

  it('cannot cross-delete the same client-supplied document id in another tenant', async () => {
    await VectorStore.deleteDocumentEmbeddings({
      documentId: 'client-controlled-id',
      workspaceId: 'workspace-a',
      autopilotConfigId: 'agent-a',
    });
    await VectorStore.deleteDocumentEmbeddings({
      documentId: 'client-controlled-id',
      workspaceId: 'workspace-b',
      autopilotConfigId: 'agent-b',
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('workspace_id = $2'),
      ['client-controlled-id', 'workspace-a', 'agent-a'],
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('workspace_id = $2'),
      ['client-controlled-id', 'workspace-b', 'agent-b'],
    );
  });

  it('treats an explicit null agent as an isolated config-less scope', async () => {
    await VectorStore.deleteDocumentEmbeddings({
      documentId: 'workspace-document',
      workspaceId: 'workspace-a',
      autopilotConfigId: null,
    });

    const [sql, params] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain('workspace_id = $2');
    expect(sql).toContain('autopilot_config_id IS NULL');
    expect(params).toEqual(['workspace-document', 'workspace-a']);
  });

  it('rejects deletion when the mandatory workspace scope is missing', async () => {
    await expect(VectorStore.deleteDocumentEmbeddings({
      documentId: 'document-a',
      workspaceId: '',
      autopilotConfigId: 'agent-a',
    })).rejects.toThrow('workspaceId is required');

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it('rejects a runtime caller that omits the mandatory agent scope', async () => {
    await expect(VectorStore.deleteDocumentEmbeddings({
      documentId: 'document-a',
      workspaceId: 'workspace-a',
      // Simulates stale JavaScript bypassing the TypeScript contract.
      autopilotConfigId: undefined,
    } as never)).rejects.toThrow('autopilotConfigId is required');

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
