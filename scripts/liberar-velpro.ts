import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
    const targetDate = '2026-10-05 23:59:59-03:00';

    console.log('=== LIBERAÇÃO DA WORKSPACE VELPRO TELECOM ===');
    console.log(`Workspace ID: ${workspaceId}`);
    console.log(`Data limite: ${targetDate} (05/10/2026 às 23:59:59 BRT)`);

    await client.query('BEGIN');

    // 1. Atualizar billing_info
    const billingUpdate = await client.query(
      `UPDATE billing_info
       SET status = 'active',
           access_until = $1,
           updated_at = NOW()
       WHERE workspace_id = $2
       RETURNING *`,
      [targetDate, workspaceId]
    );
    console.log('\n[1] billing_info atualizado:');
    console.log(billingUpdate.rows[0]);

    // 2. Atualizar asaas_subscriptions (assinatura vigente / não-superseded)
    const subsUpdate = await client.query(
      `UPDATE asaas_subscriptions
       SET status = 'active',
           trial_until = $1,
           paid_until = $1,
           canceled_at = NULL,
           updated_at = NOW()
       WHERE workspace_id = $2 AND status <> 'superseded'
       RETURNING *`,
      [targetDate, workspaceId]
    );
    console.log('\n[2] asaas_subscriptions atualizado:');
    console.log(subsUpdate.rows);

    await client.query('COMMIT');
    console.log('\nTransação confirmada com sucesso (COMMIT)!');

    // 3. Verificação de status
    const verifyStatus = await client.query(
      `SELECT 
         b.workspace_id,
         w.name,
         b.plan,
         b.status as raw_status,
         b.provider,
         b.access_until,
         CASE WHEN b.provider='asaas' AND (b.access_until IS NULL OR b.access_until < now()) THEN 'past_due' ELSE b.status END AS computed_billing_status
       FROM billing_info b
       JOIN workspaces w ON w.id = b.workspace_id
       WHERE b.workspace_id = $1`,
      [workspaceId]
    );
    console.log('\n[3] Status computado da workspace:');
    console.log(verifyStatus.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao liberar workspace:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
