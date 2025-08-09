
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function POST(
    request: Request,
    { params }: { params: { instanceName: string } }
) {
  const instanceNameFromUrl = params.instanceName;
  console.log(`--- [WEBHOOK] Payload recebido para a instância: ${instanceNameFromUrl} ---`);

  try {
    const payload = await request.json();
    console.log('[WEBHOOK] Payload completo:', JSON.stringify(payload, null, 2));

    const { event, instance: instanceNameFromPayload } = payload;
    
    // Validação para garantir que a instância na URL corresponde à do payload
    if (instanceNameFromUrl !== instanceNameFromPayload) {
        console.error(`[WEBHOOK] Conflito de nome de instância. URL: ${instanceNameFromUrl}, Payload: ${instanceNameFromPayload}`);
        return NextResponse.json({ error: 'Instance name mismatch' }, { status: 400 });
    }

    if (!event) {
      console.error('[WEBHOOK] Erro: Evento não encontrado no payload.');
      return NextResponse.json({ error: 'Event not found' }, { status: 400 });
    }

    if (event === 'messages.upsert') {
      await handleMessagesUpsert(payload);
    } else if (event === 'connection.update') {
      console.log(`[WEBHOOK] Evento de conexão da instância ${instanceNameFromUrl}: ${payload.data?.state}`);
      // Lógica futura para atualizar o status da instância no banco de dados pode ser adicionada aqui
    } else {
      console.log(`[WEBHOOK] Evento '${event}' recebido para a instância ${instanceNameFromUrl}, mas não há handler implementado.`);
    }

    return NextResponse.json({ message: 'Webhook received successfully' });
  } catch (error) {
    console.error(`[WEBHOOK] Erro ao processar o webhook para ${instanceNameFromUrl}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handleMessagesUpsert(payload: any) {
  const { instance: instanceName, data, sender, server_url } = payload;
  const { key, pushName, message } = data;

  console.log(`[WEBHOOK_MSG_UPSERT] Iniciando processamento para instância: ${instanceName}`);

  // Ignorar se a mensagem for do próprio agente ou se não tiver conteúdo
  if (key.fromMe || !message?.conversation) {
    console.log('[WEBHOOK_MSG_UPSERT] Mensagem ignorada (fromMe=true ou sem conteúdo).');
    return;
  }
  
  const parsedUrl = server_url ? new URL(server_url).hostname : null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    console.log('[WEBHOOK_MSG_UPSERT] Transação iniciada.');

    // 1. Encontrar o workspace associado à instância
    console.log('[WEBHOOK_MSG_UPSERT] Buscando workspace...');
    const instanceRes = await client.query(
      `SELECT ec.workspace_id 
       FROM evolution_api_instances AS ei
       JOIN evolution_api_configs AS ec ON ei.config_id = ec.id
       WHERE ei.name = $1`,
      [instanceName]
    );

    if (instanceRes.rows.length === 0) {
      throw new Error(`Workspace para a instância '${instanceName}' não encontrado.`);
    }
    const workspaceId = instanceRes.rows[0].workspace_id;
    console.log(`[WEBHOOK_MSG_UPSERT] Workspace ID encontrado: ${workspaceId}`);

    // 2. Encontrar ou criar o contato
    const contactJid = key.remoteJid;
    console.log(`[WEBHOOK_MSG_UPSERT] Buscando/Criando contato com JID: ${contactJid}`);
    let contactRes = await client.query('SELECT id FROM contacts WHERE phone_number_jid = $1 AND workspace_id = $2', [contactJid, workspaceId]);
    let contactId;

    if (contactRes.rows.length === 0) {
      console.log(`[WEBHOOK_MSG_UPSERT] Contato com JID ${contactJid} não encontrado. Criando...`);
      const newContactRes = await client.query(
        'INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id',
        [workspaceId, pushName || contactJid, contactJid]
      );
      contactId = newContactRes.rows[0].id;
      console.log(`[WEBHOOK_MSG_UPSERT] Contato criado com ID: ${contactId}`);
    } else {
      contactId = contactRes.rows[0].id;
      console.log(`[WEBHOOK_MSG_UPSERT] Contato encontrado com ID: ${contactId}`);
    }

    // 3. Encontrar ou criar o chat
    console.log(`[WEBHOOK_MSG_UPSERT] Buscando/Criando chat para contato ID: ${contactId}`);
    let chatRes = await client.query('SELECT id, status FROM chats WHERE contact_id = $1 AND workspace_id = $2', [contactId, workspaceId]);
    let chatId;
    let chatStatus;

    if (chatRes.rows.length === 0) {
      console.log(`[WEBHOOK_MSG_UPSERT] Chat com contato ID ${contactId} não encontrado. Criando...`);
      // Cria o chat com o status padrão 'gerais' que é definido pelo DB
      const newChatRes = await client.query(
        'INSERT INTO chats (workspace_id, contact_id) VALUES ($1, $2) RETURNING id, status',
        [workspaceId, contactId]
      );
      chatId = newChatRes.rows[0].id;
      chatStatus = newChatRes.rows[0].status;
      console.log(`[WEBHOOK_MSG_UPSERT] Chat criado com ID: ${chatId} e Status: ${chatStatus}`);
    } else {
      chatId = chatRes.rows[0].id;
      chatStatus = chatRes.rows[0].status;
      console.log(`[WEBHOOK_MSG_UPSERT] Chat encontrado com ID: ${chatId} e Status: ${chatStatus}`);

      // Se o chat estava encerrado, reabra-o na aba "Gerais"
      if (chatStatus === 'encerrados') {
        console.log(`[WEBHOOK_MSG_UPSERT] Chat estava encerrado. Movendo para 'gerais'.`);
        await client.query(
            "UPDATE chats SET status = 'gerais' WHERE id = $1",
            [chatId]
        );
         console.log(`[WEBHOOK_MSG_UPSERT] Status do chat ${chatId} atualizado para 'gerais'.`);
      }
    }

    // 4. Inserir a mensagem
    console.log(`[WEBHOOK_MSG_UPSERT] Inserindo mensagem no chat ID: ${chatId}`);
    await client.query(
      `INSERT INTO messages (
        workspace_id, 
        chat_id, 
        sender_id,
        type, 
        content, 
        created_at, 
        message_id_from_api,
        sender_from_api,
        instance_name,
        status_from_api,
        source_from_api,
        server_url,
        from_me,
        raw_payload
      ) VALUES ($1, $2, $3, 'text', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        workspaceId,
        chatId,
        contactId, // O sender_id é o ID do contato que enviou a mensagem
        message.conversation,
        new Date(payload.date_time),
        key.id,
        sender,
        instanceName,
        data.status,
        data.source,
        parsedUrl,
        key.fromMe,
        payload
      ]
    );
     console.log(`[WEBHOOK_MSG_UPSERT] Mensagem inserida com sucesso. ID da API: ${key.id}`);

    await client.query('COMMIT');
    console.log(`[WEBHOOK_MSG_UPSERT] Transação commitada. Revalidando o path...`);
    
    revalidatePath('/', 'layout');
    revalidatePath(`/api/chats/${workspaceId}`); // Revalida o novo endpoint de API

  } catch (error) {
    console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem:', error);
    await client.query('ROLLBACK');
    console.log('[WEBHOOK_MSG_UPSERT] Transação revertida (ROLLBACK).');
  } finally {
    client.release();
    console.log('[WEBHOOK_MSG_UPSERT] Conexão com o banco liberada.');
  }
}

    