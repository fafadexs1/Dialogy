import { config } from 'dotenv';
import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

config({ path: ['.env.local', '.env'], quiet: true });
const migration = '20260913193000_asaas_checkout_attempt';

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const live = await client.query(`SELECT a.atttypid::regtype::text AS type,a.attnotnull AS required
      FROM pg_attribute a WHERE a.attrelid='public.asaas_payments'::regclass
      AND a.attname='card_attempt_started_at' AND NOT a.attisdropped`);
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    if (apply) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [migration]);
      await client.query('SET LOCAL search_path=public');
      const history = await client.query('SELECT checksum,finished_at FROM public._prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [migration]);
      if (history.rowCount && (history.rowCount !== 1 || history.rows[0].checksum !== checksum || !history.rows[0].finished_at)) {
        throw new Error('O histórico desta migração precisa ser revisado.');
      }
      if (!history.rowCount) {
        await client.query(sql);
        await client.query('INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES($1,$2,now(),$3,now(),1)', [randomUUID(), checksum, migration]);
      }
    } else {
      // Exercise the exact migration without locking or changing a live table.
      await client.query('CREATE TEMP TABLE asaas_payments(id text PRIMARY KEY) ON COMMIT DROP');
      await client.query('SET LOCAL search_path=pg_temp');
      await client.query(sql);
      await client.query(sql);
    }
    const schema = apply ? 'public' : 'pg_temp';
    const column = await client.query(`SELECT a.atttypid::regtype::text AS type,a.attnotnull AS required
      FROM pg_attribute a WHERE a.attrelid=$1::regclass AND a.attname='card_attempt_started_at' AND NOT a.attisdropped`, [`${schema}.asaas_payments`]);
    if (column.rowCount !== 1 || column.rows[0].type !== 'timestamp with time zone' || column.rows[0].required) {
      throw new Error('A coluna de proteção do checkout está divergente.');
    }
    if (!apply) {
      await client.query("INSERT INTO asaas_payments(id) VALUES('checkout-validation')");
      await client.query("UPDATE asaas_payments SET card_attempt_started_at=now() WHERE id='checkout-validation'");
      const checkpoint = await client.query("SELECT card_attempt_started_at IS NOT NULL AS saved FROM asaas_payments WHERE id='checkout-validation'");
      if (!checkpoint.rows[0].saved) throw new Error('Falha na verificação do checkpoint.');
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ migration, mode: apply ? 'applied' : 'validated in temporary table and rolled back', liveColumnBefore: live.rows[0] || null, verifiedColumn: column.rows[0] }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Falha ao validar a migração do checkout.');
  process.exitCode = 1;
});
