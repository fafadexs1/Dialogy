const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const res = await client.query(`
    SELECT error FROM orchestrator_runs 
    ORDER BY created_at DESC 
    LIMIT 1
  `);
  
  console.log(res.rows[0]?.error);
  await client.end();
}

main().catch(console.error);
