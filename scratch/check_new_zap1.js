const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  try {
    console.log('--- DETAILS FOR THE NEW zap1 ---');
    const instRes = await client.query(`
      SELECT * FROM public.evolution_api_instances WHERE instance_name = 'zap1' OR display_name = 'velpro'
    `);
    console.log(JSON.stringify(instRes.rows, null, 2));

    console.log('\n--- ALL ROUTES IN meta_whatsapp_waba_routes ---');
    const routesRes = await client.query(`
      SELECT * FROM public.meta_whatsapp_waba_routes
    `);
    console.log(JSON.stringify(routesRes.rows, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
