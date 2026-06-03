import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, tool_name, status, created_at, 
              timezone('utc', now()) as utc_now, 
              now() as local_now 
       FROM public.agent_tool_executions 
       ORDER BY created_at DESC LIMIT 5`
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
