'use server';

import { v4 as uuidv4 } from 'uuid';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { AutopilotConfig, NexusFlowInstance, Action, AutopilotUsageLog, KnowledgeBaseDocument, Workspace } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';


async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    const res = await db.query('SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
    return (res.rowCount ?? 0) > 0;
}


export async function getAutopilotConfig(workspaceId: string, agentId?: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    agents: AutopilotConfig[] | null,
    workspace: Workspace | null,
    error?: string,
    hasGlobalKey?: boolean
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { config: null, rules: null, agents: null, workspace: null, error: "Usuário não autenticado." };
    }
    const userId = user.id;

    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { config: null, rules: null, agents: null, workspace: null, error: "Acesso não autorizado." };
    }

    try {
        // Fetch configs for the workspace
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);

        // Fetch workspace details (global messages)
        const workspaceRes = await db.query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
        const workspace = workspaceRes.rows[0] as Workspace || null;

        if (configRes.rowCount === 0) {
            return { config: null, rules: [], agents: [], workspace };
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
                is_private: Boolean(row.is_private),
                default_fallback_reply: row.default_fallback_reply || null,
            } as AutopilotConfig;
        }).filter(agent => !agent.is_private || agent.user_id === userId); // Show only own private agents or shared ones

        const selectedConfig =
            agents.find(agent => agent.id === agentId) ||
            agents.find(agent => agent.user_id === userId) || // Prioritize user's own agent
            agents.find(agent => agent.is_primary) ||
            agents[0] ||
            null;

        if (!selectedConfig) {
            return { config: null, rules: [], agents, workspace };
        }

        const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name', [selectedConfig.id]);

        const rules = rulesRes.rows.map(r => ({
            ...r,
            action: typeof r.action === 'string' ? JSON.parse(r.action) : r.action
        }));

        // Fetch Gemini Integration Config
        const integrationRes = await db.query(`
            SELECT config, is_active 
            FROM workspace_integrations 
            WHERE workspace_id = $1 AND provider = 'gemini'
        `, [workspaceId]);

        let geminiKeyFromIntegration = null;
        let transcriptionModelFromIntegration = null;

        if (integrationRes.rows.length > 0 && integrationRes.rows[0].is_active) {
            const intConfig = integrationRes.rows[0].config;
            geminiKeyFromIntegration = intConfig.apiKey;
            transcriptionModelFromIntegration = intConfig.transcriptionModel;
        }

        const mergedConfig = {
            ...selectedConfig,
            gemini_api_key: geminiKeyFromIntegration || selectedConfig.gemini_api_key,
            transcription_model: transcriptionModelFromIntegration || selectedConfig.transcription_model
        };

        return { config: mergedConfig, rules, agents, workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };

    } catch (error) {
        console.error(`[GET_AUTOPILOT_CONFIG] Erro ao buscar configs para o usuário ${userId} no workspace ${workspaceId}:`, error);
        return { config: null, rules: null, agents: null, workspace: null, error: 'Falha ao buscar configurações do banco de dados.', hasGlobalKey: false };
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
        let valueIndex = 4; // Start index for parameterized query, after workspaceId, configId (removed userId from WHERE) + placeholder for userId logging if needed? No, purely config update.
        // Actually, let's reset index logic.
        // Params: [workspaceId, configId] -> indices $1, $2
        // Dynamic values start at $3

        valueIndex = 3;

        if (formData.has('geminiApiKey')) {
            setClauses.push(`gemini_api_key = $${valueIndex++}`);
            values.push(formData.get('geminiApiKey') || null);
        }
        if (formData.has('aiModel')) {
            setClauses.push(`ai_model = $${valueIndex++}`);
            values.push(formData.get('aiModel'));
        }
        if (formData.has('transcriptionModel')) {
            setClauses.push(`transcription_model = $${valueIndex++}`);
            values.push(formData.get('transcriptionModel'));
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

        const isPrivate = formData.get('isPrivate');
        const value = typeof isPrivate === 'string' ? isPrivate : '';
        const truthy = value === 'true' || value === 'on' || value === '1';
        setClauses.push(`is_private = $${valueIndex++}`);
        values.push(truthy);


        if (setClauses.length === 0) {
            return { success: true }; // Nothing to update
        }

        const updateQuery = `
            UPDATE autopilot_configs
            SET ${setClauses.join(', ')}, updated_at = NOW()
            WHERE workspace_id = $1 AND id = $2
        `;

        const result = await db.query(updateQuery, [workspaceId, configId, ...values]);

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

export async function createAutopilotAgent(workspaceId: string, name: string, isPrivate: boolean = false): Promise<{ success: boolean; id?: string; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { success: false, error: 'Acesso não autorizado.' };
    }

    try {
        const countRes = await db.query('SELECT COUNT(*)::int AS total FROM autopilot_configs WHERE workspace_id = $1', [workspaceId]);
        const existingCount = countRes.rows[0]?.total ?? 0;
        const normalizedName = name?.trim() || `Agente ${existingCount + 1}`;
        const shouldBePrimary = existingCount === 0;

        const insertRes = await db.query(
            `INSERT INTO autopilot_configs (workspace_id, user_id, name, is_primary, is_private)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [workspaceId, user.id, normalizedName, shouldBePrimary, isPrivate]
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
        if (agentRes.rowCount === 0) { // Removed user_id check as multiple users can manage workspace
            return { success: false, error: 'Agente não encontrado.' };
        }
        const workspaceId = agentRes.rows[0].workspace_id;

        // Check permissions
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { success: false, error: 'Acesso não autorizado.' };
        }

        await db.query('UPDATE autopilot_configs SET is_primary = false WHERE workspace_id = $1', [workspaceId]);
        await db.query('UPDATE autopilot_configs SET is_primary = true WHERE id = $1', [agentId]);

        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[SET_PRIMARY_AUTOPILOT_AGENT] Erro:', error);
        return { success: false, error: 'Não foi possível definir o agente principal.' };
    }
}

export async function deleteAutopilotAgent(agentId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) return { success: false, error: 'Usuário não autenticado' };

        // Verify ownership/membership
        const agentRes = await db.query('SELECT workspace_id FROM autopilot_configs WHERE id = $1', [agentId]);

        if (agentRes.rowCount === 0) {
            return { success: false, error: 'Agente não encontrado' };
        }

        const workspaceId = agentRes.rows[0].workspace_id;

        const isMember = await isWorkspaceMember(user.id, workspaceId);
        if (!isMember) return { success: false, error: 'Sem permissão no workspace' };

        await db.query('DELETE FROM autopilot_configs WHERE id = $1', [agentId]);

        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('Error deleting autopilot agent:', error);
        return { success: false, error: 'Falha ao deletar agente' };
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

export async function addDocumentToKnowledgeBase(
    workspaceId: string,
    title: string,
    content: string
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { success: false, error: 'Acesso não autorizado.' };
    }

    // Try to find the user's own PRIVATE agent first, then their own SHARED, then fallback to primary
    try {
        const configRes = await db.query(
            `SELECT * FROM autopilot_configs 
             WHERE workspace_id = $1 
             ORDER BY CASE WHEN user_id = $2 THEN 0 ELSE 1 END, is_private DESC, is_primary DESC, created_at ASC 
             LIMIT 1`,
            [workspaceId, user.id]
        );

        if (configRes.rowCount === 0) {
            return { success: false, error: 'Nenhum agente de IA encontrado neste workspace.' };
        }

        const config = configRes.rows[0];
        const currentDocs: KnowledgeBaseDocument[] = typeof config.knowledge_base_documents === 'string'
            ? JSON.parse(config.knowledge_base_documents)
            : Array.isArray(config.knowledge_base_documents)
                ? config.knowledge_base_documents
                : [];

        const newDoc: KnowledgeBaseDocument = {
            id: uuidv4(),
            name: title,
            content: content,
            uploaded_at: new Date().toISOString(),
            tokens: 0 // We could estimate tokens here if needed
        };

        const updatedDocs = [...currentDocs, newDoc];

        await db.query(
            'UPDATE autopilot_configs SET knowledge_base_documents = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(updatedDocs), config.id]
        );

        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        console.error('[ADD_DOC_KB] Erro ao adicionar documento:', error);
        return { success: false, error: 'Falha ao salvar o documento na base de conhecimento.' };
    }
}
