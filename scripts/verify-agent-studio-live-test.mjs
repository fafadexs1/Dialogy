import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

// Applies only this additive migration, never other pending workspace migrations.
const name = '20260830210000_agent_studio_live_tests';
const sql = await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  const client = await pool.connect();
  try {
    if (process.argv.includes('--apply')) {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [name]);
      const previous = await client.query('SELECT checksum, finished_at FROM _prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [name]);
      if (previous.rows.length) {
        if (previous.rows.length !== 1 || previous.rows[0].checksum !== checksum || !previous.rows[0].finished_at) throw new Error('Migration history needs review; nothing was changed.');
      } else {
        await client.query(sql);
        await client.query('INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1,$2,clock_timestamp(),$3,clock_timestamp(),1)', [randomUUID(), checksum, name]);
      }
      await client.query('COMMIT');
    }
    const result = await client.query(`SELECT to_regclass('public.agent_studio_live_tests') IS NOT NULL AS table_exists,
      (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.agent_studio_live_tests')) AS rls_enabled`);
    console.log(JSON.stringify({ migration: name, ...result.rows[0] }));
    if (result.rows[0].table_exists) {
      const privileges = await client.query("SELECT has_table_privilege('authenticated','public.agent_studio_live_tests','UPDATE') AS browser_can_write, has_table_privilege('anon','public.agent_studio_live_tests','SELECT') AS anonymous_can_read");
      console.log(JSON.stringify(privileges.rows[0]));
      const probe = await client.query('SELECT id, chat_id, revision FROM agent_studio_live_tests LIMIT 0');
      console.log(JSON.stringify({ schema_query_ok: Array.isArray(probe.rows) }));
    }
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
} catch (error) { console.error(error instanceof Error ? error.message : 'Database verification failed.'); process.exitCode = 1; }
finally { await pool.end(); }
