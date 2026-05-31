import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM autopilot_configs LIMIT 1');
    if (res.rows.length > 0) {
      console.log('Columns:');
      console.log(Object.keys(res.rows[0]));
    } else {
      console.log('No rows in autopilot_configs');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
