
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import type { AutopilotConfig, NexusFlowInstance } from '@/lib/types';

// Helper function to check for admin role
async function isWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN roles r ON uwr.role_id = r.id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND r.name = 'Administrador'
    `, [userId, workspaceId]);
    return res.rowCount > 0;
}

// Helper function to check for a specific permission
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
    const userId = session.user.id;

    // First check if user is an admin, which bypasses specific permission checks
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);
    
    // If not an admin, check for specific permission
    if (!isAdmin && !await hasPermission(userId, workspaceId, 'autopilot:view')) {
        return { config: null, rules: null, error: "Acesso não autorizado." };
    }

    try {
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1', [workspaceId]);
        
        // This is not an error, it just means no config has been created yet.
        // The setup trigger should have created one, but we can handle it gracefully.
        if (configRes.rowCount === 0) {
            return { config: null, rules: [] };
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

    if (!workspaceId) {
        return { success: false, error: 'ID de Workspace é obrigatório.' };
    }

    // Permission Check: Admin or has specific edit permission
    const isAdmin = await isWorkspaceAdmin(session.user.id, workspaceId);
    if (!isAdmin && !await hasPermission(session.user.id, workspaceId, 'autopilot:edit')) {
        return { success: false, error: "Você não tem permissão para editar as configurações." };
    }
    
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        
        let currentConfigId = configId;

        // If configId is not present, it means we might need to create a config first
        if (!currentConfigId) {
            const existingConfig = await client.query('SELECT id FROM autopilot_configs WHERE workspace_id = $1', [workspaceId]);
            if (existingConfig.rowCount > 0) {
                currentConfigId = existingConfig.rows[0].id;
            } else {
                // This will create a new config with default values if it doesn't exist
                const newConfigRes = await client.query(
                    'INSERT INTO autopilot_configs (workspace_id) VALUES ($1) RETURNING id',
                    [workspaceId]
                );
                currentConfigId = newConfigRes.rows[0].id;
            }
        }
        
        const fieldsToUpdate: { [key: string]: any } = {};
        if (formData.has('geminiApiKey')) fieldsToUpdate.gemini_api_key = formData.get('geminiApiKey');
        if (formData.has('aiModel')) fieldsToUpdate.ai_model = formData.get('aiModel');
        if (formData.has('knowledgeBase')) fieldsToUpdate.knowledge_base = formData.get('knowledgeBase');
        
        const fieldNames = Object.keys(fieldsToUpdate);
        if (fieldNames.length === 0) {
            await client.query('COMMIT');
            return { success: true }; // Nothing to update
        }

        const setClauses = fieldNames.map((key, index) => `${key} = $${index + 1}`).join(', ');
        const values = Object.values(fieldsToUpdate);

        const query = `
            UPDATE autopilot_configs
            SET ${setClauses}, updated_at = NOW()
            WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2}
        `;
        
        await client.query(query, [...values, currentConfigId, workspaceId]);

        await client.query('COMMIT');
        
        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SAVE_AUTOPILOT_CONFIG]', error);
        return { success: false, error: "Falha ao salvar as configurações no banco de dados." };
    } finally {
        client.release();
    }
}
