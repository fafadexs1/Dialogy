const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const res = await client.query(
    `SELECT * FROM autopilot_usage_logs WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 5`,
    ['bfa81f51-6488-4a81-a047-6fc9185041a8']
  );
  
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch(console.error);
