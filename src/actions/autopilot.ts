

'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { AutopilotConfig, NexusFlowInstance, Action, AutopilotUsageLog, KnowledgeBaseDocument } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';


async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    const res = await db.query('SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
    return res.rowCount > 0;
}


export async function getAutopilotConfig(workspaceId: string, agentId?: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    agents: AutopilotConfig[] | null,
    error?: string
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { config: null, rules: null, agents: null, error: "Usuário não autenticado." };
    }
    const userId = user.id;
    
    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { config: null, rules: null, agents: null, error: "Acesso não autorizado." };
    }

    try {
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at', [workspaceId, userId]);
        
        if (configRes.rowCount === 0) {
            return { config: null, rules: [], agents: [] };
        }
        
        const agents = configRes.rows.map((row: any) => {
            const documentsRaw = row.knowledge_base_documents;
            const normalizedDocs: KnowledgeBaseDocument[] =
                typeof documentsRaw === 'string'
                    ? JSON.parse(documentsRaw)
                    : Array.isArray(documentsRaw)
                        ? documentsRaw
                        : [];
            return {
                ...row,
                knowledge_base_documents: normalizedDocs,
                is_active: Boolean(row.is_active),
                is_primary: Boolean(row.is_primary),
                default_fallback_reply: row.default_fallback_reply || null,
            } as AutopilotConfig;
        });

        const selectedConfig =
            agents.find(agent => agent.id === agentId) ||
            agents.find(agent => agent.is_primary) ||
            agents[0] ||
            null;

        if (!selectedConfig) {
            return { config: null, rules: [], agents };
        }

        const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name', [selectedConfig.id]);
        
        const rules = rulesRes.rows.map(r => ({
            ...r,
            action: typeof r.action === 'string' ? JSON.parse(r.action) : r.action
        }));

        return { config: selectedConfig, rules, agents };

    } catch (error) {
        console.error(`[GET_AUTOPILOT_CONFIG] Erro ao buscar configs para o usuário ${userId} no workspace ${workspaceId}:`, error);
        return { config: null, rules: null, agents: null, error: 'Falha ao buscar configurações do banco de dados.'};
    }
}


export async function saveAutopilotConfig(
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const userId = user.id;

    const workspaceId = formData.get('workspaceId') as string;
    if (!workspaceId) {
        return { success: false, error: 'ID de Workspace é obrigatório.' };
    }
    
    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { success: false, error: "Você não tem permissão para editar as configurações." };
    }

    const configId = formData.get('configId') as string | null;
    if (!configId) {
        return { success: false, error: 'Crie ou selecione um agente antes de salvar.' };
    }
    
    try {
        const fieldsToUpdate: { [key: string]: any } = {};
        const setClauses: string[] = [];
        const values: any[] = [];
        let valueIndex = 4; // Start index for parameterized query, after workspaceId, userId, configId

        if (formData.has('geminiApiKey')) {
            setClauses.push(`gemini_api_key = $${valueIndex++}`);
            values.push(formData.get('geminiApiKey') || null);
        }
        if (formData.has('aiModel')) {
            setClauses.push(`ai_model = $${valueIndex++}`);
            values.push(formData.get('aiModel'));
        }
        if (formData.has('knowledgeBase')) {
            setClauses.push(`knowledge_base = $${valueIndex++}`);
            values.push(formData.get('knowledgeBase'));
        }
        if (formData.has('agentName')) {
            setClauses.push(`name = $${valueIndex++}`);
            values.push(formData.get('agentName') || 'Meu agente de IA');
        }
        if (formData.has('knowledgeBaseDocuments')) {
            try {
                const parsedDocs = formData.get('knowledgeBaseDocuments') ? JSON.parse(formData.get('knowledgeBaseDocuments')!.toString()) : [];
                setClauses.push(`knowledge_base_documents = $${valueIndex++}`);
                values.push(JSON.stringify(parsedDocs));
            } catch (error) {
                console.error('[SAVE_AUTOPILOT_CONFIG] Erro ao parsear documentos da base:', error);
                return { success: false, error: 'Base de conhecimento inválida.' };
            }
        }
        if (formData.has('isActive')) {
            const isActive = formData.get('isActive');
            const value = typeof isActive === 'string' ? isActive : '';
            const truthy = value === 'true' || value === 'on' || value === '1';
            setClauses.push(`is_active = $${valueIndex++}`);
            values.push(truthy);
        }
        if (formData.has('defaultFallbackReply')) {
            setClauses.push(`default_fallback_reply = $${valueIndex++}`);
            values.push(formData.get('defaultFallbackReply') || null);
        }
        
        if (setClauses.length === 0) {
            return { success: true }; // Nothing to update
        }

        const updateQuery = `
            UPDATE autopilot_configs
            SET ${setClauses.join(', ')}, updated_at = NOW()
            WHERE workspace_id = $1 AND user_id = $2 AND id = $3
        `;
        
        const result = await db.query(updateQuery, [workspaceId, userId, configId, ...values]);
        
        if (result.rowCount === 0) {
            return { success: false, error: 'Agente não encontrado ou nenhuma alteração foi feita.' };
        }
        
        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        console.error('[SAVE_AUTOPILOT_CONFIG] Erro ao salvar configurações:', error);
        return { success: false, error: "Falha ao salvar as configurações no banco de dados." };
    }
}

export async function createAutopilotAgent(workspaceId: string, name: string): Promise<{ success: boolean; id?: string; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { success: false, error: 'Acesso não autorizado.' };
    }

    try {
        const countRes = await db.query('SELECT COUNT(*)::int AS total FROM autopilot_configs WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.id]);
        const existingCount = countRes.rows[0]?.total ?? 0;
        const normalizedName = name?.trim() || `Agente ${existingCount + 1}`;
        const shouldBePrimary = existingCount === 0;

        const insertRes = await db.query(
            `INSERT INTO autopilot_configs (workspace_id, user_id, name, is_primary)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [workspaceId, user.id, normalizedName, shouldBePrimary]
        );

        const newId = insertRes.rows[0]?.id;
        revalidatePath('/autopilot');
        return { success: true, id: newId };
    } catch (error) {
        console.error('[CREATE_AUTOPILOT_AGENT] Erro ao criar agente:', error);
        return { success: false, error: 'Falha ao criar agente.' };
    }
}

export async function setPrimaryAutopilotAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };

    try {
        const agentRes = await db.query('SELECT workspace_id, user_id FROM autopilot_configs WHERE id = $1', [agentId]);
        if (agentRes.rowCount === 0 || agentRes.rows[0].user_id !== user.id) {
            return { success: false, error: 'Agente não encontrado.' };
        }
        const workspaceId = agentRes.rows[0].workspace_id;

        await db.query('UPDATE autopilot_configs SET is_primary = false WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.id]);
        await db.query('UPDATE autopilot_configs SET is_primary = true WHERE id = $1 AND user_id = $2', [agentId, user.id]);

        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[SET_PRIMARY_AUTOPILOT_AGENT] Erro:', error);
        return { success: false, error: 'Não foi possível definir o agente principal.' };
    }
}

export async function saveAutopilotRule(
    configId: string, 
    rule: Omit<NexusFlowInstance, 'enabled'>
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    try {
        if (!configId || !rule.name || !rule.trigger || !rule.action) {
            return { success: false, error: 'Dados da regra incompletos.' };
        }
        
        const actionJson = JSON.stringify(rule.action);

        if (rule.id) {
            // Update existing rule
            console.log(`[SAVE_AUTOPILOT_RULE] Atualizando regra ID: ${rule.id}`);
            await db.query(
                `UPDATE autopilot_rules SET name = $1, trigger = $2, action = $3 WHERE id = $4 AND config_id = $5`,
                [rule.name, rule.trigger, actionJson, rule.id, configId]
            );
        } else {
            // Create new rule - o ID será gerado pelo banco de dados (gen_random_uuid())
            console.log(`[SAVE_AUTOPILOT_RULE] Criando nova regra para config ID: ${configId}`);
            await db.query(
                `INSERT INTO autopilot_rules (config_id, name, trigger, action) VALUES ($1, $2, $3, $4)`,
                [configId, rule.name, rule.trigger, actionJson]
            );
        }
        
        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        console.error('[SAVE_AUTOPILOT_RULE] Erro detalhado:', error);
        return { success: false, error: 'Falha ao salvar a regra no servidor.' };
    }
}


export async function deleteAutopilotRule(ruleId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    try {
        await db.query('DELETE FROM autopilot_rules WHERE id = $1', [ruleId]);
        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[DELETE_AUTOPILOT_RULE] Erro:', error);
        return { success: false, error: 'Falha ao remover a regra.' };
    }
}

export async function toggleAutopilotRule(ruleId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };
    
    try {
        await db.query('UPDATE autopilot_rules SET enabled = $1 WHERE id = $2', [enabled, ruleId]);
        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[TOGGLE_AUTOPILOT_RULE] Erro:', error);
        return { success: false, error: 'Falha ao alterar o status da regra.' };
    }
}


interface UsageLogData {
    configId: string;
    flowName: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    ruleName?: string;
}

export async function logAutopilotUsage(data: UsageLogData): Promise<void> {
    try {
        await db.query(
            `INSERT INTO autopilot_usage_logs 
             (config_id, flow_name, model_name, input_tokens, output_tokens, total_tokens, rule_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [data.configId, data.flowName, data.modelName, data.inputTokens, data.outputTokens, data.totalTokens, data.ruleName]
        );
        console.log(`[LOG_USAGE] Usage logged for flow ${data.flowName} with model ${data.modelName}. Total Tokens: ${data.totalTokens}`);
    } catch (error) {
        console.error('[LOG_USAGE] Failed to log autopilot usage:', error);
        // We don't throw an error here because logging failure should not break the main flow.
    }
}


export async function getAutopilotUsageLogs(configId: string): Promise<{ logs: AutopilotUsageLog[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { logs: null, error: "Usuário não autenticado." };
    
    // We can assume if the user is fetching logs, they have access to the config.
    // A more robust check would verify ownership of the configId.
    
    try {
        const res = await db.query(
            `SELECT flow_name, rule_name, model_name, total_tokens, created_at
             FROM autopilot_usage_logs
             WHERE config_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [configId]
        );
        return { logs: res.rows };
    } catch (error) {
        console.error('[GET_AUTOPILOT_LOGS] Erro ao buscar logs de uso:', error);
        return { logs: null, error: "Falha ao buscar o histórico de uso." };
    }
}
    
    
