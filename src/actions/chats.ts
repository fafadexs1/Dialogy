
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { User, Workspace, Chat, Message, MessageSender, Contact, SystemAgent, MessageMetadata } from '@/lib/types';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { sendAutomatedMessageAction } from './messages';
import { logAction, withDebug } from '@/lib/observability/logger';
import { buildChatProtocol } from '@/lib/utils';
import { randomUUID } from 'crypto';
import { consumeRateLimit } from '@/lib/ratelimit';
import { assignChatSchema, closeChatSchema, transferChatSchema } from '@/lib/validation/chat-schemas';
import { reportServerError } from '@/lib/observability/errors';

// Fallback timezone
const defaultTimeZone = 'America/Sao_Paulo';
const workspaceTimezoneCache = new Map<string, string>();

// Helper function to check for permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return (res.rowCount ?? 0) > 0;
}

/**
 * Atribui o chat atual ao agente logado.
 * Esta ação é chamada pelo botão "Assumir Atendimento".
 */
export const assignChatToSelfAction = withDebug(
    'assign_chat_self',
    async function assignChatToSelfAction(chatId: string): Promise<{ success: boolean, error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: "Usuário não autenticado." };
        }
        const currentAgentId = user.id;

        if (!chatId) {
            return { success: false, error: "ID do Chat é obrigatório." };
        }

        try {
            // Corrected query: Allow taking ownership as long as the chat is in the 'gerais' (general) queue,
            // regardless of whether agent_id was previously filled.
            const result = await db.query(
                "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2 AND status = 'gerais' RETURNING workspace_id",
                [currentAgentId, chatId]
            );

            if (result.rowCount === 0) {
                // This can happen if another agent took the chat milliseconds before, or if the chat is not in 'gerais' status.
                return { success: false, error: "Este atendimento não está mais na fila geral ou já foi assumido." };
            }

            const workspaceId = result.rows[0].workspace_id;

            // Insert system message indicating attendance started
            const agentName = user.user_metadata?.full_name || user.email || 'Agente';
            await db.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, 
                    sender_user_id, created_at, is_read
                ) VALUES ($1, $2, 'system', $3, true, $4, NOW(), true)`,
                [workspaceId, chatId, `Atendimento iniciado por ${agentName}.`, currentAgentId]
            );

            console.log(`[ASSIGN_CHAT_SELF] Chat ${chatId} atribuído ao agente ${currentAgentId}.`);
            // revalidatePath('/', 'layout'); // Removed to prevent page refresh
            return { success: true };
        } catch (error) {
            console.error("Erro ao atribuir chat a si mesmo:", error);
            return { success: false, error: "Falha no servidor ao tentar assumir o atendimento." };
        }
    },
    {
        contextResolver: (chatId) => ({ payload: { chatId } })
    }
);


export const transferChatAction = withDebug(
    'transfer_chat',
    async function transferChatAction(
        input: { chatId: string; teamId?: string; agentId?: string },
        // Optional parameter to accept a session-like object from an API call
        prefetchedSession?: { user: { id: string, name: string, email?: string | null }, isSystemAgent?: boolean }
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();

        let sessionToUse = prefetchedSession;

        if (!sessionToUse) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                sessionToUse = { user: { id: user.id, name: user.user_metadata.full_name, email: user.email } };
            }
        }

        if (!sessionToUse?.user?.id || !sessionToUse?.user?.name) {
            return { success: false, error: "Usuário não autenticado." };
        }
        const currentAgentId = sessionToUse.user.id;
        const currentAgentName = sessionToUse.user.name;
        const isSystemAgent = sessionToUse.isSystemAgent || false;

        const { chatId, teamId, agentId } = input;

        if (!chatId || (!teamId && !agentId)) {
            return { success: false, error: "Parâmetros inválidos para transferência." };
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const chatRes = await client.query(`
            SELECT 
                workspace_id, 
                agent_id as current_chat_agent_id, 
                status,
                (
                    SELECT m.instance_name 
                    FROM messages m 
                    WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL 
                    ORDER BY m.created_at DESC 
                    LIMIT 1
                ) AS last_instance_name
            FROM chats c
            WHERE c.id = $1
        `, [chatId]);
            if (chatRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Conversa não encontrada." };
            }
            const { workspace_id: workspaceId, current_chat_agent_id, status, last_instance_name: lastInstanceName } = chatRes.rows[0];

            if (status === 'encerrados') {
                await client.query('ROLLBACK');
                return { success: false, error: "Não é possível transferir um atendimento que já foi encerrado." };
            }

            // System agents have implicit permission
            if (!prefetchedSession) {
                if (!await hasPermission(currentAgentId, workspaceId, 'teams:view')) { // Permission to be defined
                    await client.query('ROLLBACK');
                    return { success: false, error: "Você não tem permissão para transferir atendimentos." };
                }
            }


            let finalAgentId = agentId;
            let transferTargetName = '';
            let transferTemplate: string | undefined;

            // Load balancing logic for team transfer
            if (teamId) {
                console.log(`[TRANSFER_CHAT] Transferindo para equipe ${teamId}. Buscando agente com base no tempo desde a última atribuição...`);
                console.log('[TRANSFER_CHAT] Params:', teamId, currentAgentId);
                const query = `
                SELECT
                    u.id as "agentId",
                    u.full_name as "agentName",
                    t.name as "teamName",
                    MAX(c.assigned_at) as "lastAssigned"
                FROM users u
                JOIN team_members tm ON u.id = tm.user_id
                JOIN teams t ON tm.team_id = t.id
                JOIN user_workspace_presence uwp
                    ON uwp.user_id = u.id
                    AND uwp.workspace_id = t.workspace_id
                LEFT JOIN chats c ON u.id = c.agent_id
                WHERE tm.team_id = $1 AND uwp.is_online = TRUE AND u.id <> $2
                GROUP BY u.id, t.name
                ORDER BY "lastAssigned" ASC NULLS FIRST, random()
                LIMIT 1
            `;

                const agentRes = await client.query(query, [teamId, currentAgentId]);

                if (agentRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: "Nenhum agente disponível nesta equipe no momento." };
                }
                finalAgentId = agentRes.rows[0].agentId;
                transferTargetName = agentRes.rows[0].teamName;
                console.log(`[TRANSFER_CHAT] Equipe ${transferTargetName} selecionada. Agente por load balance: ${finalAgentId}`);
            } else if (agentId) {
                const agentRes = await client.query('SELECT full_name FROM users WHERE id = $1', [agentId]);
                if (agentRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: "Agente de destino não encontrado." };
                }
                transferTargetName = agentRes.rows[0].full_name;
            }

            if (!finalAgentId) {
                await client.query('ROLLBACK');
                return { success: false, error: "Não foi possível determinar um agente para a transferência." };
            }

            const templateRes = await client.query(
                'SELECT transfer_team_message_template FROM workspaces WHERE id = $1',
                [workspaceId]
            );
            transferTemplate = (templateRes.rows[0]?.transfer_team_message_template as string | undefined)?.trim();

            // Update chat with the new agent and status
            await client.query(`
            UPDATE chats
            SET 
                agent_id = $1,
                status = 'atendimentos',
                assigned_at = NOW()
            WHERE id = $2
        `, [finalAgentId, chatId]);

            // Log system message
            const systemMessageContent = current_chat_agent_id
                ? `Atendimento transferido por ${currentAgentName} para ${transferTargetName}.`
                : `Atendimento atribuído a ${transferTargetName} por ${currentAgentName}.`;

            await client.query(`
            INSERT INTO messages (workspace_id, chat_id, type, content, metadata)
            VALUES ($1, $2, 'system', $3, $4)
        `, [
                workspaceId,
                chatId,
                systemMessageContent,
                {
                    event: 'transfer',
                    from_agent_id: currentAgentId,
                    to_agent_id: finalAgentId,
                    to_team_id: teamId,
                    to_name: transferTargetName
                }
            ]);

            await client.query('COMMIT');
            console.log(`[TRANSFER_CHAT] Chat ${chatId} transferido com sucesso para o agente ${finalAgentId}.`);
            if (transferTemplate) {
                const appliedTemplate = transferTemplate.replace(/{{\s*dest\s*}}/gi, transferTargetName || 'novo atendente');
                try {
                    await sendAutomatedMessageAction(chatId, appliedTemplate, currentAgentId, isSystemAgent, lastInstanceName || undefined, {
                        event: 'transfer_notice',
                        to_agent_id: finalAgentId,
                        to_team_id: teamId,
                        to_name: transferTargetName,
                        authored_by: currentAgentId,
                        template_applied: true,
                    });
                } catch (templateErr) {
                    console.error('[TRANSFER_CHAT] Falha ao enviar mensagem de transferncia:', templateErr);
                }
            }
            // revalidatePath('/', 'layout'); // Removed to prevent page refresh
            return { success: true };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Erro ao transferir chat:", error);
            return { success: false, error: "Falha no servidor ao tentar transferir o atendimento." };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (input) => ({ payload: input })
    }
);


export const closeChatAction = withDebug(
    'close_chat',
    async function closeChatAction(
        chatId: string,
        reasonTagId: string | null,
        notes: string | null,
        sendCloseMessage: boolean = true
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user || !user.user_metadata.full_name) {
            return { success: false, error: "Usuario nao autenticado." };
        }

        const currentAgentId = user.id;
        const currentAgentName = user.user_metadata.full_name;

        if (!chatId) {
            return { success: false, error: "ID do chat e obrigatorio." };
        }

        const client = await db.connect();
        let closeTemplate: string | undefined;
        try {
            await client.query('BEGIN');

            const chatRes = await client.query(`
            SELECT 
                workspace_id, 
                tag as current_tag, 
                color as current_color,
                (
                    SELECT m.instance_name 
                    FROM messages m 
                    WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL 
                    ORDER BY m.created_at DESC 
                    LIMIT 1
                ) AS last_instance_name
            FROM chats c
            WHERE id = $1
        `, [chatId]);
            if (chatRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Chat nao encontrado.' };
            }
            const { workspace_id, current_tag, current_color, last_instance_name } = chatRes.rows[0];

            const templateRes = await client.query(
                'SELECT close_message_template FROM workspaces WHERE id = $1',
                [workspace_id]
            );
            closeTemplate = (templateRes.rows[0]?.close_message_template as string | undefined)?.trim();

            let tagInfo = { label: null as string | null, color: null as string | null };
            if (reasonTagId) {
                const tagRes = await client.query('SELECT label, color FROM tags WHERE id = $1', [reasonTagId]);
                if ((tagRes.rowCount ?? 0) > 0) {
                    tagInfo = tagRes.rows[0];
                }
            }

            await client.query(
                `UPDATE chats
             SET 
                status = 'encerrados',
                closed_at = NOW(),
                close_reason_tag_id = $1,
                tag = $2,
                color = $3
             WHERE id = $4`,
                [
                    reasonTagId,
                    tagInfo.label ?? current_tag ?? '',
                    tagInfo.color ?? current_color ?? '',
                    chatId
                ]
            );

            // Marca a conversa Meta associada (se existir) como encerrada para que novas mensagens abram um novo chat.
            await client.query(
                `UPDATE meta_conversations 
             SET status = 'closed', updated_at = timezone('utc', now()) 
             WHERE chat_id = $1`,
                [chatId]
            );

            const systemMessageContent = `Atendimento encerrado por ${currentAgentName}.`;

            await client.query(`
            INSERT INTO messages (workspace_id, chat_id, type, content, metadata)
            VALUES ($1, $2, 'system', $3, $4)
        `, [
                workspace_id,
                chatId,
                systemMessageContent,
                {
                    event: 'close',
                    closed_by: currentAgentId,
                    reason_tag_id: reasonTagId,
                    notes: notes,
                }
            ]);

            await client.query('COMMIT');

            if (closeTemplate && sendCloseMessage) {
                try {
                    await sendAutomatedMessageAction(chatId, closeTemplate, currentAgentId, false, last_instance_name || undefined, {
                        event: 'close_notice',
                        authored_by: currentAgentId,
                        template_applied: true,
                        reason_tag_id: reasonTagId,
                    });
                } catch (templateErr) {
                    console.error('[CLOSE_CHAT] Falha ao enviar mensagem de encerramento:', templateErr);
                }
            }
            // revalidatePath('/', 'layout'); // Removed to prevent page refresh
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Erro ao encerrar atendimento:", error);
            return { success: false, error: (error as any)?.message || "Falha no servidor ao encerrar o atendimento." };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (chatId, reasonTagId, notes, sendCloseMessage) => ({ payload: { chatId, reasonTagId, notes, sendCloseMessage } })
    }
);

export const closeMultipleChatsAction = withDebug(
    'close_multiple_chats',
    async function closeMultipleChatsAction(
        chatIds: string[],
        message?: string
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Usuário não autenticado." };
        }

        if (!chatIds || chatIds.length === 0) {
            return { success: false, error: "Nenhum chat selecionado." };
        }

        const currentAgentId = user.id;

        try {
            // Processing in parallel might be too heavy if many chats, but for reasonable numbers it's fine.
            // We'll process them strictly to ensure we handle errors gracefully but try to close all.
            const stats = { success: 0, failed: 0 };

            // We will use Promise.all for speed, but catch individual errors
            const results = await Promise.all(chatIds.map(async (chatId) => {
                try {
                    // If a custom message is provided, send it first.
                    if (message && message.trim() !== '') {
                        // Find the last instance name for the chat to send the message
                        const instanceRes = await db.query(`
                            SELECT m.instance_name
                            FROM messages m
                            WHERE m.chat_id = $1 AND m.instance_name IS NOT NULL
                            ORDER BY m.created_at DESC
                            LIMIT 1
                        `, [chatId]);

                        const instanceName = instanceRes.rows[0]?.instance_name;

                        // We use sendAutomatedMessageAction to send the custom message
                        await sendAutomatedMessageAction(
                            chatId,
                            message,
                            currentAgentId,
                            false,
                            instanceName || undefined,
                            {
                                event: 'close_notice',
                                authored_by: currentAgentId,
                                is_bulk_action: true
                            }
                        );
                    }

                    // Then close the chat. 
                    // If we sent a custom message, we might NOT want to send the default template.
                    // However, the closeChatAction takes 'sendCloseMessage'. 
                    // If 'message' was provided, we pass false to sendCloseMessage to avoid double messages (template + custom).
                    // If 'message' was NOT provided, we pass true to use the default template if configured.
                    const shouldSendTemplate = !message;

                    const closeResult = await closeChatAction(chatId, null, "Encerramento em massa via botão 'Encerrar Todos'", shouldSendTemplate);

                    if (closeResult.success) return true;
                    return false;
                } catch (err) {
                    console.error(`Erro ao encerrar chat ${chatId} em massa:`, err);
                    return false;
                }
            }));

            const successCount = results.filter(r => r).length;

            return { success: true }; // We return success if we processed the request, even if some failed. The UI will refresh.

        } catch (error) {
            console.error("Erro no encerramento em massa:", error);
            return { success: false, error: "Falha ao processar encerramento em massa." };
        }
    },
    {
        contextResolver: (chatIds) => ({ payload: { count: chatIds?.length } })
    }
); export const updateChatTagAction = withDebug(
    'update_chat_tag',
    async function updateChatTagAction(chatId: string, tagId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: "Usuário não autenticado." };
        }

        if (!chatId || !tagId) {
            return { success: false, error: "IDs do chat e da tag são obrigatórios." };
        }

        try {
            const tagRes = await db.query('SELECT label, color FROM tags WHERE id = $1', [tagId]);
            if (tagRes.rowCount === 0) {
                return { success: false, error: "Etiqueta não encontrada." };
            }
            const { label, color } = tagRes.rows[0];

            await db.query(
                'UPDATE chats SET tag = $1, color = $2 WHERE id = $3',
                [label, color, chatId]
            );

            revalidatePath('/', 'layout');
            return { success: true };

        } catch (error) {
            console.error("Erro ao atualizar a tag do chat:", error);
            return { success: false, error: "Falha ao atualizar a etiqueta no servidor." };
        }
    },
    {
        contextResolver: (chatId, tagId) => ({ payload: { chatId, tagId } })
    }
);

function formatMessageDate(date: Date, timezone: string): string {
    const zonedDate = toZonedTime(date, timezone);
    if (isToday(zonedDate)) {
        return `Hoje`;
    }
    if (isYesterday(zonedDate)) {
        return `Ontem`;
    }
    return formatDate(zonedDate, "dd/MM/yyyy", { locale: ptBR });
}


export type InitialChatsPayload = {
    chats: Chat[];
    messages: Message[];
    selectedChatId: string | null;
    lastSyncChats: string | null;
    lastSyncMessageForSelected: string | null;
    oldestMessageDate: string | null;
    hasMoreHistory: boolean;
    hasMoreChats: boolean;
    timezone: string;
    error?: string;
};

type ChatRow = {
    id: string;
    status: Chat['status'];
    workspace_id: string;
    assigned_at: string | null;
    tag: string | null;
    color: string | null;
    protocol: string | null;
    contact_id: string | null;
    agent_id: string | null;
    team_name: string | null;
    team_color: string | null;
    instance_name: string | null;
    instance_type: Chat['instance_type'];
    source: string | null;
    chat_activity_at: string | null;
    unread_count: number | null;
    contact_name: string | null;
    contact_avatar_url: string | null;
    contact_email: string | null;
    contact_phone_number_jid: string | null;
    contact_address: string | null;
    last_message_id: string | null;
    last_message_content: string | null;
    last_message_type: Message['type'] | null;
    last_message_metadata: MessageMetadata | null;
    last_message_transcription: string | null;
    last_message_created_at: string | null;
    last_message_from_me: boolean | null;
    last_message_sender_user_id: string | null;
    last_message_sender_system_agent_id: string | null;
    last_message_instance_name: string | null;
    last_message_source_from_api: string | null;
    last_message_message_id_from_api: string | null;
    last_message_api_message_status: string | null;
    last_message_is_read: boolean | null;
    last_message_sent_by_tab: string | null;
    contact_custom_fields: Record<string, any> | null;
    is_autopilot_active?: boolean | null;
};

type MessageRow = {
    id: string;
    chat_id: string;
    workspace_id: string;
    content: string;
    type: Message['type'];
    metadata: MessageMetadata | null;
    transcription: string | null;
    created_at: string;
    from_me: boolean;
    sender_user_id: string | null;
    sender_system_agent_id: string | null;
    instance_name: string | null;
    source_from_api: string | null;
    message_id_from_api: string | null;
    api_message_status: string | null;
    is_read: boolean | null;
    sent_by_tab?: string | null;
    platform?: 'instagram' | 'messenger' | null;
    external_message_id?: string | null;
    external_sender_id?: string | null;
    external_channel_id?: string | null;
    direction?: 'incoming' | 'outgoing' | null;
    media_url?: string | null;
    contact_id?: string | null;
    contact_name?: string | null;
    contact_avatar_url?: string | null;
    contact_email?: string | null;
    contact_phone_number_jid?: string | null;
    contact_address?: string | null;
};

async function getWorkspaceTimezone(workspaceId: string): Promise<string> {
    if (workspaceTimezoneCache.has(workspaceId)) {
        return workspaceTimezoneCache.get(workspaceId)!;
    }
    const workspaceRes = await db.query('SELECT timezone FROM workspaces WHERE id = $1', [workspaceId]);
    const timezone = workspaceRes.rows[0]?.timezone || defaultTimeZone;
    workspaceTimezoneCache.set(workspaceId, timezone);
    return timezone;
}

async function fetchChats({
    workspaceId,
    userId,
    limit,
    includeChatId,
    before,
    ownership = 'mine',
    statuses,
}: {
    workspaceId: string;
    userId: string;
    limit: number;
    includeChatId: string | null;
    before?: string | null;
    ownership?: 'mine' | 'everyone';
    statuses?: Chat['status'][];
}): Promise<ChatRow[]> {
    const startTime = performance.now();
    const params: any[] = [workspaceId, limit];
    let queryIndex = 3;

    let beforeClause = '';
    if (before) {
        params.push(before);
        beforeClause = `AND GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) < $${queryIndex}`;
        queryIndex++;
    }

    let ownershipClause = '';
    if (ownership === 'mine') {
        params.push(userId);
        ownershipClause = `AND (c.status != 'encerrados' OR c.agent_id = $${queryIndex})`;
        queryIndex++;
    }

    let statusClause = "AND (c.status IN ('gerais', 'atendimentos') OR c.status = 'encerrados')";
    if (statuses && statuses.length > 0) {
        const statusPlaceholders = statuses.map((_, i) => `$${queryIndex + i}`).join(', ');
        statusClause = `AND c.status IN (${statusPlaceholders})`;
        params.push(...statuses);
        queryIndex += statuses.length;
    }

    let includeChatClause = '';
    if (includeChatId) {
        params.push(includeChatId);
        includeChatClause = `
        , target_chat AS (
            SELECT *
            FROM chats
            WHERE workspace_id = $1 AND id = $${queryIndex}
        )`;
        queryIndex++;
    }

    const { rows } = await db.query(
        `
        WITH last_message_details AS (
            SELECT DISTINCT ON (chat_id)
                id,
                chat_id,
                content,
                type,
                metadata,
                transcription,
                created_at,
                from_me,
                sender_user_id,
                sender_system_agent_id,
                instance_name,
                source_from_api,
                message_id_from_api,
                api_message_status,
                is_read,
                sent_by_tab
            FROM messages
            WHERE workspace_id = $1
            ORDER BY chat_id, created_at DESC
        ),
        filtered_chats AS (
            SELECT c.*
            FROM chats c
            LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
            WHERE c.workspace_id = $1
              ${statusClause}
              ${ownershipClause}
              ${beforeClause}
            ORDER BY GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) DESC
            LIMIT $2
        )
        ${includeChatClause}
        , merged_chats AS (
            SELECT * FROM filtered_chats
            ${includeChatId ? 'UNION SELECT * FROM target_chat' : ''}
        )
        SELECT 
            c.id,
            c.status,
            c.workspace_id,
            c.assigned_at,
            c.tag,
            c.color,
            c.protocol,
            c.is_autopilot_active,
            c.contact_id,
            c.agent_id,
            GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) AS chat_activity_at,
            (
                SELECT m.instance_name 
                FROM messages m 
                WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL 
                ORDER BY m.created_at DESC 
                LIMIT 1
            ) AS instance_name,
            lmd.source_from_api AS source,
            COALESCE((
                SELECT COUNT(*) FROM messages m
                WHERE m.chat_id = c.id AND m.from_me = false AND COALESCE(m.is_read, false) = false
            ), 0) AS unread_count,
            t.name AS team_name,
            t.color AS team_color,
            eai.type AS instance_type,
            cont.name AS contact_name,
            cont.avatar_url AS contact_avatar_url,
            cont.email AS contact_email,
            cont.phone_number_jid AS contact_phone_number_jid,
            cont.address AS contact_address,
            lmd.id AS last_message_id,
            lmd.content AS last_message_content,
            lmd.type AS last_message_type,
            lmd.metadata AS last_message_metadata,
            lmd.transcription AS last_message_transcription,
            lmd.created_at AS last_message_created_at,
            lmd.from_me AS last_message_from_me,
            lmd.sender_user_id AS last_message_sender_user_id,
            lmd.sender_system_agent_id AS last_message_sender_system_agent_id,
            lmd.instance_name AS last_message_instance_name,
            lmd.source_from_api AS last_message_source_from_api,
            lmd.message_id_from_api AS last_message_message_id_from_api,
            lmd.api_message_status AS last_message_api_message_status,
            lmd.is_read AS last_message_is_read,
            lmd.sent_by_tab AS last_message_sent_by_tab,
            (
                SELECT json_object_agg(cfd.id, cfv.value)
                FROM contact_custom_field_values cfv
                JOIN custom_field_definitions cfd ON cfv.field_id = cfd.id
                WHERE cfv.contact_id = c.contact_id
            ) AS contact_custom_fields
        FROM merged_chats c
        LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        LEFT JOIN evolution_api_instances eai ON lmd.instance_name = eai.instance_name AND eai.workspace_id = c.workspace_id
        ORDER BY GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) DESC
        `,
        params
    );
    const endTime = performance.now();
    if (process.env.NODE_ENV === 'development') {
        console.log(`[PERF] fetchChats took ${(endTime - startTime).toFixed(2)}ms for limit ${limit}`);
    }
    return rows as ChatRow[];
}

export const getInitialChatsData = withDebug(
    'get_initial_chats',
    async function getInitialChatsData({
        workspaceId,
        selectedChatId,
        ownership = 'mine',
        userIdOverride,
        workspaceTimezone,
    }: {
        workspaceId: string;
        selectedChatId: string | null;
        ownership?: 'mine' | 'everyone';
        userIdOverride?: string;
        workspaceTimezone?: string | null;
    }): Promise<InitialChatsPayload> {
        let userId = userIdOverride;

        if (!userId) {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                return {
                    chats: [],
                    messages: [],
                    selectedChatId: null,
                    lastSyncChats: null,
                    lastSyncMessageForSelected: null,
                    oldestMessageDate: null,
                    hasMoreHistory: false,
                    hasMoreChats: false,
                    timezone: defaultTimeZone,
                    error: "Usuario nao autenticado."
                };
            }

            userId = user.id;
        }

        try {
            const timezone = workspaceTimezone || await getWorkspaceTimezone(workspaceId);

            const activeChatsLimit = 1000;
            const activeChatsPromise = fetchChats({
                workspaceId,
                userId,
                limit: activeChatsLimit,
                includeChatId: selectedChatId,
                ownership,
                statuses: ['gerais', 'atendimentos']
            });

            const closedChatsLimit = 20;
            const closedChatsPromise = fetchChats({
                workspaceId,
                userId,
                limit: closedChatsLimit,
                includeChatId: null,
                ownership,
                statuses: ['encerrados']
            });

            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout ao buscar chats')), 15000)
            );

            const [activeChatRows, closedChatRows] = await Promise.race([
                Promise.all([activeChatsPromise, closedChatsPromise]),
                timeoutPromise
            ]) as [ChatRow[], ChatRow[]];

            const allChatRows = [...activeChatRows, ...closedChatRows];

            const uniqueChatRows = Array.from(new Map(allChatRows.map(c => [c.id, c])).values());

            uniqueChatRows.sort((a, b) => {
                const timeA = new Date(a.chat_activity_at || 0).getTime();
                const timeB = new Date(b.chat_activity_at || 0).getTime();
                return timeB - timeA;
            });

            const { chats, lastSyncChats } = await hydrateChats(uniqueChatRows, timezone);

            const hasMoreChats = closedChatRows.length === closedChatsLimit;

            let messages: Message[] = [];
            let lastSyncMessageForSelected: string | null = null;
            let oldestMessageDate: string | null = null;
            let hasMoreHistory = false;

            if (selectedChatId) {
                const msgResult = await getChatMessagesWindow({
                    chatId: selectedChatId,
                    limit: 50,
                    timezone,
                });
                messages = msgResult.messages;
                lastSyncMessageForSelected = msgResult.lastSyncMessage;
                oldestMessageDate = msgResult.oldestMessageDate;
                hasMoreHistory = msgResult.hasMoreHistory;
            }

            return {
                chats,
                messages,
                selectedChatId,
                lastSyncChats,
                lastSyncMessageForSelected,
                oldestMessageDate,
                hasMoreHistory,
                hasMoreChats,
                timezone,
            };

        } catch (error) {
            console.error('[GET_INITIAL_CHATS] Error:', error);
            return {
                chats: [],
                messages: [],
                selectedChatId: null,
                lastSyncChats: null,
                lastSyncMessageForSelected: null,
                oldestMessageDate: null,
                hasMoreHistory: false,
                hasMoreChats: false,
                timezone: defaultTimeZone,
                error: 'Falha ao carregar dados iniciais: ' + (error instanceof Error ? error.message : 'erro desconhecido')
            };
        }
    },
    {
        contextResolver: (input) => ({ payload: input })
    }
);

export const syncInboxData = withDebug(
    'sync_inbox',
    async function syncInboxData({
        workspaceId,
        lastSyncChats,
        chatId,
        lastSyncMessages,
    }: {
        workspaceId: string;
        lastSyncChats: string | null;
        chatId: string | null;
        lastSyncMessages: string | null;
    }): Promise<{
        deltaChats: Chat[];
        lastSyncChats: string | null;
        updatedContacts: Contact[];
        deltaMessages: Message[];
        lastSyncMessage: string | null;
        error?: string;
    }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                deltaChats: [],
                lastSyncChats: null,
                updatedContacts: [],
                deltaMessages: [],
                lastSyncMessage: null,
                error: "Usuário não autenticado."
            };
        }

        try {
            const timezone = await getWorkspaceTimezone(workspaceId);

            // 1. Fetch Chat Deltas
            let deltaChats: Chat[] = [];
            let newLastSyncChats = lastSyncChats;
            let updatedContacts: Contact[] = [];

            if (lastSyncChats) {
                const chatRows = await fetchChatsDelta({
                    workspaceId,
                    since: lastSyncChats,
                });
                const { chats, lastSyncChats: updatedSync } = await hydrateChats(chatRows, timezone);
                deltaChats = chats;
                newLastSyncChats = updatedSync || lastSyncChats;

                // Extract contacts from delta chats
                updatedContacts = chats.map(c => c.contact).filter(Boolean) as Contact[];
            }

            // 2. Fetch Message Deltas for the selected chat
            let deltaMessages: Message[] = [];
            let newLastSyncMessage = lastSyncMessages;

            if (chatId) {
                const since = lastSyncMessages || '1970-01-01T00:00:00.000Z';
                const { messages, lastSyncMessage } = await fetchMessageDeltas({
                    chatId,
                    since,
                    timezone,
                });
                deltaMessages = messages;
                newLastSyncMessage = lastSyncMessage || lastSyncMessages;
            }

            return {
                deltaChats,
                lastSyncChats: newLastSyncChats,
                updatedContacts,
                deltaMessages,
                lastSyncMessage: newLastSyncMessage,
            };

        } catch (error: any) {
            console.error("[SYNC_INBOX] Error:", error);
            return {
                deltaChats: [],
                lastSyncChats: null,
                updatedContacts: [],
                deltaMessages: [],
                lastSyncMessage: null,
                error: `Falha na sincronização: ${error.message}`
            };
        }
    },
    {
        contextResolver: (input) => ({ payload: input })
    }
);

export const searchChatsAndContacts = withDebug(
    'search_chats',
    async function searchChatsAndContacts(
        workspaceId: string,
        query: string
    ): Promise<{ chats: Chat[]; contacts: Contact[]; messages: Message[]; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { chats: [], contacts: [], messages: [], error: "Usuário não autenticado." };
        }

        if (!query || query.trim().length < 2) {
            return { chats: [], contacts: [], messages: [] };
        }

        try {
            const protocolTerm = query.trim().toUpperCase();
            const isProtocolQuery = protocolTerm.startsWith('PRT-');
            const timezone = await getWorkspaceTimezone(workspaceId);
            const searchTerm = `%${query.trim()}%`;

            // Protocol search: return only the chat and its messages (no cross-content search)
            if (isProtocolQuery) {
                const chatRes = await db.query(
                    `
                    SELECT 
                        c.id,
                        c.status,
                        c.workspace_id,
                        c.assigned_at,
                        c.tag,
                        c.color,
                        c.protocol,
                        c.contact_id,
                        c.agent_id,
                        c.created_at as chat_created_at,
                        c.closed_at,
                        cont.name AS contact_name,
                        cont.avatar_url AS contact_avatar_url,
                        cont.email AS contact_email,
                        cont.phone_number_jid AS contact_phone_number_jid,
                        cont.address AS contact_address,
                        t.name AS team_name,
                        t.color AS team_color
                    FROM chats c
                    LEFT JOIN contacts cont ON c.contact_id = cont.id
                    LEFT JOIN team_members tm ON c.agent_id = tm.user_id
                    LEFT JOIN teams t ON tm.team_id = t.id
                    WHERE c.workspace_id = $1
                      AND c.protocol ILIKE $2
                    LIMIT 1
                `,
                    [workspaceId, protocolTerm]
                );

                if (chatRes.rowCount === 0) {
                    return { chats: [], contacts: [], messages: [] };
                }

                const row = chatRes.rows[0];
                const chat: Chat = {
                    id: row.id,
                    status: row.status,
                    workspace_id: row.workspace_id,
                    contact: {
                        id: row.contact_id,
                        workspace_id: row.workspace_id,
                        name: row.contact_name || 'Contato',
                        avatar_url: row.contact_avatar_url,
                        email: row.contact_email,
                        phone_number_jid: row.contact_phone_number_jid,
                        address: row.contact_address,
                    },
                    agent: row.agent_id ? {
                        id: row.agent_id,
                        name: 'Agent',
                        firstName: 'Agent',
                        lastName: '',
                        avatar_url: '',
                        email: ''
                    } : undefined,
                    messages: [],
                    updatedAt: row.chat_created_at,
                    unreadCount: 0,
                    tag: row.tag,
                    color: row.color,
                    teamName: row.team_name,
                    teamColor: row.team_color || undefined,
                    protocol: row.protocol,
                    protocolScoped: true,
                };

                const messagesRes = await db.query(
                    `
                    SELECT 
                        m.id,
                        m.chat_id,
                        m.workspace_id,
                        m.content,
                        m.type,
                        m.created_at,
                        m.from_me,
                        m.metadata,
                        c.id AS contact_id,
                        c.name AS contact_name,
                        c.avatar_url AS contact_avatar_url,
                        c.email AS contact_email,
                        c.phone_number_jid AS contact_phone_number_jid,
                        c.address AS contact_address
                    FROM messages m
                    JOIN chats ch ON ch.id = m.chat_id
                    JOIN contacts c ON c.id = ch.contact_id
                    WHERE ch.protocol ILIKE $1
                    ORDER BY m.created_at DESC
                    LIMIT 200
                `,
                    [protocolTerm]
                );

                const messages: Message[] = messagesRes.rows.map((m: any) => ({
                    id: m.id,
                    chat_id: m.chat_id,
                    workspace_id: m.workspace_id,
                    content: m.content,
                    type: m.type,
                    createdAt: m.created_at,
                    timestamp: formatInTimeZone(new Date(m.created_at), 'HH:mm', { locale: ptBR, timeZone: timezone }),
                    formattedDate: formatMessageDate(new Date(m.created_at), timezone),
                    from_me: m.from_me,
                    metadata: m.metadata || {},
                    transcription: m.transcription || null,
                    contact_id: m.contact_id,
                    contact_name: m.contact_name,
                    contact_avatar_url: m.contact_avatar_url,
                    contact_email: m.contact_email,
                    contact_phone_number_jid: m.contact_phone_number_jid,
                    contact_address: m.contact_address,
                    status: 'default',
                }));

                // Anexar as mensagens no chat para facilitar o render imediato
                chat.messages = messages;

                return { chats: [chat], contacts: [], messages: [] };
            }

            // 1. Search in Chats (MATCHING CONTACT INFO ONLY)
            // We removed 'OR m.content ILIKE $2' to avoid random chats appearing without context
            const chatRows = await db.query(
                `
                SELECT DISTINCT ON (c.id)
                    c.id,
                    c.status,
                    c.workspace_id,
                    c.assigned_at,
                    c.tag,
                    c.color,
                    c.protocol,
                    c.contact_id,
                    c.agent_id,
                    c.created_at as chat_created_at,
                    c.closed_at,
                    cont.name AS contact_name,
                    cont.avatar_url AS contact_avatar_url,
                    cont.email AS contact_email,
                    cont.phone_number_jid AS contact_phone_number_jid,
                    cont.address AS contact_address,
                    t.name AS team_name,
                    t.color AS team_color,
                    (
                        SELECT json_build_object(
                            'id', m.id,
                            'content', m.content,
                            'created_at', m.created_at,
                            'type', m.type
                        )
                        FROM messages m
                        WHERE m.chat_id = c.id
                        ORDER BY m.created_at DESC
                        LIMIT 1
                    ) as last_message_json
                FROM chats c
                LEFT JOIN contacts cont ON c.contact_id = cont.id
                LEFT JOIN team_members tm ON c.agent_id = tm.user_id
                LEFT JOIN teams t ON tm.team_id = t.id
                WHERE c.workspace_id = $1
                  AND (
                      cont.name ILIKE $2
                      OR cont.phone_number_jid ILIKE $2
                      OR cont.email ILIKE $2
                      OR c.protocol ILIKE $2
                      OR c.id::text ILIKE $2
                  )
                ORDER BY c.id, c.created_at DESC
                LIMIT 20
            `,
                [workspaceId, searchTerm]
            );

            const chats: Chat[] = chatRows.rows.map((row: any) => {
                const lastMsg = row.last_message_json;
                return {
                    id: row.id,
                    status: row.status,
                    workspace_id: row.workspace_id,
                    contact: {
                        id: row.contact_id,
                        workspace_id: row.workspace_id,
                        name: row.contact_name || 'Contato',
                        avatar_url: row.contact_avatar_url,
                        email: row.contact_email,
                        phone_number_jid: row.contact_phone_number_jid,
                        address: row.contact_address,
                    },
                    agent: row.agent_id ? {
                        id: row.agent_id,
                        name: 'Agent',
                        firstName: 'Agent',
                        lastName: '',
                        avatar_url: '',
                        email: ''
                    } : undefined,
                    messages: lastMsg ? [{
                        id: lastMsg.id,
                        content: lastMsg.content,
                        type: lastMsg.type,
                        createdAt: lastMsg.created_at,
                        from_me: false,
                        timestamp: formatInTimeZone(new Date(lastMsg.created_at), 'HH:mm', { locale: ptBR, timeZone: timezone }),
                        formattedDate: formatMessageDate(new Date(lastMsg.created_at), timezone),
                        chat_id: row.id,
                        workspace_id: row.workspace_id,
                        status: 'default',
                        sender: undefined
                    } as Message] : [],
                    updatedAt: row.chat_created_at,
                    unreadCount: 0,
                    tag: row.tag,
                    color: row.color,
                    teamName: row.team_name,
                    teamColor: row.team_color || undefined
                    ,
                    protocol: row.protocol || buildChatProtocol(row.id),
                };
            });


            // 2. Search in Contacts (standalone)
            const contactRows = await db.query(
                `
                SELECT *
                FROM contacts
                WHERE workspace_id = $1
                  AND (
                      name ILIKE $2
                      OR phone_number_jid ILIKE $2
                      OR email ILIKE $2
                  )
                LIMIT 20
            `,
                [workspaceId, searchTerm]
            );

            const contacts: Contact[] = contactRows.rows.map((row: any) => ({
                id: row.id,
                workspace_id: row.workspace_id,
                name: row.name,
                avatar_url: row.avatar_url,
                email: row.email,
                phone_number_jid: row.phone_number_jid,
                address: row.address,
                custom_fields: row.custom_fields
            }));

            // 3. Search in Messages (Content Match)
            const messageRows = await db.query(
                `
                SELECT 
                    m.*,
                    c.workspace_id AS workspace_id,
                    cont.id AS contact_id,
                    cont.name AS contact_name,
                    cont.avatar_url AS contact_avatar_url,
                    cont.email AS contact_email,
                    cont.phone_number_jid AS contact_phone_number_jid,
                    cont.address AS contact_address
                FROM messages m
                JOIN chats c ON c.id = m.chat_id
                LEFT JOIN contacts cont ON cont.id = c.contact_id
                WHERE c.workspace_id = $1
                  AND m.content ILIKE $2
                ORDER BY m.created_at DESC
                LIMIT 20
                `,
                [workspaceId, searchTerm]
            );

            const senderIds = [...new Set(messageRows.rows.map((row: any) => row.sender_user_id).filter(Boolean))];
            const systemAgentIds = [...new Set(messageRows.rows.map((row: any) => row.sender_system_agent_id).filter(Boolean))];

            const [agentsMap, systemAgentsMap] = await Promise.all([
                fetchAgentsMap(senderIds as string[]),
                fetchSystemAgentsMap(systemAgentIds as string[]),
            ]);

            const messages: Message[] = messageRows.rows.map((row: any) => {
                const contact = row.contact_id ? {
                    id: row.contact_id,
                    workspace_id: row.workspace_id,
                    name: row.contact_name || 'Contato',
                    avatar_url: row.contact_avatar_url,
                    email: row.contact_email,
                    phone_number_jid: row.contact_phone_number_jid,
                    address: row.contact_address,
                } : undefined;

                return mapMessageFromRow(row, timezone, contact, agentsMap, systemAgentsMap);
            });

            return { chats, contacts, messages };

        } catch (error: any) {
            console.error("[SEARCH_CHATS] Error:", error);
            return { chats: [], contacts: [], messages: [], error: `Erro na busca: ${error.message}` };
        }
    },
    {
        contextResolver: (workspaceId, query) => ({ payload: { workspaceId, query } }),
        timeoutMs: 20000 // Increase timeout to 20s for complex search
    }
);

export const getOrCreateChatAction = withDebug(
    'get_or_create_chat',
    async function getOrCreateChatAction(
        workspaceId: string,
        contactId: string
    ): Promise<{ chatId?: string; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { error: "Usuário não autenticado." };
        }

        try {
            // Check for existing active chat
            const existingChat = await db.query(
                `SELECT id FROM chats WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('gerais', 'atendimentos') ORDER BY created_at DESC LIMIT 1`,
                [workspaceId, contactId]
            );

            if (existingChat.rowCount && existingChat.rowCount > 0) {
                return { chatId: existingChat.rows[0].id };
            }

            // Create new chat
            const newChatId = randomUUID();
            const protocol = buildChatProtocol(newChatId);
            const newChat = await db.query(
                `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol) VALUES ($1, $2, $3, 'gerais', $4, NOW(), $5) RETURNING id`,
                [newChatId, workspaceId, contactId, user.id, protocol]
            );

            return { chatId: newChat.rows[0].id };

        } catch (error: any) {
            console.error("[GET_OR_CREATE_CHAT] Error:", error);
            return { error: `Erro ao abrir conversa: ${error.message}` };
        }
    },
    {
        contextResolver: (workspaceId, contactId) => ({ payload: { workspaceId, contactId } }),
        timeoutMs: 15000 // Increase timeout to 15s
    }
);

export async function loadMoreChatsAction({
    workspaceId,
    limit = 20,
    before,
    ownership = 'mine',
}: {
    workspaceId: string;
    limit?: number;
    before: string;
    ownership?: 'mine' | 'everyone';
}): Promise<{ chats: Chat[]; hasMoreChats: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { chats: [], hasMoreChats: false, error: "Usuário não autenticado." };
    }

    try {
        const timezone = await getWorkspaceTimezone(workspaceId);
        const chatRows = await fetchChats({
            workspaceId,
            userId: user.id,
            limit,
            includeChatId: null,
            before,
            ownership,
            statuses: ['encerrados'] // Load more only for closed chats
        });

        const hydrated = await hydrateChats(chatRows, timezone);
        const hasMoreChats = chatRows.length === limit;

        return { chats: hydrated.chats, hasMoreChats };
    } catch (error: any) {
        console.error("[LOAD_MORE_CHATS] Error:", error);
        return { chats: [], hasMoreChats: false, error: `Falha ao carregar mais conversas: ${error.message}` };
    }
}

async function fetchChatsDelta({
    workspaceId,
    since,
}: {
    workspaceId: string;
    since: string;
}): Promise<ChatRow[]> {
    const { rows } = await db.query(
        `
        WITH last_message_details AS (
            SELECT DISTINCT ON (chat_id)
                id,
                chat_id,
                content,
                type,
                metadata,
                transcription,
                created_at,
                from_me,
                sender_user_id,
                sender_system_agent_id,
                instance_name,
                source_from_api,
                message_id_from_api,
                api_message_status,
                is_read,
                sent_by_tab
            FROM messages
            WHERE workspace_id = $1
            ORDER BY chat_id, created_at DESC
        )
        SELECT 
            c.id,
            c.status,
            c.workspace_id,
            c.assigned_at,
            c.tag,
            c.color,
            c.contact_id,
            c.is_autopilot_active,
            c.agent_id,
            GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) AS chat_activity_at,
            lmd.instance_name,
            lmd.source_from_api AS source,
            COALESCE((
                SELECT COUNT(*) FROM messages m
                WHERE m.chat_id = c.id AND m.from_me = false AND COALESCE(m.is_read, false) = false
            ), 0) AS unread_count,
            t.name AS team_name,
            eai.type AS instance_type,
            cont.name AS contact_name,
            cont.avatar_url AS contact_avatar_url,
            cont.email AS contact_email,
            cont.phone_number_jid AS contact_phone_number_jid,
            cont.address AS contact_address,
            lmd.id AS last_message_id,
            lmd.content AS last_message_content,
            lmd.type AS last_message_type,
            lmd.metadata AS last_message_metadata,
            lmd.transcription AS last_message_transcription,
            lmd.created_at AS last_message_created_at,
            lmd.from_me AS last_message_from_me,
            lmd.sender_user_id AS last_message_sender_user_id,
            lmd.sender_system_agent_id AS last_message_sender_system_agent_id,
            lmd.instance_name AS last_message_instance_name,
            lmd.source_from_api AS last_message_source_from_api,
            lmd.message_id_from_api AS last_message_message_id_from_api,
            lmd.api_message_status AS last_message_api_message_status,
            lmd.is_read AS last_message_is_read,
            lmd.is_read AS last_message_is_read,
            lmd.sent_by_tab AS last_message_sent_by_tab,
            (
                SELECT json_object_agg(cfd.id, cfv.value)
                FROM contact_custom_field_values cfv
                JOIN custom_field_definitions cfd ON cfv.field_id = cfd.id
                WHERE cfv.contact_id = c.contact_id
            ) AS contact_custom_fields
        FROM chats c
        LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        LEFT JOIN evolution_api_instances eai ON lmd.instance_name = eai.instance_name AND eai.workspace_id = c.workspace_id
        WHERE c.workspace_id = $1
          AND GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) >= $2
        ORDER BY GREATEST(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) DESC
        `,
        [workspaceId, since]
    );
    return rows as ChatRow[];
}

type AgentRow = { id: string; full_name: string; avatar_url?: string | null };

async function fetchAgentsMap(ids: string[]): Promise<Map<string, AgentRow>> {
    if (!ids.length) return new Map();
    const { rows } = await db.query(
        'SELECT id, full_name, avatar_url FROM users WHERE id::text = ANY($1::text[])',
        [ids]
    );
    return new Map(rows.map((row: AgentRow) => [row.id, row]));
}

async function fetchSystemAgentsMap(ids: string[]): Promise<Map<string, Pick<SystemAgent, 'id' | 'name' | 'avatar_url'>>> {
    if (!ids.length) return new Map();
    const { rows } = await db.query(
        'SELECT id, name, avatar_url FROM system_agents WHERE id::text = ANY($1::text[])',
        [ids]
    );
    return new Map(rows.map((row: Pick<SystemAgent, 'id' | 'name' | 'avatar_url'>) => [row.id, row]));
}

async function hydrateChats(rows: ChatRow[], timezone: string): Promise<{ chats: Chat[]; chatMap: Map<string, Chat>; lastSyncChats: string | null }> {
    if (!rows.length) {
        return { chats: [], chatMap: new Map(), lastSyncChats: null };
    }

    const agentIds = new Set<string>();
    const systemAgentIds = new Set<string>();
    rows.forEach((row) => {
        if (row.agent_id) agentIds.add(row.agent_id);
        if (row.last_message_sender_user_id) agentIds.add(row.last_message_sender_user_id);
        if (row.last_message_sender_system_agent_id) systemAgentIds.add(row.last_message_sender_system_agent_id);
    });

    const [agentsMap, systemAgentsMap] = await Promise.all([
        fetchAgentsMap([...agentIds].filter(Boolean)),
        fetchSystemAgentsMap([...systemAgentIds].filter(Boolean)),
    ]);

    const chats: Chat[] = rows.map((row) => {
        const contact = buildContactFromRow(row);
        const lastMessage = row.last_message_id
            ? mapMessageFromRow(
                {
                    id: row.last_message_id,
                    chat_id: row.id,
                    workspace_id: row.workspace_id,
                    content: row.last_message_content || '',
                    type: (row.last_message_type || 'text') as Message['type'],
                    metadata: row.last_message_metadata,
                    transcription: row.last_message_transcription,
                    created_at: row.last_message_created_at || new Date().toISOString(),
                    // updated_at removed as it is not in MessageRow
                    from_me: Boolean(row.last_message_from_me),
                    sender_user_id: row.last_message_sender_user_id,
                    sender_system_agent_id: row.last_message_sender_system_agent_id,
                    instance_name: row.last_message_instance_name,
                    source_from_api: row.last_message_source_from_api,
                    message_id_from_api: row.last_message_message_id_from_api,
                    api_message_status: row.last_message_api_message_status,
                    is_read: row.last_message_is_read,
                    sent_by_tab: row.last_message_sent_by_tab,
                    contact_id: contact?.id,
                    contact_name: contact?.name,
                    contact_avatar_url: contact?.avatar_url,
                    contact_email: contact?.email,
                    contact_phone_number_jid: contact?.phone_number_jid,
                    contact_address: contact?.address,
                },
                timezone,
                contact,
                agentsMap,
                systemAgentsMap
            )
            : undefined;

        const agentRow = row.agent_id ? agentsMap.get(row.agent_id) : undefined;
        const agent = agentRow
            ? {
                id: agentRow.id,
                name: agentRow.full_name,
                avatar_url: agentRow.avatar_url || undefined,
            } as User
            : undefined;

        return {
            id: row.id,
            status: row.status,
            workspace_id: row.workspace_id,
            contact: contact as Contact,
            agent,
            agentId: row.agent_id || undefined,
            messages: lastMessage ? [lastMessage] : [],
            updatedAt: row.chat_activity_at || undefined,
            source: row.source || undefined,
            instance_name: row.instance_name || undefined,
            instance_type: row.instance_type,
            assigned_at: row.assigned_at || undefined,
            unreadCount: Number(row.unread_count || 0),
            teamName: row.team_name || undefined,
            teamColor: row.team_color || undefined,
            tag: row.tag || undefined,
            color: row.color || undefined,
            protocol: row.protocol || buildChatProtocol(row.id),
            is_autopilot_active: row.is_autopilot_active ?? false,
        };
    });

    const chatMap = new Map(chats.map((chat) => [chat.id, chat]));
    const lastSync = rows.reduce<string | null>((acc, row) => maxIsoDate(acc, row.chat_activity_at), null);
    return { chats, chatMap, lastSyncChats: lastSync };
}

function buildContactFromRow(row: ChatRow): Contact | undefined {
    if (!row.contact_id) return undefined;
    return {
        id: row.contact_id,
        workspace_id: row.workspace_id,
        name: row.contact_name || 'Contato',
        avatar_url: row.contact_avatar_url || undefined,
        email: row.contact_email || undefined,
        phone_number_jid: row.contact_phone_number_jid || undefined,
        address: row.contact_address || undefined,
        custom_fields: row.contact_custom_fields || undefined,
    };
}

export async function getChatMessagesWindow({
    chatId,
    limit,
    before,
    timezone,
}: {
    chatId: string;
    limit: number;
    before?: string | null;
    timezone: string;
}): Promise<{
    messages: Message[];
    lastSyncMessage: string | null;
    oldestMessageDate: string | null;
    hasMoreHistory: boolean;
    contact?: Contact;
}> {
    const params: (string | number)[] = [chatId, limit];
    let beforeClause = '';
    if (before) {
        params.push(before);
        beforeClause = 'AND m.created_at < $3';
    }

    // Modified query to fetch messages for the contact associated with the chat
    const { rows } = await db.query(
        `
        WITH target_chat AS (
            SELECT contact_id, workspace_id FROM chats WHERE id = $1
        )
        SELECT 
            m.*,
            c.workspace_id AS workspace_id,
            cont.id AS contact_id,
            cont.name AS contact_name,
            cont.avatar_url AS contact_avatar_url,
            cont.email AS contact_email,
            cont.phone_number_jid AS contact_phone_number_jid,
            cont.address AS contact_address
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        JOIN target_chat tc ON c.contact_id = tc.contact_id AND c.workspace_id = tc.workspace_id
        WHERE 1=1
        ${beforeClause}
        ORDER BY m.created_at DESC
        LIMIT $2
        `,
        params
    );

    const senderIds = [...new Set(rows.map((row) => row.sender_user_id).filter(Boolean))];
    const systemAgentIds = [...new Set(rows.map((row) => row.sender_system_agent_id).filter(Boolean))];

    const [agentsMap, systemAgentsMap] = await Promise.all([
        fetchAgentsMap(senderIds as string[]),
        fetchSystemAgentsMap(systemAgentIds as string[]),
    ]);

    const contact = rows[0]?.contact_id
        ? {
            id: rows[0].contact_id,
            workspace_id: rows[0].workspace_id,
            name: rows[0].contact_name || 'Contato',
            avatar_url: rows[0].contact_avatar_url || undefined,
            email: rows[0].contact_email || undefined,
            phone_number_jid: rows[0].contact_phone_number_jid || undefined,
            address: rows[0].contact_address || undefined,
        }
        : undefined;

    const messages = rows
        .map((row: MessageRow) => mapMessageFromRow(row, timezone, contact, agentsMap, systemAgentsMap))
        .reverse();

    const lastSyncMessage = rows.reduce<string | null>((acc, row) => maxIsoDate(acc, row.created_at), null);
    const oldestMessageDate = messages[0]?.createdAt || null;
    const hasMoreHistory = rows.length === limit;

    return { messages, lastSyncMessage, oldestMessageDate, hasMoreHistory, contact };
}

async function fetchMessageDeltas({
    chatId,
    since,
    timezone,
}: {
    chatId: string;
    since: string;
    timezone: string;
}): Promise<{ messages: Message[]; lastSyncMessage: string | null }> {
    const { rows } = await db.query(
        `
        SELECT 
            m.*,
            c.workspace_id AS workspace_id,
            cont.id AS contact_id,
            cont.name AS contact_name,
            cont.avatar_url AS contact_avatar_url,
            cont.email AS contact_email,
            cont.phone_number_jid AS contact_phone_number_jid,
            cont.address AS contact_address
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        WHERE m.chat_id = $1 AND m.created_at >= $2
        ORDER BY m.created_at ASC
        `,
        [chatId, since]
    );

    if (!rows.length) {
        return { messages: [], lastSyncMessage: null };
    }

    const senderIds = [...new Set(rows.map((row) => row.sender_user_id).filter(Boolean))];
    const systemAgentIds = [...new Set(rows.map((row) => row.sender_system_agent_id).filter(Boolean))];

    const [agentsMap, systemAgentsMap] = await Promise.all([
        fetchAgentsMap(senderIds as string[]),
        fetchSystemAgentsMap(systemAgentIds as string[]),
    ]);

    const contact = rows[0]?.contact_id
        ? {
            id: rows[0].contact_id,
            workspace_id: rows[0].workspace_id,
            name: rows[0].contact_name || 'Contato',
            avatar_url: rows[0].contact_avatar_url || undefined,
            email: rows[0].contact_email || undefined,
            phone_number_jid: rows[0].contact_phone_number_jid || undefined,
            address: rows[0].contact_address || undefined,
        }
        : undefined;

    const messages = rows.map((row: MessageRow) => mapMessageFromRow(row, timezone, contact, agentsMap, systemAgentsMap));
    const lastSyncMessage = rows.reduce<string | null>((acc, row) => maxIsoDate(acc, row.created_at), null);

    return { messages, lastSyncMessage };
}

function mapMessageFromRow(
    row: MessageRow,
    timezone: string,
    contact: Contact | undefined,
    agentsMap: Map<string, AgentRow>,
    systemAgentsMap: Map<string, Pick<SystemAgent, 'id' | 'name' | 'avatar_url'>>
): Message {
    const createdAt = new Date(row.created_at);
    const zonedDate = toZonedTime(createdAt, timezone);
    const metadata = parseMetadata(row.metadata);
    const sender = resolveSender(row, contact, agentsMap, systemAgentsMap);

    return {
        id: row.id,
        chat_id: row.chat_id,
        workspace_id: row.workspace_id,
        content: row.content || '',
        type: row.type,
        status: row.content === 'Mensagem apagada' ? 'deleted' : 'default',
        metadata,
        transcription: row.transcription,
        timestamp: formatInTimeZone(zonedDate, 'HH:mm', { locale: ptBR, timeZone: timezone }),
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        formattedDate: formatMessageDate(createdAt, timezone),
        sender,
        instance_name: row.instance_name || undefined,
        source_from_api: row.source_from_api || undefined,
        api_message_status: row.api_message_status || undefined,
        message_id_from_api: row.message_id_from_api || undefined,
        from_me: row.from_me,
        is_read: row.is_read ?? undefined,
        sentByTab: row.sent_by_tab || undefined,
        platform: (row.platform as any) || undefined,
        direction: (row.direction as any) || undefined,
        externalMessageId: row.external_message_id || undefined,
        externalSenderId: row.external_sender_id || undefined,
        externalChannelId: row.external_channel_id || undefined,
        mediaUrl: row.media_url || undefined,
        optimistic: false,
    };
}

function resolveSender(
    row: MessageRow,
    contact: Contact | undefined,
    agentsMap: Map<string, AgentRow>,
    systemAgentsMap: Map<string, Pick<SystemAgent, 'id' | 'name' | 'avatar_url'>>
): MessageSender {
    if (row.from_me) {
        if (row.sender_user_id && agentsMap.has(row.sender_user_id)) {
            const agent = agentsMap.get(row.sender_user_id)!;
            return { id: agent.id, name: agent.full_name, avatar: agent.avatar_url || undefined, type: 'user' };
        }
        if (row.sender_system_agent_id && systemAgentsMap.has(row.sender_system_agent_id)) {
            const systemAgent = systemAgentsMap.get(row.sender_system_agent_id)!;
            return { id: systemAgent.id, name: systemAgent.name, avatar: systemAgent.avatar_url || undefined, type: 'system_agent' };
        }
    } else if (contact) {
        return { id: contact.id, name: contact.name, avatar: contact.avatar_url, type: 'contact' };
    }
    return undefined;
}
function parseMetadata(metadata: any): MessageMetadata | undefined {
    if (!metadata) return undefined;
    if (typeof metadata === 'object') return metadata as MessageMetadata;
    try {
        return JSON.parse(metadata) as MessageMetadata;
    } catch {
        return undefined;
    }
}

function maxIsoDate(current: string | null, candidate: string | null): string | null {
    if (!candidate) return current;
    if (!current) return candidate;
    return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

export async function getContactMessages({
    contactId,
    workspaceId,
    limit = 100,
}: {
    contactId: string;
    workspaceId: string;
    limit?: number;
}): Promise<{ messages: Message[]; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { messages: [], error: "Usuário não autenticado." };
    }

    try {
        const timezone = await getWorkspaceTimezone(workspaceId);

        const { rows } = await db.query(
            `
            SELECT 
                m.*,
                c.workspace_id AS workspace_id,
                cont.id AS contact_id,
                cont.name AS contact_name,
                cont.avatar_url AS contact_avatar_url,
                cont.email AS contact_email,
                cont.phone_number_jid AS contact_phone_number_jid,
                cont.address AS contact_address
            FROM messages m
            JOIN chats c ON c.id = m.chat_id
            LEFT JOIN contacts cont ON cont.id = c.contact_id
            WHERE c.contact_id = $1 AND c.workspace_id = $2
            ORDER BY m.created_at DESC
            LIMIT $3
            `,
            [contactId, workspaceId, limit]
        );

        const senderIds = [...new Set(rows.map((row) => row.sender_user_id).filter(Boolean))];
        const systemAgentIds = [...new Set(rows.map((row) => row.sender_system_agent_id).filter(Boolean))];

        const [agentsMap, systemAgentsMap] = await Promise.all([
            fetchAgentsMap(senderIds as string[]),
            fetchSystemAgentsMap(systemAgentIds as string[]),
        ]);

        const contact = rows[0]?.contact_id
            ? {
                id: rows[0].contact_id,
                workspace_id: rows[0].workspace_id,
                name: rows[0].contact_name || 'Contato',
                avatar_url: rows[0].contact_avatar_url || undefined,
                email: rows[0].contact_email || undefined,
                phone_number_jid: rows[0].contact_phone_number_jid || undefined,
                address: rows[0].contact_address || undefined,
            }
            : undefined;

        const messages = rows
            .map((row: MessageRow) => mapMessageFromRow(row, timezone, contact, agentsMap, systemAgentsMap))
            .reverse();

        return { messages };

    } catch (error: any) {
        console.error("[GET_CONTACT_MESSAGES] Error:", error);
        return { messages: [], error: `Falha ao buscar histórico do contato: ${error.message}` };
    }
}

export const toggleChatAutopilot = withDebug(
    'toggle_chat_autopilot',
    async function toggleChatAutopilot(chatId: string, isActive: boolean, agentId: string | null = null): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            await db.query(`
                UPDATE chats 
                SET is_autopilot_active = $1, 
                    autopilot_config_id = $2
                WHERE id = $3
            `, [isActive, agentId, chatId]);

            revalidatePath('/', 'layout');
            return { success: true };
        } catch (error: any) {
            console.error("Erro ao alternar autopilot:", error);
            return { success: false, error: "Falha ao atualizar status do autopilot." };
        }
    },
    {
        contextResolver: (chatId, isActive, agentId) => ({ payload: { chatId, isActive, agentId } })
    }
);
