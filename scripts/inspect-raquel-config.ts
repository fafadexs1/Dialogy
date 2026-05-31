import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const configId = '2801fd91-f14f-46d0-bc45-45e1d8d9f6da';
    console.log(`--- FETCHING AUTOPILOT CONFIG FOR RAQUEL (${configId}) ---`);

    const res = await client.query('SELECT * FROM autopilot_configs WHERE id = $1', [configId]);
    console.log(JSON.stringify(res.rows[0], null, 2));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
