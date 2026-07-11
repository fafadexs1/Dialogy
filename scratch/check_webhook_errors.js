const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  try {
    console.log('--- RECENT WEBHOOK LOGS ---');
    const logsRes = await client.query(`
      SELECT * FROM public.webhook_logs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(logsRes.rows, null, 2));

    console.log('\n--- RECENT META INGRESS LOGS ---');
    try {
      const ingressRes = await client.query(`
        SELECT * FROM public.meta_ingress_logs
        ORDER BY created_at DESC
        LIMIT 10
      `);
      console.log(JSON.stringify(ingressRes.rows, null, 2));
    } catch (e) {
      console.log('Error querying meta_ingress_logs:', e.message);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
