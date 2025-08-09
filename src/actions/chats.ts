
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Helper function to check for permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    return res.rowCount > 0;
}

export async function transferChatAction(
    input: { chatId: string; teamId?: string; agentId?: string }
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: "Usuário não autenticado." };
    }

    const { chatId, teamId, agentId } = input;

    if (!chatId || (!teamId && !agentId)) {
        return { success: false, error: "Parâmetros inválidos para transferência." };
    }

    try {
        const chatRes = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
        if (chatRes.rows.length === 0) {
            return { success: false, error: "Conversa não encontrada." };
        }
        const { workspace_id: workspaceId } = chatRes.rows[0];
        
        // TODO: Add a specific permission for transferring chats
        // For now, we'll check if the user can at least view teams
        if (!await hasPermission(session.user.id, workspaceId, 'teams:view')) {
            return { success: false, error: "Você não tem permissão para transferir atendimentos." };
        }

        let finalAgentId = agentId;

        // Load balancing logic for team transfer
        if (teamId) {
            console.log(`[TRANSFER_CHAT] Transferindo para equipe ${teamId}. Buscando agente...`);
            // Find online members of the team with the least number of active chats
            const agentRes = await db.query(`
                SELECT
                    u.id as "agentId",
                    COUNT(c.id) as "activeChats"
                FROM users u
                JOIN team_members tm ON u.id = tm.user_id
                LEFT JOIN chats c ON u.id = c.agent_id AND c.status = 'atendimentos'
                WHERE tm.team_id = $1 AND u.online = TRUE
                GROUP BY u.id
                ORDER BY "activeChats" ASC, random()
                LIMIT 1;
            `, [teamId]);

            if (agentRes.rows.length === 0) {
                return { success: false, error: "Nenhum agente online disponível nesta equipe no momento." };
            }
            finalAgentId = agentRes.rows[0].agentId;
            console.log(`[TRANSFER_CHAT] Agente selecionado por load balance: ${finalAgentId} com ${agentRes.rows[0].activeChats} chats.`);
        }

        if (!finalAgentId) {
             return { success: false, error: "Não foi possível determinar um agente para a transferência." };
        }

        // Update chat with the new agent and status
        await db.query(`
            UPDATE chats
            SET 
                agent_id = $1,
                status = 'atendimentos',
                assigned_at = NOW()
            WHERE id = $2
        `, [finalAgentId, chatId]);
        
        console.log(`[TRANSFER_CHAT] Chat ${chatId} transferido com sucesso para o agente ${finalAgentId}.`);
        return { success: true };

    } catch (error) {
        console.error("Erro ao transferir chat:", error);
        return { success: false, error: "Falha no servidor ao tentar transferir o atendimento." };
    }
}
