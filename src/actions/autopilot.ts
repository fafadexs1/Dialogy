
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import type { AutopilotConfig, NexusFlowInstance } from '@/lib/types';

async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    const res = await db.query('SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
    return res.rowCount > 0;
}


export async function getAutopilotConfig(workspaceId: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    error?: string
}> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { config: null, rules: null, error: "Usuário não autenticado." };
    }
    const userId = session.user.id;

    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { config: null, rules: null, error: "Acesso não autorizado." };
    }

    try {
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
        
        if (configRes.rowCount === 0) {
            console.log(`[GET_AUTOPILOT_CONFIG] Nenhuma configuração encontrada para o usuário ${userId} no workspace ${workspaceId}. Retornando estado inicial.`);
            return { config: null, rules: [] };
        }
        
        const config = configRes.rows[0];

        const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name', [config.id]);
        
        const rules = rulesRes.rows.map(r => ({
            ...r,
            action: typeof r.action === 'string' ? JSON.parse(r.action) : r.action
        }));

        return { config, rules };

    } catch (error) {
        console.error(`[GET_AUTOPILOT_CONFIG] Erro detalhado ao buscar configs para o usuário ${userId} no workspace ${workspaceId}:`, error);
        return { config: null, rules: null, error: 'Falha ao buscar configurações do banco de dados.'};
    }
}


export async function saveAutopilotConfig(
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const userId = session.user.id;

    const workspaceId = formData.get('workspaceId') as string;
    if (!workspaceId) {
        return { success: false, error: 'ID de Workspace é obrigatório.' };
    }

    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { success: false, error: "Você não tem permissão para editar as configurações." };
    }
    
    try {
        const fieldsToUpdate: { [key: string]: any } = {};
        if (formData.has('geminiApiKey')) fieldsToUpdate.gemini_api_key = formData.get('geminiApiKey') || null;
        if (formData.has('aiModel')) fieldsToUpdate.ai_model = formData.get('aiModel');
        if (formData.has('knowledgeBase')) fieldsToUpdate.knowledge_base = formData.get('knowledgeBase');
        
        const fieldNames = Object.keys(fieldsToUpdate);
        if (fieldNames.length === 0) {
            return { success: true }; 
        }

        const setClauses = fieldNames.map((key, index) => `${key} = $${index + 3}`).join(', ');
        const values = fieldNames.map(key => fieldsToUpdate[key]);

        const upsertQuery = `
            INSERT INTO autopilot_configs (workspace_id, user_id, ${fieldNames.join(', ')})
            VALUES ($1, $2, ${fieldNames.map((_, i) => `$${i + 3}`).join(', ')})
            ON CONFLICT (workspace_id, user_id)
            DO UPDATE SET 
                ${setClauses},
                updated_at = NOW()
            WHERE autopilot_configs.workspace_id = $1 AND autopilot_configs.user_id = $2;
        `;
        
        await db.query(upsertQuery, [workspaceId, userId, ...values]);
        
        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        console.error('[SAVE_AUTOPILOT_CONFIG] Erro ao salvar configurações:', error);
        return { success: false, error: "Falha ao salvar as configurações no banco de dados." };
    }
}
