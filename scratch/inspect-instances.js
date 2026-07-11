const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('--- evolution_api_instances ---');
  const res = await client.query('SELECT id, instance_name, waba_id, phone_number_id, cluster_id, workspace_id FROM evolution_api_instances');
  console.log(res.rows);

  await client.end();
}

main().catch(console.error);
