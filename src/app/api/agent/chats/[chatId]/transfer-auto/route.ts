'use server';

import { randomUUID } from 'crypto';
import { transferSnapshot } from '@/services/chat-distribution/transfer-snapshot';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import type { Chat } from '@/lib/types';
import { createTrustedActorContext } from '@/lib/security/trusted-server-context';
import { describeTeamUnavailability } from '@/services/chat-distribution/team-availability';
import { rankAssignableTeams } from '@/services/chat-distribution/team-availability-server';

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
 * Ranks every team that can receive a chat right now — online members, within
 * business hours, accepting assignments, with portfolio room — from the least
 * to the most loaded, then walks that list until one accepts. Agent selection
 * inside the team is delegated to the same fair, atomic allocator used by every
 * team transfer.
 *
 * Authentication: Bearer token from system_agents table
 *
 * Response:
 * - 200: { success: true, teamId, teamName, agentId, agentName }
 * - 409: No team can take the chat right now (body carries the actual reason)
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
        // Todas as equipes que podem receber agora, da menos carregada para a
        // mais carregada. A lista inteira importa: escolher só a primeira e
        // desistir era o que fazia a transferência automática falhar quando a
        // equipe mais folgada estava fechada ou lotada.
        const operationId = request.headers.get('Idempotency-Key') || randomUUID();
        const preconditions = await transferSnapshot(authResult.agent.workspace_id,authResult.agent.id,operationId,chatId);
        const previous=await db.query(`SELECT op.team_id,t.name FROM chat_transfer_operations op JOIN teams t ON t.id=op.team_id
          WHERE op.workspace_id=$1 AND op.actor_id=$2 AND op.operation_id=$3 AND op.chat_id=$4`,
          [authResult.agent.workspace_id,authResult.agent.id,operationId,chatId]);
        const candidateTeams = previous.rows[0] ? [{teamId:previous.rows[0].team_id,teamName:previous.rows[0].name}]
          : await rankAssignableTeams(authResult.agent.workspace_id);

        if (candidateTeams.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Nenhuma equipe pode receber o atendimento agora. Verifique se há agentes online, dentro do expediente e com distribuição ativa.'
                },
                { status: 409 }
            );
        }

        // Corrida entre a leitura e a atribuição é normal: entre listar e
        // transferir, o agente pode sair ou bater o teto. Por isso tentamos as
        // equipes em ordem em vez de tratar a primeira recusa como fim.
        let lastFailure: { error: string; teamName: string } | null = null;

        for (const team of candidateTeams) {
            const result = await transferChatAction({
                chatId, operationId, ...preconditions,
                teamId: team.teamId,
            }, createTrustedActorContext({
                user: {
                    id: authResult.agent.id,
                    name: authResult.agent.name,
                },
                isSystemAgent: true
            }));

            if (result.success) {
                return NextResponse.json({
                    success: true,
                    message: 'Chat transferido com sucesso.',
                    operationId:result.operationId,outcome:result.outcome,
                    teamId: team.teamId,
                    teamName: team.teamName,
                    agentId: result.assignedAgent?.id,
                    agentName: result.assignedAgent?.name
                });
            }

            if (!result.reasonCode) {
                // Falha que não é indisponibilidade (chat encerrado, erro de
                // servidor): tentar outra equipe não muda nada.
                return NextResponse.json(
                    { success: false, error: result.error || 'Falha ao transferir o chat.' },
                    { status: 500 }
                );
            }

            console.log(`[TRANSFER_AUTO] Equipe ${team.teamName} recusou (${result.reasonCode}). Tentando a próxima.`);
            lastFailure = {
                error: result.error || describeTeamUnavailability(result.reasonCode, team.teamName),
                teamName: team.teamName,
            };
        }

        return NextResponse.json(
            {
                success: false,
                error: lastFailure?.error || 'Nenhuma equipe pode receber o atendimento agora.'
            },
            { status: 409 }
        );

    } catch (error: any) {
        console.error('[TRANSFER_AUTO] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
