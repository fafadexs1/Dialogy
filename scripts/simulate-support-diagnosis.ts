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
const CPF_FIELD_ID = '53d4dc37-fa88-4749-be3a-194953864e80';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeAutopilot(client: any, userMessage: string) {
  const messageId = randomUUID();
  
  // 1. Inserir mensagem do cliente no banco
  await client.query(`
    INSERT INTO public.messages (
      id, workspace_id, chat_id, type, content, from_me, is_read, instance_name, created_at
    ) VALUES ($1, $2, $3, 'text', $4, FALSE, TRUE, $5, clock_timestamp())
  `, [messageId, WORKSPACE_ID, CHAT_ID, userMessage, INSTANCE_NAME]);

  const sentTime = new Date();

  // 2. Executar o processamento do Autopilot
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
      userMessage,
      INSTANCE_NAME,
      messageId
    );
  }

  await wait(3000);

  // 3. Buscar e exibir mensagens geradas
  const newMsgs = await client.query(`
    SELECT content, from_me, sender_system_agent_id
    FROM public.messages
    WHERE chat_id = $1 AND created_at > $2
    ORDER BY created_at ASC
  `, [CHAT_ID, sentTime]);

  for (const msg of newMsgs.rows) {
    if (msg.from_me) {
      if (msg.sender_system_agent_id) {
        const isSystemAction = msg.content.startsWith('Executando ferramenta:') || msg.content.includes('concluido') || msg.content.includes('falhou');
        if (isSystemAction) {
          console.log(`⚙️ [FERRAMENTA]: \x1b[36m${msg.content}\x1b[0m`);
        } else {
          console.log(`🤖 [LUCAS]: \x1b[32m\x1b[1m${msg.content}\x1b[0m`);
        }
      } else {
        console.log(`🤖 [AI RESPONSE]: \x1b[32m${msg.content}\x1b[0m`);
      }
    }
  }
}

async function main() {
  console.log('\n================================================================');
  console.log('🤖 INICIANDO SIMULAÇÃO REAL DE DIAGNÓSTICO COM LUCAS TÉCNICO   🤖');
  console.log('================================================================\n');

  const client = await pool.connect();

  try {
    // 1. Limpar mensagens anteriores, procedimentos anteriores e atualizar CPF do contato para 01298570174
    console.log('🧹 Limpando histórico e definindo CPF para 01298570174 no CRM...');
    await client.query('DELETE FROM public.messages WHERE chat_id = $1', [CHAT_ID]);
    await client.query('DELETE FROM public.procedure_executions WHERE chat_id = $1', [CHAT_ID]);
    
    // Atualizar CPF do contato
    await client.query(`
      INSERT INTO public.contact_custom_field_values (contact_id, field_id, value)
      VALUES ($1, $2, '01298570174')
      ON CONFLICT (contact_id, field_id) DO UPDATE SET value = '01298570174'
    `, [CONTACT_ID, CPF_FIELD_ID]);

    // Setar autopilot ativo no atendente Lucas (TicketMaster)
    await client.query(`
      UPDATE public.chats 
      SET is_autopilot_active = TRUE, 
          copilot_mode = 'auto', 
          assigned_system_agent_id = '779c0e28-b9c2-4604-9496-44d56cece388',
          status = 'atendimentos',
          unread_count = 0,
          closed_at = NULL,
          close_reason_tag_id = NULL,
          close_notes = NULL
      WHERE id = $1
    `, [CHAT_ID]);

    console.log('\n💬 --- ETAPA 1: CLIENTE DIZ QUE A INTERNET ESTÁ INSTÁVEL/LENTA ---');
    console.log('👤 Usuário diz: "estou com problemas de conexao, minha internet esta caindo toda hora"');
    await executeAutopilot(client, 'estou com problemas de conexao, minha internet esta caindo toda hora');

    await wait(2000);

    console.log('\n💬 --- ETAPA 2: CLIENTE CONTINUA PEDINDO UM DIAGNÓSTICO ---');
    console.log('👤 Usuário diz: "voce consegue ver qual e o problema de conexao por ai?"');
    await executeAutopilot(client, 'voce consegue ver qual e o problema de conexao por ai?');

  } catch (error) {
    console.error('❌ Erro na simulação de diagnóstico:', error);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

main().catch(console.error);
