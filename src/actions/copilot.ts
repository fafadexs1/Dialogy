'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { enqueueAiAutopilotProcess, shouldEnqueueJob } from '@/lib/queue';
import { createClient } from '@/lib/supabase/server';
import type { Chat, Contact } from '@/lib/types';
import { requireChatAccess, requireWorkspaceAccess } from '@/server/inbox/access';
import {
    discardPendingCopilotSuggestions,
    getPendingCopilotSuggestionForChat,
    resolveCopilotSuggestion,
    type CopilotSuggestion,
} from '@/services/autopilot/runtime/copilot-suggestion';

export type InboxAiAgent = {
    id: string;
    name: string;
    isPrimary: boolean;
    aiModel: string | null;
    /** Present when this AI configuration is also published as an Intelligent Attendant. */
    systemAgentId: string | null;
    systemAgentName: string | null;
    systemAgentAvatarUrl: string | null;
    canTakeOverConversation: boolean;
};

type CopilotChatRow = {
    id: string;
    workspace_id: string;
    status: string;
    is_autopilot_active: boolean | null;
    autopilot_config_id: string | null;
    assigned_system_agent_id: string | null;
    copilot_mode: string | null;
};

async function getSessionUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

async function loadCopilotChat(chatId: string): Promise<CopilotChatRow | null> {
    const { rows } = await db.query<CopilotChatRow>(
        `SELECT id, workspace_id, status, is_autopilot_active, autopilot_config_id, assigned_system_agent_id, copilot_mode
           FROM chats
          WHERE id = $1
          LIMIT 1`,
        [chatId],
    );
    return rows[0] || null;
}

/**
 * AI agents an operator can pick from inside a conversation, plus whether each one
 * can take the conversation over completely (only published Intelligent Attendants can).
 */
export async function listInboxAiAgents(workspaceId: string): Promise<{
    agents: InboxAiAgent[];
    error?: string;
}> {
    const userId = await getSessionUserId();
    const access = await requireWorkspaceAccess(userId, workspaceId);
    if (!access.ok) return { agents: [], error: access.error };

    try {
        const { rows } = await db.query(
            `SELECT ac.id,
                    ac.name,
                    ac.is_primary,
                    ac.ai_model,
                    sa.id AS system_agent_id,
                    sa.name AS system_agent_name,
                    sa.avatar_url AS system_agent_avatar_url,
                    sa.is_active AS system_agent_active
               FROM autopilot_configs ac
               LEFT JOIN LATERAL (
                    SELECT id, name, avatar_url, is_active
                      FROM system_agents
                     WHERE workspace_id = ac.workspace_id
                       AND autopilot_config_id = ac.id
                       AND type = 'intelligent_attendant'
                     ORDER BY is_active DESC, created_at ASC
                     LIMIT 1
               ) sa ON TRUE
              WHERE ac.workspace_id = $1
                AND ac.is_active = TRUE
              ORDER BY ac.is_primary DESC, ac.name ASC`,
            [workspaceId],
        );

        return {
            agents: rows.map((row: any) => ({
                id: row.id,
                name: row.name || 'Agente de IA',
                isPrimary: Boolean(row.is_primary),
                aiModel: row.ai_model || null,
                systemAgentId: row.system_agent_id || null,
                systemAgentName: row.system_agent_name || null,
                systemAgentAvatarUrl: row.system_agent_avatar_url || null,
                canTakeOverConversation: Boolean(row.system_agent_id) && row.system_agent_active !== false,
            })),
        };
    } catch (error) {
        console.error('[COPILOT] Failed to list inbox AI agents:', error);
        return { agents: [], error: 'Não foi possível carregar os agentes de IA.' };
    }
}

/**
 * Runs the autopilot orchestrator for the last customer message of a chat.
 * The reply comes back through the `ai_suggestion` realtime event.
 */
export async function requestCopilotSuggestion(chatId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    const userId = await getSessionUserId();
    const access = await requireChatAccess(userId, chatId);
    if (!access.ok) return { success: false, error: access.error };

    const chat = await loadCopilotChat(chatId);
    if (chat?.status === 'encerrados') {
        return { success: false, error: 'Nao e possivel usar o copiloto em uma conversa encerrada.' };
    }
    if (!chat) return { success: false, error: 'Conversa não encontrada.' };
    if (!chat.is_autopilot_active || !chat.autopilot_config_id || chat.copilot_mode !== 'suggest' || chat.assigned_system_agent_id) {
        return { success: false, error: 'Ative o copiloto nesta conversa antes de pedir uma sugestão.' };
    }

    const { rows } = await db.query(
        `SELECT id, COALESCE(NULLIF(transcription, ''), content, '') AS content, instance_name
           FROM messages
          WHERE chat_id = $1
            AND from_me = FALSE
            AND workspace_id = $2
            AND COALESCE(type, '') <> 'system'
            AND COALESCE(metadata->>'isInternalNote', 'false') <> 'true'
            AND LOWER(COALESCE(api_message_status, '')) NOT IN ('internal', 'failed', 'error')
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [chatId, chat.workspace_id],
    );
    const lastInbound = rows[0];
    if (!lastInbound) {
        return { success: false, error: 'Ainda não há mensagem do cliente para o copiloto analisar.' };
    }

    try {
        await queueAutopilotTurn({
            workspaceId: chat.workspace_id,
            chat,
            messageId: lastInbound.id,
            content: lastInbound.content,
            instanceName: lastInbound.instance_name || 'N/A',
        });
        return { success: true };
    } catch (error) {
        console.error('[COPILOT] Failed to request suggestion:', error);
        return { success: false, error: 'Não foi possível gerar a sugestão agora.' };
    }
}

async function queueAutopilotTurn(input: {
    workspaceId: string;
    chat: CopilotChatRow;
    messageId: string;
    content: string;
    instanceName: string;
}): Promise<void> {
    if (shouldEnqueueJob('ai_autopilot_process')) {
        await enqueueAiAutopilotProcess({
            workspaceId: input.workspaceId,
            chatId: input.chat.id,
            messageId: input.messageId,
            lastMessageContent: input.content,
            instanceName: input.instanceName,
            suggestionRequest: { agentId: input.chat.autopilot_config_id! },
        });
        return;
    }

    const { processAutopilotForChat } = await import('@/services/autopilot-service');
    await processAutopilotForChat(
        input.workspaceId,
        {
            id: input.chat.id,
            workspace_id: input.workspaceId,
            status: input.chat.status,
            assigned_system_agent_id: input.chat.assigned_system_agent_id,
            is_autopilot_active: true,
            autopilot_config_id: input.chat.autopilot_config_id,
            copilot_mode: 'suggest',
            messages: [],
            contact: {} as Contact,
        } as Chat,
        input.content,
        input.instanceName,
        input.messageId,
        { agentId: input.chat.autopilot_config_id! },
    );
}

/**
 * Turns the copilot on for a conversation and immediately drafts a reply for the
 * customer message that is waiting, so the operator sees value on the first click.
 */
export async function activateChatCopilot(chatId: string, agentId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    const userId = await getSessionUserId();
    const access = await requireChatAccess(userId, chatId);
    if (!access.ok) return { success: false, error: access.error };

    const chat = await loadCopilotChat(chatId);
    if (!chat) return { success: false, error: 'Conversa não encontrada.' };

    if (chat.assigned_system_agent_id) {
        return { success: false, error: 'Assuma o atendimento antes de ativar o copiloto.' };
    }

    if (chat?.status === 'encerrados') {
        return { success: false, error: 'Nao e possivel ativar o copiloto em uma conversa encerrada.' };
    }

    const agent = await db.query(
        `SELECT id FROM autopilot_configs
          WHERE id = $1 AND workspace_id = $2 AND is_active = TRUE
          LIMIT 1`,
        [agentId, chat.workspace_id],
    );
    if (!agent.rowCount) {
        return { success: false, error: 'Agente de IA indisponível neste workspace.' };
    }

    try {
        const updateResult = await db.query(
            `UPDATE chats
                SET is_autopilot_active = TRUE,
                    autopilot_config_id = $1,
                    copilot_mode = 'suggest',
                    updated_at = clock_timestamp()
              WHERE id = $2
                AND workspace_id = $3
                AND assigned_system_agent_id IS NULL
                AND status <> 'encerrados'`,
            [agentId, chatId, chat.workspace_id],
        );
        if (updateResult.rowCount === 0) {
            return { success: false, error: 'Nao e possivel ativar o copiloto em uma conversa encerrada.' };
        }
        await discardPendingCopilotSuggestions(chatId);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('[COPILOT] Failed to activate copilot:', error);
        return { success: false, error: 'Falha ao ativar o copiloto.' };
    }

    // Best effort: activation must not fail because there is nothing to draft yet.
    await requestCopilotSuggestion(chatId).catch(() => undefined);
    return { success: true };
}

export async function deactivateChatCopilot(chatId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    const userId = await getSessionUserId();
    const access = await requireChatAccess(userId, chatId);
    if (!access.ok) return { success: false, error: access.error };

    try {
        await db.query(
            `UPDATE chats
                SET is_autopilot_active = FALSE,
                    copilot_mode = 'off',
                    updated_at = clock_timestamp()
              WHERE id = $1 AND copilot_mode = 'suggest' AND assigned_system_agent_id IS NULL`,
            [chatId],
        );
        await discardPendingCopilotSuggestions(chatId);
        revalidatePath('/', 'layout');
        return { success: true };
    } catch (error) {
        console.error('[COPILOT] Failed to deactivate copilot:', error);
        return { success: false, error: 'Falha ao desativar o copiloto.' };
    }
}

export async function getPendingCopilotSuggestion(chatId: string): Promise<{
    suggestion: CopilotSuggestion | null;
    error?: string;
}> {
    const userId = await getSessionUserId();
    const access = await requireChatAccess(userId, chatId);
    if (!access.ok) return { suggestion: null, error: access.error };

    const chat = await loadCopilotChat(chatId);
    if (!chat) return { suggestion: null, error: 'Conversa não encontrada.' };

    const suggestion = await getPendingCopilotSuggestionForChat({
        chatId,
        workspaceId: chat.workspace_id,
    });
    return { suggestion };
}

/**
 * Records what the operator did with the draft. Feeds the acceptance rate that tells
 * whether this agent is actually good at this conversation.
 */
export async function resolveCopilotSuggestionAction(input: {
    chatId: string;
    suggestionId?: string | null;
    outcome: 'sent' | 'edited' | 'dismissed';
}): Promise<{ success: boolean; error?: string }> {
    const userId = await getSessionUserId();
    const access = await requireChatAccess(userId, input.chatId);
    if (!access.ok) return { success: false, error: access.error };

    const chat = await loadCopilotChat(input.chatId);
    if (!chat) return { success: false, error: 'Conversa não encontrada.' };

    await resolveCopilotSuggestion({
        chatId: input.chatId,
        workspaceId: chat.workspace_id,
        status: input.outcome,
        suggestionId: input.suggestionId ?? null,
        userId,
    });
    return { success: true };
}
