import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const configId = '2801fd91-f14f-46d0-bc45-45e1d8d9f6da';
    const res = await client.query(
      'SELECT id, name, knowledge_base, escalation_policy, closing_policy FROM autopilot_configs WHERE id = $1',
      [configId]
    );
    const row = res.rows[0];
    if (!row) {
      console.error('Config not found.');
      return;
    }
    console.log('--- RAQUEL NAME ---');
    console.log(row.name);
    console.log('\n--- RAQUEL KNOWLEDGE BASE ---');
    console.log(row.knowledge_base);
    console.log('\n--- ESCALATION POLICY ---');
    console.log(row.escalation_policy);
    console.log('\n--- CLOSING POLICY ---');
    console.log(row.closing_policy);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
