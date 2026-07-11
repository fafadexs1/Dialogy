const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('--- SYNCING ROUTES FROM evolution_api_instances ---');
  const instancesQuery = await client.query(
    `SELECT id, waba_id, phone_number_id, cluster_id, workspace_id 
     FROM evolution_api_instances 
     WHERE phone_number_id IS NOT NULL OR waba_id IS NOT NULL`
  );

  let count = 0;

  for (const inst of instancesQuery.rows) {
    const clusterId = inst.cluster_id;
    const wabaId = inst.waba_id || 'waba-unknown';
    const phoneNumberId = inst.phone_number_id;

    // Sync WABA Route first if waba_id and cluster_id are present
    if (inst.waba_id && clusterId) {
      await client.query(
        `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, estado, version)
         VALUES ($1, $2, 'active', 1)
         ON CONFLICT (waba_id) DO UPDATE SET cluster_id = $2, updated_at = NOW()`,
        [inst.waba_id, clusterId]
      );
    }

    // Sync Phone Route if phone_number_id is present
    if (phoneNumberId) {
      // Resolve cluster_id to create WABA route placeholder if necessary
      if (clusterId) {
        await client.query(
          `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, estado, version)
           VALUES ($1, $2, 'active', 1)
           ON CONFLICT (waba_id) DO NOTHING`,
          [wabaId, clusterId]
        );
      }

      await client.query(
        `INSERT INTO meta_whatsapp_phone_routes (phone_number_id, waba_id, instance_id, workspace_id, estado)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (phone_number_id) DO UPDATE SET 
           waba_id = $2, 
           instance_id = $3, 
           workspace_id = $4, 
           updated_at = NOW()`,
        [phoneNumberId, wabaId, inst.id, inst.workspace_id]
      );
    }

    count++;
  }

  console.log(`Successfully synced ${count} routes.`);
  await client.end();
}

main().catch(console.error);
