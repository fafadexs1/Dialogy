import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getMetaRoutingOverview } from '@/actions/meta-routing';

let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(`CREATE TABLE meta_whatsapp_deliveries (
    status text, created_at timestamptz, updated_at timestamptz
  )`);
}, 30000);
afterAll(async () => { await sql?.close(); });
beforeEach(async () => {
  await sql.exec('TRUNCATE meta_whatsapp_deliveries');
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin' } } });
  mocks.query.mockReset();
  // Execute the actual action's statistics SQL on PostgreSQL; unrelated
  // lookups use fixtures and no external database is touched by this test.
  mocks.query.mockImplementation(async (query: string) => {
    if (query.includes('EXTRACT(EPOCH') || query.includes('COUNT(*)')) {
      return sql.query(query);
    }
    if (query.includes('is_superadmin')) return { rowCount: 1, rows: [{ is_superadmin: true }] };
    if (query.includes('information_schema.tables')) return { rowCount: 1, rows: [{}] };
    return { rowCount: 0, rows: [] };
  });
});

describe('Meta routing overview latency on PostgreSQL', () => {
  it('loads durations beyond the 32-bit millisecond limit', async () => {
    await sql.exec(`INSERT INTO meta_whatsapp_deliveries VALUES
      ('processed', '2026-01-01Z', '2026-02-01Z')`);
    const result = await getMetaRoutingOverview();
    expect(result.error).toBeUndefined();
    expect(result.data?.statistics).toMatchObject({
      avgLatencyMs: 2678400000, maxLatencyMs: 2678400000, successRate: 100,
    });
  });

  it('returns zero latency when there are no processed deliveries', async () => {
    await sql.exec(`INSERT INTO meta_whatsapp_deliveries VALUES
      ('pending', '2026-01-01Z', '2026-02-01Z')`);
    const result = await getMetaRoutingOverview();
    expect(result.error).toBeUndefined();
    expect(result.data?.statistics).toMatchObject({
      pendingCount: 1, avgLatencyMs: 0, maxLatencyMs: 0,
    });
  });

  it('preserves measured zero latency instead of invented defaults', async () => {
    await sql.exec(`INSERT INTO meta_whatsapp_deliveries VALUES
      ('processed', '2026-01-01Z', '2026-01-01Z')`);
    const result = await getMetaRoutingOverview();
    expect(result.data?.statistics).toMatchObject({ avgLatencyMs: 0, maxLatencyMs: 0 });
  });

  it('does not query routing data for an unauthenticated request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await getMetaRoutingOverview()).toEqual({ data: null, error: 'Acesso não autorizado.' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
