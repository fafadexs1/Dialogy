'use server';

import { db } from '@/lib/db';
import { syncLegacyChatQueueTag } from '@/services/chat/chat-tag-routing-compat';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { User, Workspace, Chat, Message, MessageSender, Contact, SystemAgent, MessageMetadata, Tag } from '@/lib/types';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { sendAutomatedMessageAction } from './messages';
import { logAction, withDebug } from '@/lib/observability/logger';
import { buildChatProtocol, formatMessageDate } from '@/lib/utils';
import { buildChatTeamLateralSql } from '@/lib/chat-team-resolution';
import {
    INBOX_CHAT_PAGE_SIZE,
    type InboxListFilters,
    type InboxPaginationPage,
    type InboxStatusPagination,
    type InboxTabCounts,
} from '@/lib/inbox-pagination';
import { randomUUID } from 'crypto';
import { consumeRateLimit } from '@/lib/ratelimit';
import { assignChatSchema, closeChatSchema, transferChatSchema } from '@/lib/validation/chat-schemas';
import { reportServerError } from '@/lib/observability/errors';
import { getWorkspaceTemplates, getWorkspaceTimezone } from '@/lib/workspace-config';
import { touchUserPresenceActivity } from '@/lib/presence-server';
import { dedupeActiveWhatsappChatsByIdentity } from '@/lib/whatsapp/chat-dedupe';
import { scopeMessagesToChatThread } from '@/lib/chat-thread-messages';
import { mergeEquivalentContacts } from '@/lib/whatsapp/contact-thread';
import { enqueueAiAutopilotProcess, enqueueAiCaseMemoryRefresh, shouldEnqueueJob } from '@/lib/queue';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';
import { requireChatAccess, requireWorkspaceAccess } from '@/server/inbox/access';
import { loadContactThreadContext } from '@/server/inbox/contact-thread-service';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { recordDecisionOutcomesForChat } from '@/services/autopilot/outcome-tracker';
import { hasWorkspacePermission as hasPermission } from '@/lib/workspace-permissions';
import { selectFairAgentForTeam } from '@/services/chat-distribution/fair-distribution';
import {
    describeTeamUnavailability,
    evaluateTeamBusinessHours,
    type TeamAvailabilityReason,
} from '@/services/chat-distribution/team-availability';
import {
    isTrustedActorContext,
    isTrustedUserContext,
    type TrustedActorContext,
    type TrustedUserContext,
} from '@/lib/security/trusted-server-context';
import { scheduleDialogyNexusInternalEvent } from '@/modules/nexus/services/dialogy-event-scheduler';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

type NexusEventCausation = {
    eventChain?: string[];
    causedByExecutionId?: string;
    causedByNodeId?: string;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(errorMessage));
        }, timeoutMs);

        promise
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
    });
}

/**
 * Atribui o chat atual ao agente logado.
 * Esta ação é chamada pelo botão "Assumir Atendimento".
 */
export const assignChatToSelfAction = withDebug(
    'assign_chat_self',
    async function assignChatToSelfAction(chatId: string): Promise<{ success: boolean, error?: string, chat?: Chat }> {
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
            const chatAccess = await requireChatAccess(currentAgentId, chatId);
            if (!chatAccess.ok) {
                return { success: false, error: chatAccess.error };
            }

            // Corrected query: Allow taking ownership as long as the chat is in the 'gerais' (general) queue,
            // regardless of whether agent_id was previously filled.
            const result = await db.query(
                `UPDATE chats
                 SET agent_id = $1,
                     assigned_system_agent_id = NULL,
                     is_autopilot_active = FALSE,
                     copilot_mode = 'off',
                     status = 'atendimentos',
                     assigned_at = clock_timestamp(),
                     updated_at = clock_timestamp(),
                     -- Quem assume da fila so herda a equipe se pertencer a ela.
                     team_id = CASE
                         WHEN chats.team_id IS NOT NULL AND EXISTS (
                             SELECT 1 FROM team_members tm
                             WHERE tm.team_id = chats.team_id
                               AND tm.user_id = $1
                         ) THEN chats.team_id
                         ELSE NULL
                     END
                 WHERE id = $2 AND status = 'gerais'
                 RETURNING workspace_id`,
                [currentAgentId, chatId]
            );

            if (result.rowCount === 0) {
                // This can happen if another agent took the chat milliseconds before, or if the chat is not in 'gerais' status.
                return { success: false, error: "Este atendimento não está mais na fila geral ou já foi assumido." };
            }

            const workspaceId = result.rows[0].workspace_id;

            // Insert system message indicating attendance started
            const agentName = user.user_metadata?.full_name || user.email || 'Agente';
            const assignmentMessage = await db.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, 
                    sender_user_id, created_at, is_read
                ) VALUES ($1, $2, 'system', $3, true, $4, clock_timestamp(), true)
                RETURNING id, created_at`,
                [workspaceId, chatId, `Atendimento iniciado por ${agentName}.`, currentAgentId]
            );

            await touchUserPresenceActivity(currentAgentId, workspaceId, null, 'assign_chat');
            await broadcastHydratedChatUpdate(workspaceId, chatId);
            if (assignmentMessage.rows[0]?.id) {
                scheduleDialogyNexusInternalEvent({
                    workspaceId,
                    eventName: 'chat.assigned',
                    eventId: String(assignmentMessage.rows[0].id),
                    chatId,
                    sessionId: chatId,
                    conversationId: chatId,
                    payload: {
                        chatId,
                        assignedAgentId: currentAgentId,
                        assignedAgentName: agentName,
                        assignedAt: assignmentMessage.rows[0].created_at,
                        assignmentType: 'self',
                    },
                });
            }
            console.log(`[ASSIGN_CHAT_SELF] Chat ${chatId} atribuído ao agente ${currentAgentId}.`);

            // Fetch updated chat with full details (tags, colors) to return to frontend
            // This ensures the UI updates immediately with correct colors
            const updatedRows = await fetchChats({
                workspaceId,
                userId: currentAgentId,
                limit: 1,
                includeChatId: chatId,
                ownership: 'everyone',
                statuses: []
            });

            let updatedChat: Chat | undefined;
            if (updatedRows.length > 0) {
                const timezone = await getWorkspaceTimezone(workspaceId);
                const { chats } = await hydrateChats(updatedRows, timezone);
                updatedChat = chats[0];
            }

            // revalidatePath('/', 'layout'); // Removed to prevent page refresh
            return { success: true, chat: updatedChat };
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
        input: { chatId: string; teamId?: string; agentId?: string; nexusEventContext?: NexusEventCausation; handoffSummary?: string },
        trustedContext?: TrustedActorContext
    ): Promise<{
        success: boolean;
        error?: string;
        /**
         * Motivo legível por máquina quando a transferência falha por
         * indisponibilidade. Os chamadores devem ramificar por aqui — comparar
         * o texto de `error` foi o que fez o atendente de IA anunciar "fora do
         * expediente" para clientes quando a causa real era outra.
         */
        reasonCode?: TeamAvailabilityReason;
        chat?: Chat;
        assignedAgent?: { id: string; name: string };
    }> {
        const trustedCall = isTrustedActorContext(trustedContext);
        let sessionToUse: {
            user: { id: string; name?: string | null; email?: string | null };
            isSystemAgent?: boolean;
        } | undefined = trustedCall ? trustedContext : undefined;

        if (!sessionToUse) {
            const supabase = await createClient();
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

        const { chatId, teamId, agentId, nexusEventContext } = input;

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
                assigned_system_agent_id AS current_system_agent_id,
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
            FOR UPDATE OF c
        `, [chatId]);
            if (chatRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Conversa não encontrada." };
            }
            const { workspace_id: workspaceId, current_chat_agent_id, current_system_agent_id, status, last_instance_name: lastInstanceName } = chatRes.rows[0];

            if (status === 'encerrados') {
                await client.query('ROLLBACK');
                return { success: false, error: "Não é possível transferir um atendimento que já foi encerrado." };
            }

            if (trustedCall && isSystemAgent) {
                const actorAccess = await client.query(
                    `SELECT 1 FROM system_agents
                     WHERE id = $1 AND workspace_id = $2 AND is_active = TRUE
                     LIMIT 1`,
                    [currentAgentId, workspaceId]
                );
                if ((actorAccess.rowCount ?? 0) === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: 'Agente do sistema não autorizado para este workspace.' };
                }
            } else if (!trustedCall) {
                if (!await hasPermission(currentAgentId, workspaceId, 'teams:view')) { // Permission to be defined
                    await client.query('ROLLBACK');
                    return { success: false, error: "Você não tem permissão para transferir atendimentos." };
                }
            }


            let finalAgentId = agentId;
            let transferTargetName = '';
            let transferActorName = currentAgentName;
            let transferActorAvatarUrl: string | null = null;
            let automaticTeamTag: string | null = null;
            let automaticTeamTagColor: string | null = null;

            if (isSystemAgent) {
                const actorRes = await client.query(
                    'SELECT name, avatar_url FROM system_agents WHERE id = $1 AND workspace_id = $2',
                    [currentAgentId, workspaceId]
                );
                transferActorName = actorRes.rows[0]?.name || currentAgentName;
                transferActorAvatarUrl = actorRes.rows[0]?.avatar_url || null;
            } else {
                const actorRes = await client.query('SELECT full_name, avatar_url FROM users WHERE id = $1', [currentAgentId]);
                transferActorName = actorRes.rows[0]?.full_name || currentAgentName;
                transferActorAvatarUrl = actorRes.rows[0]?.avatar_url || null;
            }

            // Load balancing logic for team transfer
            if (teamId) {
                // --- Active Business Hours & Exceptions Validation ---
                const teamStatusRes = await client.query(
                    `SELECT t.id, t.name, w.timezone,
                            team_tag.label AS automatic_tag_label,
                            team_tag.color AS automatic_tag_color,
                            COALESCE(json_agg(bh.*) FILTER (WHERE bh.id IS NOT NULL), '[]') as "businessHours",
                            COALESCE(json_agg(se.*) FILTER (WHERE se.id IS NOT NULL), '[]') as "scheduleExceptions"
                     FROM teams t
                     JOIN workspaces w ON t.workspace_id = w.id
                     LEFT JOIN tags team_tag ON team_tag.id = t.tag_id AND team_tag.workspace_id = t.workspace_id
                     LEFT JOIN business_hours bh ON t.id = bh.team_id
                     LEFT JOIN schedule_exceptions se
                       ON t.id = se.team_id
                      AND se.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
                     WHERE t.id = $1 AND t.workspace_id = $2
                     GROUP BY t.id, w.timezone, team_tag.label, team_tag.color`,
                    [teamId, workspaceId]
                );

                const teamRow = teamStatusRes.rows[0];
                const teamName: string | null = teamRow?.name || null;

                if (teamRow) {
                    automaticTeamTag = teamRow.automatic_tag_label || null;
                    automaticTeamTagColor = teamRow.automatic_tag_color || null;

                    const schedule = evaluateTeamBusinessHours({
                        businessHours: teamRow.businessHours,
                        scheduleExceptions: teamRow.scheduleExceptions,
                        timezone: teamRow.timezone,
                    });

                    if (!schedule.isOpen) {
                        console.log(
                            `[TRANSFER_CHAT] Setor ${teamRow.name} fora do expediente (${schedule.verdict}) em ${schedule.currentDayOfWeek} ${schedule.currentTime}.`
                        );
                        await client.query('ROLLBACK');
                        return {
                            success: false,
                            reasonCode: 'outside_business_hours',
                            error: describeTeamUnavailability('outside_business_hours', teamRow.name),
                        };
                    }
                }

                console.log(`[TRANSFER_CHAT] Transferindo para equipe ${teamId}. Buscando agente por carga efetiva e justiça...`);
                console.log('[TRANSFER_CHAT] Params:', teamId, currentAgentId);
                const distribution = await selectFairAgentForTeam(client, {
                    workspaceId,
                    teamId,
                    chatId,
                    source: isSystemAgent ? 'system_agent_team_transfer' : 'human_team_transfer',
                    excludeAgentId: isSystemAgent ? null : currentAgentId,
                });

                const selectedAgent = distribution.selection;
                if (!selectedAgent) {
                    console.log(`[TRANSFER_CHAT] Equipe ${teamId} sem agente elegível: ${distribution.reason}.`);
                    await client.query('ROLLBACK');
                    return {
                        success: false,
                        reasonCode: distribution.reason,
                        error: describeTeamUnavailability(distribution.reason, teamName),
                    };
                }
                finalAgentId = selectedAgent.agentId;
                transferTargetName = selectedAgent.teamName;
                console.log('[TRANSFER_CHAT] Agente selecionado pelo balanceador justo.', {
                    teamId,
                    finalAgentId,
                    effectiveLoad: selectedAgent.effectiveLoad,
                    occupancy: selectedAgent.occupancy,
                    portfolioCount: selectedAgent.portfolioCount,
                    fairnessScoreBefore: selectedAgent.fairnessScoreBefore,
                    overflow: selectedAgent.overflow,
                });
            } else if (agentId) {
                const agentRes = await client.query(
                    `SELECT u.full_name
                     FROM users u
                     WHERE u.id = $1
                       AND (
                         EXISTS (
                           SELECT 1
                           FROM user_workspace_roles uwr
                           WHERE uwr.user_id = u.id AND uwr.workspace_id = $2
                         )
                         OR EXISTS (
                           SELECT 1
                           FROM team_members tm
                           JOIN teams t ON t.id = tm.team_id
                           WHERE tm.user_id = u.id AND t.workspace_id = $2
                         )
                       )`,
                    [agentId, workspaceId]
                );
                if (agentRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: "Agente de destino não encontrado neste workspace." };
                }
                transferTargetName = agentRes.rows[0].full_name;
            }

            if (!finalAgentId) {
                await client.query('ROLLBACK');
                return { success: false, error: "Não foi possível determinar um agente para a transferência." };
            }

            const isFirstAssignment = !current_chat_agent_id && !current_system_agent_id;
            const isActualTransfer = !!current_chat_agent_id && current_chat_agent_id !== finalAgentId;
            const isHumanTakingFromAi = !!current_system_agent_id && !current_chat_agent_id;

            // Update chat with the new agent and status
            await client.query(`
            UPDATE chats
            SET
                agent_id = $1,
                assigned_system_agent_id = NULL,
                is_autopilot_active = FALSE,
                copilot_mode = 'off',
                status = 'atendimentos',
                assigned_at = clock_timestamp(),
                updated_at = clock_timestamp(),
                tag = COALESCE($3, tag),
                color = COALESCE($4, color),
                -- A equipe vira um fato gravado. Numa atribuicao direta a um
                -- agente, a equipe atual so continua valendo se ele pertencer a
                -- ela; caso contrario zera, e a etiqueta deixa de mostrar uma
                -- equipe a qual o responsavel nao pertence.
                team_id = CASE
                    WHEN $5::uuid IS NOT NULL THEN $5::uuid
                    WHEN chats.team_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM team_members tm
                        WHERE tm.team_id = chats.team_id
                          AND tm.user_id = $1
                    ) THEN chats.team_id
                    ELSE NULL
                END
            WHERE id = $2
        `, [finalAgentId, chatId, automaticTeamTag, automaticTeamTagColor, teamId ?? null]);

            // Log system message
            const systemMessageContent = isHumanTakingFromAi ? `Atendimento reassumido por ${transferTargetName}.` : !isFirstAssignment
                ? `Atendimento transferido por ${transferActorName} para ${transferTargetName}.`
                : `Atendimento atribuído a ${transferTargetName} por ${transferActorName}.`;

            // A deterministic server-side flow may attach its confirmed contract/context.
            // This is an internal system entry, never an outbound customer message.
            const handoffSummary = trustedCall ? String(input.handoffSummary || '').trim().slice(0, 2000) : '';
            const transferMessage = await client.query(`
            INSERT INTO messages (workspace_id, chat_id, type, content, metadata, created_at)
            VALUES ($1, $2, 'system', $3, $4, clock_timestamp())
            RETURNING id, created_at
        `, [
                workspaceId,
                chatId,
                handoffSummary ? `${systemMessageContent}\n${handoffSummary}` : systemMessageContent,
                {
                    event: 'transfer',
                    ...(handoffSummary ? { handoff_summary: handoffSummary } : {}),
                    previous_system_agent_id: current_system_agent_id || null,
                    autopilot_disabled: true,
                    from_agent_id: currentAgentId,
                    from_agent_name: transferActorName,
                    from_agent_avatar_url: transferActorAvatarUrl,
                    to_agent_id: finalAgentId,
                    to_team_id: teamId,
                    to_name: transferTargetName,
                    nexus_event_chain: nexusEventContext?.eventChain,
                    nexus_caused_by_execution_id: nexusEventContext?.causedByExecutionId,
                    nexus_caused_by_node_id: nexusEventContext?.causedByNodeId,
                }
            ]);

            await client.query('COMMIT');
            await broadcastHydratedChatUpdate(workspaceId, chatId);
            if (transferMessage.rows[0]?.id) {
                scheduleDialogyNexusInternalEvent({
                    workspaceId,
                    eventName: isFirstAssignment ? 'chat.assigned' : 'chat.transferred',
                    eventId: String(transferMessage.rows[0].id),
                    chatId,
                    sessionId: chatId,
                    conversationId: chatId,
                    instanceName: lastInstanceName || undefined,
                    eventChain: nexusEventContext?.eventChain,
                    context: {
                        causedByExecutionId: nexusEventContext?.causedByExecutionId,
                        causedByNodeId: nexusEventContext?.causedByNodeId,
                    },
                    payload: {
                        chatId,
                        previousAgentId: current_chat_agent_id || null,
                        previousSystemAgentId: current_system_agent_id || null,
                        assignedAgentId: finalAgentId,
                        assignedTeamId: teamId || null,
                        assignedName: transferTargetName,
                        actorId: currentAgentId,
                        actorName: transferActorName,
                        transferredAt: transferMessage.rows[0].created_at,
                        firstAssignment: isFirstAssignment,
                    },
                });
            }
            const updatedChat = await fetchHydratedChatForImmediateReturn(
                workspaceId,
                currentAgentId,
                chatId,
            );
            if (!isSystemAgent) {
                await touchUserPresenceActivity(currentAgentId, workspaceId, null, 'transfer_chat');
            }
            console.log(`[TRANSFER_CHAT] Chat ${chatId} transferido com sucesso para o agente ${finalAgentId}.`);
            if (isActualTransfer) {
                // Run template notice asynchronously so transfer UX stays snappy.
                (async () => {
                    try {
                        const { transferTeamMessageTemplate } = await getWorkspaceTemplates(workspaceId);
                        const transferTemplate = transferTeamMessageTemplate || undefined;
                        if (!transferTemplate) return;

                        const appliedTemplate = transferTemplate.replace(/{{\s*dest\s*}}/gi, transferTargetName || 'novo atendente');
                        await sendAutomatedMessageAction(chatId, appliedTemplate, currentAgentId, isSystemAgent, lastInstanceName || undefined, {
                            event: 'transfer_notice',
                            to_agent_id: finalAgentId,
                            to_team_id: teamId,
                            to_name: transferTargetName,
                            authored_by: currentAgentId,
                            authored_by_name: transferActorName,
                            authored_by_avatar_url: transferActorAvatarUrl || undefined,
                            template_applied: true,
                        });
                    } catch (templateErr) {
                        console.error('[TRANSFER_CHAT] Falha ao enviar mensagem de transferncia:', templateErr);
                    }
                })();
            }

            return {
                success: true,
                chat: updatedChat,
                assignedAgent: { id: finalAgentId, name: transferTargetName },
            };

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

export const transferChatToIntelligentAgentAction = withDebug(
    'transfer_chat_to_intelligent_agent',
    async function transferChatToIntelligentAgentAction(
        input: {
            chatId: string;
            systemAgentId: string;
            nexusEventContext?: NexusEventCausation;
        },
        trustedContext?: TrustedActorContext
    ): Promise<{ success: boolean; error?: string; chat?: Chat }> {
        const trustedCall = isTrustedActorContext(trustedContext);
        let sessionToUse: {
            user: { id: string; name?: string | null; email?: string | null };
            isSystemAgent?: boolean;
        } | undefined = trustedCall ? trustedContext : undefined;

        if (!sessionToUse) {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                sessionToUse = { user: { id: user.id, name: user.user_metadata.full_name || user.email || 'Agente', email: user.email } };
            }
        }

        if (!sessionToUse?.user?.id || !sessionToUse?.user?.name) {
            return { success: false, error: "Usuário não autenticado." };
        }

        const { chatId, systemAgentId, nexusEventContext } = input;
        if (!chatId || !systemAgentId) {
            return { success: false, error: "Chat e Atendente Inteligente são obrigatórios." };
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const chatRes = await client.query(
                `SELECT workspace_id, status, contact_id
                 FROM chats
                 WHERE id = $1
                 FOR UPDATE`,
                [chatId]
            );
            if ((chatRes.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Conversa não encontrada." };
            }

            const chat = chatRes.rows[0];
            if (chat.status === 'encerrados') {
                await client.query('ROLLBACK');
                return { success: false, error: "Não é possível transferir um atendimento encerrado para IA." };
            }

            const workspaceId = chat.workspace_id;
            if (trustedCall && trustedContext.isSystemAgent) {
                const actorRes = await client.query(
                    `SELECT 1 FROM system_agents
                     WHERE id = $1 AND workspace_id = $2 AND is_active = TRUE
                     LIMIT 1`,
                    [sessionToUse.user.id, workspaceId]
                );
                if ((actorRes.rowCount ?? 0) === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: "Agente do sistema não autorizado para este workspace." };
                }
            }
            if (!trustedCall && !await hasPermission(sessionToUse.user.id, workspaceId, 'teams:view')) {
                await client.query('ROLLBACK');
                return { success: false, error: "Você não tem permissão para transferir atendimentos." };
            }

            const agentRes = await client.query(
                `SELECT sa.id, sa.name, sa.autopilot_config_id, sa.is_active, ac.is_active AS autopilot_is_active
                 FROM system_agents sa
                 LEFT JOIN autopilot_configs ac ON ac.id = sa.autopilot_config_id
                 WHERE sa.id = $1
                   AND sa.workspace_id = $2
                   AND sa.type = 'intelligent_attendant'
                 LIMIT 1`,
                [systemAgentId, workspaceId]
            );
            if ((agentRes.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Atendente Inteligente não encontrado neste workspace." };
            }

            const intelligentAgent = agentRes.rows[0];
            if (!intelligentAgent.is_active) {
                await client.query('ROLLBACK');
                return { success: false, error: "Este Atendente Inteligente está inativo." };
            }
            if (!intelligentAgent.autopilot_config_id) {
                await client.query('ROLLBACK');
                return { success: false, error: "Este Atendente Inteligente não possui uma configuração de IA vinculada." };
            }
            if (!intelligentAgent.autopilot_is_active) {
                await client.query('ROLLBACK');
                return { success: false, error: "A configuração de IA vinculada está pausada." };
            }

            await client.query(
                `UPDATE chats
                 SET assigned_system_agent_id = $1,
                     agent_id = NULL,
                     is_autopilot_active = TRUE,
                     autopilot_config_id = $2,
                     copilot_mode = 'auto',
                     status = 'atendimentos',
                     assigned_at = clock_timestamp(),
                     updated_at = clock_timestamp(),
                     -- A equipe do atendente inteligente vira a equipe do chat.
                     -- Antes so o broadcast em tempo real conhecia esse vinculo,
                     -- e a consulta de listagem nao — a etiqueta trocava a cada
                     -- refetch.
                     team_id = (SELECT sa.team_id FROM system_agents sa WHERE sa.id = $1)
                 WHERE id = $3`,
                [systemAgentId, intelligentAgent.autopilot_config_id, chatId]
            );

            const transferMessage = await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, is_read, sender_system_agent_id, metadata, created_at
                 ) VALUES ($1, $2, 'system', $3, true, true, $4, $5, clock_timestamp())
                 RETURNING id, created_at`,
                [
                    workspaceId,
                    chatId,
                    `Atendimento transferido para ${intelligentAgent.name}.`,
                    systemAgentId,
                    {
                        event: 'transfer_to_intelligent_attendant',
                        from_actor_id: sessionToUse.user.id,
                        from_actor_type: trustedCall && trustedContext.isSystemAgent ? 'system_agent' : 'user',
                        to_system_agent_id: systemAgentId,
                        autopilot_config_id: intelligentAgent.autopilot_config_id,
                        nexus_event_chain: nexusEventContext?.eventChain,
                        nexus_caused_by_execution_id: nexusEventContext?.causedByExecutionId,
                        nexus_caused_by_node_id: nexusEventContext?.causedByNodeId,
                    },
                ]
            );

            await client.query('COMMIT');
            await broadcastHydratedChatUpdate(workspaceId, chatId);
            if (transferMessage.rows[0]?.id) {
                scheduleDialogyNexusInternalEvent({
                    workspaceId,
                    eventName: 'chat.transferred',
                    eventId: String(transferMessage.rows[0].id),
                    chatId,
                    sessionId: chatId,
                    conversationId: chatId,
                    eventChain: nexusEventContext?.eventChain,
                    context: {
                        causedByExecutionId: nexusEventContext?.causedByExecutionId,
                        causedByNodeId: nexusEventContext?.causedByNodeId,
                    },
                    payload: {
                        chatId,
                        assignedSystemAgentId: systemAgentId,
                        assignedSystemAgentName: intelligentAgent.name,
                        autopilotConfigId: intelligentAgent.autopilot_config_id,
                        actorId: sessionToUse.user.id,
                        actorType: trustedCall && trustedContext.isSystemAgent ? 'system_agent' : 'user',
                        transferredAt: transferMessage.rows[0].created_at,
                    },
                });
            }
            const updatedChat = await fetchHydratedChatForImmediateReturn(
                workspaceId,
                sessionToUse.user.id,
                chatId,
            );

            try {
                const lastInboundRes = await db.query(
                    `SELECT id, content, instance_name
                     FROM messages
                     WHERE chat_id = $1
                       AND from_me = FALSE
                       AND COALESCE(content, '') <> ''
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [chatId]
                );
                const lastInbound = lastInboundRes.rows[0];
                if (lastInbound?.content) {
                    if (shouldEnqueueJob('ai_autopilot_process')) {
                        await enqueueAiAutopilotProcess({
                            workspaceId,
                            chatId,
                            messageId: lastInbound.id,
                            lastMessageContent: lastInbound.content,
                            instanceName: lastInbound.instance_name || 'N/A',
                        });
                    } else {
                        const { processAutopilotForChat } = await import('@/services/autopilot-service');
                        await processAutopilotForChat(
                            workspaceId,
                            {
                                id: chatId,
                                workspace_id: workspaceId,
                                status: 'atendimentos',
                                assigned_system_agent_id: systemAgentId,
                                is_autopilot_active: true,
                                autopilot_config_id: intelligentAgent.autopilot_config_id,
                                copilot_mode: 'auto',
                                messages: [],
                                contact: {} as Contact,
                            } as Chat,
                            lastInbound.content,
                            lastInbound.instance_name || 'N/A',
                            lastInbound.id
                        );
                    }
                }
            } catch (error) {
                console.error('[TRANSFER_TO_AI] Falha ao enfileirar resposta inicial:', error);
            }

            return { success: true, chat: updatedChat };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[TRANSFER_TO_AI] Erro ao transferir para Atendente Inteligente:', error);
            return { success: false, error: "Falha no servidor ao transferir para IA." };
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
        sendCloseMessage: boolean = true,
        additionalMetadata: Record<string, any> = {},
        trustedContext?: TrustedActorContext,
    ): Promise<{ success: boolean; error?: string }> {
        const trustedCall = isTrustedActorContext(trustedContext);
        let currentAgentId = trustedCall ? trustedContext.user.id : '';
        let currentAgentName = trustedCall ? trustedContext.user.name : '';
        const isSystemAgent = trustedCall && trustedContext.isSystemAgent;
        const nexusEventChain = Array.isArray(additionalMetadata.nexusEventChain)
            ? additionalMetadata.nexusEventChain.map(String)
            : undefined;
        const nexusCausedByExecutionId = typeof additionalMetadata.nexusCausedByExecutionId === 'string'
            ? additionalMetadata.nexusCausedByExecutionId
            : undefined;
        const nexusCausedByNodeId = typeof additionalMetadata.nexusCausedByNodeId === 'string'
            ? additionalMetadata.nexusCausedByNodeId
            : undefined;
        if (!trustedCall) {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !user.user_metadata.full_name) {
                return { success: false, error: "Usuario nao autenticado." };
            }
            currentAgentId = user.id;
            currentAgentName = user.user_metadata.full_name;
        }

        if (!chatId) {
            return { success: false, error: "ID do chat e obrigatorio." };
        }

        if (!trustedCall) {
            const chatAccess = await requireChatAccess(currentAgentId, chatId);
            if (!chatAccess.ok) {
                return { success: false, error: chatAccess.error };
            }
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

            if (isSystemAgent) {
                const actorAccess = await client.query(
                    `SELECT 1 FROM system_agents
                     WHERE id = $1 AND workspace_id = $2 AND is_active = TRUE
                     LIMIT 1`,
                    [currentAgentId, workspace_id],
                );
                if ((actorAccess.rowCount ?? 0) === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: 'Agente do sistema não autorizado para este workspace.' };
                }
            }

            const { closeMessageTemplate } = await getWorkspaceTemplates(workspace_id);
            closeTemplate = closeMessageTemplate || undefined;

            let tagInfo = { label: null as string | null, color: null as string | null };
            if (reasonTagId) {
                const tagRes = await client.query(
                    'SELECT label, color FROM tags WHERE id = $1 AND workspace_id = $2',
                    [reasonTagId, workspace_id]
                );
                if ((tagRes.rowCount ?? 0) === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: 'Motivo de encerramento invalido para este workspace.' };
                }
                tagInfo = tagRes.rows[0];
            }

            const closeUpdate = await client.query(
                `UPDATE chats
             SET 
                status = 'encerrados',
                closed_at = clock_timestamp(),
                close_reason_tag_id = $1,
                close_notes = $2,
                tag = $3,
                color = $4,
                assigned_system_agent_id = NULL,
                is_autopilot_active = FALSE,
                copilot_mode = 'off',
                assigned_at = NULL,
                updated_at = clock_timestamp()
             WHERE id = $5
             RETURNING closed_at`,
                [
                    reasonTagId,
                    notes,
                    tagInfo.label ?? current_tag ?? '',
                    tagInfo.color ?? current_color ?? '',
                    chatId
                ]
            );

            // Mantém a conversa Meta associada em estado encerrado para que
            // uma mensagem posterior não reabra o atendimento implicitamente.
            await client.query(
                `UPDATE meta_conversations 
             SET status = 'closed', updated_at = timezone('utc', now()) 
             WHERE chat_id = $1`,
                [chatId]
            );

            // Cancela quaisquer execuções de fluxo Nexus/Autopilot que estejam aguardando nesta conversa
            await client.query(
                `UPDATE public.workflow_executions
                 SET status = 'cancelled', updated_at = clock_timestamp()
                 WHERE workspace_id = $1
                   AND (conversation_id = $2 OR session_id = $2)
                   AND status IN ('waiting', 'queued')`,
                [workspace_id, chatId],
            );

            const systemMessageContent = `Atendimento encerrado por ${currentAgentName}.`;

            const closeMessage = await client.query(`
            INSERT INTO messages (workspace_id, chat_id, type, content, metadata, created_at)
            VALUES ($1, $2, 'system', $3, $4, clock_timestamp())
            RETURNING id, created_at
        `, [
                workspace_id,
                chatId,
                systemMessageContent,
                {
                    event: 'close',
                    closed_by: currentAgentId,
                    reason_tag_id: reasonTagId,
                    notes: notes,
                    ...additionalMetadata
                }
            ]);

            await client.query('COMMIT');
            await broadcastHydratedChatUpdate(workspace_id, chatId);
            if (closeMessage.rows[0]?.id) {
                scheduleDialogyNexusInternalEvent({
                    workspaceId: workspace_id,
                    eventName: 'chat.closed',
                    eventId: String(closeMessage.rows[0].id),
                    chatId,
                    sessionId: chatId,
                    conversationId: chatId,
                    instanceName: last_instance_name || undefined,
                    eventChain: nexusEventChain,
                    context: {
                        causedByExecutionId: nexusCausedByExecutionId,
                        causedByNodeId: nexusCausedByNodeId,
                    },
                    payload: {
                        chatId,
                        closedBy: currentAgentId,
                        closedByName: currentAgentName,
                        reasonTagId,
                        notes,
                        closedAt: closeUpdate.rows[0]?.closed_at || closeMessage.rows[0].created_at,
                    },
                });
            }

            try {
                const closedAtRes = await db.query('SELECT closed_at FROM chats WHERE id = $1', [chatId]);
                const closedAt = closedAtRes.rows[0]?.closed_at
                    ? new Date(closedAtRes.rows[0].closed_at).toISOString()
                    : null;

                if (shouldEnqueueJob('ai_case_memory_refresh')) {
                    await enqueueAiCaseMemoryRefresh({
                        workspaceId: workspace_id,
                        chatId,
                        closedAt,
                    });
                } else {
                    await refreshCaseMemoryForChat({
                        workspaceId: workspace_id,
                        chatId,
                        closedAt,
                    });
                }
            } catch (caseMemoryError) {
                console.error('[CLOSE_CHAT] Falha ao atualizar memoria de caso:', caseMemoryError);
            }

            try {
                const closedAtRes = await db.query('SELECT closed_at FROM chats WHERE id = $1', [chatId]);
                await recordDecisionOutcomesForChat({
                    workspaceId: workspace_id,
                    chatId,
                    trigger: 'closed',
                    closedAt: closedAtRes.rows[0]?.closed_at || null,
                });
            } catch (outcomeError) {
                console.error('[CLOSE_CHAT] Falha ao registrar outcome do ledger:', outcomeError);
            }

            if (closeTemplate && sendCloseMessage) {
                try {
                    await sendAutomatedMessageAction(chatId, closeTemplate, currentAgentId, isSystemAgent, last_instance_name || undefined, {
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
        contextResolver: (chatId, reasonTagId, notes, sendCloseMessage, additionalMetadata) => ({ payload: { chatId, reasonTagId, notes, sendCloseMessage, additionalMetadata } })
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
);

export const updateChatTagAction = withDebug(
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
            const chatAccess = await requireChatAccess(user.id, chatId);
            if (!chatAccess.ok) return { success: false, error: chatAccess.error };

            const tagRes = await db.query(
                `SELECT t.label, t.color
                 FROM tags t
                 JOIN chats c ON c.workspace_id = t.workspace_id
                 WHERE t.id = $1 AND c.id = $2`,
                [tagId, chatId]
            );
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
    }
);

export const toggleMultipleChatsAutopilotAction = withDebug(
    'toggle_multiple_chats_autopilot',
    async function toggleMultipleChatsAutopilotAction(chatIds: string[], isActive: boolean, agentId: string | null = null, mode: 'suggest' | 'auto' | 'off' = 'suggest'): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        if (!chatIds || chatIds.length === 0) {
            return { success: false, error: "Nenhum chat selecionado." };
        }

        try {
            const copilotMode = isActive ? mode : 'off';
            const accessResults = await Promise.all(chatIds.map((chatId) => requireChatAccess(user.id, chatId)));
            const denied = accessResults.find((result) => !result.ok);
            if (denied && !denied.ok) return { success: false, error: denied.error };
            
            // Execute updates in parallel
            await Promise.all(chatIds.map(async (chatId) => {
                await db.query(`
                    UPDATE chats 
                    SET is_autopilot_active = $1, 
                        autopilot_config_id = $2,
                        copilot_mode = $4
                    WHERE id = $3
                      AND ($1 = FALSE OR status <> 'encerrados')
                `, [isActive, agentId, chatId, copilotMode]);
            }));

            revalidatePath('/', 'layout');
            return { success: true };
        } catch (error: any) {
            console.error("Erro ao alternar autopilot em massa:", error);
            return { success: false, error: "Falha ao atualizar status do autopilot em massa." };
        }
    },
    {
        contextResolver: (chatIds, isActive, agentId, mode) => ({ payload: { count: chatIds?.length, isActive, agentId, mode } })
    }
);

export type InitialChatsPayload = {
    chats: Chat[];
    messages: Message[];
    selectedChatId: string | null;
    lastSyncChats: string | null;
    lastSyncMessageForSelected: string | null;
    oldestMessageDate: string | null;
    oldestMessageId: string | null;
    hasMoreHistory: boolean;
    hasMoreChats: boolean;
    timezone: string;
    inboxCounts?: InboxTabCounts;
    statusPagination?: InboxStatusPagination;
    nextCursor?: { lastActivityAt: string; id: string } | null;
    chatPagination?: {
        active: { hasMore: boolean; cursor: { lastActivityAt: string; id: string } | null };
        closed: { hasMore: boolean; cursor: { lastActivityAt: string; id: string } | null };
    };
    selectedMessageWindow?: {
        messages: Message[];
        oldestMessageDate: string | null;
        oldestMessageId: string | null;
        hasMoreHistory: boolean;
    } | null;
    error?: string;
};

type ChatRow = {
    id: string;
    status: Chat['status'];
    workspace_id: string;
    ad_source?: string | null;
    ad_campaign?: string | null;
    ad_campaign_id?: string | null;
    ad_confidence?: string | null;
    assigned_at: string | null;
    tag: string | null;
    color: string | null;
    protocol: string | null;
    contact_id: string | null;
    agent_id: string | null;
    assigned_system_agent_id: string | null;
    assigned_system_agent_name?: string | null;
    assigned_system_agent_avatar_url?: string | null;
    assigned_system_agent_type?: string | null;
    team_id: string | null;
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
    last_message_platform: string | null;
    last_message_source_from_api: string | null;
    last_message_message_id_from_api: string | null;
    last_message_api_message_status: string | null;
    last_message_is_read: boolean | null;
    last_message_sent_by_tab: string | null;
    last_message_external_message_id?: string | null;
    last_message_external_sender_id?: string | null;
    last_message_external_channel_id?: string | null;
    last_message_direction?: 'incoming' | 'outgoing' | null;
    last_message_media_url?: string | null;
    contact_custom_fields: Record<string, any> | null;
    is_autopilot_active?: boolean | null;
    autopilot_config_id?: string | null;
    copilot_mode?: 'off' | 'auto' | 'suggest' | null;
    meta_contact_external_id?: string | null;
    meta_contact_username?: string | null;
    meta_platform?: string | null;
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
    team_id?: string | null;
    team_name?: string | null;
    team_color?: string | null;
};

function buildInboxListFilterClause({
    filters,
    params,
    queryIndex,
    chatAlias = 'c',
}: {
    filters?: InboxListFilters;
    params: any[];
    queryIndex: number;
    chatAlias?: string;
}): { clause: string; nextQueryIndex: number } {
    if (!filters) return { clause: '', nextQueryIndex: queryIndex };

    const clauses: string[] = [];
    let nextQueryIndex = queryIndex;
    const assignmentFilterClause = (clause: string) => `(
        ${chatAlias}.status NOT IN ('atendimentos', 'encerrados')
        OR (${clause})
    )`;

    if (filters.queueScope === 'robo') {
        clauses.push(`NULLIF(BTRIM(${chatAlias}.tag), '') IS NULL`);
    } else if (filters.queueScope === 'fila') {
        clauses.push(`NULLIF(BTRIM(${chatAlias}.tag), '') IS NOT NULL`);
    }

    if (filters.responsibleId) {
        params.push(filters.responsibleId);
        // Responsável humano só restringe Atendendo/Encerrados. Robô e Fila
        // são escopos compartilhados; aplicar agent_id neles zera a lista.
        clauses.push(assignmentFilterClause(
            `${chatAlias}.agent_id = $${nextQueryIndex}::uuid`
        ));
        nextQueryIndex++;
    }

    if (filters.teamIds?.length) {
        params.push(filters.teamIds);
        const teamIdsParameter = `$${nextQueryIndex}::uuid[]`;
        clauses.push(assignmentFilterClause(`(
            ${chatAlias}.team_id = ANY(${teamIdsParameter})
            OR (
                ${chatAlias}.team_id IS NULL
                AND ${chatAlias}.agent_id IN (
                    SELECT ranked_legacy_team.user_id
                    FROM (
                        SELECT
                            tm.user_id,
                            tm.team_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY tm.user_id
                                ORDER BY legacy_team.name ASC, legacy_team.id ASC
                            ) AS team_rank
                        FROM team_members tm
                        JOIN teams legacy_team
                          ON legacy_team.id = tm.team_id
                         AND legacy_team.workspace_id = $1
                    ) ranked_legacy_team
                    WHERE ranked_legacy_team.team_rank = 1
                      AND ranked_legacy_team.team_id = ANY(${teamIdsParameter})
                )
            )
            OR (
                ${chatAlias}.team_id IS NULL
                AND (
                    ${chatAlias}.agent_id IS NULL
                    OR ${chatAlias}.agent_id NOT IN (
                        SELECT tm.user_id
                        FROM team_members tm
                        JOIN teams legacy_team
                          ON legacy_team.id = tm.team_id
                         AND legacy_team.workspace_id = $1
                    )
                )
                AND EXISTS (
                    SELECT 1
                    FROM teams filter_team
                    JOIN tags filter_tag
                      ON filter_tag.id = filter_team.tag_id
                     AND filter_tag.workspace_id = filter_team.workspace_id
                    WHERE filter_team.workspace_id = ${chatAlias}.workspace_id
                      AND filter_team.id = ANY(${teamIdsParameter})
                      AND filter_tag.label = ${chatAlias}.tag
                )
            )
        )`));
        nextQueryIndex++;
    }

    if (filters.onlyUnread) {
        clauses.push(assignmentFilterClause(`EXISTS (
            SELECT 1
            FROM messages unread_message
            WHERE unread_message.chat_id = ${chatAlias}.id
              AND unread_message.from_me = false
              AND COALESCE(unread_message.is_read, false) = false
        )`));
    }

    if (filters.unassignedOnly) {
        clauses.push(assignmentFilterClause(
            `${chatAlias}.agent_id IS NULL AND ${chatAlias}.assigned_system_agent_id IS NULL`
        ));
    }

    if (!filters.includeMarketing) {
        clauses.push(`(
            ${chatAlias}.status <> 'gerais'
            OR ${chatAlias}.agent_id IS NOT NULL
            OR COALESCE((
                SELECT NOT (
                    COALESCE(latest_message.metadata->>'isMarketing', 'false') = 'true'
                    OR latest_message.metadata->>'event' = 'marketing_auto_close'
                )
                FROM messages latest_message
                WHERE latest_message.chat_id = ${chatAlias}.id
                ORDER BY latest_message.created_at DESC, latest_message.id DESC
                LIMIT 1
            ), false)
        )`);
    }

    return {
        clause: clauses.length > 0 ? `AND ${clauses.map((clause) => `(${clause})`).join('\nAND ')}` : '',
        nextQueryIndex,
    };
}

async function fetchInboxTabCounts({
    workspaceId,
    userId,
    ownership,
    filters,
}: {
    workspaceId: string;
    userId: string;
    ownership: 'mine' | 'everyone';
    filters?: InboxListFilters;
}): Promise<InboxTabCounts> {
    const params: any[] = [workspaceId, userId, ownership === 'everyone'];
    const filterClause = buildInboxListFilterClause({
        filters,
        params,
        queryIndex: 4,
    });
    const { rows } = await db.query<InboxTabCounts>(
        `SELECT
            COUNT(*) FILTER (
                WHERE c.status = 'gerais'
                  AND NULLIF(BTRIM(c.tag), '') IS NULL
            )::int AS robo,
            COUNT(*) FILTER (
                WHERE c.status = 'gerais'
                  AND NULLIF(BTRIM(c.tag), '') IS NOT NULL
            )::int AS gerais,
            COUNT(*) FILTER (
                WHERE c.status = 'atendimentos'
                  AND ($3::boolean OR c.agent_id = $2)
            )::int AS atendimentos,
            COUNT(*) FILTER (
                WHERE c.status = 'encerrados'
                  AND ($3::boolean OR c.agent_id = $2)
            )::int AS encerrados
         FROM chats c
         WHERE c.workspace_id = $1
           AND c.status IN ('gerais', 'atendimentos', 'encerrados')
           ${filterClause.clause}`,
        params
    );

    return rows[0] || { robo: 0, gerais: 0, atendimentos: 0, encerrados: 0 };
}

export const loadOlderChatsAction = withDebug(
    'load_older_chats',
    async function loadOlderChatsAction(
        workspaceId: string,
        before: string,
        beforeId: string | null,
        statuses: Chat['status'][] = ['gerais', 'atendimentos'],
        ownership: 'mine' | 'everyone' = 'mine',
        filters?: InboxListFilters,
    ): Promise<{
        success: boolean;
        chats?: Chat[];
        hasMoreChats?: boolean;
        nextCursor?: { lastActivityAt: string; id: string } | null;
        error?: string;
    }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Usuário não autenticado." };
        }

        try {
            const userId = user.id;
            const access = await requireWorkspaceAccess(userId, workspaceId);
            if (!access.ok) return { success: false, error: access.error };
            const limit = INBOX_CHAT_PAGE_SIZE;

            const rows = await fetchChats({
                workspaceId,
                userId,
                limit: limit + 1,
                includeChatId: null,
                before,
                beforeId,
                ownership,
                statuses,
                filters,
            });

            if (rows.length === 0) {
                return { success: true, chats: [], hasMoreChats: false, nextCursor: null };
            }

            const pageRows = rows.slice(0, limit);
            const timezone = await getWorkspaceTimezone(workspaceId);
            const { chats } = await hydrateChats(pageRows, timezone);
            const cursorRow = pageRows.at(-1);

            return {
                success: true,
                chats,
                hasMoreChats: rows.length > limit,
                nextCursor: cursorRow?.chat_activity_at
                    ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                    : null,
            };

        } catch (error) {
            console.error("Erro ao carregar chats antigos:", error);
            reportServerError((error as Error).message, 'load_older_chats');
            return { success: false, error: "Falha ao carregar mais conversas." };
        }
    },
    {
        contextResolver: (workspaceId, before, beforeId) => ({ payload: { workspaceId, before, beforeId } })
    }
);

const MAX_CHAT_TAGS = 8;

export const toggleChatTagAction = withDebug(
    'toggle_chat_tag',
    async function toggleChatTagAction(
        chatId: string,
        tagId: string,
        selected: boolean
    ): Promise<{ success: boolean; tags?: Tag[]; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: 'Usuário não autenticado.' };
        if (!chatId || !tagId) return { success: false, error: 'Chat e etiqueta são obrigatórios.' };

        const chatAccess = await requireChatAccess(user.id, chatId);
        if (!chatAccess.ok) return { success: false, error: chatAccess.error };

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const scope = await client.query(
                `SELECT c.workspace_id
                 FROM chats c
                 JOIN tags t ON t.workspace_id = c.workspace_id
                 WHERE c.id = $1 AND t.id = $2 AND t.is_close_reason = FALSE
                 FOR UPDATE OF c`,
                [chatId, tagId]
            );
            if ((scope.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Etiqueta indisponível para este atendimento.' };
            }

            const workspaceId = scope.rows[0].workspace_id as string;
            if (selected) {
                const count = await client.query(
                    'SELECT COUNT(*)::int AS total FROM chat_tags WHERE chat_id = $1',
                    [chatId]
                );
                if (Number(count.rows[0]?.total || 0) >= MAX_CHAT_TAGS) {
                    await client.query('ROLLBACK');
                    return { success: false, error: `Use no máximo ${MAX_CHAT_TAGS} etiquetas por atendimento.` };
                }
                await client.query(
                    `INSERT INTO chat_tags (chat_id, tag_id, workspace_id, added_by)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (chat_id, tag_id) DO NOTHING`,
                    [chatId, tagId, workspaceId, user.id]
                );
            } else {
                await client.query(
                    'DELETE FROM chat_tags WHERE chat_id = $1 AND tag_id = $2 AND workspace_id = $3',
                    [chatId, tagId, workspaceId]
                );
            }

            // Inbox queue routing still reads the legacy chats.tag/color pair.
            // Keep it synchronized with the multi-tag relation until every
            // queue consumer has moved to chats.team_id/chat_tags. Without
            // this bridge, adding a classification succeeds visually but the
            // conversation remains in the Robot bucket.
            await syncLegacyChatQueueTag(client, { chatId, tagId, workspaceId });

            const tagsResult = await client.query(
                `SELECT t.id, t.label, t.value, t.color, t.is_close_reason,
                        t.team_ids, t.category, t.sort_order
                 FROM chat_tags ct
                 JOIN tags t ON t.id = ct.tag_id AND t.workspace_id = ct.workspace_id
                 JOIN chats c ON c.id = ct.chat_id AND c.workspace_id = ct.workspace_id
                 WHERE ct.chat_id = $1
                   AND NOT (
                     c.team_id IS NOT NULL
                     AND c.team_id = ANY(COALESCE(t.team_ids, ARRAY[]::uuid[]))
                   )
                 ORDER BY ct.created_at, COALESCE(t.sort_order, 2147483647), t.label`,
                [chatId]
            );
            await client.query('COMMIT');
            revalidatePath('/', 'layout');
            return { success: true, tags: tagsResult.rows as Tag[] };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[TOGGLE_CHAT_TAG] Error:', error);
            return { success: false, error: 'Falha ao atualizar as etiquetas do atendimento.' };
        } finally {
            client.release();
        }
    }
);

export const getInboxChatsSnapshotAction = withDebug(
    'get_inbox_chats_snapshot',
    async function getInboxChatsSnapshotAction({
        workspaceId,
        status,
        ownership = 'mine',
        filters,
    }: {
        workspaceId: string;
        status: Chat['status'];
        ownership?: 'mine' | 'everyone';
        filters?: InboxListFilters;
    }): Promise<{
        success: boolean;
        chats: Chat[];
        counts?: InboxTabCounts;
        pagination?: InboxPaginationPage;
        error?: string;
    }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, chats: [], error: 'Usuário não autenticado.' };
        }

        try {
            const access = await requireWorkspaceAccess(user.id, workspaceId);
            if (!access.ok) return { success: false, chats: [], error: access.error };

            const limit = INBOX_CHAT_PAGE_SIZE;
            const countFilters = filters
                ? { ...filters, queueScope: undefined }
                : undefined;
            const [rows, timezone, counts] = await Promise.all([
                fetchChats({
                    workspaceId,
                    userId: user.id,
                    limit: limit + 1,
                    includeChatId: null,
                    ownership,
                    statuses: [status],
                    filters,
                }),
                getWorkspaceTimezone(workspaceId),
                fetchInboxTabCounts({ workspaceId, userId: user.id, ownership, filters: countFilters }),
            ]);
            const pageRows = rows.slice(0, limit);
            const { chats } = await hydrateChats(pageRows, timezone);
            const cursorRow = pageRows.at(-1);

            return {
                success: true,
                chats,
                counts,
                pagination: {
                    hasMore: rows.length > limit,
                    cursor: cursorRow?.chat_activity_at
                        ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                        : null,
                },
            };
        } catch (error) {
            console.error('[GET_INBOX_CHATS_SNAPSHOT] Error:', error);
            return {
                success: false,
                chats: [],
                error: 'Falha ao aplicar os filtros da Inbox.',
            };
        }
    },
    {
        contextResolver: (input) => ({ payload: input }),
    }
);

async function fetchChats({
    workspaceId,
    userId,
    limit,
    includeChatId,
    before,
    beforeId,
    ownership = 'mine',
    statuses,
    filters,
}: {
    workspaceId: string;
    userId: string;
    limit: number;
    includeChatId: string | null;
    before?: string | null;
    beforeId?: string | null;
    ownership?: 'mine' | 'everyone';
    statuses?: Chat['status'][];
    filters?: InboxListFilters;
}): Promise<ChatRow[]> {
    const startTime = performance.now();
    const params: any[] = [workspaceId, limit];
    let queryIndex = 3;

    let beforeClause = '';
    if (before && beforeId) {
        params.push(before, beforeId);
        beforeClause = `AND (c.last_activity_at, c.id) < ($${queryIndex}::timestamptz, $${queryIndex + 1}::uuid)`;
        queryIndex += 2;
    } else if (before) {
        params.push(before);
        beforeClause = `AND c.last_activity_at < $${queryIndex}::timestamptz`;
        queryIndex += 1;
    }

    let ownershipClause = '';
    if (ownership === 'mine') {
        params.push(userId);
        // "Atribuídos a mim" requires explicit assignment only in
        // Atendendo/Encerrados. Robô/Fila remain shared.
        ownershipClause = `AND (c.status NOT IN ('atendimentos', 'encerrados') OR c.agent_id = $${queryIndex})`;
        queryIndex++;
    }

    let statusClause = "AND (c.status IN ('gerais', 'atendimentos') OR c.status = 'encerrados')";
    if (statuses && statuses.length > 0) {
        const statusPlaceholders = statuses.map((_, i) => `$${queryIndex + i}`).join(', ');
        statusClause = `AND c.status IN (${statusPlaceholders})`;
        params.push(...statuses);
        queryIndex += statuses.length;
    }

    const inboxFilterClause = buildInboxListFilterClause({
        filters,
        params,
        queryIndex,
    });
    queryIndex = inboxFilterClause.nextQueryIndex;

    let includeChatClause = '';
    if (includeChatId) {
        params.push(includeChatId);
        includeChatClause = `
        , target_chat_ids AS (
            SELECT id
            FROM chats
            WHERE workspace_id = $1 AND id = $${queryIndex}
        )`;
        queryIndex++;
    }

    const { rows } = await db.query(
        `
        WITH filtered_chats AS (
            SELECT c.id, c.last_activity_at
            FROM chats c
            WHERE c.workspace_id = $1
              ${statusClause}
              ${ownershipClause}
              ${inboxFilterClause.clause}
              ${beforeClause}
            ORDER BY c.last_activity_at DESC, c.id DESC
            LIMIT $2
        ),
        sorted_chat_ids AS (
            SELECT id FROM filtered_chats
        )
        ${includeChatClause}
        , merged_chat_ids AS (
            SELECT id FROM sorted_chat_ids
            ${includeChatId ? 'UNION SELECT id FROM target_chat_ids' : ''}
        ),
        merged_chats AS (
            SELECT c.*
            FROM chats c
            JOIN merged_chat_ids mci ON mci.id = c.id
        ),
        unread_counts AS (
            SELECT
                m.chat_id,
                COUNT(*) AS unread_count
            FROM messages m
            JOIN merged_chats c ON c.id = m.chat_id
            WHERE m.from_me = false
              AND COALESCE(m.is_read, false) = false
            GROUP BY m.chat_id
        ),
        contact_custom_fields AS (
            SELECT
                cfv.contact_id,
                json_object_agg(cfv.field_id, cfv.value) AS contact_custom_fields
            FROM contact_custom_field_values cfv
            JOIN (
                SELECT DISTINCT contact_id
                FROM merged_chats
                WHERE contact_id IS NOT NULL
            ) mc ON mc.contact_id = cfv.contact_id
            GROUP BY cfv.contact_id
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
            c.autopilot_config_id,
            c.copilot_mode,
            c.contact_id,
            c.agent_id,
            c.assigned_system_agent_id,
            c.last_activity_at AS chat_activity_at,
            COALESCE(lmd.instance_name, lci.instance_name) AS instance_name,
            COALESCE(
                lmd.source_from_api,
                lmd.platform::text,
                lci.source_from_api,
                lci.platform::text,
                mc.platform::text
            ) AS source,
            COALESCE(uc.unread_count, 0) AS unread_count,
            t.id AS team_id,
            t.name AS team_name,
            t.color AS team_color,
            channel_instance.type AS instance_type,
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
            lmd.platform AS last_message_platform,
            lmd.source_from_api AS last_message_source_from_api,
            lmd.message_id_from_api AS last_message_message_id_from_api,
            lmd.api_message_status AS last_message_api_message_status,
            lmd.is_read AS last_message_is_read,
            lmd.sent_by_tab AS last_message_sent_by_tab,
            lmd.external_message_id AS last_message_external_message_id,
            lmd.external_sender_id AS last_message_external_sender_id,
            lmd.external_channel_id AS last_message_external_channel_id,
            lmd.direction AS last_message_direction,
            lmd.media_url AS last_message_media_url,
            ccf.contact_custom_fields AS contact_custom_fields,
            COALESCE(mct.external_id, mct_from_message.external_id, CASE WHEN NULLIF(cont.phone_number_jid, '') IS NULL THEN mct_stable.external_id END) AS meta_contact_external_id,
            COALESCE(mct.username, mct_from_message.username, CASE WHEN NULLIF(cont.phone_number_jid, '') IS NULL THEN mct_stable.username END) AS meta_contact_username,
            COALESCE(mc.platform, mct_from_message.platform_type, CASE WHEN NULLIF(cont.phone_number_jid, '') IS NULL THEN mct_stable.platform_type END) AS meta_platform
        FROM merged_chats c
        LEFT JOIN LATERAL (
            SELECT
                m.id,
                m.chat_id,
                m.content,
                m.type,
                m.metadata,
                m.transcription,
                m.created_at,
                m.from_me,
                m.sender_user_id,
                m.sender_system_agent_id,
                m.instance_name,
                m.source_from_api,
                m.platform,
                m.message_id_from_api,
                m.api_message_status,
                m.is_read,
                m.sent_by_tab,
                m.external_message_id,
                m.external_sender_id,
                m.external_channel_id,
                m.direction,
                m.media_url
            FROM messages m
            WHERE m.chat_id = c.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
        ) lmd ON TRUE
        LEFT JOIN LATERAL (
            SELECT m.instance_name, m.source_from_api, m.platform
            FROM messages m
            WHERE m.chat_id = c.id
              AND m.instance_name IS NOT NULL
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
        ) lci ON TRUE
        LEFT JOIN unread_counts uc ON uc.chat_id = c.id
        LEFT JOIN contact_custom_fields ccf ON ccf.contact_id = c.contact_id
        LEFT JOIN meta_conversations mc ON mc.chat_id = c.id
        LEFT JOIN meta_contacts mct ON mct.id = mc.meta_contact_id
        LEFT JOIN contacts cont
          ON cont.id = c.contact_id
         AND cont.workspace_id = c.workspace_id
        LEFT JOIN LATERAL (
            SELECT mct2.username, mct2.external_id, mch.type as platform_type
            FROM meta_contacts mct2
            JOIN meta_channels mch ON mch.id = mct2.channel_id
            WHERE lmd.external_sender_id IS NOT NULL
              AND mct2.external_id = lmd.external_sender_id
              AND mch.workspace_id = c.workspace_id
              AND (
                lmd.external_channel_id IS NULL
                OR mch.external_page_id = lmd.external_channel_id
                OR mch.ig_business_id = lmd.external_channel_id
              )
              AND (
                lmd.platform IS NULL
                OR mch.type::text = lmd.platform::text
              )
            ORDER BY mct2.created_at DESC
            LIMIT 1
        ) mct_from_message ON true
        LEFT JOIN LATERAL (
            SELECT mct2.username, mct2.external_id, mch.type as platform_type
            FROM meta_contacts mct2
            JOIN meta_channels mch ON mch.id = mct2.channel_id
            WHERE NULLIF(cont.phone_number_jid, '') IS NULL
              AND mct2.contact_id = c.contact_id
            ORDER BY mct2.created_at DESC
            LIMIT 1
        ) mct_stable ON true
        ${buildChatTeamLateralSql({ chatAlias: 'c' })}
        LEFT JOIN LATERAL (
            SELECT type
            FROM (
                SELECT eai.type
                FROM evolution_api_instances eai
                WHERE COALESCE(lmd.instance_name, lci.instance_name) IS NOT NULL
                  AND eai.instance_name = COALESCE(lmd.instance_name, lci.instance_name)
                  AND eai.workspace_id = c.workspace_id
                UNION ALL
                SELECT 'telegram'::text AS type
                FROM telegram_bot_instances tbi
                WHERE COALESCE(lmd.instance_name, lci.instance_name) IS NOT NULL
                  AND tbi.instance_name = COALESCE(lmd.instance_name, lci.instance_name)
                  AND tbi.workspace_id = c.workspace_id
            ) instances
            LIMIT 1
        ) channel_instance ON true
        ORDER BY c.last_activity_at DESC, c.id DESC
        `,
        params
    );
    const endTime = performance.now();
    console.log(`[PERF] fetchChats took ${(endTime - startTime).toFixed(2)}ms for limit ${limit}`);
    return dedupeActiveWhatsappChatsByIdentity({
        chats: rows as ChatRow[],
        getId: (chat) => chat.id,
        getStatus: (chat) => chat.status,
        getPhoneOrJid: (chat) => chat.contact_phone_number_jid,
        preserveChatId: includeChatId,
    });
}

export const getInitialChatsData = withDebug(
    'get_initial_chats',
    async function getInitialChatsData({
        workspaceId,
        selectedChatId,
        ownership = 'mine',
        workspaceTimezone,
        pagination,
    }: {
        workspaceId: string;
        selectedChatId: string | null;
        ownership?: 'mine' | 'everyone';
        workspaceTimezone?: string | null;
        pagination?: {
            before: string;
            beforeId: string | null;
            statuses: Chat['status'][];
            limit?: number;
        };
    }, trustedContext?: TrustedUserContext): Promise<InitialChatsPayload> {
        let userId = isTrustedUserContext(trustedContext) ? trustedContext.userId : undefined;

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
                    oldestMessageId: null,
                    hasMoreHistory: false,
                    hasMoreChats: false,
                    timezone: DEFAULT_TIMEZONE,
                    error: "Usuario nao autenticado."
                };
            }

            userId = user.id;
        }

        try {
            const access = await requireWorkspaceAccess(userId, workspaceId);
            if (!access.ok) {
                return {
                    chats: [],
                    messages: [],
                    selectedChatId: null,
                    lastSyncChats: null,
                    lastSyncMessageForSelected: null,
                    oldestMessageDate: null,
                    oldestMessageId: null,
                    hasMoreHistory: false,
                    hasMoreChats: false,
                    timezone: DEFAULT_TIMEZONE,
                    error: access.error,
                };
            }

            if (pagination) {
                const limit = Math.min(Math.max(pagination.limit ?? 25, 1), 50);
                const rows = await fetchChats({
                    workspaceId,
                    userId,
                    limit,
                    includeChatId: null,
                    before: pagination.before,
                    beforeId: pagination.beforeId,
                    ownership,
                    statuses: pagination.statuses,
                });
                const timezone = workspaceTimezone || await getWorkspaceTimezone(workspaceId);
                const { chats, lastSyncChats } = await hydrateChats(rows, timezone);
                const cursorRow = rows.at(-1);
                return {
                    chats,
                    messages: [],
                    selectedChatId: null,
                    lastSyncChats,
                    lastSyncMessageForSelected: null,
                    oldestMessageDate: null,
                    oldestMessageId: null,
                    hasMoreHistory: false,
                    hasMoreChats: rows.length === limit,
                    timezone,
                    nextCursor: cursorRow?.chat_activity_at
                        ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                        : null,
                };
            }

            // Repair chats that were marked as attending without an assigned agent.
            // Fire-and-forget: don't block the main loading path.
            db.query(
                `UPDATE chats
                 SET status = 'gerais',
                     assigned_at = NULL
                 WHERE workspace_id = $1
                   AND status = 'atendimentos'
                   AND agent_id IS NULL
                   AND assigned_system_agent_id IS NULL`,
                [workspaceId]
            ).catch(err => console.error('[REPAIR_CHATS] Failed:', err));

            const activeChatsLimit = INBOX_CHAT_PAGE_SIZE;
            const timezonePromise = workspaceTimezone
                ? Promise.resolve(workspaceTimezone)
                : getWorkspaceTimezone(workspaceId);
            const activeChatRowsPromise = withTimeout(
                fetchChats({
                    workspaceId,
                    userId,
                    limit: activeChatsLimit,
                    includeChatId: selectedChatId,
                    ownership,
                    statuses: ['gerais', 'atendimentos']
                }),
                10000,
                'Timeout ao buscar chats ativos'
            );
            const inboxCountsPromise = withTimeout(
                fetchInboxTabCounts({
                    workspaceId,
                    userId,
                    ownership,
                    filters: { includeMarketing: true },
                }),
                10000,
                'Timeout ao contar chats da Inbox'
            );

            const closedChatsLimit = INBOX_CHAT_PAGE_SIZE;
            let closedChatsDegraded = false;
            const closedChatRowsWithLookaheadPromise = withTimeout(
                fetchChats({
                    workspaceId,
                    userId,
                    limit: closedChatsLimit + 1,
                    includeChatId: null,
                    ownership,
                    statuses: ['encerrados']
                }),
                4000,
                'Timeout ao buscar chats encerrados'
            ).catch((error) => {
                closedChatsDegraded = true;
                console.warn('[GET_INITIAL_CHATS] Closed chats load degraded:', error);
                return [] as ChatRow[];
            });

            const [timezone, activeChatRows, closedChatRowsWithLookahead, inboxCounts] = await Promise.all([
                timezonePromise,
                activeChatRowsPromise,
                closedChatRowsWithLookaheadPromise,
                inboxCountsPromise,
            ]);
            const closedChatRows = closedChatRowsWithLookahead.slice(0, closedChatsLimit);
            const hasMoreClosedChats = closedChatsDegraded
                || closedChatRowsWithLookahead.length > closedChatsLimit;

            const allChatRows = [...activeChatRows, ...closedChatRows];

            const uniqueChatRows = Array.from(new Map(allChatRows.map(c => [c.id, c])).values());

            uniqueChatRows.sort((a, b) => {
                const timeA = new Date(a.chat_activity_at || 0).getTime();
                const timeB = new Date(b.chat_activity_at || 0).getTime();
                return timeB - timeA || b.id.localeCompare(a.id);
            });

            const { chats, lastSyncChats } = await hydrateChats(uniqueChatRows, timezone);

            const hasMoreChats = hasMoreClosedChats || activeChatRows.length === activeChatsLimit;
            const cursorRow = activeChatRows.at(-1);
            const closedCursorRow = closedChatRows.at(-1);

            const messages: Message[] = [];
            const lastSyncMessageForSelected: string | null = null;
            const oldestMessageDate: string | null = null;
            const oldestMessageId: string | null = null;
            const hasMoreHistory = false;

            return {
                chats,
                messages,
                selectedChatId,
                lastSyncChats,
                lastSyncMessageForSelected,
                oldestMessageDate,
                oldestMessageId,
                hasMoreHistory,
                hasMoreChats,
                timezone,
                inboxCounts,
                nextCursor: cursorRow?.chat_activity_at
                    ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                    : null,
                chatPagination: {
                    active: {
                        hasMore: activeChatRows.length === activeChatsLimit,
                        cursor: cursorRow?.chat_activity_at
                            ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                            : null,
                    },
                    closed: {
                        hasMore: hasMoreClosedChats,
                        cursor: closedCursorRow?.chat_activity_at
                            ? { lastActivityAt: closedCursorRow.chat_activity_at, id: closedCursorRow.id }
                            : null,
                    },
                },
                statusPagination: {
                    robo: {
                        hasMore: activeChatRows.length === activeChatsLimit,
                        cursor: cursorRow?.chat_activity_at
                            ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                            : null,
                    },
                    gerais: {
                        hasMore: activeChatRows.length === activeChatsLimit,
                        cursor: cursorRow?.chat_activity_at
                            ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                            : null,
                    },
                    atendimentos: {
                        hasMore: activeChatRows.length === activeChatsLimit,
                        cursor: cursorRow?.chat_activity_at
                            ? { lastActivityAt: cursorRow.chat_activity_at, id: cursorRow.id }
                            : null,
                    },
                    encerrados: {
                        hasMore: hasMoreClosedChats,
                        cursor: closedCursorRow?.chat_activity_at
                            ? { lastActivityAt: closedCursorRow.chat_activity_at, id: closedCursorRow.id }
                            : null,
                    },
                },
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
                oldestMessageId: null,
                hasMoreHistory: false,
                hasMoreChats: false,
                timezone: DEFAULT_TIMEZONE,
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
        ownership = 'mine',
    }: {
        workspaceId: string;
        lastSyncChats: string | null;
        chatId: string | null;
        lastSyncMessages: string | null;
        ownership?: 'mine' | 'everyone';
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
            const access = await requireWorkspaceAccess(user.id, workspaceId);
            if (!access.ok) {
                return {
                    deltaChats: [],
                    lastSyncChats: null,
                    updatedContacts: [],
                    deltaMessages: [],
                    lastSyncMessage: null,
                    error: access.error,
                };
            }

            const timezone = await getWorkspaceTimezone(workspaceId);

            // 1. Fetch Chat Deltas
            let deltaChats: Chat[] = [];
            let newLastSyncChats = lastSyncChats;
            let updatedContacts: Contact[] = [];

            {
                const chatSyncAnchor = lastSyncChats || '1970-01-01T00:00:00.000Z';
                const chatRows = await fetchChatsDelta({
                    workspaceId,
                    since: chatSyncAnchor,
                    userId: user.id,
                    ownership,
                    includeChatId: chatId,
                });
                const { chats, lastSyncChats: updatedSync } = await hydrateChats(chatRows, timezone);
                deltaChats = chats;
                newLastSyncChats = updatedSync
                    || lastSyncChats
                    || new Date().toISOString();

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
                    workspaceId,
                    userId: user.id,
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
                error: `Erro ao sincronizar: ${error.message}`
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

        const access = await requireWorkspaceAccess(user.id, workspaceId);
        if (!access.ok) {
            return { chats: [], contacts: [], messages: [], error: access.error };
        }

        if (!query || query.trim().length < 2) {
            return { chats: [], contacts: [], messages: [] };
        }
        try {
            const protocolTerm = query.trim().toUpperCase();
            const isProtocolQuery = protocolTerm.startsWith('PRT-');
            const timezone = await getWorkspaceTimezone(workspaceId);
            const searchTerm = `%${query.trim()}%`;

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
                        cont.phone AS contact_phone,
                        cont.phone_number_jid AS contact_phone_number_jid,
                        cont.address AS contact_address,
                        t.name AS team_name,
                        t.color AS team_color
                    FROM chats c
                    LEFT JOIN contacts cont
                      ON c.contact_id = cont.id
                     AND cont.workspace_id = c.workspace_id
                    ${buildChatTeamLateralSql({ chatAlias: 'c' })}
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
                        phone: row.contact_phone,
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
                    WHERE ch.workspace_id = $1
                      AND ch.protocol ILIKE $2
                    ORDER BY m.created_at DESC
                    LIMIT 200
                `,
                    [workspaceId, protocolTerm]
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

                chat.messages = messages;
                return { chats: [chat], contacts: [], messages: [] };
            }

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
                    cont.phone AS contact_phone,
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
                LEFT JOIN contacts cont
                  ON c.contact_id = cont.id
                 AND cont.workspace_id = c.workspace_id
                ${buildChatTeamLateralSql({ chatAlias: 'c' })}
                WHERE c.workspace_id = $1
                  AND (
                      cont.name ILIKE $2
                      OR cont.phone_number_jid ILIKE $2
                      OR cont.phone ILIKE $2
                      OR cont.phone_canonical ILIKE $2
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
                        phone: row.contact_phone,
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
                    teamColor: row.team_color || undefined,
                    protocol: row.protocol || buildChatProtocol(row.id),
                };
            });

            const contactRows = await db.query(
                `
                SELECT *
                FROM contacts
                WHERE workspace_id = $1
                  AND (
                      name ILIKE $2
                      OR phone_number_jid ILIKE $2
                      OR phone ILIKE $2
                      OR phone_canonical ILIKE $2
                      OR email ILIKE $2
                  )
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT 50
            `,
                [workspaceId, searchTerm]
            );

            const contacts: Contact[] = mergeEquivalentContacts(contactRows.rows.map((row: any) => ({
                id: row.id,
                workspace_id: row.workspace_id,
                name: row.name,
                avatar_url: row.avatar_url,
                email: row.email,
                phone: row.phone,
                phone_number_jid: row.phone_number_jid,
                address: row.address,
                custom_fields: row.custom_fields
            })));

            const messageRows = await db.query(
                `
                SELECT 
                    m.*,
                    c.workspace_id AS workspace_id,
                    c.status AS chat_status,
                    c.protocol AS chat_protocol,
                    cont.id AS contact_id,
                    cont.name AS contact_name,
                    cont.avatar_url AS contact_avatar_url,
                    cont.email AS contact_email,
                    cont.phone_number_jid AS contact_phone_number_jid,
                    cont.address AS contact_address
                FROM messages m
                JOIN chats c ON c.id = m.chat_id
                LEFT JOIN contacts cont
                  ON cont.id = c.contact_id
                 AND cont.workspace_id = c.workspace_id
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

                const message = mapMessageFromRow(row, timezone, contact, agentsMap, systemAgentsMap);
                return {
                    ...message,
                    chat_status: row.chat_status,
                    chat_protocol: row.chat_protocol,
                } as Message;
            });

            return { chats, contacts, messages };

        } catch (error: any) {
            console.error("[SEARCH_CHATS] Error:", error);
            return { chats: [], contacts: [], messages: [], error: `Erro na busca: ${error.message}` };
        }
    },
    {
        contextResolver: (workspaceId, query) => ({ payload: { workspaceId, query } })
    }
);

export const getContactProtocolsAction = withDebug(
    'get_contact_protocols',
    async function getContactProtocolsAction(
        workspaceId: string,
        contactId: string
    ): Promise<{
        protocols: Array<{
            chatId: string;
            protocol: string;
            status: Chat['status'];
            createdAt: string;
            lastActivityAt: string;
            lastMessageContent: string | null;
        }>;
        error?: string;
    }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { protocols: [], error: "Usuario nao autenticado." };
        }

        if (!workspaceId || !contactId) {
            return { protocols: [], error: "Workspace e contato sao obrigatorios." };
        }

        try {
            const access = await requireWorkspaceAccess(user.id, workspaceId);
            if (!access.ok) {
                return { protocols: [], error: access.error };
            }

            const { rows } = await db.query(
                `
                SELECT
                    c.id AS chat_id,
                    COALESCE(c.protocol, 'PRT-' || upper(replace(c.id::text, '-', ''))) AS protocol,
                    c.status,
                    c.created_at,
                    COALESCE(c.last_activity_at, c.created_at) AS last_activity_at,
                    last_msg.content AS last_message_content
                FROM chats c
                LEFT JOIN LATERAL (
                    SELECT m.created_at, m.content
                    FROM messages m
                    WHERE m.chat_id = c.id
                    ORDER BY m.created_at DESC
                    LIMIT 1
                ) last_msg ON TRUE
                WHERE c.workspace_id = $1
                  AND c.contact_id = $2
                ORDER BY c.created_at DESC
                LIMIT 200
                `,
                [workspaceId, contactId]
            );

            const protocols = rows.map((row: any) => ({
                chatId: row.chat_id as string,
                protocol: row.protocol as string,
                status: row.status as Chat['status'],
                createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
                lastActivityAt: row.last_activity_at instanceof Date ? row.last_activity_at.toISOString() : String(row.last_activity_at),
                lastMessageContent: row.last_message_content ? String(row.last_message_content) : null,
            }));

            return { protocols };
        } catch (error: any) {
            console.error('[GET_CONTACT_PROTOCOLS] Error:', error);
            return { protocols: [], error: `Falha ao buscar protocolos: ${error.message}` };
        }
    },
    {
        contextResolver: (workspaceId, contactId) => ({ payload: { workspaceId, contactId } }),
    }
);

export const refreshChatAction = withDebug(
    'refresh_chat',
    async function refreshChatAction(chatId: string): Promise<{ chat?: Chat; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { error: "Usuário não autenticado." };
        }

        try {
            // 1. Get workspace_id for the chat
            const chatRes = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
            if (chatRes.rowCount === 0) {
                return { error: "Chat não encontrado." };
            }
            const workspaceId = chatRes.rows[0].workspace_id;

            // 2. Fetch full chat data with joins
            const rows = await fetchChats({
                workspaceId,
                userId: user.id,
                limit: 1,
                includeChatId: chatId,
                ownership: 'everyone',
                statuses: [] // no filter
            });

            if (rows.length === 0) {
                return { error: "Chat não encontrado ou permissão negada." };
            }

            // 3. Hydrate to Chat object
            // Reuse hydrateChats but we need to mock timezone or fetch it?
            // Ideally we fetch it.
            const timezone = await getWorkspaceTimezone(workspaceId);
            const { chats } = await hydrateChats(rows, timezone);

            if (chats.length === 0) return { error: "Erro ao processar dados do chat." };

            return { chat: chats[0] };

        } catch (error: any) {
            console.error("Erro ao atualizar chat:", error);
            return { error: "Falha no servidor." };
        }
    },
    {
        contextResolver: (chatId) => ({ payload: { chatId } })
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
            const access = await requireWorkspaceAccess(user.id, workspaceId);
            if (!access.ok) {
                return { error: access.error };
            }

            const contactRes = await db.query(
                `SELECT id, phone, phone_number_jid
                 FROM contacts
                 WHERE id = $1
                   AND workspace_id = $2
                 LIMIT 1`,
                [contactId, workspaceId]
            );
            const contactRow = contactRes.rows[0];

            // Check for an existing active chat on this contact or equivalent contacts by canonical phone
            const existingChat = await db.query(
                `SELECT ch.id
                 FROM chats ch
                 JOIN contacts c1
                   ON c1.id = ch.contact_id
                  AND c1.workspace_id = ch.workspace_id
                 JOIN contacts c2
                   ON c2.id = $2
                  AND c2.workspace_id = ch.workspace_id
                 WHERE ch.workspace_id = $1
                   AND ch.status IN ('gerais', 'atendimentos')
                   AND (
                     ch.contact_id = $2
                     OR (c1.phone_canonical IS NOT NULL AND c1.phone_canonical = c2.phone_canonical)
                   )
                 ORDER BY ch.created_at DESC
                 LIMIT 1`,
                [workspaceId, contactId]
            );

            if (existingChat.rowCount && existingChat.rowCount > 0) {
                return { chatId: existingChat.rows[0].id };
            }

            // Create new chat
            const newChatId = randomUUID();
            const protocol = buildChatProtocol(newChatId);
            const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
            const chatLimitStatus = await getMonthlyChatLimitStatus(workspaceId);
            if (!chatLimitStatus.allowed) {
                throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
            }
            const newChat = await db.query(
                `INSERT INTO chats (id, workspace_id, contact_id, status, agent_id, assigned_at, protocol, last_activity_at) VALUES ($1, $2, $3, 'gerais', $4, NOW(), $5, NOW()) RETURNING id`,
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

export const getMergedContactThreadAction = withDebug(
    'get_merged_contact_thread',
    async function getMergedContactThreadAction(
        workspaceId: string,
        contactId: string
    ): Promise<{ chat?: Chat; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { error: "Usuário não autenticado." };
        }

        try {
            const access = await requireWorkspaceAccess(user.id, workspaceId);
            if (!access.ok) {
                return { error: access.error };
            }

            const threadContext = await loadContactThreadContext(workspaceId, contactId);
            if ('error' in threadContext) {
                return { error: threadContext.error };
            }
            const { mergedContact, relatedContactIds } = threadContext;

            const timezone = await getWorkspaceTimezone(workspaceId);
            const chatRowsRes = await db.query(
                `
                SELECT
                    c.id,
                    c.status,
                    c.workspace_id,
                    c.assigned_at,
                    c.tag,
                    c.color,
                    c.protocol,
                    c.is_autopilot_active,
                    c.autopilot_config_id,
                    c.copilot_mode,
                    c.contact_id,
                    c.agent_id,
                    c.assigned_system_agent_id,
                    c.last_activity_at AS chat_activity_at,
                    COALESCE(lmd.instance_name, lci.instance_name) AS instance_name,
                    COALESCE(lmd.source_from_api, lmd.platform::text, lci.source_from_api, lci.platform::text, mc.platform::text) AS source,
                    0 AS unread_count,
                    t.id AS team_id,
                    t.name AS team_name,
                    t.color AS team_color,
                    channel_instance.type AS instance_type,
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
                    lmd.platform AS last_message_platform,
                    lmd.source_from_api AS last_message_source_from_api,
                    lmd.message_id_from_api AS last_message_message_id_from_api,
                    lmd.api_message_status AS last_message_api_message_status,
                    lmd.is_read AS last_message_is_read,
                    lmd.sent_by_tab AS last_message_sent_by_tab,
                    lmd.external_message_id AS last_message_external_message_id,
                    lmd.external_sender_id AS last_message_external_sender_id,
                    lmd.external_channel_id AS last_message_external_channel_id,
                    lmd.direction AS last_message_direction,
                    lmd.media_url AS last_message_media_url,
                    NULL::json AS contact_custom_fields,
                    COALESCE(mct.external_id, mct_from_message.external_id, CASE WHEN NULLIF(cont.phone_number_jid, '') IS NULL THEN mct_stable.external_id END) AS meta_contact_external_id,
                    COALESCE(mct.username, mct_from_message.username, CASE WHEN NULLIF(cont.phone_number_jid, '') IS NULL THEN mct_stable.username END) AS meta_contact_username,
                    COALESCE(mc.platform, mct_from_message.platform_type, CASE WHEN NULLIF(cont.phone_number_jid, '') IS NULL THEN mct_stable.platform_type END) AS meta_platform
                FROM chats c
                LEFT JOIN LATERAL (
                    SELECT
                        m.id,
                        m.chat_id,
                        m.content,
                        m.type,
                        m.metadata,
                        m.transcription,
                        m.created_at,
                        m.from_me,
                        m.sender_user_id,
                        m.sender_system_agent_id,
                        m.instance_name,
                        m.source_from_api,
                        m.platform,
                        m.message_id_from_api,
                        m.api_message_status,
                        m.is_read,
                        m.sent_by_tab,
                        m.external_message_id,
                        m.external_sender_id,
                        m.external_channel_id,
                        m.direction,
                        m.media_url
                    FROM messages m
                    WHERE m.chat_id = c.id
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 1
                ) lmd ON TRUE
                LEFT JOIN LATERAL (
                    SELECT m.instance_name, m.source_from_api, m.platform
                    FROM messages m
                    WHERE m.chat_id = c.id
                      AND m.instance_name IS NOT NULL
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 1
                ) lci ON TRUE
                LEFT JOIN meta_conversations mc ON mc.chat_id = c.id
                LEFT JOIN meta_contacts mct ON mct.id = mc.meta_contact_id
                LEFT JOIN contacts cont
                  ON cont.id = c.contact_id
                 AND cont.workspace_id = c.workspace_id
                LEFT JOIN LATERAL (
                    SELECT mct2.username, mct2.external_id, mch.type as platform_type
                    FROM meta_contacts mct2
                    JOIN meta_channels mch ON mch.id = mct2.channel_id
                    WHERE lmd.external_sender_id IS NOT NULL
                      AND mct2.external_id = lmd.external_sender_id
                      AND mch.workspace_id = c.workspace_id
                      AND (
                        lmd.external_channel_id IS NULL
                        OR mch.external_page_id = lmd.external_channel_id
                        OR mch.ig_business_id = lmd.external_channel_id
                      )
                      AND (
                        lmd.platform IS NULL
                        OR mch.type::text = lmd.platform::text
                      )
                    ORDER BY mct2.created_at DESC
                    LIMIT 1
                ) mct_from_message ON true
                LEFT JOIN LATERAL (
                    SELECT mct2.username, mct2.external_id, mch.type as platform_type
                    FROM meta_contacts mct2
                    JOIN meta_channels mch ON mch.id = mct2.channel_id
                    WHERE NULLIF(cont.phone_number_jid, '') IS NULL
                      AND mct2.contact_id = c.contact_id
                    ORDER BY mct2.created_at DESC
                    LIMIT 1
                ) mct_stable ON true
                ${buildChatTeamLateralSql({ chatAlias: 'c' })}
                LEFT JOIN LATERAL (
                    SELECT type
                    FROM (
                        SELECT eai.type
                        FROM evolution_api_instances eai
                        WHERE COALESCE(lmd.instance_name, lci.instance_name) IS NOT NULL
                          AND eai.instance_name = COALESCE(lmd.instance_name, lci.instance_name)
                          AND eai.workspace_id = c.workspace_id
                        UNION ALL
                        SELECT 'telegram'::text AS type
                        FROM telegram_bot_instances tbi
                        WHERE COALESCE(lmd.instance_name, lci.instance_name) IS NOT NULL
                          AND tbi.instance_name = COALESCE(lmd.instance_name, lci.instance_name)
                          AND tbi.workspace_id = c.workspace_id
                    ) instances
                    LIMIT 1
                ) channel_instance ON true
                WHERE c.workspace_id = $1
                  AND c.contact_id = ANY($2::uuid[])
                ORDER BY
                    CASE
                        WHEN c.status = 'atendimentos' THEN 0
                        WHEN c.status = 'gerais' THEN 1
                        ELSE 2
                    END,
                    c.last_activity_at DESC,
                    c.created_at DESC
                LIMIT 100
                `,
                [workspaceId, relatedContactIds]
            );

            const hydrated = await hydrateChats(chatRowsRes.rows as ChatRow[], timezone);
            const threadChat = hydrated.chats[0];
            const relatedChatIds = [...new Set(chatRowsRes.rows.map((row: any) => row.id).filter(Boolean))];

            if (!threadChat) {
                const created = await getOrCreateChatAction(workspaceId, mergedContact.id);
                if (created.error || !created.chatId) {
                    return { error: created.error || 'Nenhuma conversa encontrada para este contato.' };
                }

                return {
                    chat: {
                        id: created.chatId,
                        status: 'gerais',
                        workspace_id: workspaceId,
                        contact: {
                            ...mergedContact,
                            relatedContactIds,
                            relatedContactCount: relatedContactIds.length,
                        },
                        messages: [],
                        unreadCount: 0,
                        updatedAt: new Date().toISOString(),
                        protocol: buildChatProtocol(created.chatId),
                        relatedContactThread: true,
                        relatedContactIds,
                        relatedChatIds: [created.chatId],
                    },
                };
            }

            const messagesRes = await db.query(
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
                LEFT JOIN contacts cont
                  ON cont.id = c.contact_id
                 AND cont.workspace_id = c.workspace_id
                WHERE c.workspace_id = $1
                  AND c.contact_id = ANY($2::uuid[])
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1000
                `,
                [workspaceId, relatedContactIds]
            );

            const senderIds = [...new Set(messagesRes.rows.map((row: any) => row.sender_user_id).filter(Boolean))];
            const systemAgentIds = [...new Set(messagesRes.rows.map((row: any) => row.sender_system_agent_id).filter(Boolean))];
            const [agentsMap, systemAgentsMap] = await Promise.all([
                fetchAgentsMap(senderIds as string[]),
                fetchSystemAgentsMap(systemAgentIds as string[]),
            ]);
            const messages = messagesRes.rows
                .map((row: MessageRow) => mapMessageFromRow(row, timezone, mergedContact, agentsMap, systemAgentsMap))
                .reverse();

            return {
                chat: {
                    ...threadChat,
                    contact: {
                        ...mergedContact,
                        relatedContactIds,
                        relatedContactCount: relatedContactIds.length,
                    },
                    messages,
                    relatedContactThread: true,
                    relatedContactIds,
                    relatedChatIds,
                    updatedAt: messages[messages.length - 1]?.createdAt || threadChat.updatedAt,
                },
            };
        } catch (error: any) {
            console.error('[GET_MERGED_CONTACT_THREAD] Error:', error);
            return { error: `Erro ao abrir historico agregado: ${error.message}` };
        }
    },
    {
        contextResolver: (workspaceId, contactId) => ({ payload: { workspaceId, contactId } }),
        timeoutMs: 20000,
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
    userId,
    ownership = 'mine',
    includeChatId,
}: {
    workspaceId: string;
    since: string;
    userId: string;
    ownership?: 'mine' | 'everyone';
    includeChatId?: string | null;
}): Promise<ChatRow[]> {
    const startTime = performance.now();
    const params: any[] = [workspaceId, since];
    let queryIndex = 3;

    let ownershipCondition = '';
    if (ownership === 'mine') {
        params.push(userId);
        // Robô/Fila remain shared; ownership filters only human attendance
        // and closed-conversation updates.
        ownershipCondition = `(c.status NOT IN ('atendimentos', 'encerrados') OR c.agent_id = $${queryIndex})`;
        queryIndex++;
    }

    if (includeChatId && ownership === 'mine') {
        params.push(includeChatId);
        const includeCondition = `c.id = $${queryIndex}`;
        ownershipCondition = ownershipCondition
            ? `(${ownershipCondition} OR ${includeCondition})`
            : includeCondition;
        queryIndex++;
    }

    const ownershipClause = ownershipCondition ? `AND ${ownershipCondition}` : '';

    const { rows } = await db.query(
        `
        WITH changed_chats AS (
            -- O OR entre updated_at e last_activity_at depende de haver indice
            -- para AMBAS as colunas: com apenas uma indexada o planner cai em
            -- Parallel Seq Scan (162k linhas, 6.283 buffers, 51,7 ms).
            -- Com idx_chats_workspace_updated_at criado, ele resolve por BitmapOr.
            -- Nao trocar por UNION: medido, o UNION obriga a materializar os ids,
            -- deduplicar e rebuscar cada linha pela PK — 19x mais lento e 72x mais
            -- buffers numa janela de 24h (55,8 ms vs 2,9 ms / 105.344 vs 1.466).
            SELECT c.*
            FROM chats c
            WHERE c.workspace_id = $1
              ${ownershipClause}
              AND (c.updated_at >= $2 OR c.last_activity_at >= $2)
        ),
        last_message_details AS (
            SELECT DISTINCT ON (m.chat_id)
                m.id,
                m.chat_id,
                m.content,
                m.type,
                m.metadata,
                m.transcription,
                m.created_at,
                m.from_me,
                m.sender_user_id,
                m.sender_system_agent_id,
                m.instance_name,
                m.source_from_api,
                m.platform,
                m.message_id_from_api,
                m.api_message_status,
                m.is_read,
                m.sent_by_tab
            FROM messages m
            WHERE m.chat_id IN (SELECT id FROM changed_chats)
            ORDER BY m.chat_id, m.created_at DESC
        ),
        latest_channel_message AS (
            SELECT DISTINCT ON (m.chat_id)
                m.chat_id,
                m.instance_name,
                m.source_from_api,
                m.platform
            FROM messages m
            WHERE m.chat_id IN (SELECT id FROM changed_chats)
              AND m.instance_name IS NOT NULL
            ORDER BY m.chat_id, m.created_at DESC
        ),
        unread_counts AS (
            SELECT
                m.chat_id,
                COUNT(*) AS unread_count
            FROM messages m
            JOIN changed_chats c ON c.id = m.chat_id
            WHERE m.from_me = false
              AND COALESCE(m.is_read, false) = false
            GROUP BY m.chat_id
        ),
        contact_custom_fields AS (
            SELECT
                cfv.contact_id,
                json_object_agg(cfv.field_id, cfv.value) AS contact_custom_fields
            FROM contact_custom_field_values cfv
            JOIN (
                SELECT DISTINCT contact_id
                FROM changed_chats
                WHERE contact_id IS NOT NULL
            ) cc ON cc.contact_id = cfv.contact_id
            GROUP BY cfv.contact_id
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
            c.autopilot_config_id,
            c.copilot_mode,
            c.agent_id,
            c.assigned_system_agent_id,
            c.last_activity_at AS chat_activity_at,
            COALESCE(lmd.instance_name, lci.instance_name) AS instance_name,
            COALESCE(
                lmd.source_from_api,
                lmd.platform::text,
                lci.source_from_api,
                lci.platform::text,
                mc.platform::text
            ) AS source,
            COALESCE(uc.unread_count, 0) AS unread_count,
            t.name AS team_name,
            t.id AS team_id,
            t.color AS team_color,
            channel_instance.type AS instance_type,
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
            lmd.platform AS last_message_platform,
            lmd.source_from_api AS last_message_source_from_api,
            lmd.message_id_from_api AS last_message_message_id_from_api,
            lmd.api_message_status AS last_message_api_message_status,
            lmd.is_read AS last_message_is_read,
            lmd.sent_by_tab AS last_message_sent_by_tab,
            ccf.contact_custom_fields AS contact_custom_fields,
            ad_attr.source AS ad_source,
            ad_attr.campaign AS ad_campaign,
            ad_attr.campaign_id AS ad_campaign_id,
            ad_attr.confidence AS ad_confidence
        FROM changed_chats c
        LEFT JOIN LATERAL (
            SELECT aa.source, aa.campaign, aa.campaign_id, aa.confidence
            FROM ad_attributions aa
            -- ad_attributions.chat_id e text (migration do Google Ads) e chats.id
            -- e uuid: sem cast o Postgres nao acha operador (42883). Castamos o
            -- lado uuid para text, nao o contrario, para o idx_ad_attributions_chat
            -- continuar servindo a busca.
            WHERE aa.chat_id = c.id::text
            ORDER BY aa.attributed_at DESC
            LIMIT 1
        ) ad_attr ON true
        LEFT JOIN last_message_details lmd ON lmd.chat_id = c.id
        LEFT JOIN latest_channel_message lci ON lci.chat_id = c.id
        LEFT JOIN unread_counts uc ON uc.chat_id = c.id
        LEFT JOIN contact_custom_fields ccf ON ccf.contact_id = c.contact_id
        LEFT JOIN meta_conversations mc ON mc.chat_id = c.id
        LEFT JOIN contacts cont
          ON cont.id = c.contact_id
         AND cont.workspace_id = c.workspace_id
        ${buildChatTeamLateralSql({ chatAlias: 'c' })}
        LEFT JOIN LATERAL (
            SELECT type
            FROM (
                SELECT eai.type
                FROM evolution_api_instances eai
                WHERE COALESCE(lmd.instance_name, lci.instance_name) IS NOT NULL
                  AND eai.instance_name = COALESCE(lmd.instance_name, lci.instance_name)
                  AND eai.workspace_id = c.workspace_id
                UNION ALL
                SELECT 'telegram'::text AS type
                FROM telegram_bot_instances tbi
                WHERE COALESCE(lmd.instance_name, lci.instance_name) IS NOT NULL
                  AND tbi.instance_name = COALESCE(lmd.instance_name, lci.instance_name)
                  AND tbi.workspace_id = c.workspace_id
            ) instances
            LIMIT 1
        ) channel_instance ON true
        WHERE c.last_activity_at >= $2
        ORDER BY c.last_activity_at DESC
        `,
        params
    );
    const endTime = performance.now();
    console.log(`[PERF] fetchChatsDelta took ${(endTime - startTime).toFixed(2)}ms, ${rows.length} changed chats since ${since}`);
    return dedupeActiveWhatsappChatsByIdentity({
        chats: rows as ChatRow[],
        getId: (chat) => chat.id,
        getStatus: (chat) => chat.status,
        getPhoneOrJid: (chat) => chat.contact_phone_number_jid,
    });
}

type AgentRow = { id: string; full_name: string; avatar_url?: string | null };

async function fetchHydratedChatForImmediateReturn(
    workspaceId: string,
    userId: string,
    chatId: string,
): Promise<Chat | undefined> {
    try {
        const rows = await fetchChats({
            workspaceId,
            userId,
            limit: 1,
            includeChatId: chatId,
            ownership: 'everyone',
            statuses: [],
        });
        if (!rows.length) return undefined;

        const timezone = await getWorkspaceTimezone(workspaceId);
        const { chats } = await hydrateChats(rows, timezone);
        return chats[0];
    } catch (error) {
        // The transfer is already committed at this point. A hydration failure
        // must not turn a successful ownership change into a false error.
        console.error('[CHAT_HYDRATION] Failed to hydrate immediate chat response:', error);
        return undefined;
    }
}

async function fetchAgentsMap(ids: string[]): Promise<Map<string, AgentRow>> {
    if (!ids.length) return new Map();
    const { rows } = await db.query(
        'SELECT id, full_name, avatar_url FROM users WHERE id::text = ANY($1::text[])',
        [ids]
    );
    return new Map(rows.map((row: AgentRow) => [row.id, row]));
}

async function fetchSystemAgentsMap(ids: string[]): Promise<Map<string, Pick<SystemAgent, 'id' | 'name' | 'avatar_url' | 'type'>>> {
    if (!ids.length) return new Map();
    const { rows } = await db.query(
        'SELECT id, name, avatar_url, type FROM system_agents WHERE id::text = ANY($1::text[])',
        [ids]
    );
    return new Map(rows.map((row: Pick<SystemAgent, 'id' | 'name' | 'avatar_url' | 'type'>) => [row.id, row]));
}

async function fetchChatTagsMap(chatIds: string[]): Promise<Map<string, Tag[]>> {
    if (!chatIds.length) return new Map();
    const { rows } = await db.query(
        `SELECT ct.chat_id, t.id, t.label, t.value, t.color, t.is_close_reason,
                t.team_ids, t.category, t.sort_order
         FROM chat_tags ct
         JOIN tags t ON t.id = ct.tag_id AND t.workspace_id = ct.workspace_id
         JOIN chats c ON c.id = ct.chat_id AND c.workspace_id = ct.workspace_id
         WHERE ct.chat_id::text = ANY($1::text[])
           AND t.is_close_reason = FALSE
           AND NOT (
             c.team_id IS NOT NULL
             AND c.team_id = ANY(COALESCE(t.team_ids, ARRAY[]::uuid[]))
           )
         ORDER BY ct.chat_id, ct.created_at, COALESCE(t.sort_order, 2147483647), t.label`,
        [chatIds]
    );
    const result = new Map<string, Tag[]>();
    for (const row of rows) {
        const tags = result.get(row.chat_id) || [];
        tags.push({
            id: row.id,
            label: row.label,
            value: row.value,
            color: row.color,
            is_close_reason: row.is_close_reason,
            team_ids: row.team_ids,
            category: row.category,
            sort_order: row.sort_order,
        });
        result.set(row.chat_id, tags);
    }
    return result;
}

async function hydrateChats(rows: ChatRow[], timezone: string): Promise<{ chats: Chat[]; chatMap: Map<string, Chat>; lastSyncChats: string | null }> {
    if (!rows.length) {
        return { chats: [], chatMap: new Map(), lastSyncChats: null };
    }

    const agentIds = new Set<string>();
    const systemAgentIds = new Set<string>();
    rows.forEach((row) => {
        if (row.agent_id) agentIds.add(row.agent_id);
        if (row.assigned_system_agent_id) systemAgentIds.add(row.assigned_system_agent_id);
        if (row.last_message_sender_user_id) agentIds.add(row.last_message_sender_user_id);
        if (row.last_message_sender_system_agent_id) systemAgentIds.add(row.last_message_sender_system_agent_id);
    });

    const [agentsMap, systemAgentsMap, chatTagsMap] = await Promise.all([
        fetchAgentsMap([...agentIds].filter(Boolean)),
        fetchSystemAgentsMap([...systemAgentIds].filter(Boolean)),
        fetchChatTagsMap(rows.map((row) => row.id)),
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
                    platform: row.last_message_platform as any,
                    message_id_from_api: row.last_message_message_id_from_api,
                    api_message_status: row.last_message_api_message_status,
                    is_read: row.last_message_is_read,
                    sent_by_tab: row.last_message_sent_by_tab,
                    external_message_id: row.last_message_external_message_id,
                    external_sender_id: row.last_message_external_sender_id,
                    external_channel_id: row.last_message_external_channel_id,
                    direction: row.last_message_direction,
                    media_url: row.last_message_media_url,
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
                systemAgentsMap,
                'preview'
            )
            : undefined;

        const agentRow = row.agent_id ? agentsMap.get(row.agent_id) : undefined;
        const assignedSystemAgentRow = row.assigned_system_agent_id ? systemAgentsMap.get(row.assigned_system_agent_id) : undefined;
        const agent = agentRow
            ? {
                id: agentRow.id,
                name: agentRow.full_name,
                avatar_url: agentRow.avatar_url || undefined,
                avatar: agentRow.avatar_url || undefined,
            } as User
            : undefined;

        return {
            id: row.id,
            status: row.status,
            workspace_id: row.workspace_id,
            contact: contact as Contact,
            agent,
            agentId: row.agent_id || undefined,
            assigned_system_agent_id: row.assigned_system_agent_id || null,
            assignedSystemAgent: assignedSystemAgentRow
                ? {
                    id: assignedSystemAgentRow.id,
                    name: assignedSystemAgentRow.name,
                    avatar_url: assignedSystemAgentRow.avatar_url,
                    type: assignedSystemAgentRow.type,
                }
                : undefined,
            messages: lastMessage ? [lastMessage] : [],
            updatedAt: row.chat_activity_at || undefined,
            source: row.source || undefined,
            instance_name: row.instance_name || undefined,
            instance_type: row.instance_type,
            assigned_at: row.assigned_at || undefined,
            unreadCount: Number(row.unread_count || 0),
            teamName: row.team_name || undefined,
            team_id: row.team_id || undefined,
            teamColor: row.team_color || undefined,
            tag: row.tag || undefined,
            color: row.color || undefined,
            tags: chatTagsMap.get(row.id) || [],
            protocol: row.protocol || buildChatProtocol(row.id),
            is_autopilot_active: row.is_autopilot_active ?? false,
            autopilot_config_id: row.autopilot_config_id ?? null,
            copilot_mode: row.copilot_mode || 'auto',
            metaContactExternalId: row.meta_contact_external_id || undefined,
            metaContactUsername: row.meta_contact_username || undefined,
            metaPlatform: (row.meta_platform as any) || undefined,
            adAttribution: row.ad_confidence
                ? {
                    source: row.ad_source || 'google',
                    campaign: row.ad_campaign || undefined,
                    campaignId: row.ad_campaign_id || undefined,
                    confidence: row.ad_confidence,
                }
                : undefined,
        };
    });

    const chatMap = new Map(chats.map((chat) => [chat.id, chat]));

function maxIsoDate(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
}

function parseMetadata(metadata: any, shape: 'full' | 'preview' = 'full'): MessageMetadata | null {
    if (!metadata) return null;
    try {
        return typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    } catch (e) {
        return null;
    }
}

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

export async function getContactMessages({
    contactId,
    workspaceId,
    limit = 50,
    before,
    timezone = DEFAULT_TIMEZONE,
}: {
    contactId: string;
    workspaceId: string;
    limit?: number;
    before?: string;
    timezone?: string;
}): Promise<{ messages: Message[] }> {
    const params: any[] = [contactId, workspaceId, limit];
    let beforeClause = '';
    if (before) {
        params.push(before);
        beforeClause = 'AND m.created_at < $4::timestamptz';
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
        JOIN contacts cont
          ON cont.id = c.contact_id
         AND cont.workspace_id = c.workspace_id
        WHERE cont.id = $1
          AND c.workspace_id = $2
          AND m.workspace_id = c.workspace_id
          ${beforeClause}
        ORDER BY m.created_at DESC
        LIMIT $3
        `,
        params
    );

    const senderIds = [...new Set(rows.map((row) => row.sender_user_id).filter(Boolean))];
    const systemAgentIds = [...new Set(rows.map((row) => row.sender_system_agent_id).filter(Boolean))];

    const [agentsMap, systemAgentsMap] = await Promise.all([
        fetchAgentsMap(senderIds as string[]),
        fetchSystemAgentsMap(systemAgentIds as string[]),
    ]);

    const contact = rows.length > 0 ? {
        id: rows[0].contact_id,
        workspace_id: rows[0].workspace_id,
        name: rows[0].contact_name,
        avatar_url: rows[0].contact_avatar_url,
        email: rows[0].contact_email,
        phone_number_jid: rows[0].contact_phone_number_jid,
        address: rows[0].contact_address
    } : undefined;

    const messages = rows.map(row => mapMessageFromRow(row, timezone, contact as Contact, agentsMap, systemAgentsMap)).reverse();

    return { messages };
}

export async function getChatMessagesWindow({
    chatId,
    limit,
    before,
    beforeId,
    timezone,
    chatOnly = false,
}: {
    chatId: string;
    limit: number;
    before?: string | null;
    beforeId?: string | null;
    timezone: string;
    chatOnly?: boolean;
}): Promise<{
    messages: Message[];
    lastSyncMessage: string | null;
    oldestMessageDate: string | null;
    oldestMessageId: string | null;
    hasMoreHistory: boolean;
    contact?: Contact;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return {
            messages: [],
            lastSyncMessage: null,
            oldestMessageDate: null,
            oldestMessageId: null,
            hasMoreHistory: false,
        };
    }

    const accessCheck = await db.query(
        `
        SELECT
            c.workspace_id,
            c.contact_id,
            cont.name AS contact_name,
            cont.avatar_url AS contact_avatar_url,
            cont.email AS contact_email,
            cont.phone AS contact_phone,
            cont.phone_number_jid AS contact_phone_number_jid,
            cont.address AS contact_address
        FROM chats c
        LEFT JOIN contacts cont
          ON cont.id = c.contact_id
         AND cont.workspace_id = c.workspace_id
        JOIN user_workspace_roles uwr
          ON uwr.workspace_id = c.workspace_id
         AND uwr.user_id = $2
        WHERE c.id = $1
        LIMIT 1
        `,
        [chatId, user.id]
    );

    if ((accessCheck.rowCount ?? 0) === 0) {
        return {
            messages: [],
            lastSyncMessage: null,
            oldestMessageDate: null,
            oldestMessageId: null,
            hasMoreHistory: false,
        };
    }

    const targetRow = accessCheck.rows[0];
    const targetContact: Contact | undefined = targetRow.contact_id
        ? {
            id: targetRow.contact_id,
            workspace_id: targetRow.workspace_id,
            name: targetRow.contact_name || 'Contato',
            avatar_url: targetRow.contact_avatar_url || undefined,
            email: targetRow.contact_email || undefined,
            phone: targetRow.contact_phone || undefined,
            phone_number_jid: targetRow.contact_phone_number_jid || undefined,
            address: targetRow.contact_address || undefined,
        }
        : undefined;

    const params: (string | number | string[])[] = [chatId, limit];
    let beforeClause = '';
    if (before && beforeId) {
        params.push(before, beforeId);
        // Use timestamptz for proper comparison with timestamp with time zone column
        beforeClause = 'AND (message.created_at, message.id) < ($3::timestamptz, $4::uuid)';
    } else if (before) {
        params.push(before);
        beforeClause = 'AND message.created_at < $3::timestamptz';
    }

    // console.log('[GET_CHAT_MESSAGES_WINDOW] Query params:', { chatId, limit, before, beforeId, beforeClause });

    // Keep the identity sets materialized and split direct/related matches with
    // UNION so PostgreSQL can use the workspace/contact indexes for each path.
    // The lateral query reads at most `limit` rows per related chat. This still
    // yields the exact global top `limit`: a row ranked below `limit` inside its
    // own chat can never belong to the global top `limit`.
    const contactIdsCTE = chatOnly
        ? `SELECT tc.contact_id AS id
           FROM target_chat tc
           WHERE tc.contact_id IS NOT NULL`
        : `SELECT tc.contact_id AS id
           FROM target_chat tc
           WHERE tc.contact_id IS NOT NULL

           UNION

           SELECT c.id
           FROM contacts c
           JOIN target_chat tc
             ON c.workspace_id = tc.workspace_id
            AND c.phone_canonical = tc.phone_canonical
           WHERE tc.phone_canonical IS NOT NULL`;

    const chatIdsCTE = chatOnly
        ? `SELECT tc.id, tc.workspace_id, tc.contact_id
           FROM target_chat tc`
        : `SELECT tc.id, tc.workspace_id, tc.contact_id
           FROM target_chat tc

           UNION

           SELECT ch.id, ch.workspace_id, ch.contact_id
           FROM matching_contact_ids mci
           JOIN chats ch
             ON ch.contact_id = mci.id
           JOIN target_chat tc
             ON tc.workspace_id = ch.workspace_id`;

    const { rows } = await db.query(
        `
        WITH target_chat AS MATERIALIZED (
            SELECT
                ch.id,
                ch.workspace_id,
                ch.contact_id,
                target_contact.phone_canonical
            FROM chats ch
            LEFT JOIN contacts target_contact
              ON target_contact.id = ch.contact_id
             AND target_contact.workspace_id = ch.workspace_id
            WHERE ch.id = $1
        ),
        matching_contact_ids AS MATERIALIZED (
            ${contactIdsCTE}
        ),
        matching_chats AS MATERIALIZED (
            ${chatIdsCTE}
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
        FROM matching_chats c
        LEFT JOIN contacts cont
          ON cont.id = c.contact_id
         AND cont.workspace_id = c.workspace_id
        CROSS JOIN LATERAL (
            SELECT message.*
            FROM messages message
            WHERE message.chat_id = c.id
              AND message.workspace_id = c.workspace_id
              ${beforeClause}
            ORDER BY message.created_at DESC, message.id DESC
            LIMIT $2
        ) m
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $2
        `,
        params
    );

    // console.log('[GET_CHAT_MESSAGES_WINDOW] Query result:', { rowsCount: rows.length, firstRowDate: rows[0]?.created_at, lastRowDate: rows[rows.length - 1]?.created_at });

    const senderIds = [...new Set(rows.map((row) => row.sender_user_id).filter(Boolean))];
    const systemAgentIds = [...new Set(rows.map((row) => row.sender_system_agent_id).filter(Boolean))];

    const [agentsMap, systemAgentsMap] = await Promise.all([
        fetchAgentsMap(senderIds as string[]),
        fetchSystemAgentsMap(systemAgentIds as string[]),
    ]);

    const messages = scopeMessagesToChatThread(
        chatId,
        rows
            .map((row: MessageRow) => mapMessageFromRow(row, timezone, targetContact, agentsMap, systemAgentsMap))
            .reverse(),
    );

    const lastSyncMessage = rows.reduce<string | null>((acc, row) => maxIsoDate(acc, row.created_at), null);
    const oldestRow = rows[rows.length - 1];
    // Ensure oldestMessageDate is always an ISO string, not a Date object
    const rawOldestDate = oldestRow?.created_at;
    const oldestMessageDate = rawOldestDate
        ? (rawOldestDate instanceof Date ? rawOldestDate.toISOString() : String(rawOldestDate))
        : null;
    const oldestMessageId = oldestRow?.id || null;
    const hasMoreHistory = rows.length === limit;

    console.log('[GET_CHAT_MESSAGES_WINDOW] Pagination info:', {
        rowsCount: rows.length,
        limit,
        hasMoreHistory,
        oldestMessageDate,
        oldestMessageId
    });

    return { messages, lastSyncMessage, oldestMessageDate, oldestMessageId, hasMoreHistory, contact: targetContact };
}

async function fetchMessageDeltas({
    chatId,
    since,
    timezone,
    workspaceId,
    userId,
}: {
    chatId: string;
    since: string;
    timezone: string;
    workspaceId: string;
    userId: string;
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
        JOIN user_workspace_roles uwr
          ON uwr.workspace_id = c.workspace_id
         AND uwr.user_id = $4
        LEFT JOIN contacts cont
          ON cont.id = c.contact_id
         AND cont.workspace_id = c.workspace_id
        WHERE m.chat_id = $1
          AND m.created_at >= $2
          AND c.workspace_id = $3
          AND m.workspace_id = c.workspace_id
        ORDER BY m.created_at ASC
        `,
        [chatId, since, workspaceId, userId]
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
    systemAgentsMap: Map<string, Pick<SystemAgent, 'id' | 'name' | 'avatar_url' | 'type'>>,
    metadataShape: 'full' | 'preview' = 'full'
): Message {
    const createdAt = new Date(row.created_at);
    const zonedDate = toZonedTime(createdAt, timezone);
    const metadata = parseMetadata(row.metadata, metadataShape);
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
    systemAgentsMap: Map<string, Pick<SystemAgent, 'id' | 'name' | 'avatar_url' | 'type'>>
): MessageSender {
    if (row.from_me) {
        if (row.sender_user_id && agentsMap.has(row.sender_user_id)) {
            const agent = agentsMap.get(row.sender_user_id)!;
            return {
                type: 'user',
                id: agent.id,
                name: agent.full_name,
                avatar_url: agent.avatar_url || undefined,
            };
        }
        if (row.sender_system_agent_id && systemAgentsMap.has(row.sender_system_agent_id)) {
            const systemAgent = systemAgentsMap.get(row.sender_system_agent_id)!;
            return {
                type: 'system_agent',
                id: systemAgent.id,
                name: systemAgent.name,
                avatar_url: systemAgent.avatar_url || undefined,
            };
        }
        return { type: 'user', id: 'unknown', name: 'Sistema' };
    }

    return {
        type: 'contact',
        id: contact?.id || row.contact_id || 'unknown',
        name: contact?.name || row.contact_name || 'Contato',
        avatar_url: contact?.avatar_url || row.contact_avatar_url || undefined,
    };
}

export const toggleChatAutopilot = withDebug(
    'toggle_chat_autopilot',
    async function toggleChatAutopilot(chatId: string, isActive: boolean, agentId: string | null = null): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            const chatAccess = await requireChatAccess(user.id, chatId);
            if (!chatAccess.ok) return { success: false, error: chatAccess.error };

            const copilotMode = isActive ? 'suggest' : 'off';
            const updateResult = await db.query(`
                UPDATE chats 
                SET is_autopilot_active = $1, 
                    autopilot_config_id = $2,
                    copilot_mode = $4
                WHERE id = $3
                  AND ($1 = FALSE OR status <> 'encerrados')
            `, [isActive, agentId, chatId, copilotMode]);

            if (isActive && updateResult.rowCount === 0) {
                return { success: false, error: 'Nao e possivel ativar o Robo em uma conversa encerrada.' };
            }

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

import { logToDebugFile } from '@/lib/debug-file';

export const updateChatCopilotModeAction = withDebug(
    'update_chat_copilot_mode',
    async function updateChatCopilotModeAction(chatId: string, mode: 'auto' | 'suggest' | 'off'): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        logToDebugFile(`[updateChatCopilotModeAction] Request: chatId=${chatId}, mode=${mode}`);

        try {
            const chatAccess = await requireChatAccess(user.id, chatId);
            if (!chatAccess.ok) return { success: false, error: chatAccess.error };

            const updateResult = await db.query(`
                UPDATE chats 
                SET copilot_mode = $1
                WHERE id = $2
                  AND ($1 = 'off' OR status <> 'encerrados')
            `, [mode, chatId]);

            if (mode !== 'off' && updateResult.rowCount === 0) {
                return { success: false, error: 'Nao e possivel ativar o Copiloto em uma conversa encerrada.' };
            }

            logToDebugFile(`[updateChatCopilotModeAction] Success update for chatId=${chatId}`);

            revalidatePath('/', 'layout');
            return { success: true };
        } catch (error: any) {
            logToDebugFile(`[updateChatCopilotModeAction] Error: ${error.message}`);
            console.error("Erro ao atualizar modo do copilot:", error);
            return { success: false, error: "Falha ao atualizar modo do copilot." };
        }
    },
    {
        contextResolver: (chatId, mode) => ({ payload: { chatId, mode } })
    }
);

function maxIsoDate(d1: string | null, d2: string | Date | null): string | null {
    if (!d1) return d2 ? (d2 instanceof Date ? d2.toISOString() : String(d2)) : null;
    if (!d2) return d1;
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    return date1 > date2 ? d1 : (d2 instanceof Date ? d2.toISOString() : String(d2));
}

function parseMetadata(metadata: any, shape: 'full' | 'preview'): MessageMetadata {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata);
        } catch (e) {
            return {};
        }
    }
    return metadata;
}
