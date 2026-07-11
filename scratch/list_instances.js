const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  try {
    console.log('--- ALL INSTANCES IN evolution_api_instances ---');
    const instRes = await client.query(`
      SELECT i.id, i.workspace_id, w.name as workspace_name, i.instance_name, i.display_name, i.cluster_id, c.name as cluster_name, i.waba_id, i.phone_number_id, i.created_at
      FROM public.evolution_api_instances i
      LEFT JOIN public.whatsapp_clusters c ON i.cluster_id = c.id
      LEFT JOIN public.workspaces w ON i.workspace_id = w.id
      ORDER BY i.created_at DESC
    `);
    console.log(JSON.stringify(instRes.rows, null, 2));

    console.log('\n--- ALL ROUTES IN meta_whatsapp_waba_routes ---');
    const routesRes = await client.query(`
      SELECT r.*, c.name as cluster_name
      FROM public.meta_whatsapp_waba_routes r
      LEFT JOIN public.whatsapp_clusters c ON r.cluster_id = c.id
    `);
    console.log(JSON.stringify(routesRes.rows, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
