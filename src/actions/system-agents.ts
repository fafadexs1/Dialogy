

'use server';

import { db } from '@/lib/db';
import type { SystemAgent } from '@/lib/types';
import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

const DEFAULT_SYSTEM_AGENT_AVATAR_URL = '/integration-fallback.svg';

export async function getSystemAgents(workspaceId: string): Promise<{ agents: SystemAgent[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { agents: null, error: "Usuário não autenticado." };

    if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) {
        return { agents: null, error: "Acesso não autorizado." };
    }

    try {
        const res = await db.query(
            `SELECT
                sa.*,
                ac.name AS autopilot_config_name,
                t.name AS team_name
             FROM system_agents sa
             LEFT JOIN autopilot_configs ac ON ac.id = sa.autopilot_config_id
             LEFT JOIN teams t ON t.id = sa.team_id
             WHERE sa.workspace_id = $1
             ORDER BY sa.created_at DESC`,
            [workspaceId]
        );
        return { agents: res.rows };
    } catch (error) {
        console.error("[GET_SYSTEM_AGENTS] Error:", error);
        return { agents: null, error: "Falha ao buscar agentes do sistema." };
    }
}


export async function createSystemAgent(
    workspaceId: string,
    data: Pick<SystemAgent, 'name' | 'avatar_url' | 'webhook_url'> & Partial<Pick<SystemAgent, 'type' | 'handoff_system_agent_id' | 'hide_from_chatlist' | 'autopilot_config_id' | 'team_id'>>
): Promise<{ success: boolean; error?: string, agent?: SystemAgent }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) {
        return { success: false, error: "Você não tem permissão para criar agentes." };
    }

    // Validate webhook URL if provided
    const webhookUrl = data.webhook_url?.trim();
    const agentType = data.type || 'default';

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

    if (agentType === 'intelligent_attendant' && !data.autopilot_config_id) {
        return { success: false, error: 'Selecione uma configuração de IA para o Atendente Inteligente.' };
    }

    if (data.autopilot_config_id) {
        const configRes = await db.query(
            'SELECT 1 FROM autopilot_configs WHERE id = $1 AND workspace_id = $2 LIMIT 1',
            [data.autopilot_config_id, workspaceId]
        );
        if ((configRes.rowCount ?? 0) === 0) {
            return { success: false, error: 'Configuração de IA não encontrada neste workspace.' };
        }
    }

    if (data.team_id) {
        const teamRes = await db.query(
            'SELECT 1 FROM teams WHERE id = $1 AND workspace_id = $2 LIMIT 1',
            [data.team_id, workspaceId]
        );
        if ((teamRes.rowCount ?? 0) === 0) {
            return { success: false, error: 'Setor/equipe não encontrado neste workspace.' };
        }
    }

    // Generate a secure, unique token
    const token = `dgy_${randomBytes(24).toString('hex')}`;

    try {
        const webhookValue = webhookUrl || null;
        const avatarUrl = data.avatar_url?.trim() || DEFAULT_SYSTEM_AGENT_AVATAR_URL;
        const res = await db.query(
            `INSERT INTO system_agents (
                workspace_id, name, avatar_url, webhook_url, token, created_by_id,
                type, handoff_system_agent_id, hide_from_chatlist, autopilot_config_id, team_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false), $10, $11)
             RETURNING *`,
            [
                workspaceId,
                data.name,
                avatarUrl,
                webhookValue,
                token,
                user.id,
                agentType,
                data.handoff_system_agent_id || null,
                data.hide_from_chatlist,
                data.autopilot_config_id || null,
                data.team_id || null,
            ]
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
    data: Pick<SystemAgent, 'name' | 'avatar_url' | 'webhook_url'> & Partial<Pick<SystemAgent, 'type' | 'handoff_system_agent_id' | 'hide_from_chatlist' | 'autopilot_config_id' | 'team_id'>>
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    try {
        const agentRes = await db.query('SELECT workspace_id, type FROM system_agents WHERE id = $1', [agentId]);
        if ((agentRes.rowCount || 0) === 0) return { success: false, error: 'Agente não encontrado.' };
        const workspaceId = agentRes.rows[0].workspace_id;

        if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) {
            return { success: false, error: "Você não tem permissão para editar agentes." };
        }

        const webhookUrl = data.webhook_url?.trim();
        const agentType = data.type || agentRes.rows[0].type || 'default';

        if (webhookUrl) {
            try {
                const url = new URL(webhookUrl);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
            } catch (_) {
                return { success: false, error: "A URL do Webhook fornecida é inválida." };
            }
        }

        if (agentType === 'intelligent_attendant' && !data.autopilot_config_id) {
            return { success: false, error: 'Selecione uma configuração de IA para o Atendente Inteligente.' };
        }

        if (data.autopilot_config_id) {
            const configRes = await db.query(
                'SELECT 1 FROM autopilot_configs WHERE id = $1 AND workspace_id = $2 LIMIT 1',
                [data.autopilot_config_id, workspaceId]
            );
            if ((configRes.rowCount ?? 0) === 0) {
                return { success: false, error: 'Configuração de IA não encontrada neste workspace.' };
            }
        }

        if (data.team_id) {
            const teamRes = await db.query(
                'SELECT 1 FROM teams WHERE id = $1 AND workspace_id = $2 LIMIT 1',
                [data.team_id, workspaceId]
            );
            if ((teamRes.rowCount ?? 0) === 0) {
                return { success: false, error: 'Setor/equipe não encontrado neste workspace.' };
            }
        }

        const webhookValue = webhookUrl || null;
        const avatarUrl = data.avatar_url?.trim() || DEFAULT_SYSTEM_AGENT_AVATAR_URL;

        await db.query(
            `UPDATE system_agents SET 
                name = $1, 
                avatar_url = $2, 
                webhook_url = $3,
                type = $4,
                handoff_system_agent_id = $5,
                hide_from_chatlist = COALESCE($6, hide_from_chatlist),
                autopilot_config_id = $7,
                team_id = $8
             WHERE id = $9`,
            [
                data.name,
                avatarUrl,
                webhookValue,
                agentType,
                data.handoff_system_agent_id || null,
                data.hide_from_chatlist,
                data.autopilot_config_id || null,
                data.team_id || null,
                agentId,
            ]
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
        if ((agentRes.rowCount || 0) === 0) return { success: false, error: 'Agente não encontrado.' };
        const workspaceId = agentRes.rows[0].workspace_id;

        if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) {
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


