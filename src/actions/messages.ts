

'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { MessageMetadata, Message } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

// Importando as novas funções de serviço
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { sendImageMessage } from '@/services/whatsapp/send-image-message';
import { sendVideoMessage } from '@/services/whatsapp/send-video-message';
import { sendAudioMessage } from '@/services/whatsapp/send-audio-message';
import { sendDocumentMessage } from '@/services/whatsapp/send-document-message';
import { InstagramMessagingService } from '@/services/meta/instagram-messaging-service';
import { MessengerMessagingService } from '@/services/meta/messenger-messaging-service';
import {
    persistNormalizedMessage,
    type MetaChannelRecord,
} from '@/services/meta/meta-channel.service';
import type { Chat, Contact } from '@/lib/types';

type MetaSendContext = {
    channel: MetaChannelRecord;
    platform: 'instagram' | 'messenger';
    externalUserId: string;
    externalChannelId: string | null;
    chat: Pick<Chat, 'id' | 'workspace_id' | 'status'>;
    contact: Pick<Contact, 'id' | 'workspace_id' | 'name' | 'avatar_url'>;
    lastIncomingSender?: string | null;
};

function formatMetaSendError(err: any): string {
    const message = err instanceof Error ? err.message : String(err);
    const lowered = message?.toLowerCase?.() || '';

    if (lowered.includes('does not have the capability')) {
        return 'A Meta retornou (#3) \"Application does not have the capability to make this API call\". Habilite o recurso Instagram Messaging no app, garanta as permissões instagram_manage_messages/pages_manage_metadata e refaça a conexão com um token válido da página/conta comercial.';
    }

    return message || 'Falha ao enviar mensagem para o canal Meta.';
}

async function resolveMetaSendContext(chatId: string, client: any): Promise<MetaSendContext | null> {
    const res = await client.query(
        `
        SELECT 
          mc.platform,
          mc.external_thread_id,
          mct.external_id as external_user_id,
          (SELECT m.external_sender_id FROM messages m WHERE m.chat_id = mc.chat_id AND m.external_sender_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_external_sender_id,
          ch.id as channel_id,
          ch.workspace_id,
          ch.type,
          ch.external_page_id,
          ch.ig_business_id,
          ch.access_token,
          ch.app_secret,
          ch.verify_token,
          ch.name as channel_name,
          c.id as contact_id,
          c.workspace_id as contact_workspace_id,
          c.name as contact_name,
          c.avatar_url as contact_avatar
        FROM meta_conversations mc
        JOIN meta_contacts mct ON mct.id = mc.meta_contact_id
        JOIN meta_channels ch ON ch.id = mc.channel_id
        JOIN contacts c ON c.id = mct.contact_id
        WHERE mc.chat_id = $1
        LIMIT 1
      `,
        [chatId]
    );

    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    const channel: MetaChannelRecord = {
        id: row.channel_id,
        workspace_id: row.workspace_id,
        type: row.type,
        external_page_id: row.external_page_id,
        ig_business_id: row.ig_business_id,
        access_token: row.access_token,
        app_secret: row.app_secret,
        verify_token: row.verify_token,
        name: row.channel_name,
        status: 'active',
    };

    return {
        channel,
        platform: row.platform,
        externalUserId: row.external_user_id || row.last_external_sender_id,
        externalChannelId: row.external_page_id || row.ig_business_id,
        chat: { id: chatId, workspace_id: row.workspace_id, status: 'atendimentos' as Chat['status'] },
        contact: {
            id: row.contact_id,
            workspace_id: row.contact_workspace_id,
            name: row.contact_name,
            avatar_url: row.contact_avatar,
        },
    };
}

async function getApiConfigForInstance(instanceName: string): Promise<{ api_url: string; api_key: string; } | null> {
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


/**
 * Ação genérica para enviar uma mensagem de texto.
 * Pode ser chamada tanto por formulários (agentes) quanto por automações (Piloto Automático).
 * @param input - Um objeto FormData ou um objeto com os dados da mensagem.
 * @returns Um objeto com o resultado da operação.
 */
async function internalSendMessage(
    chatId: string,
    content: string,
    senderId: string, // The user ID of the sender (could be an agent or the system for automated messages)
    tabId: string | null, // ID da aba que está enviando a mensagem
    metadata?: MessageMetadata,
    instanceNameParam?: string, // Opcional: nome da instância para usar
): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
    if (!content || !chatId) {
        return { success: false, error: 'Conteúdo e ID do chat são obrigatórios.' };
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Carrega info básica do chat para atribuição de agente (independente do canal)
        const chatInfoRes = await client.query(`
            SELECT 
                c.workspace_id, c.status, c.agent_id,
                ct.phone_number_jid,
                (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_instance_name
            FROM chats c
            JOIN contacts ct ON c.contact_id = ct.id
            WHERE c.id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const chatInfo = chatInfoRes.rows[0];
        const { workspace_id: workspaceId, status: chatStatus, agent_id: currentAgentId, phone_number_jid: remoteJid, last_instance_name: lastInstanceName } = chatInfo;

        // Se for humano e chat em "gerais", atribui o agente
        const isFromHumanAgent = metadata?.sentBy !== 'system_agent';
        if (chatStatus === 'gerais' && !currentAgentId && isFromHumanAgent) {
            await client.query(
                "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2",
                [senderId, chatId]
            );
        }

        // Tenta contexto Meta (Instagram/Messenger)
        const metaCtx = await resolveMetaSendContext(chatId, client);
        if (metaCtx) {
            try {
                const service =
                    metaCtx.platform === 'instagram'
                        ? new InstagramMessagingService(metaCtx.channel)
                        : new MessengerMessagingService(metaCtx.channel);

                const apiResponse = await service.sendMessage({
                    recipientId: metaCtx.externalUserId,
                    type: 'text',
                    text: content,
                });

                await persistNormalizedMessage({
                    channel: metaCtx.channel,
                    chat: metaCtx.chat,
                    contact: metaCtx.contact,
                    message: {
                        type: 'text',
                        content,
                        metadata,
                    },
                    platform: metaCtx.platform,
                    direction: 'outgoing',
                    externalMessageId: (apiResponse as any)?.message_id || (apiResponse as any)?.id || null,
                    externalSenderId: metaCtx.externalUserId,
                    externalChannelId: metaCtx.externalChannelId,
                    rawPayload: { request: { content }, response: apiResponse },
                    fromMe: true,
                    senderUserId: senderId,
                    senderSystemAgentId: metadata?.sentBy === 'system_agent' ? senderId : null,
                });

                await client.query('COMMIT');
                return { success: true, apiResponse };
            } catch (metaErr) {
                await client.query('ROLLBACK');
                console.error('[SEND_MESSAGE_ACTION][META]', metaErr);
                return { success: false, error: formatMetaSendError(metaErr) };
            }
        }

        // Fluxo WhatsApp legado
        const instanceName = instanceNameParam || lastInstanceName;

        if (!remoteJid || !instanceName) {
            throw new Error('Nao foi possivel encontrar o numero de destino ou a instancia para este chat.');
        }

        const apiConfig = await getApiConfigForInstance(instanceName);

        if (!apiConfig) {
            throw new Error('Configuracao da API nao encontrada para a instancia ' + instanceName + '.');
        }

        const apiResponse = await sendTextMessage(apiConfig, instanceName, remoteJid, content);

        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, from_me, 
                message_id_from_api, api_message_status, instance_name, 
                metadata, is_read, ${senderColumn}, sent_by_tab
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                workspaceId, chatId, 'text', content, true,
                apiResponse?.key?.id, 'SENT', instanceName,
                metadata ?? {}, true, senderId, tabId
            ]
        );

await client.query('COMMIT');

        // Revalidação manual não é mais necessária com subscriptions.
        // A UI será atualizada via websockets.
        // revalidatePath('/', 'layout');

        return { success: true, apiResponse };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MESSAGE_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao enviar mensagem: ${errorMessage}` };
    } finally {
        client.release();
    }
}


/**
 * Internal function to handle media sending logic.
 */
async function internalSendMedia(
    chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string;
    }[],
    senderId: string,
    tabId: string | null,
    metadata?: MessageMetadata,
    instanceNameParam?: string,
): Promise<{ success: boolean; error?: string }> {
    if (!chatId || !mediaFiles || mediaFiles.length === 0) {
        return { success: false, error: 'Dados da mídia inválidos.' };
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatInfoRes = await client.query(`
            SELECT c.workspace_id, ct.phone_number_jid, 
                   (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_instance_name
            FROM chats c
            JOIN contacts ct ON c.contact_id = ct.id
            WHERE c.id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) throw new Error('Chat não encontrado.');

        const { workspace_id: workspaceId, phone_number_jid: remoteJid, last_instance_name: lastInstanceName } = chatInfoRes.rows[0];
        const instanceName = instanceNameParam || lastInstanceName;

        if (!remoteJid || !instanceName) throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');

        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração da Evolution API não encontrada para a instância ${instanceName}.`);

        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        for (const file of mediaFiles) {
            let apiResponse;
            let dbMessageType: Message['type'];

            const mediaContent = file.base64; // Pode ser Base64 ou URL remota

            switch (file.mediatype) {
                case 'image':
                    apiResponse = await sendImageMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                    dbMessageType = 'image';
                    break;
                case 'video':
                    apiResponse = await sendVideoMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                    dbMessageType = 'video';
                    break;
                case 'document':
                    apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                    dbMessageType = 'document';
                    break;
                case 'audio':
                    // Special handling for recorded audio to be sent as voice note
                    if (file.filename === 'audio_gravado.mp3') {
                        apiResponse = await sendAudioMessage(apiConfig, instanceName, { number: remoteJid, audio: mediaContent });
                    } else {
                        // Send other audio files as documents
                        apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                    }
                    dbMessageType = 'audio';
                    break;
                default:
                    throw new Error(`Unsupported mediatype: ${file.mediatype}`);
            }

            const messageTypeKey = `${dbMessageType}Message` as keyof typeof apiResponse.message;
            const messageDetails = apiResponse.message?.[messageTypeKey] as any;
            const resolvedMediaUrl =
                apiResponse?.message?.mediaUrl ||
                messageDetails?.url ||
                (apiResponse as any)?.tempMediaPublicUrl;

            const dbMetadata: MessageMetadata = {
                ...(metadata ?? {}),
                mediaUrl: resolvedMediaUrl,
                fileName: messageDetails?.fileName || file.filename,
                mimetype: messageDetails?.mimetype || file.mimetype,
                duration: messageDetails?.seconds,
                thumbnail: file.thumbnail || (metadata?.thumbnail ?? undefined),
            };

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name,
                    metadata, is_read, ${senderColumn}, sent_by_tab
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    workspaceId, chatId, dbMessageType, caption, true,
                    apiResponse?.key?.id, apiResponse?.status || 'SENT', instanceName,
                    dbMetadata, true, senderId, tabId
                ]
            );
        }

        await client.query('COMMIT');

        // Revalidação manual não é mais necessária com subscriptions.
        // A UI será atualizada via websockets.
        // revalidatePath('/', 'layout');

        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MEDIA_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido ao enviar mídia.";
        return { success: false, error: errorMessage };
    } finally {
        client.release();
    }
}


/**
 * Action specifically for sending messages from the UI (human agents).
 */
export async function sendAgentMessageAction(
    chatId: string,
    content: string,
    tabId: string | null
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    // Tenta Meta primeiro (Instagram/Messenger)
    const client = await db.connect();
    try {
        const metaCtx = await resolveMetaSendContext(chatId, client);
        if (metaCtx) {
            try {
                const service =
                    metaCtx.platform === 'instagram'
                        ? new InstagramMessagingService(metaCtx.channel)
                        : new MessengerMessagingService(metaCtx.channel);

                const apiResponse = await service.sendMessage({
                    recipientId: metaCtx.externalUserId,
                    type: 'text',
                    text: content,
                });

                await persistNormalizedMessage({
                    channel: metaCtx.channel,
                    chat: metaCtx.chat,
                    contact: metaCtx.contact,
                    message: { type: 'text', content, metadata: {} },
                    platform: metaCtx.platform,
                    direction: 'outgoing',
                    externalMessageId: (apiResponse as any)?.message_id || (apiResponse as any)?.id || null,
                    externalSenderId: metaCtx.externalUserId,
                    externalChannelId: metaCtx.externalChannelId,
                    rawPayload: { request: { content }, response: apiResponse },
                    fromMe: true,
                    senderUserId: user.id,
                    senderSystemAgentId: null,
                });
                return { success: true };
            } catch (metaErr) {
                console.error('[SEND_AGENT_MESSAGE][META]', metaErr);
                return { success: false, error: formatMetaSendError(metaErr) };
            }
        }
    } catch (err) {
        console.error('[SEND_AGENT_MESSAGE][META_CTX]', err);
    } finally {
        client.release();
    }

    return internalSendMessage(chatId, content, user.id, tabId);
}

/**
 * Action specifically for sending internal notes.
 * These messages are NOT sent to WhatsApp.
 */
export async function sendInternalNoteAction(
    chatId: string,
    content: string,
    tabId: string | null
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatInfoRes = await client.query(`
            SELECT workspace_id FROM chats WHERE id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const { workspace_id: workspaceId } = chatInfoRes.rows[0];

        await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, from_me, 
                api_message_status, metadata, is_read, sender_user_id, sent_by_tab
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                workspaceId, chatId, 'text', content, true,
                'internal', { isInternalNote: true }, true, user.id, tabId
            ]
        );

        await client.query('COMMIT');
        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_INTERNAL_NOTE] Erro:', error);
        return { success: false, error: 'Falha ao salvar nota interna.' };
    } finally {
        client.release();
    }
}

/**
 * Action for sending automated messages.
 */
export async function sendAutomatedMessageAction(
    chatId: string,
    content: string,
    agentId: string,
    isSystemAgent: boolean = false,
    instanceName?: string,
    metadata?: MessageMetadata,
): Promise<{ success: boolean; error?: string, apiResponse?: any }> {
    const baseMetadata = isSystemAgent ? { sentBy: 'system_agent' as const } : { sentBy: 'autopilot' as const };

    // Meta first
    const client = await db.connect();
    try {
        const metaCtx = await resolveMetaSendContext(chatId, client);
        if (metaCtx) {
            try {
                const service = metaCtx.platform === 'instagram'
                    ? new InstagramMessagingService(metaCtx.channel)
                    : new MessengerMessagingService(metaCtx.channel);

                const apiResponse = await service.sendMessage({
                    recipientId: metaCtx.externalUserId,
                    type: 'text',
                    text: content,
                });

                await persistNormalizedMessage({
                    channel: metaCtx.channel,
                    chat: metaCtx.chat,
                    contact: metaCtx.contact,
                    message: { type: 'text', content, metadata: { ...baseMetadata, ...metadata } },
                    platform: metaCtx.platform,
                    direction: 'outgoing',
                    externalMessageId: (apiResponse as any)?.message_id || (apiResponse as any)?.id || null,
                    externalSenderId: metaCtx.externalUserId,
                    externalChannelId: metaCtx.externalChannelId,
                    rawPayload: { request: { content }, response: apiResponse },
                    fromMe: true,
                    senderUserId: agentId,
                    senderSystemAgentId: isSystemAgent ? agentId : null,
                });
                return { success: true, apiResponse };
            } catch (metaErr) {
                console.error('[SEND_AUTOMATED_MESSAGE][META]', metaErr);
                return { success: false, error: formatMetaSendError(metaErr) };
            }
        }
    } catch (err) {
        console.error('[SEND_AUTOMATED_MESSAGE][META_FALLBACK]', err);
    } finally {
        client.release();
    }

    return internalSendMessage(
        chatId,
        content,
        agentId,
        null,
        { ...baseMetadata, ...metadata },
        instanceName
    );
}

export async function sendMediaAction(
    chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string;
    }[],
    tabId: string | null
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuario nao autenticado.' };
    }

    // Meta first
    const client = await db.connect();
    try {
        const metaCtx = await resolveMetaSendContext(chatId, client);
        if (metaCtx) {
            try {
                const service = metaCtx.platform === 'instagram'
                    ? new InstagramMessagingService(metaCtx.channel)
                    : new MessengerMessagingService(metaCtx.channel);

                for (const file of mediaFiles) {
                    const apiResponse = await service.sendMessage({
                        recipientId: metaCtx.externalUserId,
                        type: file.mediatype === 'document' ? 'file' : file.mediatype,
                        text: caption,
                        mediaUrl: file.base64, // assume URL/base64 already handled upstream
                    });

                    await persistNormalizedMessage({
                        channel: metaCtx.channel,
                        chat: metaCtx.chat,
                        contact: metaCtx.contact,
                        message: {
                            type: file.mediatype === 'document' ? 'document' : file.mediatype,
                            content: caption,
                            metadata: { mediaUrl: file.base64, mimetype: file.mimetype, fileName: file.filename },
                            mediaUrl: file.base64,
                        },
                        platform: metaCtx.platform,
                        direction: 'outgoing',
                        externalMessageId: (apiResponse as any)?.message_id || (apiResponse as any)?.id || null,
                        externalSenderId: metaCtx.externalUserId,
                        externalChannelId: metaCtx.externalChannelId,
                        rawPayload: { request: { caption, file }, response: apiResponse },
                        fromMe: true,
                        senderUserId: user.id,
                        senderSystemAgentId: null,
                    });
                }
                return { success: true };
            } catch (metaErr) {
                console.error('[SEND_MEDIA][META]', metaErr);
                return { success: false, error: formatMetaSendError(metaErr) };
            }
        }
    } catch (err) {
        console.error('[SEND_MEDIA][META_FALLBACK]', err);
    } finally {
        client.release();
    }

    return internalSendMedia(chatId, caption, mediaFiles, user.id, tabId);
}

export async function sendAutomatedMediaAction(
    chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string;
    }[],
    agentId: string,
    instanceName?: string,
): Promise<{ success: boolean; error?: string }> {
    // Meta first
    const client = await db.connect();
    try {
        const metaCtx = await resolveMetaSendContext(chatId, client);
        if (metaCtx) {
            const service = metaCtx.platform === 'instagram'
                ? new InstagramMessagingService(metaCtx.channel)
                : new MessengerMessagingService(metaCtx.channel);

            for (const file of mediaFiles) {
                const apiResponse = await service.sendMessage({
                    recipientId: metaCtx.externalUserId,
                    type: file.mediatype === 'document' ? 'file' : file.mediatype,
                    text: caption,
                    mediaUrl: file.base64,
                });

                await persistNormalizedMessage({
                    channel: metaCtx.channel,
                    chat: metaCtx.chat,
                    contact: metaCtx.contact,
                    message: {
                        type: file.mediatype === 'document' ? 'document' : file.mediatype,
                        content: caption,
                        metadata: { mediaUrl: file.base64, mimetype: file.mimetype, fileName: file.filename },
                        mediaUrl: file.base64,
                    },
                    platform: metaCtx.platform,
                    direction: 'outgoing',
                    externalMessageId: (apiResponse as any)?.message_id || (apiResponse as any)?.id || null,
                    externalSenderId: metaCtx.externalUserId,
                    externalChannelId: metaCtx.externalChannelId,
                    rawPayload: { request: { caption, file }, response: apiResponse },
                    fromMe: true,
                    senderUserId: agentId,
                    senderSystemAgentId: null,
                });
            }
            return { success: true };
        }
    } catch (err) {
        console.error('[SEND_AUTOMATED_MEDIA][META_FALLBACK]', err);
    } finally {
        client.release();
    }

    return internalSendMedia(chatId, caption, mediaFiles, agentId, null, undefined, instanceName);
}

export async function startNewConversation(
    input: { workspaceId: string, instanceName: string, phoneNumber: string, message: string, tabId: string | null }
): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const senderId = user.id;

    const { workspaceId, instanceName, phoneNumber, message, tabId } = input;
    if (!workspaceId || !instanceName || !phoneNumber || !message) {
        return { success: false, error: 'Todos os campos são obrigatórios.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const fullJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

        // 1. Find or create the contact
        let contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2',
            [workspaceId, fullJid]
        );
        let contactId;
        if (contactRes.rowCount === 0) {
            const newContactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id`,
                [workspaceId, phoneNumber, fullJid]
            );
            contactId = newContactRes.rows[0].id;
        } else {
            contactId = contactRes.rows[0].id;
        }

        // 2. Find or create the chat
        let chatRes = await client.query(
            `SELECT id FROM chats WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('gerais', 'atendimentos')`,
            [workspaceId, contactId]
        );
        let chatId;
        if (chatRes.rowCount > 0) {
            chatId = chatRes.rows[0].id;
        } else {
            const newChatRes = await client.query(
                `INSERT INTO chats (workspace_id, contact_id, status, agent_id, assigned_at) VALUES ($1, $2, 'atendimentos', $3, NOW()) RETURNING id`,
                [workspaceId, contactId, senderId]
            );
            chatId = newChatRes.rows[0].id;
        }

        await client.query('COMMIT');

        // 3. Send the message using the existing internal action
        // We pass the instanceName directly to ensure it's used.
        const sendResult = await internalSendMessage(chatId, message, senderId, tabId, {}, instanceName);

        if (sendResult.success) {
            return { success: true };
        } else {
            return { success: false, error: sendResult.error };
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[START_NEW_CONVERSATION_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao iniciar conversa: ${errorMessage}` };
    } finally {
        client.release();
    }
}

export async function saveTranscriptionAction(messageId: string, transcription: string): Promise<{ success: boolean; error?: string }> {
    if (!messageId || !transcription) {
        return { success: false, error: "ID da mensagem e transcrição são obrigatórios." };
    }

    try {
        const result = await db.query(
            'UPDATE messages SET transcription = $1 WHERE id = $2',
            [transcription, messageId]
        );
        if (result.rowCount === 0) {
            return { success: false, error: "Mensagem não encontrada." };
        }
        // No longer needed with realtime
        // revalidatePath('/', 'layout');
        return { success: true };
    } catch (error: any) {
        console.error("Erro ao salvar transcrição:", error);
        return { success: false, error: "Falha no servidor ao salvar a transcrição." };
    }
}
