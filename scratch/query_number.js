const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const chatId = 'dc1e23d7-4ad7-4a15-b37c-90a23fc990f1';

  // 1. Messages in the currently open chat
  console.log('=== 1. MENSAGENS NO CHAT ABERTO ATUAL (dc1e23d7) ===');
  try {
    const r1 = await c.query(
      `SELECT id, direction, type, content, sender_from_api, message_id_from_api, 
              created_at, from_me, platform, instance_name,
              metadata->>'evolutionRealtimeSideEffectsSkipReason' as skip_reason
       FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [chatId]
    );
    console.log('Total mensagens:', r1.rowCount);
    r1.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 2. How was this chat created? Check source and details
  console.log('\n=== 2. DETALHES DO CHAT ABERTO ===');
  try {
    const r2 = await c.query(
      `SELECT c.*, ct.name as contact_name, ct.phone, ct.phone_number_jid, ct.phone_canonical
       FROM chats c LEFT JOIN contacts ct ON c.contact_id = ct.id
       WHERE c.id = $1`,
      [chatId]
    );
    r2.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 3. Check if this was a manual/internal chat creation (no instance_type = manual/internal creation)
  console.log('\n=== 3. ÚLTIMAS MENSAGENS RECEBIDAS DESTE CONTATO (qualquer chat) ===');
  try {
    const r3 = await c.query(
      `SELECT m.id, m.chat_id, m.direction, m.type, m.content, m.sender_from_api, 
              m.created_at, m.from_me, m.platform, m.instance_name,
              c.instance_type, c.status as chat_status
       FROM messages m 
       JOIN chats c ON m.chat_id = c.id
       JOIN contacts ct ON c.contact_id = ct.id
       WHERE ct.phone_number_jid = '5561998461615@s.whatsapp.net'
       AND m.from_me = false
       ORDER BY m.created_at DESC LIMIT 10`,
      []
    );
    console.log('Total:', r3.rowCount);
    r3.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 4. Check which instance was routing messages from this JID previously
  console.log('\n=== 4. INSTANCIAS QUE ROTEARAM MSGS DESTE CONTATO ===');
  try {
    const r4 = await c.query(
      `SELECT DISTINCT m.instance_name, m.platform, c.instance_type, count(*) as total_msgs
       FROM messages m 
       JOIN chats c ON m.chat_id = c.id
       JOIN contacts ct ON c.contact_id = ct.id
       WHERE ct.phone_number_jid = '5561998461615@s.whatsapp.net'
       GROUP BY m.instance_name, m.platform, c.instance_type`,
      []
    );
    r4.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 5. Now check the Evolution API for instance state - which instances exist and their webhook URLs
  console.log('\n=== 5. VERIFICAR SE INSTANCIA zap4 (baileys) ESTÁ ATIVA ===');
  try {
    const r5 = await c.query(
      `SELECT e.instance_name, e.type, e.webhook_url, e.display_name, e.webhook_key,
              (SELECT count(*) FROM evolution_webhook_events WHERE instance_name = e.instance_name AND created_at > NOW() - INTERVAL '24 hours') as events_24h,
              (SELECT max(created_at) FROM evolution_webhook_events WHERE instance_name = e.instance_name) as last_event_at
       FROM evolution_api_instances e
       WHERE e.workspace_id = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab'`,
      []
    );
    r5.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  await c.end();
}

main().catch(console.error);
