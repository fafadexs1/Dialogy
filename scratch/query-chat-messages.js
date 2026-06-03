const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log("=== SIMULATION CHAT MESSAGES IN CHRONOLOGICAL ORDER ===");
  const chatQuery = `
    SELECT from_me, content, created_at
    FROM public.messages
    WHERE chat_id = '96c1649f-ef93-43d2-8346-bc1bbc937d0b'
    ORDER BY created_at ASC
  `;
  const res = await client.query(chatQuery);
  for (const row of res.rows) {
    const sender = row.from_me ? "BOT" : "USER";
    console.log(`[${row.created_at.toISOString()}] ${sender}: ${row.content}`);
  }

  await client.end();
}

main().catch(console.error);
