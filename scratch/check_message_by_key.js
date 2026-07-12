const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  try {
    console.log('--- SEARCHING FOR SENT MESSAGE KEY ---');
    const msgRes = await client.query(`
      SELECT id, api_message_status, status_from_api, metadata, raw_payload
      FROM public.messages
      WHERE metadata::text ILIKE '%3EB09FD709A89D756A4F7B%'
         OR message_id_from_api = '3EB09FD709A89D756A4F7B'
    `);
    console.log('Result from messages table:');
    console.log(JSON.stringify(msgRes.rows, null, 2));

    console.log('\n--- SEARCHING FOR WEBHOOK LOGS WITH KEY ---');
    const logRes = await client.query(`
      SELECT * FROM public.webhook_logs
      WHERE payload::text ILIKE '%3EB09FD709A89D756A4F7B%'
    `);
    console.log('Result from webhook_logs table:');
    console.log(JSON.stringify(logRes.rows, null, 2));
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
