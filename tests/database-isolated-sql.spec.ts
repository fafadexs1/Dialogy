import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mock = vi.hoisted(() => ({ databases: new Map<string, PGlite>() }));
vi.mock('pg', () => ({ Client: vi.fn(function(config: { connectionString: string }) {
  const database = mock.databases.get(new URL(config.connectionString).hostname);
  if (!database) throw new Error('Credencial de teste desconhecida.');
  return { connect: async () => undefined, end: async () => undefined,
    query: async (sql: string, params: unknown[]) => { const result = await database.query(sql, params); return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }; } };
}) }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('@/modules/nexus/services/credentials', () => ({ loadNexusCredentialPayload: async ({ workspaceId, credentialId }: { workspaceId: string; credentialId: string }) => {
  if (credentialId !== `credential-${workspaceId}` || !['a', 'b'].includes(workspaceId)) throw new Error('Credencial não encontrada neste workspace.');
  return { payload: { connectionString: `postgres://example@${workspaceId}/db`, ssl: false } };
} }));
import { executeNexusDatabaseOperation } from '@/modules/nexus/services/integration-executors';

beforeAll(async () => {
  for (const workspace of ['a', 'b']) {
    const database = new PGlite(); mock.databases.set(workspace, database);
    await database.exec(`CREATE TABLE orders(id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, '${workspace}'), (2, 'other');`);
  }
}, 30000);
afterAll(async () => { for (const database of mock.databases.values()) await database.close(); });

describe('SQL PostgreSQL isolado por credencial do workspace', () => {
  it('aplica filtros parametrizados e mantém valores como dados literais', async () => {
    const injection = "x'; DROP TABLE orders; --";
    await executeNexusDatabaseOperation({ workspaceId: 'a', credentialId: 'credential-a', runtimeSource: {}, preResolved: true, config: { operation: 'update', table: 'orders', values: { note: injection }, filters: [{ column: 'id', operator: 'eq', value: 1 }] } });
    const selected = await executeNexusDatabaseOperation({ workspaceId: 'a', credentialId: 'credential-a', runtimeSource: {}, config: { operation: 'select', table: 'orders', filters: [{ column: 'id', operator: 'eq', value: 1 }] } });
    expect(selected.rows).toEqual([{ id: 1, note: injection }]);
    expect((await mock.databases.get('a')!.query('SELECT count(*)::int AS n FROM orders')).rows).toEqual([{ n: 2 }]);
    expect((await mock.databases.get('b')!.query('SELECT note FROM orders WHERE id=1')).rows).toEqual([{ note: 'b' }]);
  });
  it('recusa credencial de outro workspace antes de executar consulta', async () => {
    await expect(executeNexusDatabaseOperation({ workspaceId: 'b', credentialId: 'credential-a', runtimeSource: {}, config: { operation: 'select', table: 'orders' } })).rejects.toThrow(/workspace/);
  });
  it('limita SELECT a no máximo mil linhas', async () => {
    await mock.databases.get('b')!.exec('INSERT INTO orders SELECT n, n::text FROM generate_series(3, 1005) AS n');
    const selected = await executeNexusDatabaseOperation({ workspaceId: 'b', credentialId: 'credential-b', runtimeSource: {}, config: { operation: 'select', table: 'orders', limit: 5000 } });
    expect(selected.rows).toHaveLength(1000);
  });
});
