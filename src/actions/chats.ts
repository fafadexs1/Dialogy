
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

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

/**
 * Atribui o chat atual ao agente logado.
 * Esta ação é chamada pelo botão "Assumir Atendimento".
 */
export async function assignChatToSelfAction(chatId: string): Promise<{ success: boolean, error?: string}> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
        return { success: false, error: "Usuário não autenticado." };
    }
    const currentAgentId = session.user.id;

    if (!chatId) {
        return { success: false, error: "ID do Chat é obrigatório." };
    }

    try {
        const result = await db.query(
            "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2 AND agent_id IS NULL",
            [currentAgentId, chatId]
        );

        if (result.rowCount === 0) {
            // Isso pode acontecer se outro agente assumiu o chat milissegundos antes.
            return { success: false, error: "Este atendimento já foi assumido por outro agente." };
        }

        console.log(`[ASSIGN_CHAT_SELF] Chat ${chatId} atribuído ao agente ${currentAgentId}.`);
        revalidatePath('/', 'layout');
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
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    
    let sessionToUse = prefetchedSession;
    
    if (!sessionToUse) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            sessionToUse = { user: { id: session.user.id, name: session.user.user_metadata.full_name, email: session.user.email } };
        }
    }

    if (!sessionToUse?.user?.id || !sessionToUse?.user?.name) {
        return { success: false, error: "Usuário não autenticado." };
    }
    const currentAgentId = sessionToUse.user.id;
    const currentAgentName = sessionToUse.user.name;

    const { chatId, teamId, agentId } = input;

    if (!chatId || (!teamId && !agentId)) {
        return { success: false, error: "Parâmetros inválidos para transferência." };
    }
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatRes = await client.query('SELECT workspace_id, agent_id as current_chat_agent_id, status FROM chats WHERE id = $1', [chatId]);
        if (chatRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: "Conversa não encontrada." };
        }
        const { workspace_id: workspaceId, current_chat_agent_id, status } = chatRes.rows[0];
        
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

        // Load balancing logic for team transfer
        if (teamId) {
            console.log(`[TRANSFER_CHAT] Transferindo para equipe ${teamId}. Buscando agente com base no tempo desde a última atribuição...`);
            const agentRes = await client.query(`
                SELECT
                    u.id as "agentId",
                    u.full_name as "agentName",
                    t.name as "teamName",
                    MAX(c.assigned_at) as "lastAssigned"
                FROM users u
                JOIN team_members tm ON u.id = tm.user_id
                JOIN teams t ON tm.team_id = t.id
                LEFT JOIN chats c ON u.id = c.agent_id
                WHERE tm.team_id = $1 AND u.online = TRUE
                GROUP BY u.id, t.name
                ORDER BY "lastAssigned" ASC NULLS FIRST, random()
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
        revalidatePath('/', 'layout');
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
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user?.id || !session.user.user_metadata.full_name) {
        return { success: false, error: "Usuário não autenticado." };
    }

    const currentAgentId = session.user.id;
    const currentAgentName = session.user.user_metadata.full_name;

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

        let tagInfo = { label: null, color: null };
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
                close_notes = $2,
                tag = $3,
                color = $4
             WHERE id = $5`,
            [reasonTagId, notes, tagInfo.label, tagInfo.color, chatId]
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
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro ao encerrar atendimento:", error);
        const errorMessage = error instanceof Error ? `Erro ao encerrar atendimento: ${error.message}` : "Falha no servidor ao encerrar o atendimento.";
        return { success: false, error: errorMessage };
    } finally {
        client.release();
    }
}


export async function updateChatTagAction(chatId: string, tagId: string): Promise<{ success: boolean; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
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
}
