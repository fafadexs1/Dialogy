import { describe, expect, it, vi } from 'vitest';

import {
  RECONCILIATION_CONFIRMATION,
  auditMigrations,
  checksumMigration,
  inferMigrationInvariants,
  reconcileVerifiedMigrations,
  type LocalMigration,
} from '../src/services/migrations/reconciliation';

function migration(sql: string, blockers: string[] = []): LocalMigration {
  const inferred = inferMigrationInvariants(sql);
  return { name: '20260101000000_safe', sql, checksum: checksumMigration(sql), invariants: inferred.invariants, blockers: [...inferred.blockers, ...blockers] };
}

describe('Prisma migration reconciliation', () => {
  it('infers catalog postconditions and blocks data backfills', () => {
    const result = inferMigrationInvariants(`
      CREATE TABLE public.widgets (id uuid);
      ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS label text;
      CREATE INDEX IF NOT EXISTS widgets_label_idx ON public.widgets(label);
      UPDATE public.widgets SET label = '' WHERE label IS NULL;
    `);
    expect(result.invariants).toEqual(expect.arrayContaining([
      { kind: 'table', schema: 'public', name: 'widgets', present: true },
      { kind: 'column', schema: 'public', table: 'widgets', name: 'label', present: true },
      { kind: 'index', schema: 'public', name: 'widgets_label_idx', present: true },
    ]));
    expect(result.blockers).toContain('contains_data_mutation_requiring_manual_invariant');
  });

  it('verifies a cutover default as a first-class catalog invariant', () => {
    const result = inferMigrationInvariants(`
      ALTER TABLE public.autopilot_configs
        ALTER COLUMN workflow_builder_mode SET DEFAULT 'native_v2';
    `);
    expect(result.invariants).toContainEqual({
      kind: 'column_default',
      schema: 'public',
      table: 'autopilot_configs',
      name: 'workflow_builder_mode',
      expected: "'native_v2'",
      present: true,
    });
  });

  it('never treats an unresolved failed ledger row as reconcilable', async () => {
    const local = migration('CREATE TABLE public.widgets (id uuid);');
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ migration_name: local.name, checksum: local.checksum, finished_at: null, rolled_back_at: null }] })
        .mockResolvedValueOnce({ rows: [{ present: true }] }),
    };
    const [result] = await auditMigrations(db as never, [local]);
    expect(result.status).toBe('failed_ledger_entry');
  });

  it('requires exact confirmation and explicit migration selection before writes', async () => {
    const pool = { connect: vi.fn() };
    await expect(reconcileVerifiedMigrations(pool as never, [], { confirmation: '', names: [] })).rejects.toThrow('confirmation');
    await expect(reconcileVerifiedMigrations(pool as never, [], { confirmation: RECONCILIATION_CONFIRMATION, names: [] })).rejects.toThrow('selected');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('inserts ledger rows only after a transaction-local re-audit passes', async () => {
    const local = migration('CREATE TABLE public.widgets (id uuid);');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public._prisma_migrations')) return { rows: [] };
      if (sql.includes('information_schema.tables')) return { rows: [{ present: true }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    await expect(reconcileVerifiedMigrations(pool as never, [local], {
      confirmation: RECONCILIATION_CONFIRMATION,
      names: [local.name],
    })).resolves.toEqual([local.name]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO public._prisma_migrations'))).toBe(true);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('rolls back when a catalog invariant is absent', async () => {
    const local = migration('CREATE TABLE public.widgets (id uuid);');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public._prisma_migrations')) return { rows: [] };
      if (sql.includes('information_schema.tables')) return { rows: [{ present: false }] };
      return { rows: [] };
    });
    const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) };
    await expect(reconcileVerifiedMigrations(pool as never, [local], {
      confirmation: RECONCILIATION_CONFIRMATION,
      names: [local.name],
    })).rejects.toThrow('missing_blocked');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});
