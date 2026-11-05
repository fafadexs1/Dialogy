import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('=== BUSCANDO MENSAGENS RECENTES (ÚLTIMAS 24H) PARA 5561995215930 ===');

    // 1. Encontrar todos os contatos com 61995215930
    const contacts = await client.query(
      "SELECT id, workspace_id, name, phone FROM contacts WHERE phone ILIKE '%61995215930%'"
    );
    console.log('Contatos:', contacts.rows);

    const contactIds = contacts.rows.map(c => c.id);

    const chatCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'chats' ORDER BY ordinal_position"
    );
    console.log('Chats columns:', chatCols.rows.map(r => r.column_name));

    // 2. Buscar chats mais recentes desses contatos
    const chats = await client.query(
      `SELECT *
       FROM chats
       WHERE contact_id = ANY($1)
       ORDER BY updated_at DESC
       LIMIT 10`,
      [contactIds]
    );

    console.log(`\nChats mais recentes encontrados (${chats.rows.length}):`);
    for (const ch of chats.rows) {
      console.log(`- Chat ${ch.id} [WS: ${ch.workspace_id}] Status: ${ch.status} | Created: ${ch.created_at?.toISOString()} | Updated: ${ch.updated_at?.toISOString()}`);
    }

    if (chats.rows.length > 0) {
      const latestChat = chats.rows[0];
      console.log(`\n=== DETALHES DO CHAT MAIS RECENTE: ${latestChat.id} ===`);
    const msgCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'messages' ORDER BY ordinal_position"
    );
    console.log('Messages columns:', msgCols.rows.map(r => r.column_name));

    const targetChatId = 'ef8de861-3f70-4202-8778-7e42e2dd250b';
    console.log(`\n=== MENSAGENS DO CHAT RECENTE: ${targetChatId} ===`);
    const messages = await client.query(
      'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [targetChatId]
    );

    for (const m of messages.rows) {
      console.log(`\n--------------------------------------------------`);
      console.log(`[${m.created_at?.toISOString()}] ID: ${m.id}`);
      console.log(`From Me: ${m.from_me || m.is_from_me || m.fromMe} | Type: ${m.message_type || m.type}`);
      console.log(`Text/Body: ${m.text || m.body || m.content}`);
      if (m.error) console.log(`ERROR: ${m.error}`);
      console.log('Full Message Object:', JSON.stringify(m, null, 2));
    }
    }

    // 3. Buscar mensagens de qualquer chat com conteúdo recente ou erro recente nas últimas 24h
    console.log('\n=== MENSAGENS GERAIS NAS ÚLTIMAS 24H ENVOLVENDO ESSE NÚMERO OU ERROS ===');
    const recentMsgs = await client.query(
      `SELECT m.id, m.chat_id, m.sender_type, m.status, m.body, m.error, m.metadata, m.created_at
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE c.contact_id = ANY($1) AND m.created_at >= NOW() - INTERVAL '48 hours'
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [contactIds]
    );

    console.log(`Mensagens nas últimas 48h: ${recentMsgs.rows.length}`);
    for (const m of recentMsgs.rows.reverse()) {
      console.log(`\n[${m.created_at?.toISOString()}] Chat: ${m.chat_id} | Sender: ${m.sender_type} | Status: ${m.status}`);
      console.log(`Body: ${m.body}`);
      if (m.error) console.log(`>>> ERROR: ${m.error}`);
      if (m.metadata) console.log(`>>> Metadata:`, JSON.stringify(m.metadata, null, 2));
    }

    // 4. Buscar em webhook_events / logs se houver
    try {
      const logs = await client.query(
        `SELECT id, event, payload, created_at
         FROM evolution_webhook_events
         WHERE payload::text ILIKE '%5561995215930%' OR payload::text ILIKE '%61995215930%'
         ORDER BY created_at DESC
         LIMIT 5`
      );
      console.log(`\nEvolution webhook events: ${logs.rows.length}`);
      for (const l of logs.rows) {
        console.log(`[${l.created_at?.toISOString()}] Event: ${l.event}`);
      }
    } catch {}

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
