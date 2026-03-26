'use server';

import { db } from '@/lib/db';
import type { Message, Chat, Contact } from '@/lib/types';

const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 8000);
const FAILED_MESSAGE_STATUSES = new Set(['FAILED', 'ERROR']);
type WebhookWhatsappInstanceType = 'cloud' | 'baileys';

interface WebhookPayload {
    event: 'message.created';
    account: {
        id: string; // workspace ID
        name: string;
    };
    conversation: {
        id: string; // chat ID
        status: Chat['status'];
        channel: string; // e.g., 'WhatsApp'
        instance_name: string;
        instance_type?: WebhookWhatsappInstanceType;
        assigned_agent: {
            id: string | undefined;
            name: string | undefined;
        };
    };
    contact: {
        id: string;
        name: string;
        phone_number: string | undefined;
        email: string | undefined;
        avatar_url: string | undefined;
        custom_fields: Record<string, any>;
    };
    message: {
        id: string;
        content: string;
        type: Message['type'];
        from_me: boolean;
        created_at: string;
        metadata: Message['metadata'];
    };
}

async function getWorkspaceName(workspaceId: string): Promise<string> {
    const res = await db.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    return res.rows[0]?.name || 'Unknown Workspace';
}

async function getContactWithCustomFields(contactId: string): Promise<Contact | null> {
    const res = await db.query(
        `SELECT 
            c.*,
            COALESCE(
                (SELECT json_object_agg(cfd.label, cfv.value)
                 FROM contact_custom_field_values cfv
                 JOIN custom_field_definitions cfd ON cfv.field_id = cfd.id
                 WHERE cfv.contact_id = c.id),
                '{}'::json
            ) as custom_fields
        FROM contacts c
        WHERE c.id = $1`,
        [contactId]
    );
    return res.rows[0] || null;
}

async function logWebhookAttempt({
    payload,
    statusCode,
    responseBody,
    headers,
}: {
    payload: WebhookPayload;
    statusCode: number | null;
    responseBody: any;
    headers?: Record<string, any>;
}) {
    try {
        await db.query(
            `INSERT INTO webhook_logs (source, direction, event, status_code, payload, headers, response_body)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                payload.account.id || 'webhook_dispatch',
                'outgoing',
                payload.event,
                statusCode,
                payload,
                headers || {},
                responseBody || {}
            ]
        );
    } catch (err) {
        console.error('[WEBHOOK_DISPATCHER] Falha ao registrar webhook_logs', err);
    }
}

function toIsoDate(value: string | Date): string {
    if (value instanceof Date) {
        return value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeWhatsappInstanceType(
    instanceType: string | null | undefined
): WebhookWhatsappInstanceType | undefined {
    if (instanceType === 'wa_cloud') {
        return 'cloud';
    }
    if (instanceType === 'baileys') {
        return 'baileys';
    }
    return undefined;
}

async function resolveWhatsappInstanceType(
    instanceName: string | undefined,
    knownInstanceType?: Chat['instance_type'] | null
): Promise<WebhookWhatsappInstanceType | undefined> {
    const normalizedKnownType = normalizeWhatsappInstanceType(knownInstanceType);
    if (normalizedKnownType) {
        return normalizedKnownType;
    }

    const trimmedInstanceName = instanceName?.trim();
    if (!trimmedInstanceName || trimmedInstanceName === 'N/A') {
        return undefined;
    }

    const res = await db.query(
        `SELECT type
         FROM evolution_api_instances
         WHERE instance_name = $1
         LIMIT 1`,
        [trimmedInstanceName]
    );

    return normalizeWhatsappInstanceType(res.rows[0]?.type);
}

export async function dispatchMessageToWebhooksById(
    chatId: string,
    messageId: string,
    instanceName?: string | null
) {
    const chatRes = await db.query(
        `SELECT 
            c.id,
            c.workspace_id,
            c.status,
            c.agent_id,
            u.full_name AS agent_name,
            ct.id AS contact_id,
            ct.name AS contact_name,
            ct.phone_number_jid,
            ct.email,
            ct.avatar_url
         FROM chats c
         JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN users u ON u.id = c.agent_id
         WHERE c.id = $1`,
        [chatId]
    );

    if (chatRes.rowCount === 0) {
        console.error(`[WEBHOOK_DISPATCHER] Chat ${chatId} not found.`);
        return;
    }

    const chatRow = chatRes.rows[0];

    const messageRes = await db.query(
        `SELECT id, content, type, from_me, created_at, metadata, direction, instance_name, api_message_status
         FROM messages
         WHERE id = $1`,
        [messageId]
    );

    if (messageRes.rowCount === 0) {
        console.error(`[WEBHOOK_DISPATCHER] Message ${messageId} not found.`);
        return;
    }

    const messageRow = messageRes.rows[0];
    const normalizedStatus = (messageRow.api_message_status || '').toUpperCase();
    if (FAILED_MESSAGE_STATUSES.has(normalizedStatus)) {
        console.log(
            `[WEBHOOK_DISPATCHER] Ignorando despacho para mensagem ${messageId} com status ${normalizedStatus}.`
        );
        return;
    }

    const isIncomingMessage =
        !messageRow.from_me &&
        (!messageRow.direction || messageRow.direction === 'incoming');
    if (!isIncomingMessage) {
        console.log(
            `[WEBHOOK_DISPATCHER] Ignorando despacho para mensagem ${messageId} pois nao e inbound.`
        );
        return;
    }

    const resolvedInstance = instanceName || messageRow.instance_name || 'N/A';

    const chat: Chat = {
        id: chatRow.id,
        workspace_id: chatRow.workspace_id,
        status: chatRow.status,
        contact: {
            id: chatRow.contact_id,
            workspace_id: chatRow.workspace_id,
            name: chatRow.contact_name,
            phone_number_jid: chatRow.phone_number_jid,
            email: chatRow.email,
            avatar_url: chatRow.avatar_url,
        } as Contact,
        agent: chatRow.agent_id
            ? ({ id: chatRow.agent_id, name: chatRow.agent_name } as any)
            : undefined,
        messages: [],
    };

    const message: Message = {
        id: messageRow.id,
        chat_id: chatRow.id,
        workspace_id: chatRow.workspace_id,
        content: messageRow.content || '',
        type: messageRow.type,
        status: 'default',
        metadata: messageRow.metadata || undefined,
        transcription: null,
        timestamp: '',
        createdAt: toIsoDate(messageRow.created_at),
        formattedDate: '',
        from_me: messageRow.from_me,
        direction: messageRow.direction || undefined,
        instance_name: resolvedInstance,
    };

    await dispatchMessageToWebhooks(chat, message, resolvedInstance);
}

export async function dispatchMessageToWebhooks(
    chat: Chat,
    message: Message,
    instanceName: string
) {
    try {
        console.log(`[WEBHOOK_DISPATCHER] Iniciando despacho para chat ${chat.id}, mensagem ${message.id}`);

        const normalizedStatus = (message.api_message_status || '').toUpperCase();
        if (FAILED_MESSAGE_STATUSES.has(normalizedStatus)) {
            console.log(
                `[WEBHOOK_DISPATCHER] Despacho bloqueado para mensagem ${message.id} com status ${normalizedStatus}.`
            );
            return;
        }

        const isIncomingMessage =
            !message.from_me &&
            (!message.direction || message.direction === 'incoming');
        if (!isIncomingMessage) {
            console.log(
                `[WEBHOOK_DISPATCHER] Despacho bloqueado para mensagem ${message.id} pois nao e inbound.`
            );
            return;
        }

        if (!chat.workspace_id) {
            console.error(`[WEBHOOK_DISPATCHER] Erro crítico: O objeto 'chat' não contém 'workspace_id'. Abortando.`);
            return;
        }

        const agents = await db.query('SELECT * FROM system_agents WHERE workspace_id = $1 AND is_active = TRUE AND webhook_url IS NOT NULL', [chat.workspace_id]);
        const activeAgents = agents.rows.filter((a: any) => {
            const url = (a.webhook_url || '').trim();
            // Marketing agents sem webhook não devem disparar nada.
            if (a.type === 'marketing') return url.length > 0;
            return url.length > 0;
        });

        if (activeAgents.length === 0) {
            console.log(`[WEBHOOK_DISPATCHER] Nenhum agente ativo com webhook encontrado para o workspace ${chat.workspace_id}.`);
            return;
        }

        const [workspaceName, contactWithDetails, instanceType] = await Promise.all([
            getWorkspaceName(chat.workspace_id),
            getContactWithCustomFields(chat.contact.id),
            resolveWhatsappInstanceType(instanceName || message.instance_name, chat.instance_type),
        ]);

        if (!contactWithDetails) {
            console.error(`[WEBHOOK_DISPATCHER] Erro crítico: Não foi possível encontrar detalhes do contato ${chat.contact.id}. Abortando.`);
            return;
        }

        const payload: WebhookPayload = {
            event: 'message.created',
            account: {
                id: chat.workspace_id,
                name: workspaceName,
            },
            conversation: {
                id: chat.id,
                status: chat.status,
                channel: 'WhatsApp', // Placeholder
                instance_name: instanceName || 'N/A',
                ...(instanceType ? { instance_type: instanceType } : {}),
                assigned_agent: {
                    id: chat.agent?.id,
                    name: chat.agent?.name,
                },
            },
            contact: {
                id: contactWithDetails.id,
                name: contactWithDetails.name,
                phone_number: contactWithDetails.phone_number_jid,
                email: contactWithDetails.email,
                avatar_url: contactWithDetails.avatar_url,
                custom_fields: contactWithDetails.custom_fields || {},
            },
            message: {
                id: message.id,
                content: message.content,
                type: message.type,
                from_me: !!message.from_me,
                created_at: message.createdAt,
                metadata: message.metadata ?? {},
            },
        };

        // Determine if this message should go only to a specific system agent (marketing handoff)
        const resolveTargetSystemAgent = async (): Promise<{ targetAgentId: string | null; marketingSenderSystemAgentId: string | null; marketingMessageCreatedAt: string | null }> => {
            // Only act if the last outbound message was marketing with a target.
            const res = await db.query(
                `SELECT metadata->>'marketingTargetSystemAgentId' AS target,
                        metadata->>'from_system_agent_id' AS marketing_sender,
                        created_at,
                        metadata->>'isMarketing' AS is_marketing
                 FROM messages
                 WHERE chat_id = $1
                   AND from_me = TRUE
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [chat.id]
            );

            const row = res.rows[0];
            if (!row) {
                return { targetAgentId: null, marketingSenderSystemAgentId: null, marketingMessageCreatedAt: null };
            }

            const isMarketing = row.is_marketing === 'true';
            if (!isMarketing || !row.target) {
                return { targetAgentId: null, marketingSenderSystemAgentId: null, marketingMessageCreatedAt: null };
            }

            return {
                targetAgentId: row.target,
                marketingSenderSystemAgentId: row.marketing_sender || null,
                marketingMessageCreatedAt: row.created_at || null,
            };
        };

        const { targetAgentId, marketingSenderSystemAgentId, marketingMessageCreatedAt } = await resolveTargetSystemAgent();
        const isChatClosed = chat.status === 'encerrados';
        const isChatAssigned = !!(chat as any).agent_id || !!chat.agent?.id;

        // Se não há contexto de marketing, ou se o chat já está em atendimento/encerrado, não aplica handoff nem nota.
        const hasMarketingContext = targetAgentId || marketingSenderSystemAgentId || marketingMessageCreatedAt;
        if (hasMarketingContext && !isChatClosed && !isChatAssigned && (!message.from_me || message.direction === 'incoming')) {
            const hasHandoff = await db.query(
                `SELECT 1 FROM messages 
                 WHERE chat_id = $1 
                   AND metadata ? 'marketingHandoff'
                   AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)
                 LIMIT 1`,
                [chat.id, marketingMessageCreatedAt]
            );

            if (hasHandoff.rowCount === 0 && targetAgentId) {
                const targetAgentRes = await db.query('SELECT name FROM system_agents WHERE id = $1', [targetAgentId]);
                const targetAgentName = targetAgentRes.rows[0]?.name || 'Agente do Sistema';

                await db.query(
                    `INSERT INTO messages (
                        workspace_id, chat_id, type, content, from_me, is_read, sender_system_agent_id, metadata
                    ) VALUES ($1, $2, 'system', $3, true, true, $4, $5)`,
                    [
                        chat.workspace_id,
                        chat.id,
                        `Cliente respondeu à mensagem de marketing. Encaminhado para ${targetAgentName}.`,
                        targetAgentId,
                        {
                            marketingHandoff: true,
                            from_system_agent_id: marketingSenderSystemAgentId,
                            to_system_agent_id: targetAgentId,
                        },
                    ]
                );
            }
        }

        const sendWebhook = async (agent: any) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
            const logContext = `agent='${agent.name}' agentId=${agent.id} workspace=${chat.workspace_id} instance=${instanceName || 'N/A'}`;
            try {
                console.log(`[WEBHOOK_DISPATCHER] Enviando para ${logContext} url=${agent.webhook_url}`);
                const response = await fetch(agent.webhook_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Dialogy-Token': agent.token,
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                const responseText = await response.text().catch(() => null);
                const parsedResponse = responseText ? (() => { try { return JSON.parse(responseText); } catch { return responseText; } })() : {};
                await logWebhookAttempt({
                    payload,
                    statusCode: response.status,
                    responseBody: parsedResponse,
                    headers: { target: agent.webhook_url },
                });
                if (!response.ok) {
                    console.error(`[WEBHOOK_DISPATCHER] Webhook respondeu com status ${response.status} para ${logContext}.`);
                }
            } catch (error: any) {
                const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'erro desconhecido');
                await logWebhookAttempt({
                    payload,
                    statusCode: null,
                    responseBody: { error: reason, dropped: true },
                    headers: { target: agent.webhook_url },
                });
                console.error(`[WEBHOOK_DISPATCHER] Falha ao enviar webhook para ${logContext}:`, error);
            } finally {
                clearTimeout(timer);
            }
        };

        const targetAgents = targetAgentId ? activeAgents.filter((a: any) => a.id === targetAgentId) : activeAgents;
        await Promise.allSettled(targetAgents.map(sendWebhook));
    } catch (error) {
        console.error('[WEBHOOK_DISPATCHER] Falha inesperada ao despachar webhooks:', error);
    }
}
