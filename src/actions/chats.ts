
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { User, Workspace, Chat, Message, MessageSender, Contact, SystemAgent, MessageMetadata } from '@/lib/types';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';

// Fallback timezone
const defaultTimeZone = 'America/Sao_Paulo';

// Helper function to check for permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return res.rowCount > 0;
}

/**
 * Atribui o chat atual ao agente logado.
 * Esta aÃ§Ã£o Ã© chamada pelo botÃ£o "Assumir Atendimento".
 */
export async function assignChatToSelfAction(chatId: string): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: "UsuÃ¡rio nÃ£o autenticado." };
    }
    const currentAgentId = user.id;

    if (!chatId) {
        return { success: false, error: "ID do Chat Ã© obrigatÃ³rio." };
    }

    try {
        // Corrected query: Allow taking ownership as long as the chat is in the 'gerais' (general) queue,
        // regardless of whether agent_id was previously filled.
        const result = await db.query(
            "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2 AND status = 'gerais'",
            [currentAgentId, chatId]
        );

        if (result.rowCount === 0) {
            // This can happen if another agent took the chat milliseconds before, or if the chat is not in 'gerais' status.
            return { success: false, error: "Este atendimento nÃ£o estÃ¡ mais na fila geral ou jÃ¡ foi assumido." };
        }

        console.log(`[ASSIGN_CHAT_SELF] Chat ${chatId} atribuÃ­do ao agente ${currentAgentId}.`);
        // revalidatePath('/', 'layout'); // Removed to prevent page refresh
        return { success: true };
    } catch (error) {
        console.error("Erro ao atribuir chat a si mesmo:", error);
        return { success: false, error: "Falha no servidor ao tentar assumir o atendimento." };
    }
}


export async function transferChatAction(
    input: { chatId: string; teamId?: string; agentId?: string },
    // Optional parameter to accept a session-like object from an API call
    prefetchedSession?: { user: { id: string, name: string, email?: string | null } }
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
        return { success: false, error: "UsuÃ¡rio nÃ£o autenticado." };
    }
    const currentAgentId = sessionToUse.user.id;
    const currentAgentName = sessionToUse.user.name;

    const { chatId, teamId, agentId } = input;

    if (!chatId || (!teamId && !agentId)) {
        return { success: false, error: "ParÃ¢metros invÃ¡lidos para transferÃªncia." };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatRes = await client.query('SELECT workspace_id, agent_id as current_chat_agent_id, status FROM chats WHERE id = $1', [chatId]);
        if (chatRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: "Conversa nÃ£o encontrada." };
        }
        const { workspace_id: workspaceId, current_chat_agent_id, status } = chatRes.rows[0];

        if (status === 'encerrados') {
            await client.query('ROLLBACK');
            return { success: false, error: "NÃ£o Ã© possÃ­vel transferir um atendimento que jÃ¡ foi encerrado." };
        }

        // System agents have implicit permission
        if (!prefetchedSession) {
            if (!await hasPermission(currentAgentId, workspaceId, 'teams:view')) { // Permission to be defined
                await client.query('ROLLBACK');
                return { success: false, error: "VocÃª nÃ£o tem permissÃ£o para transferir atendimentos." };
            }
        }


        let finalAgentId = agentId;
        let transferTargetName = '';

        // Load balancing logic for team transfer
        if (teamId) {
            console.log(`[TRANSFER_CHAT] Transferindo para equipe ${teamId}. Buscando agente com base no tempo desde a Ãºltima atribuiÃ§Ã£o...`);
            const agentRes = await client.query(`
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
                WHERE tm.team_id = $1 AND uwp.is_online = TRUE
                GROUP BY u.id, t.name
                ORDER BY "lastAssigned" ASC NULLS FIRST, random()
                LIMIT 1;
            `, [teamId]);

            if (agentRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Nenhum agente disponÃ­vel nesta equipe no momento." };
            }
            finalAgentId = agentRes.rows[0].agentId;
            transferTargetName = agentRes.rows[0].teamName;
            console.log(`[TRANSFER_CHAT] Equipe ${transferTargetName} selecionada. Agente por load balance: ${finalAgentId}`);
        } else if (agentId) {
            const agentRes = await client.query('SELECT full_name FROM users WHERE id = $1', [agentId]);
            if (agentRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Agente de destino nÃ£o encontrado." };
            }
            transferTargetName = agentRes.rows[0].full_name;
        }

        if (!finalAgentId) {
            await client.query('ROLLBACK');
            return { success: false, error: "NÃ£o foi possÃ­vel determinar um agente para a transferÃªncia." };
        }

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
            : `Atendimento atribuÃ­do a ${transferTargetName} por ${currentAgentName}.`;

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
        // revalidatePath('/', 'layout'); // Removed to prevent page refresh
        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro ao transferir chat:", error);
        return { success: false, error: "Falha no servidor ao tentar transferir o atendimento." };
    } finally {
        client.release();
    }
}


export async function closeChatAction(
    chatId: string,
    reasonTagId: string | null,
    notes: string | null
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.user_metadata.full_name) {
        return { success: false, error: "UsuÃ¡rio nÃ£o autenticado." };
    }

    const currentAgentId = user.id;
    const currentAgentName = user.user_metadata.full_name;

    if (!chatId) {
        return { success: false, error: "ID do chat Ã© obrigatÃ³rio." };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatRes = await client.query('SELECT workspace_id, tag as current_tag, color as current_color FROM chats WHERE id = $1', [chatId]);
        if (chatRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Chat nÃ£o encontrado.' };
        }
        const { workspace_id, current_tag, current_color } = chatRes.rows[0];

        let tagInfo = { label: null as string | null, color: null as string | null };
        if (reasonTagId) {
            const tagRes = await client.query('SELECT label, color FROM tags WHERE id = $1', [reasonTagId]);
            if (tagRes.rowCount > 0) {
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
        revalidatePath('/', 'layout');
        return { success: true };
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error("Erro ao encerrar atendimento:", error);
        return { success: false, error: error.message || "Falha no servidor ao encerrar o atendimento." };
    } finally {
        client.release();
    }
}


export async function updateChatTagAction(chatId: string, tagId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: "UsuÃ¡rio nÃ£o autenticado." };
    }

    if (!chatId || !tagId) {
        return { success: false, error: "IDs do chat e da tag sÃ£o obrigatÃ³rios." };
    }

    try {
        const tagRes = await db.query('SELECT label, color FROM tags WHERE id = $1', [tagId]);
        if (tagRes.rowCount === 0) {
            return { success: false, error: "Etiqueta nÃ£o encontrada." };
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
}

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
    timezone: string;
    error?: string;
};

export async function getInitialChatsData({
    workspaceId,
    selectedChatId,
    messageLimit = 40,
    chatLimit = 50,
}: {
    workspaceId: string;
    selectedChatId?: string | null;
    messageLimit?: number;
    chatLimit?: number;
}): Promise<InitialChatsPayload> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !workspaceId) {
        return {
            chats: [],
            messages: [],
            selectedChatId: null,
            lastSyncChats: null,
            lastSyncMessageForSelected: null,
            oldestMessageDate: null,
            hasMoreHistory: false,
            timezone: defaultTimeZone,
            error: "Usuário ou workspace não encontrado.",
        };
    }

    try {
        const timezone = await getWorkspaceTimezone(workspaceId);
        const chatRows = await fetchChats({
            workspaceId,
            userId: user.id,
            limit: chatLimit,
            includeChatId: selectedChatId || null,
        });

        if (!chatRows.length) {
            return {
                chats: [],
                messages: [],
                selectedChatId: null,
                lastSyncChats: null,
                lastSyncMessageForSelected: null,
                oldestMessageDate: null,
                hasMoreHistory: false,
                timezone,
            };
        }

        const hydratedChats = await hydrateChats(chatRows, timezone);
        const resolvedChatId = selectedChatId && hydratedChats.chatMap.has(selectedChatId)
            ? selectedChatId
            : hydratedChats.chats[0]?.id || null;

        let messages: Message[] = [];
        let lastSyncMessageForSelected: string | null = null;
        let oldestMessageDate: string | null = null;
        let hasMoreHistory = false;

        if (resolvedChatId) {
            const messageResult = await fetchMessagesWindow({
                chatId: resolvedChatId,
                limit: messageLimit,
                timezone,
            });
            messages = messageResult.messages;
            lastSyncMessageForSelected = messageResult.lastSyncMessage;
            oldestMessageDate = messageResult.oldestMessageDate;
            hasMoreHistory = messageResult.hasMoreHistory;
        }

        return {
            chats: hydratedChats.chats,
            messages,
            selectedChatId: resolvedChatId,
            lastSyncChats: hydratedChats.lastSyncChats,
            lastSyncMessageForSelected,
            oldestMessageDate,
            hasMoreHistory,
            timezone,
        };
    } catch (error: any) {
        console.error("[GET_INITIAL_CHATS] Error:", error);
        return {
            chats: [],
            messages: [],
            selectedChatId: null,
            lastSyncChats: null,
            lastSyncMessageForSelected: null,
            oldestMessageDate: null,
            hasMoreHistory: false,
            timezone: defaultTimeZone,
            error: `Falha ao buscar dados iniciais: ${error.message}`,
        };
    }
}

export async function syncInboxData({
    workspaceId,
    lastSyncChats,
    chatId,
    lastSyncMessages,
}: {
    workspaceId: string;
    lastSyncChats: string | null;
    chatId?: string | null;
    lastSyncMessages?: string | null;
}): Promise<{
    deltaChats: Chat[];
    updatedContacts: Contact[];
    deltaMessages: Message[];
    lastSyncChats: string | null;
    lastSyncMessage: string | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !workspaceId) {
        return {
            deltaChats: [],
            updatedContacts: [],
            deltaMessages: [],
            lastSyncChats,
            lastSyncMessage: lastSyncMessages ?? null,
            error: "Usuário ou workspace não encontrado.",
        };
    }

    try {
        const timezone = await getWorkspaceTimezone(workspaceId);
        const since = lastSyncChats || new Date(0).toISOString();
        const deltaRows = await fetchChatsDelta({ workspaceId, since });
        const hydrated = await hydrateChats(deltaRows, timezone);
        const updatedContacts = Array.from(
            new Map(
                hydrated.chats
                    .filter((chat) => Boolean(chat.contact))
                    .map((chat) => [chat.contact!.id, chat.contact!])
            ).values()
        );

        let deltaMessages: Message[] = [];
        let newLastSyncMessage: string | null = lastSyncMessages ?? null;

        if (chatId && lastSyncMessages) {
            const deltaResult = await fetchMessageDeltas({
                chatId,
                since: lastSyncMessages,
                timezone,
            });
            deltaMessages = deltaResult.messages;
            newLastSyncMessage = deltaResult.lastSyncMessage ?? newLastSyncMessage;
        }

        return {
            deltaChats: hydrated.chats,
            updatedContacts,
            deltaMessages,
            lastSyncChats: hydrated.lastSyncChats || lastSyncChats,
            lastSyncMessage: newLastSyncMessage,
        };
    } catch (error: any) {
        console.error("[SYNC_INBOX] Error:", error);
        return {
            deltaChats: [],
            updatedContacts: [],
            deltaMessages: [],
            lastSyncChats,
            lastSyncMessage: lastSyncMessages ?? null,
            error: `Falha ao sincronizar inbox: ${error.message}`,
        };
    }
}

export async function getChatMessagesWindow({
    chatId,
    limit = 40,
    before,
}: {
    chatId: string;
    limit?: number;
    before?: string | null;
}): Promise<{
    messages: Message[];
    lastSyncMessage: string | null;
    oldestMessageDate: string | null;
    hasMoreHistory: boolean;
    contact?: Contact;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return {
            messages: [],
            lastSyncMessage: null,
            oldestMessageDate: null,
            hasMoreHistory: false,
            error: "Usuário não autenticado.",
        };
    }

    try {
        const workspaceRes = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
        if (workspaceRes.rowCount === 0) {
            return {
                messages: [],
                lastSyncMessage: null,
                oldestMessageDate: null,
                hasMoreHistory: false,
                error: "Chat não encontrado.",
            };
        }
        const workspaceId = workspaceRes.rows[0].workspace_id as string;
        const timezone = await getWorkspaceTimezone(workspaceId);
        const result = await fetchMessagesWindow({ chatId, limit, before, timezone });
        return result;
    } catch (error: any) {
        console.error("[GET_CHAT_MESSAGES_WINDOW] Error:", error);
        return {
            messages: [],
            lastSyncMessage: null,
            oldestMessageDate: null,
            hasMoreHistory: false,
            error: `Falha ao carregar mensagens: ${error.message}`,
        };
    }
}

type ChatRow = {
    id: string;
    status: Chat['status'];
    workspace_id: string;
    assigned_at: string | null;
    tag: string | null;
    color: string | null;
    contact_id: string | null;
    agent_id: string | null;
    team_name: string | null;
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
    contact_id?: string | null;
    contact_name?: string | null;
    contact_avatar_url?: string | null;
    contact_email?: string | null;
    contact_phone_number_jid?: string | null;
    contact_address?: string | null;
};

async function getWorkspaceTimezone(workspaceId: string): Promise<string> {
    const workspaceRes = await db.query('SELECT timezone FROM workspaces WHERE id = $1', [workspaceId]);
    return workspaceRes.rows[0]?.timezone || defaultTimeZone;
}

async function fetchChats({
    workspaceId,
    userId,
    limit,
    includeChatId,
}: {
    workspaceId: string;
    userId: string;
    limit: number;
    includeChatId: string | null;
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
        ),
        filtered_chats AS (
            SELECT c.*
            FROM chats c
            LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
            WHERE c.workspace_id = $1
              AND (c.status IN ('gerais', 'atendimentos') OR (c.status = 'encerrados' AND c.agent_id = $2))
            ORDER BY COALESCE(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) DESC
            LIMIT $3
        ),
        target_chat AS (
            SELECT *
            FROM chats
            WHERE workspace_id = $1 AND id = $4
        ),
        merged_chats AS (
            SELECT * FROM filtered_chats
            UNION
            SELECT * FROM target_chat
        )
        SELECT 
            c.id,
            c.status,
            c.workspace_id,
            c.assigned_at,
            c.tag,
            c.color,
            c.contact_id,
            c.agent_id,
            COALESCE(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) AS chat_activity_at,
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
            lmd.sent_by_tab AS last_message_sent_by_tab
        FROM merged_chats c
        LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        LEFT JOIN evolution_api_instances eai ON lmd.instance_name = eai.instance_name AND eai.workspace_id = c.workspace_id
        ORDER BY COALESCE(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) DESC
        `,
        [workspaceId, userId, limit, includeChatId]
    );
    return rows as ChatRow[];
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
            c.agent_id,
            COALESCE(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) AS chat_activity_at,
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
            lmd.sent_by_tab AS last_message_sent_by_tab
        FROM chats c
        LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        LEFT JOIN evolution_api_instances eai ON lmd.instance_name = eai.instance_name AND eai.workspace_id = c.workspace_id
        WHERE c.workspace_id = $1
          AND COALESCE(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) > $2
        ORDER BY COALESCE(lmd.created_at, c.closed_at, c.assigned_at, c.created_at) DESC
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
                    updated_at: row.last_message_created_at || new Date().toISOString(),
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
            messages: lastMessage ? [lastMessage] : [],
            updatedAt: row.chat_activity_at || undefined,
            source: row.source || undefined,
            instance_name: row.instance_name || undefined,
            instance_type: row.instance_type,
            assigned_at: row.assigned_at || undefined,
            unreadCount: Number(row.unread_count || 0),
            teamName: row.team_name || undefined,
            tag: row.tag || undefined,
            color: row.color || undefined,
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
    };
}

async function fetchMessagesWindow({
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
        WHERE m.chat_id = $1
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
        WHERE m.chat_id = $1 AND m.created_at > $2
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
