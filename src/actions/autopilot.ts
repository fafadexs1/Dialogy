
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import type { AutopilotConfig, NexusFlowInstance } from '@/lib/types';

// Helper function to check for admin permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    return res.rowCount > 0;
}


export async function getAutopilotConfig(workspaceId: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    error?: string
}> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { config: null, rules: null, error: "Usuário não autenticado." };

    if (!await hasPermission(session.user.id, workspaceId, 'autopilot:view')) {
        return { config: null, rules: null, error: "Acesso não autorizado." };
    }

    try {
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1', [workspaceId]);
        if (configRes.rowCount === 0) {
            return { config: null, rules: [], error: "Nenhuma configuração encontrada." };
        }
        const config = configRes.rows[0];

        const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1', [config.id]);
        const rules = rulesRes.rows.map(r => ({ ...r, action: JSON.parse(r.action) }));

        return { config, rules };

    } catch (error) {
        console.error('[GET_AUTOPILOT_CONFIG]', error);
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

    const workspaceId = formData.get('workspaceId') as string;
    const configId = formData.get('configId') as string;
    const geminiApiKey = formData.get('geminiApiKey') as string;
    const aiModel = formData.get('aiModel') as string;
    const knowledgeBase = formData.get('knowledgeBase') as string;

    if (!workspaceId) {
        return { success: false, error: 'ID do Workspace é obrigatório.' };
    }

    if (!await hasPermission(session.user.id, workspaceId, 'autopilot:edit')) {
        return { success: false, error: "Você não tem permissão para editar as configurações." };
    }

    try {
        const query = `
            UPDATE autopilot_configs
            SET
                gemini_api_key = $1,
                ai_model = $2,
                knowledge_base = $3,
                updated_at = NOW()
            WHERE id = $4 AND workspace_id = $5
        `;
        await db.query(query, [geminiApiKey, aiModel, knowledgeBase, configId, workspaceId]);

        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        console.error('[SAVE_AUTOPILOT_CONFIG]', error);
        return { success: false, error: "Falha ao salvar as configurações no banco de dados." };
    }
}
