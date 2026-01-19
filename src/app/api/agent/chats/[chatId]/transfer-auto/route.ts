'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import type { Chat } from '@/lib/types';
import { getPresenceTtlSeconds } from '@/lib/presence';

/**
 * Find any online agent in the workspace who is a member of at least one team.
 * Returns a random online agent from the pool.
 */
async function findAvailableAgent(workspaceId: string): Promise<{ userId: string; userName: string } | null> {
    try {
        const ttlSeconds = getPresenceTtlSeconds();

        // Find all online users who are members of at least one team in this workspace
        const result = await db.query(
            `
            SELECT DISTINCT u.id as user_id, u.name as user_name
            FROM users u
            JOIN team_members tm ON tm.user_id = u.id
            JOIN teams t ON t.id = tm.team_id
            JOIN user_workspace_presence uwp 
                ON uwp.user_id = u.id 
                AND uwp.workspace_id = $1
            WHERE t.workspace_id = $1
              AND uwp.is_online = TRUE
              AND uwp.last_seen > NOW() - ($2 * interval '1 second')
            ORDER BY RANDOM()
            LIMIT 1;
            `,
            [workspaceId, ttlSeconds]
        );

        if (result.rowCount === 0) {
            return null;
        }

        return {
            userId: result.rows[0].user_id,
            userName: result.rows[0].user_name
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
        const availableAgent = await findAvailableAgent(authResult.agent.workspace_id);

        if (!availableAgent) {
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
            agentId: availableAgent.userId,
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
                agentId: availableAgent.userId,
                agentName: availableAgent.userName
            });
        } else {
            return NextResponse.json(
                { success: false, error: result.error || 'Falha ao transferir o chat.' },
                { status: 500 }
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
