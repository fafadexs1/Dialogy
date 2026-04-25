import { db } from '@/lib/db';
import type { AutopilotConfig, NexusFlowInstance, KnowledgeBaseDocument, Workspace, Chat, Contact } from '@/lib/types';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { sendAutomatedMessageAction } from '@/actions/messages';
import { logToDebugFile } from '@/lib/debug-file';
import { resolveCanonicalWhatsappChatIdByIdentity } from '@/lib/whatsapp/contact-identity';
import { retrieveSupportContext } from '@/services/rag/retrieval';
import { runAgentTools } from '@/services/agent-tools/runtime';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';

function interpolateTemplate(value: string, context: Record<string, any>): string {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
        const resolved = path.split('.').reduce((acc, key) => acc?.[key], context);
        return resolved == null ? '' : String(resolved);
    });
}

function interpolatePayload(value: any, context: Record<string, any>): any {
    if (typeof value === 'string') return interpolateTemplate(value, context);
    if (Array.isArray(value)) return value.map((item) => interpolatePayload(item, context));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolatePayload(item, context)]));
    }
    return value;
}

async function executeTriggeredWebhookRule(input: {
    rule: NexusFlowInstance;
    chat: Chat;
    contact: Contact;
    message: string;
}) {
    if (input.rule.action?.type !== 'webhook') {
        return null;
    }

    const action = input.rule.action;
    const method = action.method || 'POST';
    const context = {
        chat: { id: input.chat.id, workspace_id: input.chat.workspace_id, status: input.chat.status },
        contact: input.contact,
        message: input.message,
    };

    const response = await fetch(action.url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(interpolatePayload(action.body || {}, context)) : undefined,
    });

    const text = await response.text();
    let parsed: any = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }

    if (!response.ok) {
        throw new Error(`Webhook ${input.rule.name} retornou HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const reply =
        parsed?.reply ||
        parsed?.message ||
        parsed?.response ||
        parsed?.content ||
        (typeof parsed === 'string' ? parsed : null);

    return {
        reply: typeof reply === 'string' && reply.trim() ? reply.trim() : null,
        response: parsed ?? text,
    };
}

async function logIntelligentAttendantResponse(input: {
    configId: string;
    chatId: string;
    systemAgentId: string;
    modelName: string;
    customerMessage: string;
    response?: string | null;
    status: 'sent' | 'suggested' | 'empty' | 'error';
    triggeredRule?: string | null;
    errorMessage?: string;
    metadata?: Record<string, unknown> | null;
}) {
    try {
        await db.query(
            `INSERT INTO autopilot_usage_logs (
                config_id, flow_name, model_name, input_tokens, output_tokens, total_tokens, rule_name,
                chat_id, system_agent_id, input_message, output_message, status, metadata
             ) VALUES ($1, 'intelligent_attendant_response', $2, 0, 0, 0, $3, $4, $5, $6, $7, $8, $9)`,
            [
                input.configId,
                input.modelName,
                input.triggeredRule || null,
                input.chatId,
                input.systemAgentId,
                input.customerMessage || null,
                input.response || null,
                input.status,
                JSON.stringify({
                    source: 'autopilot-service',
                    error: input.errorMessage || null,
                    ...(input.metadata || {}),
                }),
            ]
        );
    } catch (error) {
        console.error('[AUTOPILOT_RESPONSE_LOG] Failed to log response:', error);
    }
}

function normalizeAgentActions(actions: unknown): AgentToolAction[] {
    if (!Array.isArray(actions)) return [];

    return actions
        .filter((action: any) => action && typeof action === 'object')
        .filter((action: any) => action.type === 'transfer_chat' || action.type === 'add_internal_note')
        .map((action: any) => ({
            type: action.type,
            reason: typeof action.reason === 'string' ? action.reason : null,
            payload: action.payload && typeof action.payload === 'object' ? action.payload : {},
        })) as AgentToolAction[];
}

async function runRequestedAgentTools(input: {
    workspaceId: string;
    chat: Chat;
    contact: Contact;
    systemAgentId: string;
    systemAgentName: string;
    autopilotConfig: AutopilotConfig;
    customerMessage: string;
    actions: unknown;
}): Promise<AgentToolExecutionResult[]> {
    const normalizedActions = normalizeAgentActions(input.actions);
    if (normalizedActions.length === 0) return [];

    return runAgentTools(
        {
            workspaceId: input.workspaceId,
            chat: input.chat,
            contact: input.contact,
            systemAgentId: input.systemAgentId,
            systemAgentName: input.systemAgentName,
            autopilotConfig: input.autopilotConfig,
            customerMessage: input.customerMessage,
        },
        normalizedActions
    );
}

export async function getAutopilotConfigService(workspaceId: string, agentId?: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    agents: AutopilotConfig[] | null,
    workspace: Workspace | null,
    error?: string,
    hasGlobalKey?: boolean
}> {
    try {
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);
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
            agents.find(agent => agent.id === agentId) ||
            agents.find(agent => agent.is_primary && !agent.is_private) ||
            agents.find(agent => !agent.is_private) ||
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
        return { config: null, rules: null, agents: null, workspace: null, error: 'Falha ao buscar configuracoes do banco de dados.', hasGlobalKey: false };
    }
}

export async function processAutopilotForChat(
    workspaceId: string,
    chat: Chat,
    lastMessageContent: string,
    instanceName: string
) {
    const resolvedChatId =
        (await resolveCanonicalWhatsappChatIdByIdentity(db, {
            workspaceId,
            phoneOrJid: chat.contact?.phone_number_jid,
            currentChatId: chat.id,
        })) || chat.id;

    if (resolvedChatId !== chat.id) {
        chat = {
            ...chat,
            id: resolvedChatId,
        };
    }

    console.log(`[AUTOPILOT_SERVICE] Verificando autopilot para chat ${chat.id}`);

    const chatConfigRes = await db.query(
        `SELECT
            c.copilot_mode,
            c.is_autopilot_active,
            c.assigned_system_agent_id,
            c.autopilot_config_id,
            sa.name AS assigned_system_agent_name,
            sa.type AS assigned_system_agent_type,
            sa.is_active AS assigned_system_agent_active,
            sa.autopilot_config_id AS assigned_autopilot_config_id
         FROM chats c
         LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
         WHERE c.id = $1`,
        [chat.id]
    );
    const chatConfig = chatConfigRes.rows[0];
    const currentCopilotMode = chatConfig?.copilot_mode || 'auto';
    const rawIsActive = chatConfig?.is_autopilot_active ?? chat.is_autopilot_active;
    const currentIsActive = rawIsActive === true;
    const assignedSystemAgentId = chatConfig?.assigned_system_agent_id || null;
    const assignedSystemAgentName = chatConfig?.assigned_system_agent_name || 'Atendente Inteligente';
    const assignedAutopilotConfigId = chatConfig?.assigned_autopilot_config_id || chatConfig?.autopilot_config_id || chat.autopilot_config_id;

    if (!assignedSystemAgentId || chatConfig?.assigned_system_agent_type !== 'intelligent_attendant') {
        console.log(`[AUTOPILOT_SERVICE] Chat ${chat.id} nao esta atribuido a um Atendente Inteligente. Ignorando.`);
        return;
    }

    if (chatConfig?.assigned_system_agent_active === false) {
        console.log(`[AUTOPILOT_SERVICE] Atendente Inteligente atribuido esta inativo. Chat ${chat.id}.`);
        return;
    }

    if (!assignedAutopilotConfigId) {
        console.log(`[AUTOPILOT_SERVICE] Atendente Inteligente sem configuracao de IA vinculada. Chat ${chat.id}.`);
        return;
    }

    console.error(
        `[AUTOPILOT_DEBUG] *** DB FETCH -> copilot_mode: ${currentCopilotMode}, is_autopilot_active (RAW): ${rawIsActive}, (RESOLVED): ${currentIsActive} ***`
    );
    logToDebugFile(`[processAutopilotForChat] ChatId=${chat.id}, CopilotMode=${currentCopilotMode}, IsActive=${currentIsActive} (Raw: ${rawIsActive})`);

    const { config: autopilotConfig, rules: autopilotRules, agents: autopilotAgents } =
        await getAutopilotConfigService(workspaceId, assignedAutopilotConfigId || undefined);

    if (!autopilotConfig || !autopilotConfig.is_active) {
        console.log(`[AUTOPILOT_SERVICE] Autopilot desativado ou nao configurado para workspace ${workspaceId}`);
        return;
    }

    if (assignedAutopilotConfigId && autopilotConfig.id !== assignedAutopilotConfigId) {
        console.log(`[AUTOPILOT_SERVICE] Configuracao de IA atribuida nao confere com o Atendente Inteligente. Chat ${chat.id}.`);
        return;
    }

    if (!currentIsActive) {
        console.log(`[AUTOPILOT_SERVICE] Autopilot desativado para este chat (ID: ${chat.id}). Status: ${currentIsActive}`);
        return;
    }

    const messagesRes = await db.query(
        `SELECT content, from_me, sender_user_id
         FROM messages
         WHERE chat_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [chat.id]
    );

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

    let workspaceGeminiApiKey =
        (autopilotAgents || [])
            .map(a => a.gemini_api_key)
            .find((k: string | null | undefined) => !!k && k.trim().length > 0) || undefined;

    if (!workspaceGeminiApiKey) {
        try {
            const configRes = await db.query(
                `SELECT config->>'apiKey' as api_key
                 FROM workspace_integrations
                 WHERE workspace_id = $1
                   AND provider = 'gemini'
                   AND is_active = true
                 LIMIT 1`,
                [workspaceId]
            );
            if (configRes.rows.length > 0) {
                workspaceGeminiApiKey = configRes.rows[0].api_key;
            }
        } catch (error) {
            console.error('[AUTOPILOT_SERVICE] Failed to fetch integration key:', error);
        }
    }

    let ragDocuments: KnowledgeBaseDocument[] = autopilotConfig.knowledge_base_documents || [];
    let relevantHistory = '';
    let resolvedCases: Array<{
        summary: string;
        problem: string;
        resolution: string;
        outcome: string;
        closeReasonLabel?: string | null;
        keywords: string[];
        similarity: number;
    }> = [];

    try {
        if (lastMessageContent && lastMessageContent.trim().length > 3) {
            console.log(`[AUTOPILOT_RAG] Searching support context for: "${lastMessageContent.substring(0, 50)}..."`);
            const retrieval = await retrieveSupportContext({
                workspaceId,
                autopilotConfigId: autopilotConfig.id,
                query: lastMessageContent,
                excludeChatId: chat.id,
            });

            if (retrieval.knowledgeBaseDocuments.length > 0) {
                console.log(`[AUTOPILOT_RAG] Found ${retrieval.knowledgeBaseDocuments.length} document chunks.`);
                ragDocuments = retrieval.knowledgeBaseDocuments;
            }

            if (retrieval.resolvedCases.length > 0) {
                console.log(`[AUTOPILOT_RAG] Found ${retrieval.resolvedCases.length} resolved case memories.`);
                resolvedCases = retrieval.resolvedCases;
                relevantHistory = retrieval.resolvedCases.map((item) => {
                    return [
                        `[Caso Resolvido] ${item.summary}`,
                        item.problem ? `Problema: ${item.problem}` : '',
                        item.resolution ? `Resolucao: ${item.resolution}` : '',
                        item.outcome ? `Resultado: ${item.outcome}` : '',
                    ].filter(Boolean).join('\n');
                }).join('\n\n');
            }
        }
    } catch (ragError) {
        console.error('[AUTOPILOT_RAG] Error during retrieval:', ragError);
    }

    try {
        const result = await generateAgentResponse({
            config: autopilotConfig,
            chatId: chat.id,
            customerMessage: lastMessageContent || '',
            chatHistory: chatHistoryForAI,
            relevantHistory,
            rules: activeRules,
            knowledgeBase: autopilotConfig.knowledge_base || '',
            knowledgeBaseDocuments: ragDocuments,
            resolvedCases,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            escalationPolicy: autopilotConfig.escalation_policy || '',
            closingPolicy: autopilotConfig.closing_policy || '',
            model: autopilotConfig.ai_model || 'googleai/gemini-2.0-flash',
            contact: sanitizedContact,
            workspaceGeminiApiKey,
        });

        if (result?.response) {
            let finalResponse = result.response;
            let webhookExecution: Awaited<ReturnType<typeof executeTriggeredWebhookRule>> | null = null;
            const triggeredRule = result.triggeredRule
                ? activeRules.find((rule) => rule.name === result.triggeredRule)
                : null;

            if (triggeredRule?.action?.type === 'webhook') {
                try {
                    webhookExecution = await executeTriggeredWebhookRule({
                        rule: triggeredRule,
                        chat,
                        contact: sanitizedContact,
                        message: lastMessageContent || '',
                    });
                    if (webhookExecution?.reply) {
                        finalResponse = webhookExecution.reply;
                    }
                } catch (webhookError) {
                    console.error('[AUTOPILOT_WEBHOOK_ACTION] Failed to execute webhook rule:', webhookError);
                    finalResponse = autopilotConfig.default_fallback_reply || result.response;
                    webhookExecution = {
                        reply: finalResponse,
                        response: {
                            error: webhookError instanceof Error ? webhookError.message : String(webhookError),
                        },
                    };
                }
            }

            if (currentCopilotMode === 'suggest') {
                console.log(`[AUTOPILOT_SERVICE] Modo sugestao - enviando para agente: ${finalResponse.substring(0, 50)}...`);
                const { getSupabaseAdmin } = await import('@/lib/supabase');
                const supabase = getSupabaseAdmin();
                await supabase.channel(`chat:${chat.id}`).send({
                    type: 'broadcast',
                    event: 'ai_suggestion',
                    payload: {
                        suggestion: finalResponse,
                        chatId: chat.id,
                        configName: autopilotConfig.name
                    }
                });
                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: autopilotConfig.ai_model || 'googleai/gemini-2.0-flash',
                    customerMessage: lastMessageContent || '',
                    response: finalResponse,
                    status: 'suggested',
                    triggeredRule: result.triggeredRule || null,
                });
            } else {
                console.log(`[AUTOPILOT_SERVICE] Enviando resposta: ${finalResponse}`);
                const agentId = assignedSystemAgentId;
                await sendAutomatedMessageAction(
                    chat.id,
                    finalResponse,
                    agentId,
                    true,
                    instanceName
                );
                const toolResults = await runRequestedAgentTools({
                    workspaceId,
                    chat,
                    contact: sanitizedContact,
                    systemAgentId: assignedSystemAgentId,
                    systemAgentName: assignedSystemAgentName,
                    autopilotConfig,
                    customerMessage: lastMessageContent || '',
                    actions: result.actions,
                });
                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: autopilotConfig.ai_model || 'googleai/gemini-2.0-flash',
                    customerMessage: lastMessageContent || '',
                    response: finalResponse,
                    status: 'sent',
                    triggeredRule: result.triggeredRule || null,
                    metadata: {
                        ...(webhookExecution ? { webhookExecution: webhookExecution.response } : {}),
                        ...(toolResults.length > 0 ? { toolResults } : {}),
                    },
                });
            }
        } else {
            console.log('[AUTOPILOT_SERVICE] Nenhuma resposta gerada.');
            const toolResults = currentCopilotMode === 'auto'
                ? await runRequestedAgentTools({
                    workspaceId,
                    chat,
                    contact: sanitizedContact,
                    systemAgentId: assignedSystemAgentId,
                    systemAgentName: assignedSystemAgentName,
                    autopilotConfig,
                    customerMessage: lastMessageContent || '',
                    actions: result?.actions,
                })
                : [];
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: autopilotConfig.ai_model || 'googleai/gemini-2.0-flash',
                customerMessage: lastMessageContent || '',
                response: null,
                status: 'empty',
                triggeredRule: result?.triggeredRule || null,
                metadata: toolResults.length > 0 ? { toolResults } : null,
            });
        }
    } catch (error) {
        console.error('[AUTOPILOT_SERVICE] Erro ao processar:', error);
        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: autopilotConfig.ai_model || 'googleai/gemini-2.0-flash',
            customerMessage: lastMessageContent || '',
            response: null,
            status: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
        });
    }
}
