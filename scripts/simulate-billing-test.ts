// Bypass Next.js server-only check in standalone Node.js script
import module from 'module';
const originalRequire = module.prototype.require;
module.prototype.require = function (id) {
  if (id === 'server-only') {
    return {};
  }
  return originalRequire.apply(this, arguments as any);
};

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import 'dotenv/config';

process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS = '15000';
process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS = '15000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const WORKSPACE_ID = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const CHAT_ID = '96c1649f-ef93-43d2-8346-bc1bbc937d0b';
const CONTACT_ID = '0a13a140-294a-4cb4-aba1-f11bda394ecf';
const INSTANCE_NAME = 'evolution';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n================================================================');
  console.log('🤖 INICIANDO TESTE REAL E2E - RAQUEL VS FATURAS 🤖');
  console.log('================================================================\n');

  const client = await pool.connect();

  try {
    // 1. Resetar o estado do chat e contato
    console.log('🧹 Limpando histórico e preparando chat para a simulação com a Raquel...');
    await client.query('DELETE FROM public.messages WHERE chat_id = $1', [CHAT_ID]);
    
    // Setar autopilot ativo na atendente Raquel
    await client.query(`
      UPDATE public.chats 
      SET is_autopilot_active = TRUE, 
          copilot_mode = 'auto', 
          assigned_system_agent_id = '8867d3b2-be6d-47fa-86d1-97504fca414d',
          status = 'atendimentos',
          unread_count = 0,
          closed_at = NULL,
          close_reason_tag_id = NULL,
          close_notes = NULL
      WHERE id = $1
    `, [CHAT_ID]);

    const customerMessage = 'quero as faturas pra eu pagar';
    console.log(`\n👤 Usuário diz: "${customerMessage}"`);

    // 2. Inserir mensagem do cliente no banco
    const messageId = randomUUID();
    await client.query(`
      INSERT INTO public.messages (
        id, workspace_id, chat_id, type, content, from_me, is_read, instance_name, created_at
      ) VALUES ($1, $2, $3, 'text', $4, FALSE, TRUE, $5, clock_timestamp())
    `, [messageId, WORKSPACE_ID, CHAT_ID, customerMessage, INSTANCE_NAME]);

    const sentTime = new Date();

    // 3. Executar o processamento do Autopilot
    console.log('⚡ Processando Autopilot de forma síncrona localmente...');
    
    const chatRes = await client.query(
      `SELECT
          c.id,
          c.workspace_id,
          c.status,
          c.agent_id,
          c.assigned_system_agent_id,
          c.source,
          c.instance_type,
          c.is_autopilot_active,
          c.autopilot_config_id,
          c.copilot_mode,
          ct.id AS contact_id,
          ct.name AS contact_name,
          ct.email AS contact_email,
          ct.phone_number_jid AS contact_phone_number_jid,
          ct.avatar_url AS contact_avatar_url,
          ct.address AS contact_address
       FROM chats c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1
       LIMIT 1`,
      [CHAT_ID]
    );

    if (chatRes.rows.length > 0) {
      const row = chatRes.rows[0];
      const chatObj = {
        id: row.id,
        workspace_id: row.workspace_id,
        status: row.status,
        source: row.source,
        instance_type: row.instance_type,
        agentId: row.agent_id,
        assigned_system_agent_id: row.assigned_system_agent_id,
        is_autopilot_active: row.is_autopilot_active,
        autopilot_config_id: row.autopilot_config_id,
        copilot_mode: row.copilot_mode,
        messages: [],
        contact: {
          id: row.contact_id,
          name: row.contact_name,
          email: row.contact_email,
          phone_number_jid: row.contact_phone_number_jid,
          avatar_url: row.contact_avatar_url,
          address: row.contact_address,
        },
      };

      const { processAutopilotForChat } = await import('../src/services/autopilot-service');
      await processAutopilotForChat(
        WORKSPACE_ID,
        chatObj as any,
        customerMessage,
        INSTANCE_NAME,
        messageId
      );
    }

    console.log('\n⏳ Carregando respostas do banco de dados...');
    await wait(3000);

    // 4. Buscar e exibir mensagens geradas
    const newMsgs = await client.query(`
      SELECT content, from_me, sender_system_agent_id
      FROM public.messages
      WHERE chat_id = $1 AND created_at > $2
      ORDER BY created_at ASC
    `, [CHAT_ID, sentTime]);

    console.log('\n💬 CONVERSA APÓS EXECUÇÃO:');
    for (const msg of newMsgs.rows) {
      if (msg.from_me) {
        if (msg.sender_system_agent_id) {
          const isSystemAction = msg.content.startsWith('Executando ferramenta:') || msg.content.includes('concluido') || msg.content.includes('falhou');
          if (isSystemAction) {
            console.log(`⚙️ [FERRAMENTA]: \x1b[36m${msg.content}\x1b[0m`);
          } else {
            console.log(`🤖 [RAQUEL]: \x1b[32m\x1b[1m${msg.content}\x1b[0m`);
          }
        } else {
          console.log(`🤖 [AI RESPONSE]: \x1b[32m${msg.content}\x1b[0m`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Erro na simulação:', error);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

main().catch(console.error);
