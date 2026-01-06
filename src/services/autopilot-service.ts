
import { db } from '@/lib/db';
import type { AutopilotConfig, NexusFlowInstance, KnowledgeBaseDocument, Workspace, Chat, Contact } from '@/lib/types';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { sendAutomatedMessageAction } from '@/actions/messages';
import { logToDebugFile } from '@/lib/debug-file';

export async function getAutopilotConfigService(workspaceId: string, agentId?: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    agents: AutopilotConfig[] | null,
    workspace: Workspace | null,
    error?: string,
    hasGlobalKey?: boolean
}> {
    try {
        // Fetch configs for the workspace
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);

        // Fetch workspace details (global messages)
        const workspaceRes = await db.query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
        const workspace = workspaceRes.rows[0] as Workspace || null;

        if (configRes.rowCount === 0) {
            return { config: null, rules: [], agents: [], workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };
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
            agents.find(agent => agent.id === agentId) || // Specific agent request (by ID)
            agents.find(agent => agent.is_primary && !agent.is_private) || // Default public primary
            agents.find(agent => !agent.is_private) || // Any public agent
            null;

        if (!selectedConfig) {
            return { config: null, rules: [], agents, workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };
        }

        const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name', [selectedConfig.id]);

        const rules = rulesRes.rows.map(r => ({
            ...r,
            action: typeof r.action === 'string' ? JSON.parse(r.action) : r.action
        }));

        return { config: selectedConfig, rules, agents, workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };

    } catch (error) {
        console.error(`[GET_AUTOPILOT_CONFIG_SERVICE] Erro no workspace ${workspaceId}:`, error);
        return { config: null, rules: null, agents: null, workspace: null, error: 'Falha ao buscar configurações do banco de dados.', hasGlobalKey: false };
    }
}

export async function processAutopilotForChat(
    workspaceId: string,
    chat: Chat,
    lastMessageContent: string,
    instanceName: string
) {
    console.log(`[AUTOPILOT_SERVICE] Verificando autopilot para chat ${chat.id}`);

    // Force fetch copilot_mode to ensure we have the latest value
    const chatConfigRes = await db.query(`SELECT copilot_mode, is_autopilot_active FROM chats WHERE id = $1`, [chat.id]);
    const chatConfig = chatConfigRes.rows[0];
    const currentCopilotMode = chatConfig?.copilot_mode || 'auto';
    const currentIsActive = chatConfig?.is_autopilot_active ?? chat.is_autopilot_active;

    console.error(`[AUTOPILOT_DEBUG] *** DB FETCH -> copilot_mode: ${currentCopilotMode}, is_autopilot_active: ${currentIsActive} ***`);

    logToDebugFile(`[processAutopilotForChat] ChatId=${chat.id}, CopilotMode=${currentCopilotMode}, IsActive=${currentIsActive}`);

    // 1. Fetch Config
    const { config: autopilotConfig, rules: autopilotRules, agents: autopilotAgents } = await getAutopilotConfigService(workspaceId, chat.autopilot_config_id || undefined);

    if (!autopilotConfig || !autopilotConfig.is_active) {
        console.log(`[AUTOPILOT_SERVICE] Autopilot desativado ou não configurado para workspace ${workspaceId}`);
        return;
    }

    if (!currentIsActive) {
        console.log(`[AUTOPILOT_SERVICE] Autopilot desativado para este chat (ID: ${chat.id})`);
        return;
    }

    // 2. Prepare Context
    // Need full history? usually yes.
    // For now, let's just fetch simplified history or rely on what's passed?
    // The `generateAgentResponse` takes `chatHistory` string. We need to fetch it.

    // Fetch last ~20 messages for context
    const messagesRes = await db.query(`
        SELECT content, from_me, sender_user_id 
        FROM messages 
        WHERE chat_id = $1 
        ORDER BY created_at DESC 
        LIMIT 20
    `, [chat.id]);

    // Reverse to chronological
    const messages = messagesRes.rows.reverse();
    const chatHistoryForAI = messages.map((m: any) => {
        const sender = m.from_me ? 'Atendente' : 'Cliente';
        return `${sender}: ${m.content}`;
    }).join('\n');

    const activeRules = (autopilotRules || []).filter(rule => rule.enabled);

    const sanitizedContact: Contact = {
        ...(chat.contact as Contact),
        email: chat.contact?.email || '',
    };

    // Prefer the agent key, but fall back to any workspace Gemini key (Integrações > Gemini)
    // Legacy: Check if any agent has a key
    let workspaceGeminiApiKey =
        (autopilotAgents || [])
            .map(a => a.gemini_api_key)
            .find((k: string | null | undefined) => !!k && k.trim().length > 0) || undefined;

    // New: Check workspace_integrations if not found
    if (!workspaceGeminiApiKey) {
        try {
            const configRes = await db.query(`
                SELECT config->>'apiKey' as api_key 
                FROM workspace_integrations 
                WHERE workspace_id = $1 AND provider = 'gemini' AND is_active = true 
                LIMIT 1
            `, [workspaceId]);
            if (configRes.rows.length > 0) {
                workspaceGeminiApiKey = configRes.rows[0].api_key;
            }
        } catch (e) {
            console.error('[AUTOPILOT_SERVICE] Failed to fetch integration key:', e);
        }
    }

    try {
        // 3. Generate Response
        const result = await generateAgentResponse({
            config: autopilotConfig,
            chatId: chat.id,
            customerMessage: lastMessageContent || '',
            chatHistory: chatHistoryForAI,
            rules: activeRules,
            knowledgeBase: autopilotConfig.knowledge_base || '',
            knowledgeBaseDocuments: autopilotConfig.knowledge_base_documents || [],
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            model: autopilotConfig.ai_model || 'googleai/gemini-2.0-flash',
            contact: sanitizedContact,
            workspaceGeminiApiKey,
        });

        // 4. Send or Suggest Response based on copilot_mode
        if (result?.response) {
            const copilotMode = currentCopilotMode;

            if (copilotMode === 'suggest') {
                // Broadcast suggestion to the agent via Realtime
                console.log(`[AUTOPILOT_SERVICE] Modo sugestão - enviando para agente: ${result.response.substring(0, 50)}...`);
                const { getSupabaseAdmin } = await import('@/lib/supabase');
                const supabase = getSupabaseAdmin();
                await supabase.channel(`chat:${chat.id}`).send({
                    type: 'broadcast',
                    event: 'ai_suggestion',
                    payload: {
                        suggestion: result.response,
                        chatId: chat.id,
                        configName: autopilotConfig.name
                    }
                });
            } else {
                // Auto-send (default behavior)
                console.log(`[AUTOPILOT_SERVICE] Enviando resposta: ${result.response}`);
                const agentId = autopilotConfig.user_id;
                await sendAutomatedMessageAction(
                    chat.id,
                    result.response,
                    agentId,
                    false, // isSystemAgent
                    instanceName
                );
            }
        } else {
            console.log(`[AUTOPILOT_SERVICE] Nenhuma resposta gerada.`);
        }

    } catch (error) {
        console.error('[AUTOPILOT_SERVICE] Erro ao processar:', error);
    }
}
