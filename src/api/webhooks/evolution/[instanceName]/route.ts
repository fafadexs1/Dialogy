

'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import type { Message, MessageMetadata, Chat, Contact } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';
import { randomUUID } from 'crypto';
import { buildChatProtocol } from '@/lib/utils';

const WHATSAPP_STANDARD_JID_SUFFIX = '@s.whatsapp.net';

function resolveWhatsappJid(...candidates: Array<string | null | undefined>): string | null {
    const sanitized = candidates
        .map(candidate => (typeof candidate === 'string' ? candidate.trim() : ''))
        .filter((jid): jid is string => Boolean(jid));
    if (sanitized.length === 0) return null;
    const preferred = sanitized.find(jid => jid.toLowerCase().endsWith(WHATSAPP_STANDARD_JID_SUFFIX));
    return preferred ?? sanitized[0];
}

async function getApiConfigForInstance(instanceName: string): Promise<{ api_url: string, api_key: string } | null> {
    const instanceRes = await db.query(
        `SELECT c.api_url, c.api_key 
         FROM evolution_api_instances i
         JOIN whatsapp_clusters c ON i.cluster_id = c.id
         WHERE i.instance_name = $1`,
        [instanceName]
    );
    if (instanceRes.rowCount === 0) {
        return null;
    }
    return instanceRes.rows[0];
}

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

    let savedChat: Chat | null = null;
    let savedMessage: Message | null = null;
    let workspaceId: string | null = null;
    let apiConfig: { api_url: string; api_key: string; } | null = null;
    let contactData: Contact | null = null;
    const contactJid = resolveWhatsappJid(
        data?.key?.remoteJid,
        data?.key?.remoteJidAlt,
        data?.remoteJid,
        data?.remoteJidAlt
    );

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
    let dbMessageType: Message['type'] = 'text';

    const locationDetails = message.locationMessage;
    const mediaDetails = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.extendedTextMessage;
    const messageDetails = mediaDetails || locationDetails;
    const latitude = locationDetails?.degreesLatitude !== undefined ? Number(locationDetails.degreesLatitude) : undefined;
    const longitude = locationDetails?.degreesLongitude !== undefined ? Number(locationDetails.degreesLongitude) : undefined;
    const hasNumericCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
    const locationLabel = locationDetails
        ? locationDetails.name ||
        (locationDetails as any)?.address ||
        (hasNumericCoords
            ? `Localiza??o: ${latitude?.toFixed(5)}, ${longitude?.toFixed(5)}`
            : 'Localiza??o enviada')
        : '';
    
    content = message.conversation || mediaDetails?.text || mediaDetails?.caption || locationLabel;

    // A URL da m?dia est? no n?vel superior do objeto `message`
    const mediaUrl = message.mediaUrl || null;
    
    const effectiveMessageType = messageType || (locationDetails ? 'locationMessage' : undefined);

    if (effectiveMessageType) {
        switch (effectiveMessageType) {
            case 'audioMessage':
                dbMessageType = 'audio';
                break;
            case 'imageMessage':
                dbMessageType = 'image';
                break;
            case 'videoMessage':
                dbMessageType = 'video';
                break;
            case 'documentMessage':
                dbMessageType = 'document';
                break;
            case 'locationMessage':
                dbMessageType = 'location';
                break;
            case 'conversation': case 'extendedTextMessage': break;
            default:
                console.log(`[WEBHOOK_MSG_UPSERT] Tipo de mensagem não suportado: ${effectiveMessageType}. Ignorando.`);
                return;
        }
    }

    if (!content.trim() && !mediaUrl && !locationDetails) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem sem conteúdo textual ou de mídia. Ignorando.');
        return;
    }
    
    if (!contactJid) {
        console.log('[WEBHOOK_MSG_UPSERT] Nao foi possivel determinar o JID do contato. Payload ignorado.');
        return;
    }
    
    // Construir o objeto metadata
    let mimetype = mediaDetails?.mimetype || mediaDetails?.mime_type;

    if (!mimetype && effectiveMessageType) {
        if (effectiveMessageType === 'imageMessage') mimetype = 'image/jpeg';
        else if (effectiveMessageType === 'videoMessage') mimetype = 'video/mp4';
        else if (effectiveMessageType === 'audioMessage') mimetype = 'audio/mp4';
    }

    let locationThumbnail: string | undefined;
    const rawLocationThumb = locationDetails?.jpegThumbnail;
    if (rawLocationThumb) {
        try {
            if (typeof rawLocationThumb === 'string') {
                locationThumbnail = rawLocationThumb.startsWith('data:') ? rawLocationThumb : `data:image/jpeg;base64,${rawLocationThumb}`;
            } else if (Array.isArray(rawLocationThumb)) {
                locationThumbnail = `data:image/jpeg;base64,${Buffer.from(rawLocationThumb).toString('base64')}`;
            } else {
                locationThumbnail = `data:image/jpeg;base64,${Buffer.from(Object.values(rawLocationThumb)).toString('base64')}`;
            }
        } catch (thumbErr) {
            console.error('[WEBHOOK_MSG_UPSERT] Erro ao converter thumbnail de localização:', thumbErr);
        }
    }

    const safeLatitude = hasNumericCoords ? latitude : undefined;
    const safeLongitude = hasNumericCoords ? longitude : undefined;
    const mapsUrl = hasNumericCoords
        ? `https://www.google.com/maps?q=${latitude},${longitude}`
        : undefined;

    let metadata: MessageMetadata = {
        mediaUrl: mediaUrl,
        mimetype: mimetype,
        fileName: mediaDetails?.fileName,
        duration: mediaDetails?.seconds,
        thumbnail: (mediaDetails as any)?.thumbnail || (mediaDetails as any)?.jpegThumbnail,
    };

    if (locationDetails) {
        metadata = {
            ...metadata,
            latitude: safeLatitude,
            longitude: safeLongitude,
            address: locationDetails.name || (locationDetails as any)?.address,
            locationName: locationDetails.name,
            locationDescription: (locationDetails as any)?.description,
            mapUrl: mapsUrl,
            thumbnail: locationThumbnail || metadata.thumbnail,
        };
    }

    const contactPhone = contactJid.split('@')[0];
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const instanceRes = await client.query(
            `SELECT workspace_id
             FROM evolution_api_instances
             WHERE instance_name = $1`, [instanceName]
        );
        if (instanceRes.rowCount === 0) throw new Error(`Workspace para a instância '${instanceName}' não encontrado.`);
        
        workspaceId = instanceRes.rows[0].workspace_id;
        apiConfig = await getApiConfigForInstance(instanceName);

        let contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2', [workspaceId, contactJid]
        );
        
        if (contactRes.rowCount === 0) {
            console.log(`[WEBHOOK_MSG_UPSERT] Contato com JID ${contactJid} não encontrado no workspace ${workspaceId}. Criando novo contato...`);
            contactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid, avatar_url) VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [workspaceId, pushName || contactPhone, contactPhone, contactJid, null]
            );
        } else {
            // Update name if it's different and not null
            if (pushName && pushName !== contactRes.rows[0].name) {
                console.log(`[WEBHOOK_MSG_UPSERT] Atualizando nome do contato ${contactRes.rows[0].id} para '${pushName}'.`);
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
             console.log(`[WEBHOOK_MSG_UPSERT] Nenhum chat ativo encontrado para ${contactJid}. Criando um novo.`);
            const chatId = randomUUID();
            const protocol = buildChatProtocol(chatId);
            const newChatRes = await client.query(
                `INSERT INTO chats (id, workspace_id, contact_id, status, protocol) VALUES ($1, $2, $3, 'gerais'::chat_status_enum, $4) RETURNING *`,
                [chatId, workspaceId, contactData.id, protocol]
            );
            chat = newChatRes.rows[0];
        }
        chat.contact = contactData;

        const messageResult = await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, metadata,
                message_id_from_api, sender_from_api, instance_name,
                source_from_api, from_me,
                api_message_status, raw_payload
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [
                workspaceId, chat.id, dbMessageType, content, JSON.stringify(metadata ?? {}), key.id, sender,
                instanceName, data.source, key.fromMe,
                data.status?.toUpperCase() || 'SENT', JSON.stringify(payload ?? {})
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
    const profilePicUrl = contactUpdate?.profilePicUrl;
    const remoteJid = resolveWhatsappJid(
        contactUpdate?.id,
        contactUpdate?.remoteJid,
        contactUpdate?.remoteJidAlt
    );

    if (!remoteJid || !profilePicUrl) return;

    try {
        const instanceRes = await db.query('SELECT workspace_id FROM evolution_api_instances WHERE instance_name = $1', [instanceName]);
        if (instanceRes.rowCount === 0) return;
        const workspaceId = instanceRes.rows[0].workspace_id;

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
        const remoteJid = resolveWhatsappJid(
            chatUpdate?.id,
            chatUpdate?.remoteJid,
            chatUpdate?.remoteJidAlt
        );
        const archive = chatUpdate?.archive;
        if (!remoteJid) continue;

        if (archive) {
             console.log(`[WEBHOOK_CHAT_UPSERT] Recebido evento de arquivamento para ${remoteJid}. Esta funcionalidade ainda não está implementada.`);
        }
    }
}
