import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

async function main() {
  const phone = '5561995215930';
  const digits = '61995215930';
  console.log('=== SEARCHING FOR CONTACT:', phone, '===');

  const client = await pool.connect();
  try {
    const contacts = await client.query(
      'SELECT id, workspace_id, name, phone, email, created_at, updated_at FROM contacts WHERE phone ILIKE $1 OR phone ILIKE $2',
      [`%${digits}%`, `%${phone}%`]
    );
    console.log('Contacts found:', contacts.rows);

    if (contacts.rows.length === 0) {
      console.log('\nNo contacts found by phone exact match. Searching by raw phone digits or messages...');
      const recentContacts = await client.query(
        'SELECT id, name, phone, updated_at FROM contacts ORDER BY updated_at DESC LIMIT 10'
      );
      console.log('Recent contacts:', recentContacts.rows);

      const msgSearch = await client.query(
        "SELECT id, chat_id, role, content, created_at FROM messages WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT 10",
        [`%${digits}%`]
      );
      console.log('Messages mentioning phone:', msgSearch.rows);
      return;
    }

    const cols = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'messages' ORDER BY ordinal_position"
    );
    console.log('Messages columns:', cols.rows.map(r => r.column_name));

    // Focus on Velpro contact
    const velproContact = contacts.rows.find(c => c.workspace_id === 'e3b476a1-5de8-4744-80b5-a5d23fe15fab') || contacts.rows[0];
    console.log('\n==============================================');
    console.log(`VELPRO Contact: ${velproContact.id} | ${velproContact.name} | ${velproContact.phone}`);
    console.log(`==============================================`);

    const chats = await client.query(
      'SELECT * FROM chats WHERE contact_id = $1 ORDER BY updated_at DESC',
      [velproContact.id]
    );
    console.log(`Chats count: ${chats.rows.length}`);

    for (const chat of chats.rows) {
      console.log(`\n--- Chat ID: ${chat.id} | Status: ${chat.status} | Updated: ${chat.updated_at} ---`);
      console.log('Chat Details:', JSON.stringify({
        id: chat.id,
        status: chat.status,
        channel: chat.channel,
        instance_name: chat.instance_name,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
        last_message_at: chat.last_message_at,
        metadata: chat.metadata,
      }, null, 2));

      const messages = await client.query(
        'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 30',
        [chat.id]
      );

      console.log(`\nMessages (total: ${messages.rows.length}):`);
      for (const m of messages.rows.reverse()) {
        console.log(`\n[${m.created_at?.toISOString()}] Type/Sender: ${m.sender_type || m.type || m.direction || 'unknown'} | Status: ${m.status}`);
        console.log(`Body/Content: ${m.body || m.content || m.text}`);
        if (m.error) console.log(`>>> ERROR: ${m.error}`);
        if (m.metadata) console.log(`>>> Metadata:`, JSON.stringify(m.metadata, null, 2));
      }

      try {
        const orchRuns = await client.query(
          "SELECT id, status, intent, metadata, created_at FROM orchestrator_runs WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 5",
          [chat.id]
        );
        if (orchRuns.rows.length > 0) {
          console.log('\n--- Orchestrator Runs ---');
          for (const or of orchRuns.rows) {
            console.log(`Run ${or.id} [${or.status}] intent=${or.intent}:`, JSON.stringify(or.metadata, null, 2));
          }
        }
      } catch (e: any) {
        // Table might not exist or have different columns
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
