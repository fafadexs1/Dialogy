

'use server';

import { db } from '@/lib/db';
import type { SystemAgent } from '@/lib/types';
import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    // For now, let's assume any logged in user can manage agents.
    // Replace with actual permission check later.
    const res = await db.query(`SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2`, [userId, workspaceId]);
    return res.rowCount > 0;
}

export async function getSystemAgents(workspaceId: string): Promise<{ agents: SystemAgent[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { agents: null, error: "Usuário não autenticado." };

    if (!await hasPermission(user.id, workspaceId, 'automations:manage')) {
         return { agents: null, error: "Acesso não autorizado." };
    }

    try {
        const res = await db.query('SELECT * FROM system_agents WHERE workspace_id = $1 ORDER BY created_at DESC', [workspaceId]);
        return { agents: res.rows };
    } catch (error) {
        console.error("[GET_SYSTEM_AGENTS] Error:", error);
        return { agents: null, error: "Falha ao buscar agentes do sistema." };
    }
}


export async function createSystemAgent(
    workspaceId: string,
    data: Pick<SystemAgent, 'name' | 'avatar_url' | 'webhook_url'> & Partial<Pick<SystemAgent, 'type' | 'handoff_system_agent_id' | 'hide_from_chatlist'>>
): Promise<{ success: boolean; error?: string, agent?: SystemAgent }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    if (!await hasPermission(user.id, workspaceId, 'automations:manage')) {
        return { success: false, error: "Você não tem permissão para criar agentes." };
    }

    // Validate webhook URL if provided
    const webhookUrl = data.webhook_url?.trim();

    if (webhookUrl) {
        try {
            const url = new URL(webhookUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error();
            }
        } catch (_) {
            return { success: false, error: "A URL do Webhook fornecida é inválida. Ela deve ser uma URL completa (ex: https://seu-site.com/webhook)." };
        }
    }
    
    // Generate a secure, unique token
    const token = `dgy_${randomBytes(24).toString('hex')}`;

    try {
        const webhookValue = webhookUrl || null;
        const res = await db.query(
            `INSERT INTO system_agents (workspace_id, name, avatar_url, webhook_url, token, created_by_id, type, handoff_system_agent_id, hide_from_chatlist)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false)) RETURNING *`,
            [workspaceId, data.name, data.avatar_url || null, webhookValue, token, user.id, data.type || 'default', data.handoff_system_agent_id || null, data.hide_from_chatlist]
        );
        revalidatePath('/automations/robots');
        return { success: true, agent: res.rows[0] };
    } catch (error: any) {
        console.error("[CREATE_SYSTEM_AGENT] Error:", error);
         if (error.code === '23505') { // unique_violation
            return { success: false, error: "Já existe um agente com este nome neste workspace." };
        }
        return { success: false, error: "Falha ao criar o agente no banco de dados." };
    }
}

export async function updateSystemAgent(
    agentId: string,
    data: Pick<SystemAgent, 'name' | 'avatar_url' | 'webhook_url'> & Partial<Pick<SystemAgent, 'type' | 'handoff_system_agent_id' | 'hide_from_chatlist'>>
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    try {
        const agentRes = await db.query('SELECT workspace_id FROM system_agents WHERE id = $1', [agentId]);
        if (agentRes.rowCount === 0) return { success: false, error: 'Agente não encontrado.' };
        const workspaceId = agentRes.rows[0].workspace_id;

        if (!await hasPermission(user.id, workspaceId, 'automations:manage')) {
            return { success: false, error: "Você não tem permissão para editar agentes." };
        }
        
        const webhookUrl = data.webhook_url?.trim();

        if (webhookUrl) {
            try {
                const url = new URL(webhookUrl);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
            } catch (_) {
                return { success: false, error: "A URL do Webhook fornecida é inválida." };
            }
        }

        const webhookValue = webhookUrl || null;

        await db.query(
            `UPDATE system_agents SET 
                name = $1, 
                avatar_url = $2, 
                webhook_url = $3,
                type = COALESCE($4, type),
                handoff_system_agent_id = COALESCE($5, handoff_system_agent_id),
                hide_from_chatlist = COALESCE($6, hide_from_chatlist)
             WHERE id = $7`,
            [data.name, data.avatar_url || null, webhookValue, data.type || null, data.handoff_system_agent_id || null, data.hide_from_chatlist, agentId]
        );
        
        revalidatePath('/automations/robots');
        return { success: true };

    } catch (error: any) {
        console.error("[UPDATE_SYSTEM_AGENT] Error:", error);
         if (error.code === '23505') { // unique_violation
            return { success: false, error: "Já existe um agente com este nome neste workspace." };
        }
        return { success: false, error: "Falha ao atualizar o agente no banco de dados." };
    }
}


export async function deleteSystemAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    try {
        const agentRes = await db.query('SELECT workspace_id FROM system_agents WHERE id = $1', [agentId]);
        if(agentRes.rowCount === 0) return { success: false, error: 'Agente não encontrado.'};
        const workspaceId = agentRes.rows[0].workspace_id;

        if (!await hasPermission(user.id, workspaceId, 'automations:manage')) {
            return { success: false, error: "Você não tem permissão para remover agentes." };
        }

        await db.query('DELETE FROM system_agents WHERE id = $1', [agentId]);
        revalidatePath('/automations/robots');
        return { success: true };
    } catch (error) {
        console.error("[DELETE_SYSTEM_AGENT] Error:", error);
        return { success: false, error: "Falha ao remover o agente." };
    }
}

// TODO: Add a 'toggleSystemAgentActive' action

    
