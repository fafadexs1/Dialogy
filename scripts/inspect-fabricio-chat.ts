import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const chatId = '96c1649f-ef93-43d2-8346-bc1bbc937d0b';
    const msgRes = await client.query('SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chatId]);
    console.log('Message Columns:');
    if (msgRes.rows.length > 0) {
      console.log(Object.keys(msgRes.rows[0]));
      console.log('\nMessage Rows:');
      console.log(JSON.stringify(msgRes.rows.map(r => ({ id: r.id, content: r.content, from_me: r.from_me, created_at: r.created_at })), null, 2));
    } else {
      console.log('No messages found for this chat.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
