import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM public.orchestrator_runs ORDER BY created_at DESC LIMIT 1');
    if (res.rows.length > 0) {
      console.log('Columns:');
      console.log(Object.keys(res.rows[0]));
      console.log('\nLast Row Details:');
      console.log(JSON.stringify(res.rows[0], null, 2));
    } else {
      console.log('No runs found.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
