import { config } from 'dotenv';
import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

config({ path: ['.env.local', '.env'], quiet: true });
const migration = '20260912160000_platform_ai_credits';
const tables = ['ai_platform_settings', 'ai_provider_credentials', 'ai_credit_wallets', 'ai_credit_entries', 'ai_credit_calls', 'ai_credit_orders'];

async function main() {
  const sql = await readFile(resolve('prisma/migrations', migration, 'migration.sql'), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis:8000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [migration]);
    const previous = await client.query('SELECT checksum,finished_at FROM public._prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [migration]);
    if (previous.rowCount) {
      if (previous.rows.length !== 1 || previous.rows[0].checksum !== checksum || !previous.rows[0].finished_at) throw new Error('Migration history differs; manual inspection required.');
      console.log('Migration already applied.');
    } else {
      const before = await client.query('SELECT count(*)::int AS agents FROM public.autopilot_configs');
      await client.query(sql);
      await client.query('INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ($1,$2,now(),$3,now(),1)', [randomUUID(), checksum, migration]);
      const after = await client.query('SELECT count(*)::int AS agents FROM public.autopilot_configs');
      console.log(JSON.stringify({ agentsBefore: before.rows[0].agents, agentsAfter: after.rows[0].agents }));
    }
    const checks = await client.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
      has_table_privilege('anon',c.oid,'SELECT') AS anon_read,
      has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,
      has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE') AS server_access
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [tables]);
    if (checks.rows.length !== tables.length || checks.rows.some(r => !r.rls || r.anon_read || r.authenticated_read || !r.server_access)) throw new Error('Schema security verification failed.');
    await client.query('COMMIT');
    console.log(JSON.stringify({ migration, status: 'verified', tables: checks.rows }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch(error => {console.error(error instanceof Error ? error.message : 'Migration failed');process.exitCode=1;});
