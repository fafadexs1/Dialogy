// Bypass Next.js server-only check in standalone Node.js script
import module from 'module';
const originalRequire = module.prototype.require;
module.prototype.require = function (id) {
  if (id === 'server-only') {
    return {};
  }
  return originalRequire.apply(this, arguments);
};

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { enqueueAiAutopilotProcess } from '../src/lib/queue';
import { getGlobalLmStudioConfig } from '../src/services/ai/lm-studio';

// Create a direct PG pool for managing simulation states
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
  console.log('🤖 INICIANDO SIMULAÇÃO INTERATIVA DE CONTRATAÇÃO PASSO A PASSO 🤖');
  console.log('================================================================\n');

  const client = await pool.connect();

  try {
    // 1. Verificar configuração do LM Studio
    const lmStudioConfig = await getGlobalLmStudioConfig();
    console.log(`🔌 LM Studio configurado em: ${lmStudioConfig.baseUrl || 'URL padrão'}`);

    // 2. Buscar definições de campos customizados do CRM neste workspace
    console.log('\n📋 Buscando definições de campos customizados do CRM no Supabase...');
    const fieldDefs = await client.query(
      'SELECT id, label, type FROM public.custom_field_definitions WHERE workspace_id = $1',
      [WORKSPACE_ID]
    );
    console.log('Campos Customizados Encontrados:');
    console.table(fieldDefs.rows);

    // 3. Resetar o estado do chat e contato para o teste ser 100% limpo
    console.log('\n🧹 Limpando histórico e dados anteriores do chat para o teste...');
    
    // Deletar mensagens anteriores
    await client.query('DELETE FROM public.messages WHERE chat_id = $1', [CHAT_ID]);
    
    // Limpar campos customizados do contato
    await client.query('DELETE FROM public.contact_custom_field_values WHERE contact_id = $1', [CONTACT_ID]);
    
    // Resetar endereço e dados básicos do contato
    await client.query('UPDATE public.contacts SET address = NULL, name = \'Fabricio\' WHERE id = $1', [CONTACT_ID]);
    
    // Resetar o chat para autopilot ativo na atendente Raquel
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

    console.log('✅ Chat e Contato resetados com sucesso!');

    // 4. Mensagens que o usuário enviará sequentially
    const conversationSteps = [
      {
        content: 'Olá!',
        description: 'Primeira interação (Saudação inicial)',
      },
      {
        content: 'Quero contratar o plano de 1000 MEGA',
        description: 'Demonstração de interesse no plano comercial',
      },
      {
        content: 'Moro no Distrito Industrial Norte e meu nome é Fabricio',
        description: 'Informação de endereço crítico (prazo de 15 dias) e nome',
      },
      {
        content: 'Meu CPF é 529.982.247-25',
        description: 'Envio de CPF para checagem de viabilidade e CRM',
      },
      {
        content: 'Me transfere para o comercial?',
        description: 'Solicitação explícita de transferência para a equipe Comercial',
      }
    ];

    // Executar passo a passo
    for (let i = 0; i < conversationSteps.length; i++) {
      const step = conversationSteps[i];
      console.log(`\n----------------------------------------------------------------`);
      console.log(`💬 PASSO ${i + 1}/${conversationSteps.length}: ${step.description}`);
      console.log(`👤 Usuário diz: "${step.content}"`);
      console.log(`----------------------------------------------------------------`);

      // A. Inserir mensagem do cliente no banco
      const messageId = randomUUID();
      await client.query(`
        INSERT INTO public.messages (
          id, workspace_id, chat_id, type, content, from_me, is_read, instance_name, created_at
        ) VALUES ($1, $2, $3, 'text', $4, FALSE, TRUE, $5, clock_timestamp())
      `, [messageId, WORKSPACE_ID, CHAT_ID, step.content, INSTANCE_NAME]);

      const sentTime = new Date();

      // B. Executar o processamento do Autopilot de forma 100% síncrona localmente
      console.log('⚡ Processando Autopilot de forma síncrona localmente...');
      try {
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
            step.content,
            INSTANCE_NAME,
            messageId
          );
        }
      } catch (autopilotErr) {
        console.error('❌ Falha ao processar Autopilot síncrono local:', autopilotErr);
      }

      console.log('⏳ Carregando resposta e atualizações do banco de dados local...');

      // C. Polling do banco de dados para capturar a resposta da IA e ações de ferramentas
      let hasReplied = false;
      let lastCheckedMessageId = messageId;
      const printedMessageIds = new Set<string>();
      printedMessageIds.add(messageId);

      // Timeout de 60 segundos por etapa
      const startTime = Date.now();
      while (!hasReplied && Date.now() - startTime < 60000) {
        await wait(1500);

        // Buscar novas mensagens criadas após o envio do usuário
        const newMsgs = await client.query(`
          SELECT id, content, type, from_me, metadata, created_at, sender_system_agent_id
          FROM public.messages
          WHERE chat_id = $1 AND created_at > $2
          ORDER BY created_at ASC
        `, [CHAT_ID, sentTime]);

        for (const msg of newMsgs.rows) {
          if (printedMessageIds.has(msg.id)) continue;
          printedMessageIds.add(msg.id);

          const timeString = new Date(msg.created_at).toLocaleTimeString();

          if (msg.from_me) {
            // Mensagens enviadas pela IA ou sistema
            if (msg.sender_system_agent_id) {
              // É uma resposta direta ao cliente ou ação de ferramenta
              const isSystemAction = msg.content.startsWith('Executando ferramenta:') || msg.content.includes('concluido com sucesso') || msg.content.includes('falhou');
              
              if (isSystemAction) {
                console.log(`⚙️ [FERRAMENTA] [${timeString}]: \x1b[36m${msg.content}\x1b[0m`);
              } else {
                console.log(`🤖 [ATENDENTE] [${timeString}]: \x1b[32m\x1b[1m${msg.content}\x1b[0m`);
                // Consideramos respondido quando a atendente de fato manda uma mensagem textual
                hasReplied = true;
              }
            } else if (msg.metadata?.isInternalNote) {
              console.log(`📝 [NOTA INTERNA] [${timeString}]: \x1b[33m${msg.content}\x1b[0m`);
            } else if (msg.type === 'system') {
              console.log(`⚙️ [SISTEMA] [${timeString}]: \x1b[90m${msg.content}\x1b[0m`);
              if (msg.content.includes('transferido') || msg.content.includes('atribuído')) {
                // Transferência encerra o fluxo do autopilot neste passo
                hasReplied = true;
              }
            } else {
              console.log(`🤖 [AI RESPONSE] [${timeString}]: \x1b[32m${msg.content}\x1b[0m`);
              hasReplied = true;
            }
          }
        }

        // Se o chat foi transferido, o status ou agent_id mudou, podemos verificar
        const chatStatus = await client.query('SELECT is_autopilot_active, agent_id, status FROM public.chats WHERE id = $1', [CHAT_ID]);
        const chat = chatStatus.rows[0];
        if (chat && !chat.is_autopilot_active) {
          console.log(`\n⚠️  [NOTIFICAÇÃO] Autopilot foi desativado para este chat. Status: "${chat.status}", Atribuído ao Agente: "${chat.agent_id}"`);
          hasReplied = true;
        }
      }

      if (!hasReplied) {
        console.log('⚠️ Timeout de 60 segundos atingido para este passo.');
      }

      // Imprimir dados atuais do contato no final do passo para acompanhar o preenchimento dos campos
      const currentContact = await client.query(`
        SELECT ct.name, ct.address, 
               (SELECT string_agg(cd.label || ': ' || cv.value, ' | ') 
                FROM public.contact_custom_field_values cv
                JOIN public.custom_field_definitions cd ON cd.id = cv.field_id
                WHERE cv.contact_id = ct.id) as custom_fields
        FROM public.contacts ct
        WHERE ct.id = $1
      `, [CONTACT_ID]);
      
      console.log('\n📍 Estado Atual do Cliente no CRM:');
      console.log(`   Nome:      ${currentContact.rows[0]?.name || 'N/A'}`);
      console.log(`   Endereço:  ${currentContact.rows[0]?.address || 'N/A'}`);
      console.log(`   Campos:    ${currentContact.rows[0]?.custom_fields || '(Nenhum campo preenchido)'}`);
      
      // Dar uma pausa de 3 segundos para estabilização antes do próximo passo
      await wait(3000);
    }

    console.log('\n================================================================');
    console.log('✅ SIMULAÇÃO CONCLUÍDA COM SUCESSO! ✅');
    console.log('================================================================\n');

  } catch (error) {
    console.error('❌ Ocorreu um erro durante a simulação:', error);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

main();
