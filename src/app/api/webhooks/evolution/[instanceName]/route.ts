
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import type { Message, MessageMetadata, Chat } from '@/lib/types';
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
    
    // Correct content extraction logic
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
    const contactJid = key.remoteJid;
    const contactPhone = sender || contactJid.split('@')[0];
    
    try {
        await client.query('BEGIN');

        // 1. Obter o workspaceId e a config da API
        const instanceRes = await client.query(
            `SELECT ec.workspace_id, ec.api_url, ec.api_key 
             FROM evolution_api_instances AS ei
             JOIN evolution_api_configs AS ec ON ei.config_id = ec.id 
             WHERE ei.name = $1`, [instanceName]
        );
        if (instanceRes.rowCount === 0) throw new Error(`Workspace e config para a instância '${instanceName}' não encontrados.`);
        
        const { workspace_id, api_url, api_key } = instanceRes.rows[0];
        workspaceId = workspace_id; // Store for later use
        const apiConfig = { api_url, api_key };


        // 2. Criar o contato APENAS SE ele não existir.
        await client.query(
            `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid) VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, phone_number_jid) 
             DO NOTHING`, // NÃO FAZ NADA se o contato já existir
            [workspaceId, pushName || contactPhone, contactPhone, contactJid]
        );

        // 3. Buscar o contato (seja ele novo ou existente) para obter o ID e o avatar.
        const contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2',
            [workspaceId, contactJid]
        );

        if (contactRes.rowCount === 0) {
            throw new Error(`Falha ao encontrar ou criar o contato com JID ${contactJid}`);
        }
        
        const contactData = contactRes.rows[0];
        const contactId = contactData.id;
        const currentAvatar = contactData.avatar_url;
        
        // Se o contato não tem avatar, busca na API.
        if (!currentAvatar) {
            try {
                console.log(`[WEBHOOK_PROFILE_PIC] Buscando foto para JID: ${contactJid}`);
                const profilePicRes = await fetchEvolutionAPI(
                    `/chat/fetchProfilePictureUrl/${instanceName}`,
                    apiConfig,
                    {
                        method: 'POST',
                        body: JSON.stringify({ number: contactJid }),
                    }
                );
                if (profilePicRes?.profilePictureUrl) {
                    await client.query('UPDATE contacts SET avatar_url = $1 WHERE id = $2', [profilePicRes.profilePictureUrl, contactId]);
                    console.log(`[WEBHOOK_PROFILE_PIC] Foto de perfil atualizada para o contato ${contactId}`);
                    contactData.avatar_url = profilePicRes.profilePictureUrl;
                }
            } catch (picError) {
                console.error(`[WEBHOOK_PROFILE_PIC] Erro ao buscar foto de perfil para ${contactJid}:`, picError);
            }
        }
        
        // 4. Encontrar um chat ativo ou criar um novo
        let chatRes = await client.query(
            `SELECT * FROM chats WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('gerais', 'atendimentos')
             ORDER BY assigned_at DESC NULLS LAST LIMIT 1`, [workspaceId, contactId]
        );
        
        let chat: Chat;
        if (chatRes.rowCount > 0) {
            chat = chatRes.rows[0];
        } else {
            const newChatRes = await client.query(
                `INSERT INTO chats (workspace_id, contact_id, status) VALUES ($1, $2, 'gerais'::chat_status_enum) RETURNING *`,
                [workspaceId, contactId]
            );
            chat = newChatRes.rows[0];
        }
        
        chat.contact = contactData;

        // 5. Inserir a mensagem
        const messageResult = await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, sender_id, type, content, metadata,
                created_at, message_id_from_api, sender_from_api, instance_name,
                status_from_api, source_from_api, server_url, from_me,
                api_message_status, raw_payload
             ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
            [
                workspaceId, chat.id, contactId, dbMessageType, content, JSON.stringify(metadata), key.id, sender,
                instanceName, data.status, data.source, parsedUrl, key.fromMe,
                data.status?.toUpperCase(), JSON.stringify(payload)
            ]
        );

        await client.query('COMMIT');
        
        savedChat = chat;
        savedMessage = messageResult.rows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem:', error);
        // Retornamos para evitar o despacho do webhook em caso de falha.
        return;
    } finally {
        client.release();
    }
    
    // --- Despacho do Webhook (Fora da Transação) ---
    if (savedChat && savedMessage) {
        await dispatchMessageToWebhooks(savedChat, savedMessage, instanceName);
    }

    if (workspaceId) {
        revalidatePath(`/api/chats/${workspaceId}`);
    }
}

async function handleContactsUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    if (!Array.isArray(data) || data.length === 0) {
        console.log('[WEBHOOK_CONTACT_UPDATE] Payload inválido ou vazio.');
        return;
    }
    
    const contactUpdate = data[0];
    const { remoteJid, profilePicUrl } = contactUpdate;

    if (!remoteJid || !profilePicUrl) {
        console.log('[WEBHOOK_CONTACT_UPDATE] JID ou URL da foto de perfil ausente.');
        return;
    }

    try {
        const result = await db.query(
            `UPDATE contacts SET avatar_url = $1 WHERE phone_number_jid = $2`,
            [profilePicUrl, remoteJid]
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
     if (!Array.isArray(data) || data.length === 0) {
        console.log('[WEBHOOK_CHAT_UPSERT] Payload inválido ou vazio.');
        return;
    }
    
    // A API da Evolution usa o evento 'chats.upsert' principalmente para indicar arquivamento.
    // O payload típico tem um objeto com `id` (JID do contato) e `archive`.
    // Se `archive` for true, o chat foi arquivado.
    for (const chatUpdate of data) {
        const { id: remoteJid, archive } = chatUpdate;
        if (!remoteJid) continue;

        if (archive) {
             console.log(`[WEBHOOK_CHAT_UPSERT] Recebido evento de arquivamento para ${remoteJid}. Esta funcionalidade ainda não está implementada.`);
             // Futuramente, poderíamos adicionar uma lógica para mudar o status do chat aqui.
             // Ex: `UPDATE chats SET status = 'arquivados' WHERE contact_id = (SELECT id FROM contacts WHERE phone_number_jid = $1)`
        }
    }
}
