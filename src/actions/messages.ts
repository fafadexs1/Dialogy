
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { MessageMetadata, Message } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

// Importando as novas funções de serviço
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { sendImageMessage } from '@/services/whatsapp/send-image-message';
import { sendVideoMessage } from '@/services/whatsapp/send-video-message';
import { sendAudioMessage } from '@/services/whatsapp/send-audio-message';
import { sendDocumentMessage } from '@/services/whatsapp/send-document-message';
import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import { InstagramMessagingService } from '@/services/meta/instagram-messaging-service';
import { MessengerMessagingService } from '@/services/meta/messenger-messaging-service';
import {
    persistNormalizedMessage,
    type MetaChannelRecord,
} from '@/services/meta/meta-channel.service';
import { withDebug } from '@/lib/observability/logger';
import type { Chat, Contact } from '@/lib/types';
import { buildChatProtocol } from '@/lib/utils';

const DEFAULT_MARKETING_AUTO_CLOSE_MS = 5 * 60 * 1000;

async function getMarketingAutoCloseMs(workspaceId: string): Promise<number> {
    try {
        const res = await db.query(
            'SELECT marketing_auto_close_seconds FROM workspaces WHERE id = $1',
            [workspaceId]
        );
        if ((res.rowCount ?? 0) === 0) return DEFAULT_MARKETING_AUTO_CLOSE_MS;
        const raw = res.rows[0].marketing_auto_close_seconds;
        if (raw === null || raw === undefined) return DEFAULT_MARKETING_AUTO_CLOSE_MS;
        const seconds = Number(raw);
        if (!Number.isFinite(seconds) || seconds <= 0) return 0; // 0 ou negativo desabilita
        return seconds * 1000;
    } catch (err) {
        console.error('[MARKETING_AUTO_CLOSE] Falha ao buscar configuracao, usando padrao:', err);
        return DEFAULT_MARKETING_AUTO_CLOSE_MS;
    }
}

async function scheduleMarketingAutoClose(chatId: string, workspaceId: string, marketingSentAt: Date, autoCloseMs: number) {
    if (!autoCloseMs || autoCloseMs <= 0) return;
    setTimeout(async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const chatRes = await client.query(
                `SELECT status, agent_id FROM chats WHERE id = $1 FOR UPDATE`,
                [chatId]
            );
            if (chatRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return;
            }
            const { status, agent_id } = chatRes.rows[0];

            // Evita encerrar se já está encerrado ou com agente em atendimento
            if (status === 'encerrados' || agent_id) {
                await client.query('ROLLBACK');
                return;
            }

            const hasReply = await client.query(
                `SELECT 1 FROM messages WHERE chat_id = $1 AND from_me = FALSE AND created_at > $2 LIMIT 1`,
                [chatId, marketingSentAt.toISOString()]
            );

            if ((hasReply.rowCount ?? 0) > 0) {
                await client.query('ROLLBACK');
                return;
            }

            await client.query(
                `UPDATE chats 
                 SET status = 'encerrados', closed_at = NOW()
                 WHERE id = $1`,
                [chatId]
            );

            const seconds = Math.max(1, Math.round(autoCloseMs / 1000));
            const humanDelay = seconds >= 60 ? `${Math.round(seconds / 60)} minutos` : `${seconds} segundos`;

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, is_read, metadata
                 ) VALUES ($1, $2, 'system', $3, true, true, $4)`,
                [
                    workspaceId,
                    chatId,
                    `Atendimento encerrado automaticamente após ${humanDelay} sem resposta à mensagem de marketing.`,
                    {
                        event: 'marketing_auto_close',
                        autoClosedAfterMs: autoCloseMs,
                        marketingSentAt: marketingSentAt.toISOString(),
                    }
                ]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('[MARKETING_AUTO_CLOSE] Falha ao encerrar automaticamente:', err);
        } finally {
            client.release();
        }
    }, autoCloseMs).unref?.();
}

type MetaSendContext = {
    channel: MetaChannelRecord;
    platform: 'instagram' | 'messenger';
    externalUserId: string;
    externalChannelId: string | null;
    chat: Pick<Chat, 'id' | 'workspace_id' | 'status'> & { contact_id: string };
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
        chat: { id: chatId, workspace_id: row.workspace_id, status: 'atendimentos' as Chat['status'], contact_id: row.contact_id },
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
    messageId?: string, // Opcional: ID da mensagem gerado pelo cliente
    template?: { name: string; language: string; components: any[] } // New: support for templates
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

        // Se for humano e não tiver agente (independente do status), atribui o agente
        // Ignora atribuição se for mensagem de encerramento (close_notice)
        // Se o chat estiver encerrado, força a atribuição para o novo atendente
        const isFromHumanAgent = metadata?.sentBy !== 'system_agent';
        const isCloseNotice = metadata?.event === 'close_notice';

        if ((!currentAgentId || chatStatus === 'encerrados') && isFromHumanAgent && !isCloseNotice) {
            await client.query(
                "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2",
                [senderId, chatId]
            );

            // Insert system message indicating attendance started
            // We need to fetch the agent's name to be consistent with assignChatToSelfAction
            // Since senderId is the user ID, we can try to get the name from a separate query or assume it's available.
            // However, internalSendMessage doesn't receive the sender's name directly.
            // We can fetch it or just use a generic message if name is unavailable, but fetching is better.
            const agentRes = await client.query('SELECT full_name, email FROM users WHERE id = $1', [senderId]);
            const agentName = agentRes.rows[0]?.full_name || agentRes.rows[0]?.email || 'Agente';

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, 
                    sender_user_id, created_at, is_read
                ) VALUES ($1, $2, 'system', $3, true, $4, NOW(), true)`,
                [workspaceId, chatId, `Atendimento iniciado por ${agentName}.`, senderId]
            );
        }

        // Check for Mercado Livre
        if (chatInfo.source === 'mercadolivre') {
            try {
                // 1. Get Account
                const accountRes = await client.query(
                    'SELECT id, workspace_id, user_id, access_token, refresh_token FROM mercadolivre_accounts WHERE workspace_id = $1 LIMIT 1',
                    [workspaceId] // Assuming one account per workspace or we need to link chat to account more explicitly?
                    // Ideally, chat should track which account it belongs to if multiple.
                    // But for now, let's assume one active integration.
                );

                if ((accountRes.rowCount ?? 0) > 0) {
                    const { MercadoLivreMessagingService } = await import('@/services/mercadolivre/messaging-service');
                    const service = new MercadoLivreMessagingService(accountRes.rows[0]);

                    // 2. Determine if we are replying to a Question or Message
                    // We need the last received message metadata to know what we are replying to.
                    // Or just the chat context.
                    // If the last message was a Question, we answer it.
                    const lastMsgRes = await client.query(
                        `SELECT metadata, message_id_from_api FROM messages 
                          WHERE chat_id = $1 AND from_me = FALSE 
                          ORDER BY created_at DESC LIMIT 1`,
                        [chatId]
                    );

                    const lastMetadata = lastMsgRes.rows[0]?.metadata || {};
                    const isQuestion = lastMetadata.isQuestion;

                    let apiResponse: any;

                    if (isQuestion) {
                        const questionId = lastMetadata.questionId || lastMsgRes.rows[0]?.message_id_from_api;
                        if (questionId) {
                            apiResponse = await service.answerQuestion(questionId, content);
                        } else {
                            throw new Error('Não foi possível identificar a pergunta para responder.');
                        }
                    } else {
                        // Post-sale message
                        const packId = lastMetadata.packId; // Order ID
                        const buyerId = lastMetadata.buyerId || remoteJid; // We stored buyerId in remoteJid too
                        apiResponse = await service.sendMessage(packId, buyerId, content);
                    }

                    // 3. Persist
                    const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';
                    await client.query(
                        `INSERT INTO messages (
                            workspace_id, chat_id, type, content, from_me, 
                            metadata, is_read, ${senderColumn}, created_at
                        ) VALUES ($1, $2, 'text', $3, true, $4, true, $5, NOW())`,
                        [
                            workspaceId, chatId, content,
                            {
                                sentBy: metadata?.sentBy || 'agent',
                                platform: 'mercadolivre',
                                isQuestionReply: !!isQuestion
                            },
                            senderId
                        ]
                    );

                    await client.query('COMMIT');
                    return { success: true };
                }
            } catch (mlErr: any) {
                await client.query('ROLLBACK');
                console.error('[SEND_MESSAGE_ACTION][ML]', mlErr);
                return { success: false, error: mlErr.message || 'Falha ao enviar resposta ao Mercado Livre' };
            }
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



        let apiResponse: any;
        if (template) {
            apiResponse = await sendTemplateMessage(apiConfig, instanceName, {
                number: remoteJid,
                name: template.name,
                language: template.language,
                components: template.components
            });
        } else {
            apiResponse = await sendTextMessage(apiConfig, instanceName, remoteJid, content);
        }

        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        if (messageId) {
            await client.query(
                `INSERT INTO messages (
                    id, workspace_id, chat_id, type, content, from_me, 
                    message_id_from_api, api_message_status, instance_name, 
                    metadata, is_read, ${senderColumn}, sent_by_tab
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    messageId, workspaceId, chatId, 'text', content, true,
                    apiResponse?.key?.id, 'SENT', instanceName,
                    { ...metadata, ...(template ? { isTemplate: true, templateName: template.name } : {}) }, true, senderId, tabId
                ]
            );
        } else {
            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, 
                    message_id_from_api, api_message_status, instance_name, 
                    metadata, is_read, ${senderColumn}, sent_by_tab
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    workspaceId, chatId, 'text', content, true,
                    apiResponse?.key?.id, 'SENT', instanceName,
                    { ...metadata, ...(template ? { isTemplate: true, templateName: template.name } : {}) }, true, senderId, tabId
                ]
            );
        }

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

    // NOTE: We do NOT use a single transaction for the entire batch anymore.
    // This prevents holding a DB connection while uploading files to the API.
    try {
        // 1. Initial checks (read-only, fast)
        const chatInfoRes = await db.query(`
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

        // 2. Process each file independently
        for (const file of mediaFiles) {
            let apiResponse: any;
            let dbMessageType: Message['type'];

            const mediaContent = file.base64; // Pode ser Base64 ou URL remota

            // API Call (No DB connection held here)
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
                    if (file.filename === 'audio_gravado.mp3') {
                        apiResponse = await sendAudioMessage(apiConfig, instanceName, { number: remoteJid, audio: mediaContent });
                    } else {
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

            // Insert into DB (Quick operation, grabs connection and releases immediately)
            await db.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name,
                    metadata, is_read, ${senderColumn}, sent_by_tab
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    workspaceId, chatId, dbMessageType, caption, true,
                    apiResponse?.key?.id, 'SENT', instanceName,
                    dbMetadata, true, senderId, tabId
                ]
            );
        }

        // Revalidação manual não é mais necessária com subscriptions.
        // A UI será atualizada via websockets.
        // revalidatePath('/', 'layout');

        return { success: true };

    } catch (error) {
        console.error('[SEND_MEDIA_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido ao enviar mídia.";
        return { success: false, error: errorMessage };
    }
}


/**
 * Action specifically for sending messages from the UI (human agents).
 */
export const sendAgentMessageAction = withDebug(
    'send_agent_message',
    async function sendAgentMessageAction(
        chatId: string,
        content: string,
        tabId: string | null,
        messageId?: string
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
                        id: messageId,
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

        return internalSendMessage(chatId, content, user.id, tabId, undefined, undefined, messageId);
    },
    {
        contextResolver: (chatId, content) => ({ payload: { chatId, content } })
    }
);

/**
 * Action specifically for sending internal notes.
 * These messages are NOT sent to WhatsApp.
 */
export const sendInternalNoteAction = withDebug(
    'send_internal_note',
    async function sendInternalNoteAction(
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
    },
    {
        contextResolver: (chatId, content) => ({ payload: { chatId, content } })
    }
);

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
    const shouldAutoCloseMarketing = !!metadata?.isMarketing;
    const marketingSentAt = shouldAutoCloseMarketing ? new Date() : null;
    let workspaceIdForAutoClose: string | null = null;

    // Meta first
    const client = await db.connect();
    try {
        const metaCtx = await resolveMetaSendContext(chatId, client);
        if (metaCtx) {
            workspaceIdForAutoClose = metaCtx.chat.workspace_id;
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

    const result = await internalSendMessage(
        chatId,
        content,
        agentId,
        null,
        { ...baseMetadata, ...metadata },
        instanceName
    );

    if (shouldAutoCloseMarketing && result.success) {
        try {
            if (!workspaceIdForAutoClose) {
                const wsRes = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
                workspaceIdForAutoClose = wsRes.rows[0]?.workspace_id ?? null;
            }
            if (workspaceIdForAutoClose && marketingSentAt) {
                const autoCloseMs = await getMarketingAutoCloseMs(workspaceIdForAutoClose);
                await scheduleMarketingAutoClose(chatId, workspaceIdForAutoClose, marketingSentAt, autoCloseMs);
            }
        } catch (err) {
            console.error('[SEND_AUTOMATED_MESSAGE][AUTO_CLOSE] Falha ao agendar auto-encerramento:', err);
        }
    }

    return result;
}

export const sendMediaAction = withDebug(
    'send_media',
    async function sendMediaAction(
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
    },
    {
        contextResolver: (chatId, caption, mediaFiles) => ({
            payload: {
                chatId,
                caption,
                fileCount: mediaFiles?.length,
                types: mediaFiles?.map(f => f.mediatype)
            }
        })
    }
);

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
    metadata?: MessageMetadata,
): Promise<{ success: boolean; error?: string }> {
    const baseMetadata = metadata ?? {};
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
                        metadata: { ...baseMetadata, mediaUrl: file.base64, mimetype: file.mimetype, fileName: file.filename },
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

    return internalSendMedia(chatId, caption, mediaFiles, agentId, null, baseMetadata, instanceName);
}

export const sendAgentTemplateAction = withDebug(
    'send_agent_template',
    async function sendAgentTemplateAction(
        input: {
            agentId: string;
            workspaceId: string;
            numberid: string;
            instanceName: string;
            name: string;
            language: string;
            components: any[];
            metadata?: MessageMetadata;
        }
    ): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
        const { agentId, workspaceId, numberid, instanceName, name, language, components, metadata } = input;

        if (!numberid || !instanceName || !name || !language) {
            return { success: false, error: 'Campos obrigatórios faltando.' };
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const fullJid = numberid.includes('@') ? numberid : `${numberid}@s.whatsapp.net`;

            // 1. Find or create the contact
            let contactRes = await client.query(
                'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2',
                [workspaceId, fullJid]
            );
            let contactId;
            if (contactRes.rowCount === 0) {
                const newContactRes = await client.query(
                    `INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id`,
                    [workspaceId, numberid, fullJid]
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
            if (chatRes.rowCount && chatRes.rowCount > 0) {
                chatId = chatRes.rows[0].id;
            } else {
                const newChatId = randomUUID();
                const protocol = buildChatProtocol(newChatId);
                // For system agents, avoid setting agent_id (FK to users) to prevent constraint violations.
                const newChatRes = await client.query(
                    `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol) VALUES ($1, $2, $3, 'gerais', NULL, NULL, $4) RETURNING id`,
                    [newChatId, workspaceId, contactId, protocol]
                );
                chatId = newChatRes.rows[0].id;
            }

            // 3. Get API Config
            const apiConfig = await getApiConfigForInstance(instanceName);
            if (!apiConfig) {
                throw new Error(`Configuração da Evolution API não encontrada para a instância ${instanceName}.`);
            }

            // 4. Send Template
            const apiResponse = await sendTemplateMessage(apiConfig, instanceName, {
                number: fullJid,
                name,
                language,
                components
            });

            // 5. Persist Message
            // Build human-readable content preview from components, fallback to template name.
            let content = `[Template: ${name}]`;
            const bodyComponent = components.find((c: any) => c.type === 'body');
            const bodyText = bodyComponent?.parameters
                ?.map((p: any) => p.text || p.payload || p.example || '')
                .filter(Boolean)
                .join(' ')
                .trim();
            if (bodyText) {
                content = bodyText;
            }

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, 
                    message_id_from_api, api_message_status, instance_name, 
                    metadata, is_read, sender_system_agent_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    workspaceId, chatId, 'text', content, true,
                    apiResponse?.key?.id, 'SENT', instanceName,
                    {
                        isTemplate: true,
                        templateName: name,
                        templateComponents: components,
                        ...(metadata ?? {}),
                    }, true, agentId
                ]
            );

            await client.query('COMMIT');

            if (metadata?.isMarketing) {
                try {
                    const autoCloseMs = await getMarketingAutoCloseMs(workspaceId);
                    await scheduleMarketingAutoClose(chatId, workspaceId, new Date(), autoCloseMs);
                } catch (err) {
                    console.error('[SEND_AGENT_TEMPLATE_ACTION][AUTO_CLOSE] Falha ao agendar auto-encerramento:', err);
                }
            }

            return { success: true, apiResponse };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[SEND_AGENT_TEMPLATE_ACTION] Erro:', error);
            const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
            return { success: false, error: `Falha ao enviar template: ${errorMessage}` };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (input) => ({ payload: { instanceName: input.instanceName, template: input.name } })
    }
);


export const startNewConversation = withDebug(
    'start_conversation',
    async function startNewConversation(
        input: {
            workspaceId: string,
            instanceName: string,
            phoneNumber: string,
            message: string,
            tabId: string | null,
            template?: { name: string; language: string; components: any[] }
        }
    ): Promise<{ success: boolean, error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Usuário não autenticado.' };
        }
        const senderId = user.id;

        const { workspaceId, instanceName, phoneNumber, message, tabId, template } = input;
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
            if (chatRes.rowCount && chatRes.rowCount > 0) {
                chatId = chatRes.rows[0].id;
            } else {
                const newChatId = randomUUID();
                const protocol = buildChatProtocol(newChatId);
                const newChatRes = await client.query(
                    `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol) VALUES ($1, $2, $3, 'atendimentos', $4, NOW(), $5) RETURNING id`,
                    [newChatId, workspaceId, contactId, senderId, protocol]
                );
                chatId = newChatRes.rows[0].id;
            }

            await client.query('COMMIT');

            // 3. Send the message using the existing internal action
            // We pass the instanceName directly to ensure it's used.
            const sendResult = await internalSendMessage(chatId, message, senderId, tabId, {}, instanceName, undefined, template);

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
    },
    {
        contextResolver: (input) => ({ payload: { workspaceId: input.workspaceId, phoneNumber: input.phoneNumber } })
    }
);

export const saveTranscriptionAction = withDebug(
    'save_transcription',
    async function saveTranscriptionAction(messageId: string, transcription: string): Promise<{ success: boolean; error?: string }> {
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
    },
    {
        contextResolver: (messageId) => ({ payload: { messageId } })
    }
);

export const forwardMessageAction = withDebug(
    'forward_message',
    async function forwardMessageAction(
        originalMessage: Message,
        targetChatId: string,
        tabId: string | null
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Usuário não autenticado.' };
        }

        // Determine content and type based on original message
        let content = originalMessage.content;
        const metadata = originalMessage.metadata || {};

        // If it's a media message, we need to ensure we have the URL
        if (originalMessage.type !== 'text' && originalMessage.type !== 'system' && originalMessage.type !== 'location') {
            const mediaUrl = metadata.mediaUrl || metadata.thumbnail; // Fallback to thumbnail if mediaUrl missing (unlikely for valid media)

            if (!mediaUrl) {
                return { success: false, error: 'Mídia original não encontrada para encaminhamento.' };
            }

            return sendMediaAction(
                targetChatId,
                content || '', // Caption
                [{
                    base64: mediaUrl, // Passing URL as base64/url field
                    mimetype: metadata.mimetype || 'application/octet-stream',
                    filename: metadata.fileName || 'arquivo',
                    mediatype: originalMessage.type as any,
                    thumbnail: metadata.thumbnail
                }],
                tabId
            );
        }

        if (originalMessage.type === 'location') {
            return internalSendMessage(
                targetChatId,
                content || 'Localização',
                user.id,
                tabId,
                metadata
            );
        }

        return internalSendMessage(targetChatId, content, user.id, tabId, metadata);
    },
    {
        contextResolver: (msg, targetId) => ({ payload: { originalMessageId: msg.id, targetChatId: targetId } })
    }
);
