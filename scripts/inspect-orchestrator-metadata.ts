import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT *
      FROM public.orchestrator_runs
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    if (res.rows.length > 0) {
      console.log('--- DETAILS ---');
      console.log('ID:', res.rows[0].id);
      console.log('Status:', res.rows[0].status);
      console.log('Metadata:', JSON.stringify(res.rows[0].metadata, null, 2));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
