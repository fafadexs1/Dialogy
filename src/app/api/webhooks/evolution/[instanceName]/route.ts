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
    } else if (event === 'messages.update') {
      await handleMessagesUpdate(payload);
    } else if (event === 'contacts.update') {
      await handleContactsUpdate(payload);
    } else if (event === 'connection.update') {
      console.log(`[WEBHOOK] Evento de conexão da instância ${instanceNameFromUrl}: ${payload.data?.state}`);
      // Lógica futura para atualizar o status da instância no banco de dados pode ser adicionada aqui
    } else {
      console.log(`[WEBHOOK] Evento '${event}' recebido para a instância ${instanceNameFromUrl}, mas não há handler implementado.`);
    }

    revalidatePath('/', 'layout');
    return NextResponse.json({ message: 'Webhook received successfully' });
  } catch (error) {
    console.error(`[WEBHOOK] Erro ao processar o webhook para ${instanceNameFromUrl}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handleContactsUpdate(payload: any) {
    const { instance: instanceName, data: contactsToUpdate } = payload;

    if (!Array.isArray(contactsToUpdate) || contactsToUpdate.length === 0) {
        console.log('[WEBHOOK_CONTACT_UPDATE] Payload inválido ou sem contatos para atualizar.');
        return;
    }

    console.log(`[WEBHOOK_CONTACT_UPDATE] Recebido evento de atualização para ${contactsToUpdate.length} contato(s) na instância ${instanceName}`);
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
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

        for (const contactData of contactsToUpdate) {
            const { remoteJid, profilePicUrl } = contactData;
            if (remoteJid && profilePicUrl) {
                console.log(`[WEBHOOK_CONTACT_UPDATE] Atualizando avatar para JID: ${remoteJid}`);
                await client.query(
                    `UPDATE contacts SET avatar_url = $1 WHERE phone_number_jid = $2 AND workspace_id = $3`,
                    [profilePicUrl, remoteJid, workspaceId]
                );
            }
        }
        
        await client.query('COMMIT');
        revalidatePath(`/api/chats/${workspaceId}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[WEBHOOK_CONTACT_UPDATE] Erro ao atualizar contatos:', error);
    } finally {
        client.release();
    }
}


async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    
    if (!data || !data.keyId || !data.status) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload inválido, keyId ou status ausente.');
        return;
    }

    const { keyId, status } = data;

    console.log(`[WEBHOOK_MSG_UPDATE] Atualizando status da mensagem ${keyId} para ${status} na instância ${instanceName}`);
    
    const client = await db.connect();
    try {
        await client.query(
            `UPDATE messages SET api_message_status = $1 WHERE message_id_from_api = $2`,
            [status.toUpperCase(), keyId]
        );
        console.log(`[WEBHOOK_MSG_UPDATE] Status da mensagem ${keyId} atualizado com sucesso.`);
    } catch (error) {
        console.error('[WEBHOOK_MSG_UPDATE] Erro ao atualizar status da mensagem:', error);
    } finally {
        client.release();
    }
}

async function handleMessagesUpsert(payload: any) {
  const { instance: instanceName, data, sender, server_url } = payload;

  if (!data || !data.key || !data.message) {
    console.log('[WEBHOOK_MSG_UPSERT] Payload inválido, data, key ou message ausente.');
    return;
  }
  
  const { key, pushName, message, messageType } = data;

  if (key.fromMe) {
    console.log('[WEBHOOK_MSG_UPSERT] Mensagem ignorada (fromMe=true).');
    return;
  }

  let content = '';
  let metadata: any = {};
  
  const messageDetails = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.extendedTextMessage;
  
  content = messageDetails?.caption || messageDetails?.text || message.conversation || '';
  
  if (message.mediaUrl) {
      metadata.mediaUrl = message.mediaUrl;
  } else if (messageDetails?.url) {
      // Fallback for older structures or different media types
      metadata.mediaUrl = messageDetails.url;
  }

  if (messageType) {
    switch (messageType) {
      case 'imageMessage':
      case 'videoMessage':
      case 'audioMessage':
      case 'documentMessage':
        metadata.mimetype = messageDetails?.mimetype;
        metadata.fileName = messageDetails?.fileName;
        break;
      case 'conversation':
      case 'extendedTextMessage':
        // No special metadata needed
        break;
      default:
        console.log(`[WEBHOOK_MSG_UPSERT] Tipo de mensagem não suportado: ${messageType}. Ignorando.`);
        return;
    }
  }

  if (!content.trim() && !metadata.mediaUrl) {
    console.log('[WEBHOOK_MSG_UPSERT] Mensagem sem conteúdo textual ou de mídia. Ignorando.');
    return;
  }

  const parsedUrl = server_url ? new URL(server_url).hostname : null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

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

    const contactJid = key.remoteJid;
    let contactRes = await client.query('SELECT id FROM contacts WHERE phone_number_jid = $1 AND workspace_id = $2', [contactJid, workspaceId]);
    let contactId;

    if (contactRes.rows.length === 0) {
      const newContactRes = await client.query(
        'INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id',
        [workspaceId, pushName || contactJid, contactJid]
      );
      contactId = newContactRes.rows[0].id;
    } else {
      contactId = contactRes.rows[0].id;
    }

    let chatRes = await client.query('SELECT id, status FROM chats WHERE contact_id = $1 AND workspace_id = $2', [contactId, workspaceId]);
    let chatId;
    let chatStatus;

    if (chatRes.rows.length === 0) {
      const newChatRes = await client.query(
        'INSERT INTO chats (workspace_id, contact_id) VALUES ($1, $2) RETURNING id, status',
        [workspaceId, contactId]
      );
      chatId = newChatRes.rows[0].id;
      chatStatus = newChatRes.rows[0].status;
    } else {
      chatId = chatRes.rows[0].id;
      chatStatus = chatRes.rows[0].status;
      if (chatStatus === 'encerrados') {
        await client.query(
            "UPDATE chats SET status = 'gerais' WHERE id = $1",
            [chatId]
        );
      }
    }

    const messageTimestamp = new Date();

    await client.query(
      `INSERT INTO messages (
        workspace_id, chat_id, sender_id, type, content, metadata,
        created_at, message_id_from_api, sender_from_api, instance_name,
        status_from_api, source_from_api, server_url, from_me,
        api_message_status, raw_payload
      ) VALUES ($1, $2, $3, 'text', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        workspaceId, chatId, contactId, 'text', content, metadata,
        messageTimestamp, key.id, sender, instanceName,
        data.status, data.source, parsedUrl, key.fromMe,
        data.status?.toUpperCase(), payload
      ]
    );

    await client.query('COMMIT');
    
    revalidatePath(`/api/chats/${workspaceId}`);

  } catch (error) {
    console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem:', error);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}
