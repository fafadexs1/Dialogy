const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('--- UPDATING CLUSTER 02 - Hosting Now to is_active = true ---');
  const clusterUpdate = await client.query(
    `UPDATE whatsapp_clusters 
     SET is_active = true 
     WHERE id = 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d' 
     RETURNING *`
  );
  console.log('Cluster updated:', clusterUpdate.rows);

  console.log('--- UPDATING zap7 INSTANCE METADATA ---');
  const instanceUpdate = await client.query(
    `UPDATE evolution_api_instances 
     SET 
       waba_id = $1, 
       phone_number_id = $2, 
       display_phone_number = $3,
       verified_name = 'Velpro 0800 381 0404'
     WHERE instance_name = 'zap7' 
     RETURNING *`,
    ['879795098324920', '889790104217284', '889790104217284']
  );
  console.log('Instance updated:', instanceUpdate.rows);

  await client.end();
}

main().catch(console.error);
