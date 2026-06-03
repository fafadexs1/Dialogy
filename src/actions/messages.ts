
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { MessageMetadata, Message } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { randomUUID } from 'crypto';

// Importando as novas funções de serviço
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { sendImageMessage } from '@/services/whatsapp/send-image-message';
import { sendVideoMessage } from '@/services/whatsapp/send-video-message';
import { sendAudioMessage } from '@/services/whatsapp/send-audio-message';
import { sendDocumentMessage } from '@/services/whatsapp/send-document-message';
import { sendListMessage } from '@/services/whatsapp/send-list-message';
import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { InstagramMessagingService } from '@/services/meta/instagram-messaging-service';
import { MessengerMessagingService } from '@/services/meta/messenger-messaging-service';
import {
    persistNormalizedMessage,
    type MetaChannelRecord,
} from '@/services/meta/meta-channel.service';
import { withDebug } from '@/lib/observability/logger';
import { recordInboxEvent } from '@/lib/observability/inbox-events';
import type { Chat, Contact } from '@/lib/types';
import { buildChatProtocol } from '@/lib/utils';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import {
    enqueueAiCaseMemoryRefresh,
    enqueueJob,
    enqueueMarketingAutoClose,
    shouldEnqueueJob
} from '@/lib/queue';
import { touchUserPresenceActivity, touchUserPresenceFromChat } from '@/lib/presence-server';
import { buildTelegramChatJid, parseTelegramChatId, sendTelegramTextMessage } from '@/services/telegram/bot-api';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';
import {
    findWhatsappChatByIdentity,
    findOrCreateWhatsappContact,
    lockWhatsappIdentityTransaction,
    normalizeWhatsappPhoneNumber as normalizeWhatsappPhoneIdentity,
    resolveCanonicalWhatsappChatId,
} from '@/lib/whatsapp/contact-identity';
import { hasRecentWhatsappCustomerReply } from '@/lib/whatsapp/customer-window';
import { prependIntelligentAttendantSignature } from '@/lib/message-signature';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';

// Helper to map DB message (snake_case) to Frontend Message (camelCase for some fields)
function mapDbMessageToFrontend(row: any): Message {
    return {
        ...row,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at ? (row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at) : undefined,
    } as Message;
}

async function withIntelligentAttendantSignature(
    content: string,
    agentId: string,
    isSystemAgent: boolean
): Promise<string> {
    if (!isSystemAgent) return content;

    try {
        const { rows } = await db.query(
            `SELECT name, type
             FROM system_agents
             WHERE id = $1
             LIMIT 1`,
            [agentId]
        );
        const agent = rows[0];
        return agent?.type === 'intelligent_attendant'
            ? prependIntelligentAttendantSignature(content, agent.name)
            : content;
    } catch (error) {
        console.error('[SEND_AUTOMATED_MESSAGE] Falha ao montar assinatura do agente virtual:', error);
        return content;
    }
}

type MediaFilePayload = {
    base64: string;
    mimetype: string;
    filename: string;
    mediatype: 'image' | 'video' | 'document' | 'audio';
    thumbnail?: string;
    deleteAfterSend?: boolean;
    storageBucket?: string;
    storagePath?: string;
};

type InteractiveListRow = {
    title: string;
    description?: string;
    rowId: string;
};

type InteractiveListSection = {
    title: string;
    rows: InteractiveListRow[];
};

type InteractiveListPayload = {
    title?: string;
    description?: string;
    buttonText: string;
    footerText?: string;
    sections: InteractiveListSection[];
    delay?: number;
    quoted?: {
        key?: {
            id?: string;
        };
        message?: Record<string, any>;
    };
    mentionsEveryOne?: boolean;
    mentioned?: string[];
};

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
    const timer = setTimeout(async () => {
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

            const closeRes = await client.query(
                `UPDATE chats 
                 SET status = 'encerrados',
                     closed_at = NOW(),
                     updated_at = clock_timestamp()
                 WHERE id = $1
                 RETURNING closed_at`,
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
            await broadcastHydratedChatUpdate(workspaceId, chatId);

            const closedAt = closeRes.rows[0]?.closed_at
                ? new Date(closeRes.rows[0].closed_at).toISOString()
                : null;

            try {
                if (shouldEnqueueJob('ai_case_memory_refresh')) {
                    await enqueueAiCaseMemoryRefresh({
                        workspaceId,
                        chatId,
                        closedAt,
                    });
                } else {
                    await refreshCaseMemoryForChat({
                        workspaceId,
                        chatId,
                        closedAt,
                    });
                }
            } catch (caseMemoryError) {
                console.error('[MARKETING_AUTO_CLOSE] Falha ao atualizar memoria de caso:', caseMemoryError);
            }
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('[MARKETING_AUTO_CLOSE] Falha ao encerrar automaticamente:', err);
        } finally {
            client.release();
        }
    }, autoCloseMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

async function scheduleMarketingAutoCloseAsync(chatId: string, workspaceId: string, marketingSentAt: Date, autoCloseMs: number) {
    if (!autoCloseMs || autoCloseMs <= 0) return;

    if (!shouldEnqueueJob('marketing_auto_close')) {
        await scheduleMarketingAutoClose(chatId, workspaceId, marketingSentAt, autoCloseMs);
        return;
    }

    const anchor = Number.isFinite(marketingSentAt.getTime()) ? marketingSentAt : new Date();
    await enqueueMarketingAutoClose(
        {
            chatId,
            workspaceId,
            marketingSentAt: anchor.toISOString(),
            autoCloseMs,
        },
        {
            runAt: new Date(anchor.getTime() + autoCloseMs),
            maxAttempts: 1,
        }
    );
}

async function cleanupTempMedia(file: MediaFilePayload) {
    if (!file.deleteAfterSend || !file.storageBucket || !file.storagePath) return;

    try {
        const { error } = await getSupabaseAdmin().storage.from(file.storageBucket).remove([file.storagePath]);
        if (error) {
            console.error('[SEND_MEDIA_BG] Falha ao remover mídia temporária:', error, 'Bucket:', file.storageBucket, 'Path:', file.storagePath);
        }
    } catch (error) {
        console.error('[SEND_MEDIA_BG] Exceção ao remover mídia temporária:', error, 'Bucket:', file.storageBucket, 'Path:', file.storagePath);
    }
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

function serializeErrorPayload(error: unknown): unknown {
    if (error instanceof Error) {
        const errObj = error as Error & Record<string, unknown>;
        const extraEntries = Object.entries(errObj).filter(([key]) => !['name', 'message', 'stack'].includes(key));
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            ...Object.fromEntries(extraEntries),
        };
    }

    if (error && typeof error === 'object') {
        try {
            return JSON.parse(JSON.stringify(error));
        } catch (_err) {
            return String(error);
        }
    }

    return error ?? null;
}

function normalizeWhatsappPhoneNumber(value: string): string {
    return (normalizeWhatsappPhoneIdentity(value) ?? value.replace(/@.*$/, '').replace(/\D/g, '')) || value;
}

function normalizeTelegramRecipient(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith('telegram:') ? trimmed : buildTelegramChatJid(trimmed);
}

async function getTelegramInstanceCredentials(
    instanceName: string | null | undefined,
    workspaceId: string
): Promise<{ botToken: string; instanceName: string } | null> {
    if (!instanceName) return null;

    const res = await db.query(
        `SELECT
            instance_name,
            bot_token
         FROM telegram_bot_instances
         WHERE instance_name = $1
           AND workspace_id = $2
         LIMIT 1`,
        [instanceName, workspaceId]
    );

    const row = res.rows[0];
    if (!row || !row.bot_token) {
        return null;
    }

    return {
        botToken: row.bot_token,
        instanceName: row.instance_name,
    };
}

async function getMessagingInstanceType(
    client: any,
    workspaceId: string,
    instanceName: string
): Promise<'wa_cloud' | 'baileys' | 'telegram' | null> {
    const telegramCredentials = await getTelegramInstanceCredentials(instanceName, workspaceId);
    if (telegramCredentials) {
        return 'telegram';
    }

    const instanceRes = await client.query(
        `SELECT type
         FROM evolution_api_instances
         WHERE workspace_id = $1
           AND instance_name = $2
         LIMIT 1`,
        [workspaceId, instanceName]
    );

    const instanceType = instanceRes.rows[0]?.type;
    if (instanceType === 'wa_cloud' || instanceType === 'baileys') {
        return instanceType;
    }

    return null;
}

async function loadWhatsappResumeContext(
    client: any,
    workspaceId: string,
    chatId: string
): Promise<{
    chatId: string;
    workspaceId: string;
    contactId: string;
    status: Chat['status'];
    lastCustomerMessageAt: Date | null;
    canResumeWithoutTemplate: boolean;
} | null> {
    const res = await client.query(
        `SELECT
            c.id,
            c.workspace_id,
            c.contact_id,
            c.status,
            (
                SELECT m.created_at
                FROM messages m
                WHERE m.chat_id = c.id
                  AND m.from_me = FALSE
                ORDER BY m.created_at DESC
                LIMIT 1
            ) AS last_customer_message_at
         FROM chats c
         WHERE c.id = $1
           AND c.workspace_id = $2
         LIMIT 1`,
        [chatId, workspaceId]
    );

    if ((res.rowCount ?? 0) === 0) {
        return null;
    }

    const row = res.rows[0];
    const lastCustomerMessageAt = row.last_customer_message_at
        ? new Date(row.last_customer_message_at)
        : null;

    return {
        chatId: row.id,
        workspaceId: row.workspace_id,
        contactId: row.contact_id,
        status: row.status as Chat['status'],
        lastCustomerMessageAt,
        canResumeWithoutTemplate:
            row.status === 'encerrados' &&
            hasRecentWhatsappCustomerReply(lastCustomerMessageAt),
    };
}

async function reopenClosedWhatsappChat(
    client: any,
    input: {
        chatId: string;
        workspaceId: string;
        senderId: string;
        senderName: string;
        lastCustomerMessageAt: Date | null;
    }
): Promise<void> {
    const reopenRes = await client.query(
        `UPDATE chats
         SET status = 'atendimentos',
             closed_at = NULL,
             agent_id = $1,
             assigned_system_agent_id = NULL,
             is_autopilot_active = FALSE,
             copilot_mode = 'off',
             assigned_at = clock_timestamp(),
             updated_at = clock_timestamp()
         WHERE id = $2
           AND workspace_id = $3
         RETURNING id`,
        [input.senderId, input.chatId, input.workspaceId]
    );

    if ((reopenRes.rowCount ?? 0) === 0) {
        throw new Error('Nao foi possivel reabrir o atendimento selecionado.');
    }

    await client.query(
        `INSERT INTO messages (
            workspace_id,
            chat_id,
            type,
            content,
            from_me,
            sender_user_id,
            created_at,
            is_read,
            metadata
        ) VALUES ($1, $2, 'system', $3, TRUE, $4, clock_timestamp(), TRUE, $5)`,
        [
            input.workspaceId,
            input.chatId,
            `Atendimento reaberto por ${input.senderName} sem envio de template.`,
            input.senderId,
            {
                event: 'resume_without_template',
                resumed_by: input.senderId,
                last_customer_message_at: input.lastCustomerMessageAt?.toISOString() ?? null,
            },
        ]
    );
}

function buildInteractiveListPreview(list: InteractiveListPayload): string {
    const summary = [list.title, list.description].filter(Boolean).join(' - ').trim();
    if (summary) {
        return summary;
    }
    return `[Lista interativa] ${list.buttonText}`;
}

function isValidInteractiveList(list: InteractiveListPayload | undefined): list is InteractiveListPayload {
    if (!list?.buttonText?.trim()) return false;
    if (!Array.isArray(list.sections) || list.sections.length === 0) return false;

    return list.sections.every((section) =>
        typeof section?.title === 'string' &&
        section.title.trim().length > 0 &&
        Array.isArray(section.rows) &&
        section.rows.length > 0 &&
        section.rows.every((row) =>
            typeof row?.title === 'string' &&
            row.title.trim().length > 0 &&
            typeof row?.rowId === 'string' &&
            row.rowId.trim().length > 0
        )
    );
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
          ch.settings,
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

    let row = res.rows[0];

    if (!row) {
        const fallbackRes = await client.query(
            `
            WITH latest_meta_message AS (
              SELECT
                m.chat_id,
                m.workspace_id,
                CASE
                  WHEN m.platform::text IN ('instagram', 'messenger') THEN m.platform::text
                  WHEN lower(COALESCE(NULLIF(m.source_from_api, ''), '')) LIKE '%instagram%' THEN 'instagram'
                  WHEN lower(COALESCE(NULLIF(m.source_from_api, ''), '')) LIKE '%messenger%' THEN 'messenger'
                  ELSE NULL
                END AS platform,
                m.external_sender_id,
                m.external_channel_id,
                m.instance_name
              FROM messages m
              WHERE m.chat_id = $1
                AND m.external_sender_id IS NOT NULL
                AND (
                  m.platform::text IN ('instagram', 'messenger')
                  OR lower(COALESCE(NULLIF(m.source_from_api, ''), '')) IN ('instagram', 'messenger')
                )
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1
            )
            SELECT
              lmm.platform,
              lmm.external_sender_id as external_user_id,
              lmm.external_sender_id as last_external_sender_id,
              ch.id as channel_id,
              ch.workspace_id,
              ch.type,
              ch.external_page_id,
              ch.ig_business_id,
              ch.access_token,
              ch.app_secret,
              ch.verify_token,
              ch.settings,
              ch.name as channel_name,
              c.id as contact_id,
              c.workspace_id as contact_workspace_id,
              c.name as contact_name,
              c.avatar_url as contact_avatar
            FROM latest_meta_message lmm
            JOIN chats chat ON chat.id = lmm.chat_id
            JOIN contacts c ON c.id = chat.contact_id
            JOIN meta_channels ch
              ON ch.workspace_id = chat.workspace_id
             AND ch.type::text = lmm.platform
             AND (
                lmm.external_channel_id IS NULL
                OR ch.external_page_id = lmm.external_channel_id
                OR ch.ig_business_id = lmm.external_channel_id
                OR lower(ch.name) = lower(lmm.instance_name)
             )
            WHERE lmm.platform IS NOT NULL
            ORDER BY
              CASE
                WHEN ch.external_page_id = lmm.external_channel_id OR ch.ig_business_id = lmm.external_channel_id THEN 0
                WHEN lower(ch.name) = lower(lmm.instance_name) THEN 1
                ELSE 2
              END
            LIMIT 1
            `,
            [chatId]
        );

        row = fallbackRes.rows[0];
    }

    if (!row) return null;
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
        settings: row.settings,
    };

    const externalChannelId =
        row.platform === 'instagram'
            ? row.ig_business_id || row.external_page_id
            : row.external_page_id || row.ig_business_id;

    return {
        channel,
        platform: row.platform,
        externalUserId: row.external_user_id || row.last_external_sender_id,
        externalChannelId,
        chat: { id: chatId, workspace_id: row.workspace_id, status: 'atendimentos' as Chat['status'], contact_id: row.contact_id },
        contact: {
            id: row.contact_id,
            workspace_id: row.contact_workspace_id,
            name: row.contact_name,
            avatar_url: row.contact_avatar,
        },
    };
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
    template?: { name: string; language: string; components: any[]; renderedContent?: string }, // New: support for templates
    apiContent?: string // Content to send to API (if different from DB content)
): Promise<{ success: boolean; error?: string; apiResponse?: any; message?: Message }> {
    if (!content || !chatId) {
        return { success: false, error: 'Conteúdo e ID do chat são obrigatórios.' };
    }
    const client = await db.connect();

    // Variáveis capturadas para uso no bloco assíncrono (background)
    let persistedMessage: Message | null = null;
    let backgroundTaskData: any = {};
    let assignmentWorkspaceId: string | null = null;

    try {
        await client.query('BEGIN');
        if (messageId) {
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
                ['agent_message_send', messageId]
            );
        }
        chatId = (await resolveCanonicalWhatsappChatId(client, chatId)) || chatId;

        // Carrega info básica do chat para atribuição de agente (independente do canal)
        const chatInfoRes = await client.query(`
            SELECT 
                c.workspace_id, c.status, c.agent_id, c.assigned_system_agent_id,
                ct.phone_number_jid,
                mc.platform as meta_platform,
                (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_instance_name,
                COALESCE(
                    (SELECT m.source_from_api FROM messages m WHERE m.chat_id = c.id AND m.source_from_api IS NOT NULL ORDER BY m.created_at DESC LIMIT 1),
                    (SELECT m.platform::text FROM messages m WHERE m.chat_id = c.id AND m.platform IS NOT NULL ORDER BY m.created_at DESC LIMIT 1),
                    mc.platform::text
                ) as source_from_api
            FROM chats c
            JOIN contacts ct ON c.contact_id = ct.id
            LEFT JOIN meta_conversations mc ON mc.chat_id = c.id
            WHERE c.id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const chatInfo = chatInfoRes.rows[0];
        const { workspace_id: workspaceId, status: chatStatus, agent_id: currentAgentId, assigned_system_agent_id: currentSystemAgentId, phone_number_jid: remoteJid, last_instance_name: lastInstanceName, source_from_api: source, meta_platform } = chatInfo;
        const normalizedSource = (source || '').toString().toLowerCase();
        const normalizedMetaPlatform = (meta_platform || '').toString().toLowerCase();
        const isTelegramSource =
            normalizedSource === 'telegram' ||
            remoteJid?.startsWith('telegram:') ||
            /^tg\d+$/i.test((instanceNameParam || lastInstanceName || '').toString());
        const outboundSourceFromApi =
            normalizedMetaPlatform === 'instagram' || normalizedSource === 'instagram'
                ? 'instagram'
                : normalizedMetaPlatform === 'messenger' || normalizedSource === 'messenger'
                    ? 'messenger'
                    : isTelegramSource
                        ? 'telegram'
                        : normalizedSource === 'wa_cloud'
                            ? 'wa_cloud'
                            : null;

        // Emulate source property for downstream logic
        chatInfo.source = outboundSourceFromApi || source;

        if (messageId) {
            const existingMessageRes = await client.query(
                `SELECT *
                 FROM messages
                 WHERE id = $1
                   AND chat_id = $2
                   AND workspace_id = $3
                 LIMIT 1`,
                [messageId, chatId, workspaceId]
            );

            if ((existingMessageRes.rowCount ?? 0) > 0) {
                persistedMessage = mapDbMessageToFrontend(existingMessageRes.rows[0]);
                await client.query('COMMIT');
                recordInboxEvent('message_send_idempotent_replay', {
                    chatId,
                    workspaceId,
                    messageId,
                    tabId,
                });
                return { success: true, message: persistedMessage };
            }
        }

        // Se for humano e não tiver agente (independente do status), atribui o agente
        const isFromHumanAgent = !metadata?.sentBy;
        const isCloseNotice = metadata?.event === 'close_notice';

        if (!currentAgentId && chatStatus !== 'encerrados' && isFromHumanAgent && !isCloseNotice) {
            await client.query(
                `UPDATE chats
                 SET agent_id = $1,
                     assigned_system_agent_id = NULL,
                     is_autopilot_active = FALSE,
                     copilot_mode = 'off',
                     status = 'atendimentos',
                     assigned_at = NOW(),
                     updated_at = clock_timestamp()
                 WHERE id = $2`,
                [senderId, chatId]
            );
            assignmentWorkspaceId = workspaceId;

            const agentRes = await client.query('SELECT full_name, email FROM users WHERE id = $1', [senderId]);
            const agentName = agentRes.rows[0]?.full_name || agentRes.rows[0]?.email || 'Agente';

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, 
                    sender_user_id, created_at, is_read
                ) VALUES ($1, $2, 'system', $3, true, $4, NOW(), true)`,
                [workspaceId, chatId, currentSystemAgentId ? `Atendimento reassumido por ${agentName}.` : `Atendimento iniciado por ${agentName}.`, senderId]
            );
        }

        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';
        const dbMetadata = { ...metadata, ...(template ? { isTemplate: true, templateName: template.name } : {}) };

        // Define instância para uso (prioridade: param > last_instance > default/error)
        const instanceName = instanceNameParam || lastInstanceName;

        // Inserção da Mensagem Principal como PENDING
        // Usamos api_message_status = 'PENDING' para indicar que ainda vamos processar
        let insertRes;

        // Se já temos um ID (otimista), usamos ele
        const messageIdToUse = messageId || randomUUID();

        // Use rendered template content if available, otherwise fallback to regular content
        const dbContent = template?.renderedContent || content;

        // Query de inserção
        insertRes = await client.query(
            `INSERT INTO messages (
                id, workspace_id, chat_id, type, content, from_me, 
                message_id_from_api, api_message_status, instance_name, source_from_api,
                metadata, is_read, ${senderColumn}, sent_by_tab
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *`,
            [
                messageIdToUse, workspaceId, chatId, 'text', dbContent, true,
                null, 'PENDING', instanceName, // Salva instanceName mesmo que null por enquanto, mas valida depois
                outboundSourceFromApi,
                dbMetadata, true, senderId, tabId
            ]
        );

        persistedMessage = mapDbMessageToFrontend(insertRes.rows[0]);
        recordInboxEvent('message_persisted_pending', {
            chatId,
            workspaceId,
            messageId: persistedMessage.id,
            tabId,
            source: outboundSourceFromApi || source || 'whatsapp',
        });
        backgroundTaskData = {
            chatInfo,
            instanceName,
            remoteJid,
            apiContent: apiContent || content,
            template,
            messageId: persistedMessage?.id
        };

        await client.query('COMMIT');
        if (assignmentWorkspaceId) {
            await broadcastHydratedChatUpdate(assignmentWorkspaceId, chatId);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MESSAGE_ACTION] Erro síncrono:', error);
        throw error; // Erro na validação ou DB inicial deve falhar a request
    } finally {
        client.release();
    }


    // ... existing imports

    // --- BLOCO ASSÍNCRONO (FIRE-AND-FORGET) ---
    // Executa fora do fluxo principal de resposta
    (async () => {
        if (!persistedMessage || !backgroundTaskData?.messageId) return;

        try {
            const { chatInfo, instanceName, remoteJid, apiContent, template, messageId } = backgroundTaskData;
            // ... rest of the code
            const source = (chatInfo.source || '').toString().toLowerCase();
            const metaPlatform = (chatInfo.meta_platform || '').toString().toLowerCase();
            const isMetaSource = source === 'instagram' || source === 'messenger' || metaPlatform === 'instagram' || metaPlatform === 'messenger';
            const telegramCredentials = await getTelegramInstanceCredentials(instanceName, chatInfo.workspace_id);
            const isTelegramSource = source === 'telegram' || remoteJid?.startsWith('telegram:') || Boolean(telegramCredentials);

            // 1. Lógica Específica por Canal
            let apiResponse: any;
            let externalId: string | null = null;

            // -- Mercado Livre --
            if (chatInfo.source === 'mercadolivre') {
                const { MercadoLivreMessagingService } = await import('@/services/mercadolivre/messaging-service');
                // Busca conta ML
                const accountRes = await db.query(
                    'SELECT id, workspace_id, user_id, access_token, refresh_token FROM mercadolivre_accounts WHERE workspace_id = $1 LIMIT 1',
                    [persistedMessage.workspace_id]
                );

                if (accountRes.rowCount === 0) throw new Error('Conta Mercado Livre não configurada.');
                const service = new MercadoLivreMessagingService(accountRes.rows[0]);

                if (metadata?.isQuestionReply) {
                    // Lógica simplificada: se metadado diz que é resposta, tentamos achar o ID da pergunta na última mensagem recebida
                    // Como já persistimos a mensagem atual, buscamos a penúltima (recebida)
                    const lastMsgRes = await db.query(
                        `SELECT metadata, message_id_from_api FROM messages 
                         WHERE chat_id = $1 AND from_me = FALSE AND created_at < $2
                         ORDER BY created_at DESC LIMIT 1`,
                        [chatId, persistedMessage.createdAt]
                    );
                    const qId = lastMsgRes.rows[0]?.metadata?.questionId || lastMsgRes.rows[0]?.message_id_from_api;
                    if (!qId) throw new Error('Pergunta original não encontrada para resposta.');
                    apiResponse = await service.answerQuestion(qId, apiContent);
                } else {
                    const packId = metadata?.packId;
                    const buyerId = metadata?.buyerId || remoteJid;
                    if (!packId) throw new Error('PackId não encontrado para mensagem pós-venda.');
                    apiResponse = await service.sendMessage(packId, buyerId, apiContent);
                }
                externalId = apiResponse?.id || null;
            }

            // -- Meta (Instagram / Messenger) --
            // Precisamos resolver o contexto Meta.
            // Nota: resolveMetaSendContext usa 'client', vamos criar um novo pool client rápido ou usar pool direto se possível.
            // resolveMetaSendContext executa query apenas, dá pra usar db.query se adaptar a assinatura, 
            // mas ela pede client. Vamos abrir um client rápido para isso.
            else if (isMetaSource || (!instanceName && !remoteJid)) { // Assumindo que Meta channels não usam instanceName/remoteJid da mesma forma que WA
                const metaClient = await db.connect();
                let metaCtx = null;
                try {
                    metaCtx = await resolveMetaSendContext(chatId, metaClient);
                } finally {
                    metaClient.release();
                }

                if (metaCtx) {
                    const service = metaCtx.platform === 'instagram'
                        ? new InstagramMessagingService(metaCtx.channel)
                        : new MessengerMessagingService(metaCtx.channel);

                    apiResponse = await service.sendMessage({
                        recipientId: metaCtx.externalUserId,
                        type: 'text',
                        text: apiContent,
                    });

                    externalId = (apiResponse as any)?.message_id || (apiResponse as any)?.id;

                    // Persistência adicional do Meta (update)
                    // A função original chamava 'persistNormalizedMessage', que faz INSERT/UPDATE.
                    // Aqui já fizemos o INSERT. Precisamos apenas atualizar os IDs externos.
                } else {
                    // Se não é meta e não tem instanceName, falhou
                    throw new Error('Canal de envio não identificado (sem instância WA e sem contexto Meta).');
                }
            }

            // -- Telegram Bot --
            else if (isTelegramSource) {
                if (!remoteJid || !instanceName) {
                    throw new Error('Destino ou instancia nao definidos para envio Telegram.');
                }

                const credentials = telegramCredentials || await getTelegramInstanceCredentials(instanceName, chatInfo.workspace_id);
                if (!credentials) {
                    throw new Error(`Credenciais Telegram nao encontradas para a instancia ${instanceName}.`);
                }

                apiResponse = await sendTelegramTextMessage(credentials.botToken, parseTelegramChatId(remoteJid), apiContent);
                externalId = apiResponse?.message_id ? `telegram:${apiResponse.message_id}` : null;
            }

            // -- WhatsApp (Evolution API) --
            else {
                if (!remoteJid || !instanceName) {
                    throw new Error('Destino ou Instância não definidos para envio WhatsApp.');
                }

                // Valida queue
                if (shouldEnqueueJob('whatsapp_send')) {
                    // Se Queue está ativa, o handler da queue fará o envio.
                    // Apenas enfileiramos.
                    // OBS: Aqui já inserimos a mensagem. Precisamos apenas chamar enqueueJob.
                    // O handler da queue espera um messageId já criado geralmente.
                    await enqueueJob('whatsapp_send', {
                        messageId,
                        workspaceId: persistedMessage.workspace_id,
                        instanceName,
                        number: remoteJid,
                        content: apiContent, // ou content
                        apiContent,
                        template,
                        metadata: persistedMessage.metadata,
                        senderId,
                        senderType: metadata?.sentBy === 'system_agent' ? 'system_agent' : 'user',
                        tabId
                    });
                    recordInboxEvent('message_send_enqueued', {
                        chatId,
                        workspaceId: persistedMessage.workspace_id,
                        messageId,
                        instanceName,
                    });
                    // Retornamos aqui pois o worker vai atualizar o status depois
                    return;
                }

                // Envio Direto via API
                const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId: chatInfo.workspace_id });
                if (!apiConfig) throw new Error(`Configuração API não encontrada par instância ${instanceName}`);

                if (template) {
                    apiResponse = await sendTemplateMessage(apiConfig, instanceName, {
                        number: remoteJid,
                        name: template.name,
                        language: template.language,
                        components: template.components
                    });
                } else {
                    apiResponse = await sendTextMessage(apiConfig, instanceName, remoteJid, apiContent);
                }
                externalId = apiResponse?.key?.id;
            }

            // 2. Atualiza status para SENT no DB
            await db.query(`
                UPDATE messages 
                SET api_message_status = 'SENT',
                    message_id_from_api = $1
                WHERE id = $2
            `, [externalId, messageId]);
            recordInboxEvent('message_send_sent', {
                chatId,
                workspaceId: persistedMessage.workspace_id,
                messageId,
                externalId,
            });

        } catch (bgError) {
            // Atualiza para FAILED
            const errorMessage = formatMetaSendError(bgError);
            recordInboxEvent('message_send_failed', {
                chatId,
                workspaceId: persistedMessage.workspace_id,
                messageId: backgroundTaskData?.messageId,
                reason: errorMessage,
            }, 'warn');
            console.error('[INTERNAL_SEND_BG] Falha no envio em background:', bgError);
            const errorDetails = {
                source: 'dialogy_send_background',
                status: 'FAILED',
                reason: errorMessage,
                captured_at: new Date().toISOString(),
                raw_payload: serializeErrorPayload(bgError),
            };
            await db.query(`
                UPDATE messages 
                SET api_message_status = 'FAILED',
                    metadata = jsonb_set(
                        jsonb_set(COALESCE(metadata, '{}'::jsonb), '{send_error}', to_jsonb($1::text), true),
                        '{send_error_details}',
                        $2::jsonb,
                        true
                    )
                WHERE id = $3
            `, [errorMessage, JSON.stringify(errorDetails), messageId]);
        }
    })();

    // Retorna imediatamente com sucesso (Optimistic Server Response)
    return { success: true, message: persistedMessage };
}


/**
 * Internal function to handle media sending logic.
 */
async function internalSendMedia(
    chatId: string,
    caption: string,
    mediaFiles: MediaFilePayload[],
    senderId: string,
    tabId: string | null,
    metadata?: MessageMetadata,
    instanceNameParam?: string,
): Promise<{ success: boolean; error?: string; messages?: Message[] }> {
    if (!chatId || !mediaFiles || mediaFiles.length === 0) {
        return { success: false, error: 'Dados da mídia inválidos.' };
    }

    const client = await db.connect();

    // Data needed for background task
    let pendingMessages: { dbMessage: Message, file: MediaFilePayload }[] = [];
    let backgroundData: any = {};

    try {
        await client.query('BEGIN');
        chatId = (await resolveCanonicalWhatsappChatId(client, chatId)) || chatId;

        // 1. Initial checks (read-only, fast)
        const chatInfoRes = await client.query(`
            SELECT c.workspace_id, ct.phone_number_jid, 
                   (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_instance_name
            FROM chats c
            JOIN contacts ct ON c.contact_id = ct.id
            WHERE c.id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const { workspace_id: workspaceId, phone_number_jid: remoteJid, last_instance_name: lastInstanceName } = chatInfoRes.rows[0];
        const instanceName = instanceNameParam || lastInstanceName;

        if (!remoteJid || !instanceName) throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');

        const telegramCredentials = await getTelegramInstanceCredentials(instanceName, workspaceId);
        if (telegramCredentials || remoteJid.startsWith('telegram:')) {
            throw new Error('Envio de midia para Telegram ainda nao esta disponivel. Envie uma mensagem de texto.');
        }

        const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId });
        if (!apiConfig) throw new Error(`Configuração da Evolution API não encontrada para a instância ${instanceName}.`);

        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        backgroundData = {
            apiConfig,
            instanceName,
            remoteJid,
            chatId
        };

        // 2. Insert all as PENDING
        for (const file of mediaFiles) {
            const messageId = randomUUID(); // Generate locally to ensure we have it

            // Infer type for DB
            let dbMessageType: Message['type'] = file.mediatype as any;
            if (!['image', 'video', 'document', 'audio'].includes(dbMessageType)) {
                dbMessageType = 'document'; // Fallback
            }

            const dbMetadata: MessageMetadata = {
                ...(metadata ?? {}),
                mediaUrl: file.base64?.startsWith('http') ? file.base64 : undefined, // Use URL if provided
                fileName: file.filename,
                mimetype: file.mimetype,
                thumbnail: file.thumbnail,
            };

            const insertRes = await client.query(
                `INSERT INTO messages (
                    id, workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name,
                    metadata, is_read, ${senderColumn}, sent_by_tab
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *`,
                [
                    messageId, workspaceId, chatId, dbMessageType, caption, true,
                    null, 'PENDING', instanceName,
                    dbMetadata, true, senderId, tabId
                ]
            );

            pendingMessages.push({
                dbMessage: mapDbMessageToFrontend(insertRes.rows[0]),
                file
            });
        }

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MEDIA_ACTION] Erro síncrono:', error);
        return { success: false, error: error instanceof Error ? error.message : "Erro ao preparar envio de mídia." };
    } finally {
        client.release();
    }

    // --- Background Block ---
    (async () => {
        if (pendingMessages.length === 0) return;

        const { apiConfig, instanceName, remoteJid } = backgroundData;

        for (const item of pendingMessages) {
            const { dbMessage, file } = item;

            try {
                let apiResponse: any;
                const mediaContent = file.base64;

                console.log(`[INTERNAL_SEND_BG] Processing media file: ${file.filename}, type: ${file.mediatype}, mime: ${file.mimetype}`);

                // ... (switch case logic) ...
                if (file.mediatype === 'audio') {
                    console.log(`[INTERNAL_SEND_BG] Audio check - isWebm/Ogg: ${file.mimetype.includes('webm') || file.mimetype.includes('ogg')}, name startswith audio_gravado: ${file.filename?.startsWith('audio_gravado')}`);
                }

                switch (file.mediatype) {
                    case 'image':
                        apiResponse = await sendImageMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                        break;
                    case 'video':
                        // Video uploads can be slow
                        apiResponse = await sendVideoMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                        break;
                    case 'document':
                        apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                        break;
                    case 'audio':
                        if (file.filename?.startsWith('audio_gravado') || file.mimetype.includes('webm') || file.mimetype.includes('ogg')) {
                            apiResponse = await sendAudioMessage(apiConfig, instanceName, { number: remoteJid, audio: mediaContent, mimetype: file.mimetype, fileName: file.filename });
                            console.log('[INTERNAL_SEND_BG] sendAudioMessage response:', JSON.stringify(apiResponse, null, 2));
                        } else {
                            apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                        }
                        break;
                    default:
                        // Should default to document as per DB insert?
                        apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: mediaContent, mimetype: file.mimetype, filename: file.filename, caption });
                }

                // Update Status to SENT
                // Update Status to SENT

                // Extract URL if Evolution returns it (sometimes it does in message details)
                // NOTE: Evolution types might vary.
                const messageTypeKey = `${file.mediatype}Message` as any;

                // Robust extraction: Check specific audio keys or generic keys
                // PRIORITY: Check message.mediaUrl first, then specific message type 'media' key (Evolution MinIO link)
                let returnedUrl = apiResponse.message?.mediaUrl ||
                    apiResponse.message?.[messageTypeKey]?.media ||
                    apiResponse.message?.[messageTypeKey]?.url ||
                    apiResponse.message?.[messageTypeKey]?.directPath;

                let returnedMimetype = apiResponse.message?.[messageTypeKey]?.mimetype;

                // Fallback for audio where key might differ or be inside 'message' directly
                if (!returnedUrl && file.mediatype === 'audio') {
                    returnedUrl = apiResponse.message?.audioMessage?.media ||
                        apiResponse.message?.audioMessage?.url ||
                        apiResponse.message?.documentMessage?.url ||
                        apiResponse.url;

                    returnedMimetype = apiResponse.message?.audioMessage?.mimetype ||
                        apiResponse.message?.documentMessage?.mimetype;
                }
                // If the API returns a direct URL for the media, we can update it in metadata, but usually we already have our public URL if using S3.
                // If using base64 pass-through, Evolution might return a URL if it stores it (e.g. WA Cloud).

                // Atualiza status e, se houver nova URL, atualiza o metadata
                if (returnedUrl) {
                    await db.query(`
                        UPDATE messages 
                        SET api_message_status = 'SENT',
                            message_id_from_api = $1,
                            metadata = jsonb_set(
                                jsonb_set(COALESCE(metadata, '{}'), '{mediaUrl}', $2),
                                '{mimetype}', $3
                            )
                        WHERE id = $4
                    `, [apiResponse?.key?.id, JSON.stringify(returnedUrl), JSON.stringify(returnedMimetype || file.mimetype), dbMessage.id]);
                } else {
                    await db.query(`
                        UPDATE messages 
                        SET api_message_status = 'SENT',
                            message_id_from_api = $1
                        WHERE id = $2
                    `, [apiResponse?.key?.id, dbMessage.id]);
                }

            } catch (bgError: any) {
                console.error(`[SEND_MEDIA_BG] Falha ao enviar ${file.filename}:`, bgError);
                const errorMessage = bgError?.message || 'Erro desconhecido';
                const errorDetails = {
                    source: 'dialogy_send_media_background',
                    status: 'FAILED',
                    reason: errorMessage,
                    captured_at: new Date().toISOString(),
                    raw_data: {
                        filename: file.filename,
                        mimetype: file.mimetype,
                        mediatype: file.mediatype,
                    },
                    raw_payload: serializeErrorPayload(bgError),
                };
                await db.query(`
                    UPDATE messages 
                    SET api_message_status = 'FAILED',
                        metadata = jsonb_set(
                            jsonb_set(COALESCE(metadata, '{}'::jsonb), '{send_error}', to_jsonb($1::text), true),
                            '{send_error_details}',
                            $2::jsonb,
                            true
                        )
                    WHERE id = $3
                `, [errorMessage, JSON.stringify(errorDetails), dbMessage.id]);
            } finally {
                await cleanupTempMedia(file);
            }
        }
    })();

    // Return immediately
    return { success: true, messages: pendingMessages.map(p => p.dbMessage) };
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
    ): Promise<{ success: boolean; error?: string; message?: Message }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Usuário não autenticado.' };
        }

        await touchUserPresenceFromChat(user.id, chatId, tabId, 'agent_message');

        // Fetch user name for signature
        let contentWithSignature = content;
        try {
            const userRes = await db.query('SELECT full_name FROM users WHERE id = $1', [user.id]);
            const fullName = userRes.rows[0]?.full_name;
            if (fullName) {
                const firstName = fullName.trim().split(' ')[0].toUpperCase();
                contentWithSignature = `*${firstName}*:\n\n${content}`;
            }
        } catch (err) {
            console.error('[SEND_AGENT_MESSAGE] Falha ao obter nome do usuário para assinatura:', err);
        }

        return internalSendMessage(chatId, content, user.id, tabId, { optimisticId: messageId }, undefined, messageId, undefined, contentWithSignature);
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
        tabId: string | null,
        optimisticId?: string
    ): Promise<{ success: boolean; error?: string; message?: Message }> {
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
            await touchUserPresenceActivity(user.id, workspaceId, tabId, 'internal_note');

            const insertRes = await client.query(
                `INSERT INTO messages (
                workspace_id, chat_id, type, content, from_me, 
                api_message_status, metadata, is_read, sender_user_id, sent_by_tab
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
                [
                    workspaceId, chatId, 'text', content, true,
                    'internal', { isInternalNote: true, optimisticId }, true, user.id, tabId
                ]
            );

            await client.query('COMMIT');
            return { success: true, message: mapDbMessageToFrontend(insertRes.rows[0]) };

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

export const getMessageStatusBatchAction = withDebug(
    'get_message_status_batch',
    async function getMessageStatusBatchAction(
        chatId: string,
        messageIds: string[]
    ): Promise<{
        statuses: Array<{ id: string; api_message_status: string | null; message_id_from_api: string | null }>;
        error?: string;
    }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { statuses: [], error: 'Usuario nao autenticado.' };
        }

        if (!chatId || !messageIds?.length) {
            return { statuses: [] };
        }

        const { rows } = await db.query(
            `SELECT id, api_message_status, message_id_from_api
             FROM messages
             WHERE chat_id = $1 AND id::text = ANY($2::text[])`,
            [chatId, messageIds]
        );

        return {
            statuses: rows.map((row: any) => ({
                id: row.id,
                api_message_status: row.api_message_status ?? null,
                message_id_from_api: row.message_id_from_api ?? null,
            })),
        };
    },
    {
        contextResolver: (chatId, messageIds) => ({
            payload: { chatId, count: messageIds?.length || 0 },
        }),
    }
);

export const retryMessageAction = withDebug(
    'retry_message',
    async function retryMessageAction(
        messageId: string
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Usuario nao autenticado.' };
        }

        if (!messageId) {
            return { success: false, error: 'Mensagem invalida.' };
        }

        const messageRes = await db.query(
            `SELECT 
                m.id,
                m.chat_id,
                m.content,
                m.metadata,
                m.type,
                m.from_me,
                m.api_message_status,
                m.instance_name,
                m.sender_user_id,
                m.sender_system_agent_id,
                m.sent_by_tab,
                c.workspace_id,
                ct.phone_number_jid,
                (
                    SELECT m2.instance_name
                    FROM messages m2
                    WHERE m2.chat_id = c.id AND m2.instance_name IS NOT NULL
                    ORDER BY m2.created_at DESC
                    LIMIT 1
                ) AS last_instance_name
             FROM messages m
             JOIN chats c ON c.id = m.chat_id
             JOIN contacts ct ON ct.id = c.contact_id
             WHERE m.id = $1`,
            [messageId]
        );

        if ((messageRes.rowCount ?? 0) === 0) {
            return { success: false, error: 'Mensagem nao encontrada.' };
        }

        const messageRow = messageRes.rows[0];
        const currentStatus = (messageRow.api_message_status || '').toUpperCase();
        if (currentStatus && currentStatus !== 'FAILED' && currentStatus !== 'ERROR') {
            return { success: false, error: 'Mensagem nao esta em estado de falha.' };
        }

        if (!messageRow.from_me) {
            return { success: false, error: 'Nao e possivel reenviar mensagens recebidas.' };
        }

        if (messageRow.type !== 'text') {
            return { success: false, error: 'Reenvio disponivel apenas para mensagens de texto.' };
        }

        const metadata = messageRow.metadata || {};
        if ((metadata as MessageMetadata)?.isInternalNote) {
            return { success: false, error: 'Nao e possivel reenviar notas internas.' };
        }

        if (!messageRow.content || !messageRow.content.trim()) {
            return { success: false, error: 'Conteudo da mensagem esta vazio.' };
        }

        const membershipRes = await db.query(
            `SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2`,
            [user.id, messageRow.workspace_id]
        );
        if ((membershipRes.rowCount ?? 0) === 0) {
            return { success: false, error: 'Sem permissao para reenviar mensagem.' };
        }

        await touchUserPresenceActivity(user.id, messageRow.workspace_id, null, 'retry_message');

        const instanceName = messageRow.instance_name || messageRow.last_instance_name;
        if (!instanceName) {
            return { success: false, error: 'Instancia nao encontrada para reenviar a mensagem.' };
        }

        if (!messageRow.phone_number_jid) {
            return { success: false, error: 'Destino nao encontrado para reenviar a mensagem.' };
        }

        const senderId = messageRow.sender_user_id || user.id;
        const senderType = messageRow.sender_system_agent_id ? 'system_agent' : 'user';

        let apiContent = messageRow.content;
        const isSystemSender = messageRow.sender_system_agent_id || (metadata as MessageMetadata)?.sentBy === 'system_agent';
        if (!isSystemSender) {
            try {
                const userRes = await db.query('SELECT full_name FROM users WHERE id = $1', [senderId]);
                const fullName = userRes.rows[0]?.full_name;
                if (fullName) {
                    const firstName = fullName.trim().split(' ')[0].toUpperCase();
                    apiContent = `*${firstName}*:\n\n${messageRow.content}`;
                }
            } catch (err) {
                console.error('[RETRY_MESSAGE] Falha ao obter nome do remetente:', err);
            }
        }

        if (shouldEnqueueJob('whatsapp_send')) {
            const client = await db.connect();
            let statusUpdated = false;
            try {
                await client.query('BEGIN');
                await client.query(
                    `UPDATE messages
                     SET api_message_status = 'PENDING',
                         message_id_from_api = NULL
                     WHERE id = $1`,
                    [messageId]
                );
                statusUpdated = true;

                await enqueueJob(
                    'whatsapp_send',
                    {
                        messageId,
                        workspaceId: messageRow.workspace_id,
                        instanceName,
                        number: messageRow.phone_number_jid,
                        content: messageRow.content,
                        apiContent,
                        metadata,
                        senderId,
                        senderType,
                        tabId: messageRow.sent_by_tab,
                    },
                    { client }
                );

                await client.query('COMMIT');
                return { success: true };
            } catch (error) {
                await client.query('ROLLBACK');
                if (statusUpdated) {
                    await db.query(
                        `UPDATE messages SET api_message_status = 'FAILED' WHERE id = $1`,
                        [messageId]
                    );
                }
                console.error('[RETRY_MESSAGE] Erro ao reenviar mensagem:', error);
                return { success: false, error: 'Falha ao reenviar mensagem.' };
            } finally {
                client.release();
            }
        }

        try {
            const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId: messageRow.workspace_id });
            if (!apiConfig) {
                return { success: false, error: `Configuracao da API nao encontrada para a instancia ${instanceName}.` };
            }

            const apiResponse = await sendTextMessage(apiConfig, instanceName, messageRow.phone_number_jid, apiContent);
            await db.query(
                `UPDATE messages
                 SET message_id_from_api = $1,
                     api_message_status = $2,
                     instance_name = COALESCE(instance_name, $3)
                 WHERE id = $4`,
                [apiResponse?.key?.id ?? null, 'SENT', instanceName, messageId]
            );
            return { success: true };
        } catch (error) {
            console.error('[RETRY_MESSAGE] Erro ao reenviar mensagem inline:', error);
            return { success: false, error: 'Falha ao reenviar mensagem.' };
        }
    },
    {
        contextResolver: (messageId) => ({ payload: { messageId } }),
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
    chatId = (await resolveCanonicalWhatsappChatId(db, chatId)) || chatId;
    content = await withIntelligentAttendantSignature(content, agentId, isSystemAgent);
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
                    senderUserId: isSystemAgent ? null : agentId,
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
                await scheduleMarketingAutoCloseAsync(chatId, workspaceIdForAutoClose, marketingSentAt, autoCloseMs);
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
        mediaFiles: MediaFilePayload[],
        tabId: string | null,
        metadata?: MessageMetadata
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Usuario nao autenticado.' };
        }

        await touchUserPresenceFromChat(user.id, chatId, tabId, 'activity');

        // Meta first
        const client = await db.connect();
        try {
            const metaCtx = await resolveMetaSendContext(chatId, client);
            if (metaCtx) {
                try {
                    try {
                        const chatInfoRes = await client.query(
                            `SELECT workspace_id, status, agent_id, assigned_system_agent_id FROM chats WHERE id = $1`,
                            [chatId]
                        );
                        if ((chatInfoRes.rowCount ?? 0) > 0) {
                            const { workspace_id: workspaceId, status, agent_id: currentAgentId, assigned_system_agent_id: currentSystemAgentId } = chatInfoRes.rows[0];
                            if (!currentAgentId && status !== 'encerrados') {
                                await client.query(
                                    `UPDATE chats
                                     SET agent_id = $1,
                                         assigned_system_agent_id = NULL,
                                         is_autopilot_active = FALSE,
                                         copilot_mode = 'off',
                                         status = 'atendimentos',
                                         assigned_at = NOW(),
                                         updated_at = clock_timestamp()
                                     WHERE id = $2`,
                                    [user.id, chatId]
                                );
                                await broadcastHydratedChatUpdate(workspaceId, chatId);

                                const agentRes = await client.query(
                                    'SELECT full_name, email FROM users WHERE id = $1',
                                    [user.id]
                                );
                                const agentName = agentRes.rows[0]?.full_name || agentRes.rows[0]?.email || 'Agente';

                                await client.query(
                                    `INSERT INTO messages (
                                        workspace_id, chat_id, type, content, from_me,
                                        sender_user_id, created_at, is_read
                                    ) VALUES ($1, $2, 'system', $3, true, $4, NOW(), true)`,
                                    [workspaceId, chatId, currentSystemAgentId ? `Atendimento reassumido por ${agentName}.` : `Atendimento iniciado por ${agentName}.`, user.id]
                                );
                            }
                        }
                    } catch (assignErr) {
                        console.error('[SEND_MEDIA][ASSIGN]', assignErr);
                    }

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
                                metadata: { ...metadata, mediaUrl: file.base64, mimetype: file.mimetype, fileName: file.filename },
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

                        await cleanupTempMedia(file);
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

        return internalSendMedia(chatId, caption, mediaFiles, user.id, tabId, metadata);
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
    mediaFiles: MediaFilePayload[],
    agentId: string,
    instanceName?: string,
    metadata?: MessageMetadata,
): Promise<{ success: boolean; error?: string }> {
    chatId = (await resolveCanonicalWhatsappChatId(db, chatId)) || chatId;
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

                await cleanupTempMedia(file);
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

function parseCurrencyStringToCents(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const raw = value.trim();
    if (!raw || /^\{[^}]+\}$/.test(raw)) {
        return null;
    }

    let normalized = raw
        .replace(/[^\d,.-]/g, '')
        .replace(/(?!^)-/g, '');

    if (!normalized || normalized === '-' || normalized === ',' || normalized === '.') {
        return null;
    }

    const commaIndex = normalized.lastIndexOf(',');
    const dotIndex = normalized.lastIndexOf('.');
    const decimalSeparator = commaIndex > dotIndex ? ',' : dotIndex >= 0 ? '.' : '';

    if (decimalSeparator) {
        const separatorIndex = normalized.lastIndexOf(decimalSeparator);
        const integerPart = normalized.slice(0, separatorIndex).replace(/[,.]/g, '') || '0';
        const decimalPart = normalized.slice(separatorIndex + 1).replace(/\D/g, '');

        if (decimalPart.length === 0) {
            normalized = integerPart;
        } else if (decimalPart.length <= 2) {
            normalized = `${integerPart}.${decimalPart.padEnd(2, '0')}`;
        } else {
            normalized = `${integerPart}${decimalPart}`;
        }
    }

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) {
        return null;
    }

    return Math.round(amount * 100);
}

function normalizeTemplateOrderDetailsAmounts(components: any[]): any[] {
    if (!Array.isArray(components)) {
        return components;
    }

    const clonedComponents = structuredClone(components);
    const bodyComponent = clonedComponents.find((component: any) => String(component?.type || '').toLowerCase() === 'body');
    const bodyParameters = Array.isArray(bodyComponent?.parameters) ? bodyComponent.parameters : [];
    const bodyValueCandidates = [
        bodyParameters[3]?.text,
        ...bodyParameters.map((parameter: any) => parameter?.text),
    ];
    const inferredCents = bodyValueCandidates
        .map(parseCurrencyStringToCents)
        .find((value): value is number => typeof value === 'number');

    const normalizeAmountValue = (amount: any, options: { useInferredFallback?: boolean } = {}) => {
        if (!amount || typeof amount !== 'object') {
            return;
        }

        if (options.useInferredFallback && inferredCents !== undefined) {
            amount.value = inferredCents;
            return;
        }

        const parsedCents = parseCurrencyStringToCents(amount.value);
        if (parsedCents !== null) {
            amount.value = parsedCents;
            return;
        }
    };

    for (const component of clonedComponents) {
        if (String(component?.type || '').toLowerCase() !== 'button') {
            continue;
        }

        for (const parameter of component.parameters || []) {
            const orderDetails = parameter?.action?.order_details;
            if (!orderDetails || typeof orderDetails !== 'object') {
                continue;
            }

            normalizeAmountValue(orderDetails.total_amount);
            normalizeAmountValue(orderDetails.order?.subtotal);
            normalizeAmountValue(orderDetails.order?.tax);
            normalizeAmountValue(orderDetails.order?.shipping);
            normalizeAmountValue(orderDetails.order?.discount);

            if (Array.isArray(orderDetails.order?.items)) {
                for (const item of orderDetails.order.items) {
                    normalizeAmountValue(item?.amount, { useInferredFallback: true });
                }
            }

            normalizeAmountValue(orderDetails.total_amount, { useInferredFallback: true });
            normalizeAmountValue(orderDetails.order?.subtotal, { useInferredFallback: true });
        }
    }

    return clonedComponents;
}

function renderApprovedTemplateContent(template: any, components: any[]): string | null {
    const bodyText = template?.components?.find(
        (component: any) => String(component?.type || '').toUpperCase() === 'BODY'
    )?.text;

    if (typeof bodyText !== 'string' || !bodyText.trim()) {
        return null;
    }

    const parameters = components.find(
        (component: any) => String(component?.type || '').toUpperCase() === 'BODY'
    )?.parameters || [];

    return bodyText.replace(/\{\{(\d+)\}\}/g, (placeholder: string, position: string) => {
        const parameter = parameters[Number(position) - 1];
        const replacement = parameter?.text ?? parameter?.payload;
        return replacement === undefined || replacement === null ? placeholder : String(replacement);
    });
}

const TEMPLATE_CONTENT_CACHE_TTL_MS = 5 * 60 * 1000;
const approvedTemplateCache = new Map<string, { template: any; expiresAt: number }>();

async function resolveTemplateRenderedContent(
    apiConfig: { api_url: string; api_key: string },
    instanceName: string,
    name: string,
    language: string,
    components: any[]
): Promise<string | null> {
    try {
        const cacheKey = `${apiConfig.api_url}|${instanceName}|${name}|${language}`;
        const cached = approvedTemplateCache.get(cacheKey);
        let template = cached && cached.expiresAt > Date.now() ? cached.template : null;

        if (!template) {
            const templates = await fetchEvolutionAPI(`/template/find/${instanceName}`, apiConfig);
            template = templates?.find((item: any) =>
                item?.name === name && (!language || !item?.language || item.language === language)
            );

            if (template) {
                approvedTemplateCache.set(cacheKey, {
                    template,
                    expiresAt: Date.now() + TEMPLATE_CONTENT_CACHE_TTL_MS,
                });
            }
        }

        return renderApprovedTemplateContent(template, components);
    } catch (error) {
        console.error('[SEND_AGENT_TEMPLATE_ACTION] Falha ao resolver conteudo aprovado do template:', error);
        return null;
    }
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
            renderedContent?: string;
            metadata?: MessageMetadata;
            senderUserId?: string;
        }
    ): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
        const { agentId, workspaceId, numberid, instanceName, name, language, components, renderedContent, metadata, senderUserId } = input;

        if (!numberid || !instanceName || !name || !language) {
            return { success: false, error: 'Campos obrigatórios faltando.' };
        }

        const normalizedComponents = normalizeTemplateOrderDetailsAmounts(components);
        const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId });
        if (!apiConfig) {
            return { success: false, error: `Configuracao da Evolution API nao encontrada para a instancia ${instanceName}.` };
        }
        const resolvedRenderedContent = renderedContent?.trim()
            || await resolveTemplateRenderedContent(apiConfig, instanceName, name, language, normalizedComponents);
        const client = await db.connect();
        let messageId: string | null = null;
        let transactionOpen = false;
        let providerAccepted = false;
        try {
            await client.query('BEGIN');
            transactionOpen = true;
            await lockWhatsappIdentityTransaction(client, { workspaceId, phoneOrJid: numberid });

            const whatsappContact = await findOrCreateWhatsappContact(client, {
                workspaceId,
                phoneOrJid: numberid,
                fallbackName: numberid,
                fallbackPhone: normalizeWhatsappPhoneNumber(numberid),
            });

            const fullJid = whatsappContact.normalizedJid;
            const contactId = whatsappContact.contact.id;

            let chatId = '';
            const activeChat = await findWhatsappChatByIdentity(client, {
                workspaceId,
                phoneOrJid: numberid,
                statuses: ['gerais', 'atendimentos'],
                preferOpen: true,
            });

            if (activeChat?.id) {
                chatId = activeChat.id;
            } else {
                const closedChat = await findWhatsappChatByIdentity(client, {
                    workspaceId,
                    phoneOrJid: numberid,
                    statuses: ['encerrados'],
                });

                if (closedChat?.id) {
                    chatId = closedChat.id;
                } else {
                    const newChatId = randomUUID();
                    const protocol = buildChatProtocol(newChatId);
                    // For system agents, avoid setting agent_id (FK to users) to prevent constraint violations.
                    const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
                    const chatLimitStatus = await getMonthlyChatLimitStatus(workspaceId);
                    if (!chatLimitStatus.allowed) {
                        throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
                    }
                    const newChatRes = await client.query(
                        `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol) VALUES ($1, $2, $3, 'gerais', NULL, NULL, $4) RETURNING id`,
                        [newChatId, workspaceId, contactId, protocol]
                    );
                    chatId = newChatRes.rows[0].id;
                }
            }

            // Build human-readable content preview from components, fallback to template name.
            let content = resolvedRenderedContent || `[Template: ${name}]`;
            const bodyComponent = normalizedComponents.find((c: any) => c.type === 'body');
            const bodyText = bodyComponent?.parameters
                ?.map((p: any) => p.text || p.payload || p.example || '')
                .filter(Boolean)
                .join(' ')
                .trim();
            if (!resolvedRenderedContent && bodyText) {
                content = bodyText;
            }

            messageId = randomUUID();
            await client.query(
                `INSERT INTO messages (
                    id, workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name, 
                    metadata, is_read, sender_system_agent_id, sender_user_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    messageId, workspaceId, chatId, 'text', content, true,
                    null, 'PENDING', instanceName,
                    {
                        isTemplate: true,
                        templateName: name,
                        templateComponents: normalizedComponents,
                        ...(metadata ?? {}),
                    }, true, senderUserId ? null : agentId, senderUserId || null
                ]
            );

            await client.query('COMMIT');
            transactionOpen = false;

            const apiResponse = await sendTemplateMessage(apiConfig, instanceName, {
                number: fullJid,
                name,
                language,
                components: normalizedComponents
            });
            providerAccepted = true;

            try {
                await db.query(
                    `UPDATE messages
                     SET message_id_from_api = $1,
                         api_message_status = CASE
                             WHEN api_message_status IN ('DELIVERED', 'READ', 'PLAYED') THEN api_message_status
                             ELSE 'SENT'
                         END
                     WHERE id = $2`,
                    [apiResponse?.key?.id, messageId]
                );
            } catch (trackingError) {
                console.error('[SEND_AGENT_TEMPLATE_ACTION] Envio aceito, mas falhou ao persistir o status externo:', trackingError);
            }

            if (metadata?.isMarketing) {
                try {
                    const autoCloseMs = await getMarketingAutoCloseMs(workspaceId);
                    await scheduleMarketingAutoCloseAsync(chatId, workspaceId, new Date(), autoCloseMs);
                } catch (err) {
                    console.error('[SEND_AGENT_TEMPLATE_ACTION][AUTO_CLOSE] Falha ao agendar auto-encerramento:', err);
                }
            }

            return { success: true, apiResponse };

        } catch (error) {
            if (transactionOpen) {
                await client.query('ROLLBACK');
            } else if (messageId && !providerAccepted) {
                await db.query(
                    `UPDATE messages SET api_message_status = 'FAILED' WHERE id = $1 AND api_message_status IN ('PENDING', 'SENT')`,
                    [messageId]
                );
            }
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

export const sendAgentListAction = withDebug(
    'send_agent_list',
    async function sendAgentListAction(
        input: {
            agentId: string;
            workspaceId: string;
            instanceName: string;
            chatId?: string;
            numberid?: string;
            list: InteractiveListPayload;
            metadata?: MessageMetadata;
        }
    ): Promise<{ success: boolean; error?: string; apiResponse?: any; chatId?: string }> {
        const { agentId, workspaceId, instanceName, chatId: providedChatId, numberid, list, metadata } = input;

        if (!instanceName || (!providedChatId && !numberid) || !isValidInteractiveList(list)) {
            return { success: false, error: 'Campos obrigatorios faltando ou lista invalida.' };
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            let chatId = providedChatId
                ? ((await resolveCanonicalWhatsappChatId(client, providedChatId)) || providedChatId)
                : providedChatId;
            let fullJid: string;

            if (chatId) {
                const chatRes = await client.query(
                    `SELECT ct.phone_number_jid
                     FROM chats c
                     JOIN contacts ct ON ct.id = c.contact_id
                     WHERE c.id = $1 AND c.workspace_id = $2
                     LIMIT 1`,
                    [chatId, workspaceId]
                );

                if ((chatRes.rowCount ?? 0) === 0) {
                    throw new Error('Chat nao encontrado para o workspace informado.');
                }

                fullJid = chatRes.rows[0].phone_number_jid;
                if (!fullJid) {
                    throw new Error('Chat nao possui contato WhatsApp valido.');
                }
            } else {
                await lockWhatsappIdentityTransaction(client, { workspaceId, phoneOrJid: numberid! });

                const whatsappContact = await findOrCreateWhatsappContact(client, {
                    workspaceId,
                    phoneOrJid: numberid!,
                    fallbackName: normalizeWhatsappPhoneNumber(numberid!),
                    fallbackPhone: normalizeWhatsappPhoneNumber(numberid!),
                });

                const contactId = whatsappContact.contact.id;
                fullJid = whatsappContact.normalizedJid;

                const activeChat = await findWhatsappChatByIdentity(client, {
                    workspaceId,
                    phoneOrJid: numberid!,
                    statuses: ['gerais', 'atendimentos'],
                    preferOpen: true,
                });

                if (activeChat?.id) {
                    chatId = activeChat.id;
                } else {
                    const closedChat = await findWhatsappChatByIdentity(client, {
                        workspaceId,
                        phoneOrJid: numberid!,
                        statuses: ['encerrados'],
                    });

                    if (closedChat?.id) {
                        chatId = closedChat.id;
                    } else {
                        const newChatId = randomUUID();
                        const protocol = buildChatProtocol(newChatId);
                        const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
                        const chatLimitStatus = await getMonthlyChatLimitStatus(workspaceId);
                        if (!chatLimitStatus.allowed) {
                            throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
                        }
                        const newChatRes = await client.query(
                            `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol)
                             VALUES ($1, $2, $3, 'gerais', NULL, NULL, $4)
                             RETURNING id`,
                            [newChatId, workspaceId, contactId, protocol]
                        );
                        chatId = newChatRes.rows[0].id;
                    }
                }
            }

            const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId });
            if (!apiConfig) {
                throw new Error(`Configuracao da Evolution API nao encontrada para a instancia ${instanceName}.`);
            }

            const apiResponse = await sendListMessage(apiConfig, instanceName, {
                number: fullJid,
                title: list.title,
                description: list.description,
                buttonText: list.buttonText,
                footerText: list.footerText,
                sections: list.sections,
                delay: list.delay,
                quoted: list.quoted,
                mentionsEveryOne: list.mentionsEveryOne,
                mentioned: list.mentioned,
            });

            const apiMessageId = apiResponse?.key?.id ?? apiResponse?.message_id ?? apiResponse?.id ?? null;

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name,
                    metadata, is_read, sender_system_agent_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    workspaceId,
                    chatId,
                    'text',
                    buildInteractiveListPreview(list),
                    true,
                    apiMessageId,
                    'SENT',
                    instanceName,
                    {
                        interactiveType: 'list',
                        interactivePayload: {
                            kind: 'list',
                            title: list.title,
                            description: list.description,
                            buttonText: list.buttonText,
                            footerText: list.footerText,
                            sections: list.sections,
                            delay: list.delay,
                            quoted: list.quoted,
                            mentionsEveryOne: list.mentionsEveryOne,
                            mentioned: list.mentioned,
                        },
                        ...(metadata ?? {}),
                    },
                    true,
                    agentId,
                ]
            );

            await client.query('COMMIT');

            if (metadata?.isMarketing && chatId) {
                try {
                    const autoCloseMs = await getMarketingAutoCloseMs(workspaceId);
                    await scheduleMarketingAutoCloseAsync(chatId, workspaceId, new Date(), autoCloseMs);
                } catch (err) {
                    console.error('[SEND_AGENT_LIST_ACTION][AUTO_CLOSE] Falha ao agendar auto-encerramento:', err);
                }
            }

            return { success: true, apiResponse, chatId };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[SEND_AGENT_LIST_ACTION] Erro:', error);
            const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido.';
            return { success: false, error: `Falha ao enviar lista: ${errorMessage}` };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (input) => ({
            payload: {
                instanceName: input.instanceName,
                hasChatId: Boolean(input.chatId),
                hasPhoneNumber: Boolean(input.numberid),
                sections: input.list?.sections?.length ?? 0,
            }
        })
    }
);

export const getResumeConversationRequirementAction = withDebug(
    'resume_conversation_requirement',
    async function getResumeConversationRequirementAction(
        input: {
            workspaceId: string;
            chatId: string;
            instanceName: string;
        }
    ): Promise<{
        success: boolean;
        canResumeWithoutTemplate: boolean;
        requiresTemplate: boolean;
        lastCustomerMessageAt: string | null;
        error?: string;
    }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                canResumeWithoutTemplate: false,
                requiresTemplate: true,
                lastCustomerMessageAt: null,
                error: 'Usuario nao autenticado.',
            };
        }

        if (!input.workspaceId || !input.chatId || !input.instanceName) {
            return {
                success: false,
                canResumeWithoutTemplate: false,
                requiresTemplate: true,
                lastCustomerMessageAt: null,
                error: 'Workspace, chat e instancia sao obrigatorios.',
            };
        }

        const client = await db.connect();
        try {
            const instanceType = await getMessagingInstanceType(client, input.workspaceId, input.instanceName);
            if (instanceType !== 'wa_cloud') {
                return {
                    success: true,
                    canResumeWithoutTemplate: false,
                    requiresTemplate: false,
                    lastCustomerMessageAt: null,
                };
            }

            const resumeContext = await loadWhatsappResumeContext(client, input.workspaceId, input.chatId);
            const lastCustomerMessageAt = resumeContext?.lastCustomerMessageAt?.toISOString() ?? null;
            const canResumeWithoutTemplate = Boolean(resumeContext?.canResumeWithoutTemplate);

            return {
                success: true,
                canResumeWithoutTemplate,
                requiresTemplate: !canResumeWithoutTemplate,
                lastCustomerMessageAt,
            };
        } catch (error) {
            console.error('[RESUME_CONVERSATION_REQUIREMENT] Erro:', error);
            return {
                success: false,
                canResumeWithoutTemplate: false,
                requiresTemplate: true,
                lastCustomerMessageAt: null,
                error: error instanceof Error ? error.message : 'Falha ao verificar a janela da conversa.',
            };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (input) => ({
            payload: {
                workspaceId: input.workspaceId,
                chatId: input.chatId,
                instanceName: input.instanceName,
            }
        })
    }
);


export const startNewConversation = withDebug(
    'start_conversation',
    async function startNewConversation(
        input: {
            workspaceId: string,
            chatId?: string,
            instanceName: string,
            phoneNumber: string,
            message: string,
            tabId: string | null,
            template?: { name: string; language: string; components: any[]; renderedContent?: string }
        }
    ): Promise<{ success: boolean, error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Usuário não autenticado.' };
        }
        const senderId = user.id;
        const senderName = user.user_metadata?.full_name || user.email || 'Agente';

        const { workspaceId, chatId: providedChatId, instanceName, phoneNumber, message, tabId, template } = input;
        const trimmedMessage = message.trim();
        if (!workspaceId || !instanceName || !phoneNumber) {
            return { success: false, error: 'Todos os campos são obrigatórios.' };
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const instanceType = await getMessagingInstanceType(client, workspaceId, instanceName);
            const isCloudInstance = instanceType === 'wa_cloud';
            const telegramCredentials = instanceType === 'telegram'
                ? await getTelegramInstanceCredentials(instanceName, workspaceId)
                : null;
            let contactId: string;

            if (telegramCredentials) {
                const fullJid = normalizeTelegramRecipient(phoneNumber);
                const contactRes = await client.query(
                    'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2',
                    [workspaceId, fullJid]
                );

                if (contactRes.rowCount === 0) {
                    const newContactRes = await client.query(
                        `INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id`,
                        [workspaceId, parseTelegramChatId(fullJid), fullJid]
                    );
                    contactId = newContactRes.rows[0].id;
                } else {
                    contactId = contactRes.rows[0].id;
                }
            } else {
                await lockWhatsappIdentityTransaction(client, { workspaceId, phoneOrJid: phoneNumber });

                const whatsappContact = await findOrCreateWhatsappContact(client, {
                    workspaceId,
                    phoneOrJid: phoneNumber,
                    fallbackName: normalizeWhatsappPhoneNumber(phoneNumber),
                    fallbackPhone: normalizeWhatsappPhoneNumber(phoneNumber),
                });

                contactId = whatsappContact.contact.id;
            }

            const cloudResumeWithoutTemplateRequested =
                isCloudInstance &&
                !template &&
                Boolean(providedChatId);

            if (!template && !trimmedMessage && !cloudResumeWithoutTemplateRequested) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Todos os campos sao obrigatorios.' };
            }

            // 2. Find or create the chat
            let chatId: string | undefined;
            const activeChat = await findWhatsappChatByIdentity(client, {
                workspaceId,
                phoneOrJid: phoneNumber,
                statuses: ['gerais', 'atendimentos'],
                preferOpen: true,
            });

            if (activeChat?.id) {
                chatId = activeChat.id;
            } else {
                let reopenedExistingChat = false;

                if (cloudResumeWithoutTemplateRequested) {
                    const canonicalProvidedChatId = (await resolveCanonicalWhatsappChatId(client, providedChatId!)) || providedChatId!;
                    const resumeContext = await loadWhatsappResumeContext(client, workspaceId, canonicalProvidedChatId);

                    if (
                        resumeContext &&
                        resumeContext.contactId === contactId &&
                        resumeContext.canResumeWithoutTemplate
                    ) {
                        await reopenClosedWhatsappChat(client, {
                            chatId: resumeContext.chatId,
                            workspaceId,
                            senderId,
                            senderName,
                            lastCustomerMessageAt: resumeContext.lastCustomerMessageAt,
                        });
                        chatId = resumeContext.chatId;
                        reopenedExistingChat = true;
                    } else {
                        await client.query('ROLLBACK');
                        return {
                            success: false,
                            error: 'Selecione um template para reabrir via Cloud API quando nao houver resposta do cliente nas ultimas 24 horas.',
                        };
                    }
                }

                if (!reopenedExistingChat) {
                    const newChatId = randomUUID();
                    const protocol = buildChatProtocol(newChatId);
                    const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
                    const chatLimitStatus = await getMonthlyChatLimitStatus(workspaceId);
                    if (!chatLimitStatus.allowed) {
                        throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
                    }
                    const newChatRes = await client.query(
                        `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol) VALUES ($1, $2, $3, 'atendimentos', $4, NOW(), $5) RETURNING id`,
                        [newChatId, workspaceId, contactId, senderId, protocol]
                    );
                    chatId = newChatRes.rows[0].id;
                }
            }

            await client.query('COMMIT');

            if (!chatId) {
                return { success: false, error: 'Nao foi possivel determinar o chat para reabrir a conversa.' };
            }
            await broadcastHydratedChatUpdate(workspaceId, chatId);

            if (!template && !trimmedMessage) {
                return { success: true };
            }

            // 3. Send the message using the existing internal action
            // We pass the instanceName directly to ensure it's used.
            const sendResult = await internalSendMessage(chatId, trimmedMessage || message, senderId, tabId, {}, instanceName, undefined, template);

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

        await touchUserPresenceFromChat(user.id, targetChatId, tabId, 'forward_message');

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

