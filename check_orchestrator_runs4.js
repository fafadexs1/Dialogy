const { Client } = require('pg');
const fs = require('fs');
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
  
  if (res.rows.length > 0) {
    fs.writeFileSync('error_out.txt', res.rows[0].error || 'no error');
  }
  await client.end();
}

main().catch(console.error);
