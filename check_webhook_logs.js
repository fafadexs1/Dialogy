const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const res = await client.query(`
    SELECT * FROM webhook_logs 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch(console.error);
