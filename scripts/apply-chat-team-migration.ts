import 'dotenv/config';

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const MIGRATION = '20260805170000_chat_team_assignment';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente.');

  const sqlPath = resolve(process.cwd(), 'prisma/migrations', MIGRATION, 'migration.sql');
  const sql = await readFile(sqlPath, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();

  try {
    const already = await client.query(
      `SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 LIMIT 1`,
      [MIGRATION],
    );
    if ((already.rowCount ?? 0) > 0) {
      console.log(`[SKIP] ${MIGRATION} já está registrada.`);
      return;
    }

    const before = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'chats' AND column_name = 'team_id'
        ) AS has_column,
        (SELECT COUNT(*) FROM public.chats WHERE agent_id IS NOT NULL AND status <> 'encerrados') AS backfill_scope
    `);
    console.log('[ANTES]', before.rows[0]);

    await client.query('BEGIN');
    await client.query(sql);

    const invariants = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'chats' AND column_name = 'team_id'
        ) AS column_ok,
        EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chats_team_id_fkey'
        ) AS fk_ok,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_chats_workspace_team'
        ) AS index_ok,
        (SELECT COUNT(*) FROM public.chats WHERE team_id IS NOT NULL) AS rows_with_team
    `);
    const checks = invariants.rows[0];
    console.log('[VERIFICACAO]', checks);

    if (!checks.column_ok || !checks.fk_ok || !checks.index_ok) {
      throw new Error('Invariantes não satisfeitas; revertendo.');
    }

    await client.query(
      `INSERT INTO public._prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, $4, NULL, now(), 1)`,
      [randomUUID(), checksum, MIGRATION, 'Applied directly: prisma migrate deploy is unusable while _prisma_migrations is drifted.'],
    );

    await client.query('COMMIT');
    console.log(`[OK] ${MIGRATION} aplicada e registrada.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[FALHA] rollback executado:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
