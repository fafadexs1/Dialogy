const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const chatId = 'bfbbdef3-c0d9-41ed-9092-4d771690fba0';

  console.log("=== HISTÓRICO DE MENSAGENS ===");
  const messages = await client.query(`
    SELECT from_me, content, created_at
    FROM messages 
    WHERE chat_id = $1
    ORDER BY created_at ASC
  `, [chatId]);
  
  for (const msg of messages.rows) {
    const sender = msg.from_me ? 'AGENT/SYSTEM' : 'CUSTOMER';
    console.log(`[${msg.created_at.toISOString()}] ${sender}: "${msg.content}"`);
  }

  await client.end();
}

main().catch(console.error);
