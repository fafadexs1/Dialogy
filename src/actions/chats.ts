
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

export async function assignChatToAgentAction(chatId: string): Promise<{ success: boolean, error?: string}> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: "Usuário não autenticado." };
    }
    const currentAgentId = session.user.id;

    if (!chatId) {
        return { success: false, error: "ID do Chat é obrigatório." };
    }

    try {
        await db.query(
            "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2 AND agent_id IS NULL",
            [currentAgentId, chatId]
        );
        console.log(`[ASSIGN_CHAT] Chat ${chatId} atribuído ao agente ${currentAgentId}.`);
        return { success: true };
    } catch (error) {
        console.error("Erro ao atribuir chat:", error);
        return { success: false, error: "Falha no servidor ao atribuir o atendimento." };
    }
}


export async function transferChatAction(
    input: { chatId: string; teamId?: string; agentId?: string }
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.user?.name) {
        return { success: false, error: "Usuário não autenticado." };
    }
    const currentAgentId = session.user.id;
    const currentAgentName = session.user.name;

    const { chatId, teamId, agentId } = input;

    if (!chatId || (!teamId && !agentId)) {
        return { success: false, error: "Parâmetros inválidos para transferência." };
    }
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatRes = await client.query('SELECT workspace_id, agent_id as current_chat_agent_id FROM chats WHERE id = $1', [chatId]);
        if (chatRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: "Conversa não encontrada." };
        }
        const { workspace_id: workspaceId, current_chat_agent_id } = chatRes.rows[0];
        
        if (!await hasPermission(currentAgentId, workspaceId, 'teams:view')) { // Permission to be defined
            await client.query('ROLLBACK');
            return { success: false, error: "Você não tem permissão para transferir atendimentos." };
        }

        let finalAgentId = agentId;
        let transferTargetName = '';

        // Load balancing logic for team transfer
        if (teamId) {
            console.log(`[TRANSFER_CHAT] Transferindo para equipe ${teamId}. Buscando agente...`);
            const agentRes = await client.query(`
                SELECT
                    u.id as "agentId",
                    u.full_name as "agentName",
                    t.name as "teamName",
                    COUNT(c.id) as "activeChats"
                FROM users u
                JOIN team_members tm ON u.id = tm.user_id
                JOIN teams t ON tm.team_id = t.id
                LEFT JOIN chats c ON u.id = c.agent_id AND c.status = 'atendimentos'
                WHERE tm.team_id = $1 AND u.online = TRUE
                GROUP BY u.id, t.name
                ORDER BY "activeChats" ASC, random()
                LIMIT 1;
            `, [teamId]);

            if (agentRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "Nenhum agente online disponível nesta equipe no momento." };
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
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.user?.name) {
        return { success: false, error: "Usuário não autenticado." };
    }

    const currentAgentId = session.user.id;
    const currentAgentName = session.user.name;
    const chatId = formData.get('chatId') as string;
    const reasonTagId = formData.get('reasonTagId') as string;
    const notes = formData.get('notes') as string;

    if (!chatId) {
        return { success: false, error: "ID do chat é obrigatório." };
    }
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatRes = await client.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
        if(chatRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Chat não encontrado.'};
        }
        const { workspace_id } = chatRes.rows[0];

        await client.query(
            `UPDATE chats
             SET 
                status = 'encerrados',
                closed_at = NOW(),
                close_reason_tag_id = $1,
                close_notes = $2
             WHERE id = $3`,
            [reasonTagId || null, notes || null, chatId]
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
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro ao encerrar atendimento:", error);
        return { success: false, error: "Falha no servidor ao encerrar o atendimento." };
    } finally {
        client.release();
    }
}

    
