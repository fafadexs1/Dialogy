const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('--- whatsapp_clusters ---');
  const res = await client.query('SELECT id, name, is_active FROM whatsapp_clusters');
  console.log(res.rows);

  await client.end();
}

main().catch(console.error);
