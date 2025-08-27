
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import type { Message, MessageMetadata, Chat, Contact } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';


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
    } else if (event === 'chats.upsert') {
      await handleChatsUpsert(payload);
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

async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    
    if (!data || !data.keyId || !data.status) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload inválido, keyId ou status ausente.');
        return;
    }

    const { keyId, status } = data;

    console.log(`[WEBHOOK_MSG_UPDATE] Atualizando status da mensagem ${keyId} para ${status} na instância ${instanceName}`);
    
    try {
        await db.query(
            `UPDATE messages SET api_message_status = $1 WHERE message_id_from_api = $2`,
            [status.toUpperCase(), keyId]
        );
        console.log(`[WEBHOOK_MSG_UPDATE] Status da mensagem ${keyId} atualizado com sucesso.`);
    } catch (error) {
        console.error('[WEBHOOK_MSG_UPDATE] Erro ao atualizar status da mensagem:', error);
    }
}

async function handleMessagesUpsert(payload: any) {
    const { instance: instanceName, data, sender, server_url } = payload;
    const client = await db.connect();
    
    let savedChat: Chat | null = null;
    let savedMessage: Message | null = null;
    let workspaceId: string | null = null;
    let apiConfig: { api_url: string; api_key: string; } | null = null;
    let contactData: Contact | null = null;
    const contactJid = data?.key?.remoteJid;

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
    let metadata: MessageMetadata = {};
    let dbMessageType: Message['type'] = 'text';

    const messageDetails = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.extendedTextMessage;
    
    content = message.conversation || messageDetails?.text || messageDetails?.caption || '';

    if (message.mediaUrl) metadata.mediaUrl = message.mediaUrl;
    
    if (messageType) {
        switch (messageType) {
            case 'audioMessage':
                dbMessageType = 'audio';
                metadata.mimetype = messageDetails?.mimetype;
                metadata.duration = messageDetails?.seconds;
                break;
            case 'imageMessage': case 'videoMessage': case 'documentMessage':
                metadata.mimetype = messageDetails?.mimetype;
                metadata.fileName = messageDetails?.fileName;
                break;
            case 'conversation': case 'extendedTextMessage': break;
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
    const contactPhone = sender || contactJid.split('@')[0];
    
    try {
        await client.query('BEGIN');

        const instanceRes = await client.query(
            `SELECT ec.workspace_id, ec.api_url, ec.api_key 
             FROM evolution_api_instances AS ei
             JOIN evolution_api_configs AS ec ON ei.config_id = ec.id 
             WHERE ei.name = $1`, [instanceName]
        );
        if (instanceRes.rowCount === 0) throw new Error(`Workspace e config para a instância '${instanceName}' não encontrados.`);
        
        const { workspace_id, api_url, api_key } = instanceRes.rows[0];
        workspaceId = workspace_id;
        apiConfig = { api_url, api_key };
        
        let contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2', [workspaceId, contactJid]
        );
        
        if (contactRes.rowCount === 0) {
            contactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid, avatar_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [workspaceId, pushName || contactPhone, contactPhone, contactJid, null]
            );
        } else {
            // Update name if it's different and not null
            if (pushName && pushName !== contactRes.rows[0].name) {
                contactRes = await client.query(
                    'UPDATE contacts SET name = $1 WHERE id = $2 RETURNING *',
                    [pushName, contactRes.rows[0].id]
                );
            }
        }
        
        if (contactRes.rowCount === 0) throw new Error(`Falha ao encontrar ou criar o contato com JID ${contactJid}`);
        contactData = contactRes.rows[0];

        let chatRes = await client.query(
            `SELECT * FROM chats WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('gerais', 'atendimentos')`, [workspaceId, contactData.id]
        );
        
        let chat: Chat;
        if (chatRes.rowCount > 0) {
            chat = chatRes.rows[0];
        } else {
            const newChatRes = await client.query(
                `INSERT INTO chats (workspace_id, contact_id, status) VALUES ($1, $2, 'gerais'::chat_status_enum) RETURNING *`,
                [workspaceId, contactData.id]
            );
            chat = newChatRes.rows[0];
        }
        chat.contact = contactData;

        const messageResult = await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, metadata,
                message_id_from_api, sender_from_api, instance_name,
                status_from_api, source_from_api, server_url, from_me,
                api_message_status, raw_payload
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [
                workspaceId, chat.id, dbMessageType, content, JSON.stringify(metadata), key.id, sender,
                instanceName, data.status, data.source, parsedUrl, key.fromMe,
                data.status?.toUpperCase(), JSON.stringify(payload)
            ]
        );

        await client.query('COMMIT');
        
        savedChat = chat;
        savedMessage = messageResult.rows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem na transação:', error);
        return;
    } finally {
        client.release();
    }
    
    if (savedChat && savedMessage) {
        const postTransactionTasks: Promise<any>[] = [
            dispatchMessageToWebhooks(savedChat, savedMessage, instanceName),
        ];

        if (contactData?.id && apiConfig && !contactData.avatar_url) {
            postTransactionTasks.push(
                updateProfilePicture(contactData.id, contactJid, instanceName, apiConfig)
            );
        }
        
        Promise.all(postTransactionTasks).catch(err => {
            console.error("[WEBHOOK_POST_TRANSACTION] Erro ao executar tarefas em paralelo:", err);
        });
    }

    if (workspaceId) {
        revalidatePath(`/api/chats/${workspaceId}`);
    }
}

async function updateProfilePicture(contactId: string, contactJid: string, instanceName: string, apiConfig: { api_url: string; api_key: string; }) {
    try {
        console.log(`[WEBHOOK_PROFILE_PIC] Buscando foto para JID: ${contactJid}`);
        const profilePicRes = await fetchEvolutionAPI(
            `/chat/fetchProfilePictureUrl/${instanceName}`,
            apiConfig,
            { method: 'POST', body: JSON.stringify({ number: contactJid }) }
        );
        if (profilePicRes?.profilePictureUrl) {
            await db.query('UPDATE contacts SET avatar_url = $1 WHERE id = $2', [profilePicRes.profilePictureUrl, contactId]);
            console.log(`[WEBHOOK_PROFILE_PIC] Foto de perfil atualizada para o contato ${contactId}`);
        }
    } catch (picError) {
        console.error(`[WEBHOOK_PROFILE_PIC] Erro ao buscar foto de perfil para ${contactJid}:`, picError);
    }
}


async function handleContactsUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    if (!Array.isArray(data) || data.length === 0) return;
    
    const contactUpdate = data[0];
    const { id: remoteJid, profilePicUrl } = contactUpdate;

    if (!remoteJid || !profilePicUrl) return;

    try {
        const instanceRes = await db.query('SELECT config_id FROM evolution_api_instances WHERE name = $1', [instanceName]);
        if (instanceRes.rowCount === 0) return;
        const configId = instanceRes.rows[0].config_id;
        
        const configRes = await db.query('SELECT workspace_id FROM evolution_api_configs WHERE id = $1', [configId]);
        if(configRes.rowCount === 0) return;
        const workspaceId = configRes.rows[0].workspace_id;

        const result = await db.query(
            `UPDATE contacts SET avatar_url = $1 WHERE phone_number_jid = $2 AND workspace_id = $3`,
            [profilePicUrl, remoteJid, workspaceId]
        );

        if (result.rowCount > 0) {
            console.log(`[WEBHOOK_CONTACT_UPDATE] Foto de perfil atualizada para o contato ${remoteJid}.`);
        }
    } catch (error) {
        console.error('[WEBHOOK_CONTACT_UPDATE] Erro ao atualizar foto de perfil:', error);
    }
}

async function handleChatsUpsert(payload: any) {
    const { instance: instanceName, data } = payload;
     if (!Array.isArray(data) || data.length === 0) return;
    
    for (const chatUpdate of data) {
        const { id: remoteJid, archive } = chatUpdate;
        if (!remoteJid) continue;

        if (archive) {
             console.log(`[WEBHOOK_CHAT_UPSERT] Recebido evento de arquivamento para ${remoteJid}. Esta funcionalidade ainda não está implementada.`);
        }
    }
}
