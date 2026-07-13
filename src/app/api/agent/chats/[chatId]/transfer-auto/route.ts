'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import type { Chat } from '@/lib/types';
import { getPresenceTtlSeconds } from '@/lib/presence';

/**
 * Find the team with the lowest normalized live portfolio. Agent selection is
 * delegated to the same fair, atomic allocator used by every team transfer.
 */
async function findAvailableTeam(workspaceId: string): Promise<{ teamId: string; teamName: string } | null> {
    try {
        const ttlSeconds = getPresenceTtlSeconds();

        const result = await db.query(
            `
            SELECT
                t.id AS team_id,
                t.name AS team_name,
                COUNT(DISTINCT active_chat.id)::numeric
                  / GREATEST(COUNT(DISTINCT tm.user_id), 1) AS portfolio_per_available_agent
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            JOIN user_workspace_presence uwp
              ON uwp.user_id = tm.user_id
             AND uwp.workspace_id = t.workspace_id
             AND uwp.is_online = TRUE
             AND uwp.last_seen > NOW() - ($2 * interval '1 second')
            LEFT JOIN team_agent_distribution_state ds
              ON ds.workspace_id = t.workspace_id
             AND ds.team_id = t.id
             AND ds.user_id = tm.user_id
            LEFT JOIN chats active_chat
              ON active_chat.workspace_id = t.workspace_id
             AND active_chat.agent_id = tm.user_id
             AND active_chat.status = 'atendimentos'
            WHERE t.workspace_id = $1
              AND COALESCE(ds.accepting_assignments, TRUE) = TRUE
            GROUP BY t.id, t.name
            HAVING COUNT(DISTINCT tm.user_id) > 0
            ORDER BY portfolio_per_available_agent ASC, t.id ASC
            LIMIT 1
            `,
            [workspaceId, ttlSeconds]
        );

        if (result.rowCount === 0) {
            return null;
        }

        return {
            teamId: result.rows[0].team_id,
            teamName: result.rows[0].team_name
        };
    } catch (error) {
        console.error('[TRANSFER_AUTO] Error finding available agent:', error);
        return null;
    }
}

/**
 * Authenticate the system agent and validate the chat.
 */
async function authenticateAndValidate(request: Request, chatId: string) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return { error: 'Authorization token is required.', status: 401, agent: null, chat: null };
    }

    const agentRes = await db.query('SELECT * FROM system_agents WHERE token = $1', [token]);
    if (agentRes.rowCount === 0) {
        return { error: 'Invalid token.', status: 403, agent: null, chat: null };
    }
    const agent = agentRes.rows[0];

    if (!agent.is_active) {
        return { error: 'Agent is not active.', status: 403, agent: null, chat: null };
    }

    const chatRes = await db.query('SELECT * FROM chats WHERE id = $1', [chatId]);
    if (chatRes.rowCount === 0) {
        return { error: 'Chat not found.', status: 404, agent: null, chat: null };
    }
    const chat = chatRes.rows[0] as Chat;

    if (agent.workspace_id !== chat.workspace_id) {
        return { error: 'Agent and chat do not belong to the same workspace.', status: 403, agent: null, chat: null };
    }

    return { error: null, status: 200, agent, chat };
}

/**
 * POST /api/agent/chats/[chatId]/transfer-auto
 * 
 * Automatically transfers a chat to any available online agent in the workspace
 * who is a member of at least one team.
 * 
 * Authentication: Bearer token from system_agents table
 * 
 * Response:
 * - 200: { success: true, agentId: string, agentName: string }
 * - 409: No agents available
 * - 401/403: Authentication errors
 * - 404: Chat not found
 * - 500: Server error
 */
export async function POST(
    request: Request,
    props: { params: Promise<{ chatId: string }> }
) {
    const params = await props.params;
    const { chatId } = params;

    // Authenticate the system agent
    const authResult = await authenticateAndValidate(request, chatId);
    if (authResult.error || !authResult.agent) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    try {
        // Find an available online agent who is in at least one team
        const availableTeam = await findAvailableTeam(authResult.agent.workspace_id);

        if (!availableTeam) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Nenhum agente disponível no momento. Todos os agentes estão offline ou não pertencem a nenhuma equipe.'
                },
                { status: 409 }
            );
        }

        // Transfer the chat to the found agent
        const result = await transferChatAction({
            chatId,
            teamId: availableTeam.teamId,
        }, {
            user: {
                id: authResult.agent.id,
                name: authResult.agent.name,
            },
            isSystemAgent: true
        });

        if (result.success) {
            return NextResponse.json({
                success: true,
                message: 'Chat transferido com sucesso.',
                teamId: availableTeam.teamId,
                teamName: availableTeam.teamName,
                agentId: result.assignedAgent?.id,
                agentName: result.assignedAgent?.name
            });
        } else {
            const unavailable = result.error?.includes('Nenhum agente dispon');
            return NextResponse.json(
                { success: false, error: result.error || 'Falha ao transferir o chat.' },
                { status: unavailable ? 409 : 500 }
            );
        }

    } catch (error: any) {
        console.error('[TRANSFER_AUTO] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
