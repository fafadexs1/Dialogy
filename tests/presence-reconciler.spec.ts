import { describe, expect, it, vi, beforeEach } from 'vitest';

const { queryMock, readSnapshotsMock, sweepMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  readSnapshotsMock: vi.fn(),
  sweepMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: queryMock,
  },
}));

vi.mock('@/lib/presence-redis', () => ({
  readPresenceSnapshots: readSnapshotsMock,
}));

vi.mock('@/lib/presence-server', () => ({
  sweepStalePresence: sweepMock,
}));

import { reconcilePresenceOnce } from '@/services/presence/reconciler';

describe('reconcilePresenceOnce', () => {
  beforeEach(() => {
    queryMock.mockReset();
    readSnapshotsMock.mockReset();
    sweepMock.mockReset();
  });

  it('runs upsert query using w.workspace_id without missing column errors', async () => {
    const mockWorkspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
    readSnapshotsMock.mockResolvedValue([
      {
        workspaceId: mockWorkspaceId,
        online: [
          { userId: 'user-1', lastSeen: '2026-07-25T19:30:00.000Z' },
        ],
      },
    ]);

    queryMock.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('INSERT INTO user_workspace_presence')) {
        expect(text).toContain('w.workspace_id');
        expect(text).not.toContain('s.workspace_id');
        return { rowCount: 1, rows: [] };
      }
      if (text.includes('UPDATE user_workspace_presence')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    });

    const result = await reconcilePresenceOnce();

    expect(result).toEqual({
      workspaces: 1,
      online: 1,
      desligados: 0,
    });
    // UPSERT + desligamento no workspace + limpeza de orfaos.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('NAO chama sweepStalePresence — ela derrubaria quem acabou de marcar online', async () => {
    // Regressao real, vista em producao: sweepStalePresence decide quem esta
    // online consultando `presence_sessions`, tabela que o modo Redis nao
    // popula. O NOT EXISTS dela era sempre verdadeiro, entao ela zerava a
    // projecao logo depois do UPSERT — o reconciliador desfazendo o proprio
    // trabalho a cada 15s. Na tela: "ONLINE (0)" com todo mundo conectado.
    readSnapshotsMock.mockResolvedValue([
      {
        workspaceId: 'e3b476a1-5de8-4744-80b5-a5d23fe15fab',
        online: [{ userId: 'user-1', lastSeen: '2026-07-25T19:30:00.000Z' }],
      },
    ]);
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    await reconcilePresenceOnce();

    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('a limpeza de orfaos nao consulta presence_sessions', async () => {
    readSnapshotsMock.mockResolvedValue([
      {
        workspaceId: 'e3b476a1-5de8-4744-80b5-a5d23fe15fab',
        online: [{ userId: 'user-1', lastSeen: '2026-07-25T19:30:00.000Z' }],
      },
    ]);

    const sqls: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      sqls.push(String(sql));
      return { rowCount: 0, rows: [] };
    });

    await reconcilePresenceOnce();

    // No modo Redis a verdade e o snapshot, nunca a tabela antiga de sessoes.
    expect(sqls.some((s) => s.includes('presence_sessions'))).toBe(false);
    // E os workspaces vivos precisam ser preservados por nome.
    expect(sqls.some((s) => s.includes('NOT (workspace_id = ANY'))).toBe(true);
  });
});
