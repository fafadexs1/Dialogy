import { config } from 'dotenv';
import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
config({ path: ['.env.local', '.env'], quiet: true });
const migration = '20260913201000_asaas_resubscribe';

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='3s'");
    await c.query("SET LOCAL statement_timeout='15s'");
    if (apply) {
      await c.query('SET LOCAL search_path=public');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [migration]);
      const history = await c.query('SELECT checksum,finished_at FROM public._prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [migration]);
      if (history.rowCount && (history.rowCount !== 1 || history.rows[0].checksum !== checksum || !history.rows[0].finished_at)) throw new Error('Histórico da migração divergente.');
      if (!history.rowCount) {
        await c.query(sql);
        await c.query('INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES($1,$2,now(),$3,now(),1)', [randomUUID(), checksum, migration]);
      }
    } else {
      await c.query('CREATE TEMP TABLE asaas_subscriptions(id text PRIMARY KEY,workspace_id text NOT NULL UNIQUE,status text NOT NULL,subscription_id text UNIQUE) ON COMMIT DROP');
      await c.query('CREATE TEMP TABLE asaas_payments(id text PRIMARY KEY,subscription_id text REFERENCES asaas_subscriptions(id)) ON COMMIT DROP');
      await c.query('SET LOCAL search_path=pg_temp');
      await c.query("INSERT INTO asaas_subscriptions VALUES('old','workspace','trialing','sub_old')");
      await c.query("INSERT INTO asaas_payments VALUES('invoice','old')");
      await c.query(sql); await c.query(sql);
      await c.query("UPDATE asaas_subscriptions SET status='superseded' WHERE id='old'");
      await c.query("INSERT INTO asaas_subscriptions VALUES('new','workspace','creating','sub_new')");
      await c.query('SAVEPOINT duplicate_current');
      let rejected = false;
      try { await c.query("INSERT INTO asaas_subscriptions VALUES('duplicate','workspace','creating','sub_duplicate')"); }
      catch (error) { if ((error as { code?: string }).code !== '23505') throw error; rejected = true; }
      await c.query('ROLLBACK TO SAVEPOINT duplicate_current');
      if (!rejected) throw new Error('A proteção contra duas assinaturas atuais falhou.');
      const rows = await c.query('SELECT count(*)::int AS retained FROM asaas_payments p JOIN asaas_subscriptions s ON s.id=p.subscription_id');
      if (rows.rows[0].retained !== 1) throw new Error('O histórico da fatura não foi preservado.');
    }
    const schema = apply ? 'public' : 'pg_temp';
    const indexes = await c.query(`SELECT i.indisvalid,i.indisunique,pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_index i WHERE i.indexrelid=to_regclass($1) AND i.indrelid=$2::regclass`, [`${schema}.asaas_subscriptions_current_workspace_key`, `${schema}.asaas_subscriptions`]);
    if (indexes.rowCount !== 1 || !indexes.rows[0].indisvalid || !indexes.rows[0].indisunique || indexes.rows[0].predicate !== "(status <> 'superseded'::text)") throw new Error('Índice de assinatura atual divergente.');
    const old = await c.query("SELECT 1 FROM pg_constraint WHERE conrelid=$1::regclass AND conname='asaas_subscriptions_workspace_id_key'", [`${schema}.asaas_subscriptions`]);
    if (old.rowCount) throw new Error('A restrição antiga ainda impede a nova contratação.');
    await c.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ migration, mode: apply ? 'applied' : 'temporary-table validation rolled back', currentContractUnique: true, ...(apply ? {} : { historicalInvoicePreserved: true, duplicateCurrentRejected: true }) }));
  } catch (error) {
    await c.query('ROLLBACK'); throw error;
  } finally { await c.end(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
