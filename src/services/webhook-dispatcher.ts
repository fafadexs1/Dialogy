'use server';

import { db } from '@/lib/db';
import type { Message, Chat, Contact } from '@/lib/types';

const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 8000);

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

export async function dispatchMessageToWebhooks(
    chat: Chat,
    message: Message,
    instanceName: string
) {
    try {
        console.log(`[WEBHOOK_DISPATCHER] Iniciando despacho para chat ${chat.id}, mensagem ${message.id}`);

        if (!chat.workspace_id) {
            console.error(`[WEBHOOK_DISPATCHER] Erro crítico: O objeto 'chat' não contém 'workspace_id'. Abortando.`);
            return;
        }

        const agents = await db.query('SELECT * FROM system_agents WHERE workspace_id = $1 AND is_active = TRUE AND webhook_url IS NOT NULL', [chat.workspace_id]);

        if ((agents.rowCount ?? 0) === 0) {
            console.log(`[WEBHOOK_DISPATCHER] Nenhum agente ativo com webhook encontrado para o workspace ${chat.workspace_id}.`);
            return;
        }

        const workspaceName = await getWorkspaceName(chat.workspace_id);
        const contactWithDetails = await getContactWithCustomFields(chat.contact.id);

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
            const meta = (message.metadata as any) || {};
            if (meta.marketingTargetSystemAgentId) {
                return {
                    targetAgentId: meta.marketingTargetSystemAgentId,
                    marketingSenderSystemAgentId: meta.from_system_agent_id || null,
                    marketingMessageCreatedAt: null,
                };
            }

            // For incoming replies, look back to the last marketing message that specified a target.
            if (!message.from_me || message.direction === 'incoming') {
                const res = await db.query(
                    `SELECT metadata->>'marketingTargetSystemAgentId' AS target
                             , metadata->>'from_system_agent_id' AS marketing_sender
                             , created_at
                     FROM messages
                     WHERE chat_id = $1
                       AND from_me = TRUE
                       AND metadata ? 'isMarketing'
                       AND metadata->>'marketingTargetSystemAgentId' IS NOT NULL
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [chat.id]
                );
                return {
                    targetAgentId: res.rows[0]?.target || null,
                    marketingSenderSystemAgentId: res.rows[0]?.marketing_sender || null,
                    marketingMessageCreatedAt: res.rows[0]?.created_at || null,
                };
            }
            return { targetAgentId: null, marketingSenderSystemAgentId: null, marketingMessageCreatedAt: null };
        };

        const { targetAgentId, marketingSenderSystemAgentId, marketingMessageCreatedAt } = await resolveTargetSystemAgent();

        // On incoming reply, mark chat back to "gerais" and log a system handoff message (for metrics),
        // but do not route to a specific system agent.
        if (!message.from_me || message.direction === 'incoming') {
            const hasHandoff = await db.query(
                `SELECT 1 FROM messages 
                 WHERE chat_id = $1 
                   AND metadata ? 'marketingHandoff'
                   AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)
                 LIMIT 1`,
                [chat.id, marketingMessageCreatedAt]
            );

            if (hasHandoff.rowCount === 0) {
                const targetAgentName = targetAgentId
                  ? (await db.query('SELECT name FROM system_agents WHERE id = $1', [targetAgentId])).rows[0]?.name || 'Agente do Sistema'
                  : 'Fila (gerais)';

                // Move chat back to gerais and clear assignment.
                await db.query(
                  `UPDATE chats SET status = 'gerais', agent_id = NULL, assigned_at = NULL WHERE id = $1`,
                  [chat.id]
                );

                await db.query(
                    `INSERT INTO messages (
                        workspace_id, chat_id, type, content, from_me, is_read, sender_system_agent_id, metadata
                    ) VALUES ($1, $2, 'system', $3, true, true, $4, $5)`,
                    [
                        chat.workspace_id,
                        chat.id,
                        `Cliente respondeu à mensagem de marketing. Chat movido para Gerais (${targetAgentName}).`,
                        targetAgentId || null,
                        {
                            marketingHandoff: true,
                            from_system_agent_id: marketingSenderSystemAgentId,
                            to_system_agent_id: targetAgentId || null,
                        },
                    ]
                );
            }
        }

        const sendWebhook = async (agent: any) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
            try {
                console.log(`[WEBHOOK_DISPATCHER] Enviando para o agente '${agent.name}' na URL: ${agent.webhook_url}`);
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
                    console.error(`[WEBHOOK_DISPATCHER] Webhook respondeu com status ${response.status} para '${agent.name}'.`);
                }
            } catch (error: any) {
                const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'erro desconhecido');
                await logWebhookAttempt({
                    payload,
                    statusCode: null,
                    responseBody: { error: reason, dropped: true },
                    headers: { target: agent.webhook_url },
                });
                console.error(`[WEBHOOK_DISPATCHER] Falha ao enviar webhook para '${agent.name}':`, error);
            } finally {
                clearTimeout(timer);
            }
        };

        await Promise.allSettled(agents.rows.map(sendWebhook));
    } catch (error) {
        console.error('[WEBHOOK_DISPATCHER] Falha inesperada ao despachar webhooks:', error);
    }
}
