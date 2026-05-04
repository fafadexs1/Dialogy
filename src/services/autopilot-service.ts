import { db } from '@/lib/db';
import type { AutopilotConfig, NexusFlowInstance, KnowledgeBaseDocument, Workspace, Chat, Contact, Message, MessageMetadata } from '@/lib/types';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { sendAutomatedMessageAction } from '@/actions/messages';
import { logToDebugFile } from '@/lib/debug-file';
import { resolveCanonicalWhatsappChatIdByIdentity } from '@/lib/whatsapp/contact-identity';
import { retrieveSupportContext } from '@/services/rag/retrieval';
import { runAgentTools } from '@/services/agent-tools/runtime';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import { listAgentToolCatalogItems, listDefaultEnabledAgentToolNames } from '@/services/agent-tools/catalog';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { extractKnowledgeToolProcedures, formatKnowledgeToolProcedures } from '@/services/agent-tools/knowledge-procedures';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import {
    hasExplicitTeamHandoff,
    routeDeterministicAgentTools,
    shouldHandoffToHuman,
    type ToolRouterTeam,
} from '@/services/agent-tools/router';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';
import { classifyToolIntent } from '@/ai/flows/tool-intent-gate';
import {
    finishOrchestratorRun,
    recordOrchestratorEvent,
    startOrchestratorRun,
    timeOrchestratorStage,
    withTimeout,
    type OrchestratorRunHandle,
} from '@/services/orchestrator/runtime';
import { analyzeMediaForAutopilot } from '@/ai/flows/analyze-media';
import {
    buildMcpCustomerResponseFromToolResults,
    buildRouterRebootActionFromSgpResults,
    buildSgpResponseFromToolResults,
    buildToolFailureResponse,
    ensurePromisedSgpLookupAction,
    ensureProcedureSgpLookupAction,
} from '@/services/autopilot-sgp-response';

/**
 * Sends an AI response as one or more separate WhatsApp message bubbles.
 *
 * When `aiMessageBlocks` is provided (the AI explicitly decided to split),
 * each block is sent as its own message. Otherwise, the heuristic
 * `splitIntoMessageBlocks` is used as a fallback for deterministic responses.
 */
async function sendMultiBlockResponse(
    chatId: string,
    formattedResponse: string,
    agentId: string,
    isSystemAgent: boolean,
    instanceName?: string,
    aiMessageBlocks?: string[] | null,
): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
    // Prefer AI-decided blocks; fall back to heuristic splitting
    const blocks = (aiMessageBlocks && aiMessageBlocks.length > 1)
        ? aiMessageBlocks
        : splitIntoMessageBlocks(formattedResponse);

    if (blocks.length <= 1) {
        return sendAutomatedMessageAction(chatId, formattedResponse, agentId, isSystemAgent, instanceName);
    }

    let lastResult: { success: boolean; error?: string; apiResponse?: any } = { success: true };
    for (let i = 0; i < blocks.length; i++) {
        if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 350));
        }
        lastResult = await sendAutomatedMessageAction(chatId, blocks[i], agentId, isSystemAgent, instanceName);
        if (!lastResult.success) break;
    }
    return lastResult;
}

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

function interpolateRecord(value: Record<string, string> | undefined, context: Record<string, any>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(value || {})
            .filter(([key]) => key.trim())
            .map(([key, item]) => [key, interpolateTemplate(String(item ?? ''), context)])
    );
}

async function executeTriggeredWebhookRule(input: {
    rule: NexusFlowInstance;
    chat: Chat;
    contact: Contact;
    message: string;
    agentResponse?: string | null;
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
        resposta_agente: input.agentResponse || '',
        agent: {
            response: input.agentResponse || '',
        },
    };
    const url = new URL(interpolateTemplate(action.url, context));
    const query = interpolateRecord(action.query, context);
    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
    }

    const headers = interpolateRecord(action.headers, context);
    const auth = action.auth;
    if (auth?.type === 'bearer' && auth.token) {
        headers.Authorization = `Bearer ${interpolateTemplate(auth.token, context)}`;
    } else if (auth?.type === 'basic' && (auth.username || auth.password)) {
        const username = interpolateTemplate(auth.username || '', context);
        const password = interpolateTemplate(auth.password || '', context);
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    } else if (auth?.type === 'api_key' && auth.key && auth.value) {
        const key = interpolateTemplate(auth.key, context);
        const value = interpolateTemplate(auth.value, context);
        if (auth.placement === 'query') {
            url.searchParams.set(key, value);
        } else {
            headers[key] = value;
        }
    }

    const bodyPayload = interpolatePayload(action.body || {}, context);
    const requestInit: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'DELETE') {
        if (action.bodyType === 'form-data') {
            const formData = new FormData();
            for (const [key, value] of Object.entries(bodyPayload)) {
                formData.append(key, value == null ? '' : String(value));
            }
            requestInit.body = formData;
        } else {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            requestInit.body = JSON.stringify(bodyPayload);
        }
    }

    const response = await fetch(url.toString(), requestInit);

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

    const allowedTypes = new Set([
        'transfer_chat',
        'add_internal_note',
        'crm_update_contact_custom_fields',
        'sgp_fetch_contracts',
        'sgp_fetch_contact_panel_data',
        'sgp_generate_invoice_pix',
        'sgp_create_payment_promise',
        'sgp_open_support_ticket',
        'mcp_call_tool',
    ]);

    return actions
        .filter((action: any) => action && typeof action === 'object')
        .filter((action: any) => allowedTypes.has(action.type))
        .map((action: any) => ({
            type: action.type,
            reason: typeof action.reason === 'string' ? action.reason : null,
            payload: action.payload && typeof action.payload === 'object' ? action.payload : {},
        })) as AgentToolAction[];
}

function mergeAgentActions(...actionSets: Array<AgentToolAction[] | null | undefined>): AgentToolAction[] {
    const merged: AgentToolAction[] = [];
    let hasTransfer = false;
    let hasInternalNote = false;

    for (const actions of actionSets) {
        for (const action of actions || []) {
            if (action.type === 'transfer_chat') {
                if (hasTransfer) continue;
                hasTransfer = true;
            }

            if (action.type === 'add_internal_note') {
                if (hasInternalNote) continue;
                hasInternalNote = true;
            }

            merged.push(action);
        }
    }

    return merged.slice(0, 4);
}

function filterImplicitTransferActions(input: {
    actions: AgentToolAction[];
    customerMessage: string;
    availableTeams: ToolRouterTeam[];
}): AgentToolAction[] {
    if (shouldHandoffToHuman(input.customerMessage)) {
        return input.actions;
    }

    return input.actions.filter((action) => {
        if (action.type !== 'transfer_chat' && action.type !== 'add_internal_note') {
            return true;
        }

        const payload = action.payload && typeof action.payload === 'object' ? action.payload as Record<string, any> : {};
        const targetTeam =
            typeof payload.teamId === 'string'
                ? input.availableTeams.find((team) => team.id === payload.teamId)
                : null;
        const teamName = String(payload.teamName || targetTeam?.name || '');
        const reason = String(action.reason || payload.reason || payload.content || '');
        const text = `${teamName} ${reason}`;

        if (action.type === 'transfer_chat') {
            const explicitByTarget = targetTeam ? hasExplicitTeamHandoff(input.customerMessage, targetTeam) : false;
            const explicitByName = teamName ? hasExplicitTeamHandoff(input.customerMessage, { name: teamName }) : false;
            return explicitByTarget || explicitByName;
        }

        return !/\b(transfer|encaminh|roteamento)\b/i.test(text);
    });
}

function isPreResponseDataAction(action: AgentToolAction) {
    return action.type === 'crm_update_contact_custom_fields' || action.type.startsWith('sgp_') || action.type === 'mcp_call_tool';
}

function buildMcpResponseFromToolResults(results: AgentToolExecutionResult[]): string | null {
    const mcpResult = results.find((result) => result.toolName.startsWith('mcp:') && result.status === 'success');
    const output = mcpResult?.output as any;
    if (!output) return null;

    if (output.structuredContent && typeof output.structuredContent === 'object') {
        return JSON.stringify(output.structuredContent, null, 2).slice(0, 1800);
    }

    const textParts = Array.isArray(output.content)
        ? output.content
            .map((item: any) => {
                if (item?.type === 'text' && typeof item.text === 'string') return item.text;
                if (typeof item === 'string') return item;
                return null;
            })
            .filter(Boolean)
        : [];

    return textParts.join('\n\n').trim().slice(0, 1800) || null;
}

function compactToolOutputForContinuation(result: AgentToolExecutionResult): Record<string, unknown> {
    const output = (result.output || {}) as any;

    if (result.toolName === 'sgp_fetch_contact_panel_data') {
        const contracts = Array.isArray(output.contracts) ? output.contracts : [];
        return {
            customerName: output.customerName || null,
            cpfCnpj: output.cpfCnpj || null,
            contracts: contracts.slice(0, 8).map((contract: any) => ({
                id: contract.id,
                planDescription: contract.planDescription,
                connectionStatus: contract.connectionStatus,
                statusLabel: contract.statusLabel,
                addressLabel: contract.addressLabel,
                ip: contract.ip,
                ipv6: contract.ipv6,
                login: contract.login,
            })),
            invoiceGroups: Array.isArray(output.invoiceGroups)
                ? output.invoiceGroups.slice(0, 8).map((group: any) => ({
                    contractId: group.contractId,
                    title: group.title,
                    summary: group.summary,
                }))
                : [],
        };
    }

    if (result.toolName.startsWith('mcp:')) {
        return {
            content: output.content || null,
            structuredContent: output.structuredContent || null,
            isError: output.isError || false,
        };
    }

    return output;
}

function buildToolContinuationContext(results: AgentToolExecutionResult[]): string {
    const successfulResults = results.filter((result) => result.status === 'success');
    if (successfulResults.length === 0) return '';

    const payload = successfulResults.map((result) => ({
        toolName: result.toolName,
        output: compactToolOutputForContinuation(result),
    }));

    return [
        '[RESULTADOS DE FERRAMENTAS JA EXECUTADAS]',
        JSON.stringify(payload).slice(0, 5000),
        'Use estes dados para decidir se ainda falta executar a proxima @tool obrigatoria do procedimento. Se faltar, retorne a proxima action agora. Se o procedimento ja terminou, responda com o resultado concreto ao cliente.',
    ].join('\n');
}

function actionKey(action: AgentToolAction): string {
    if (action.type === 'mcp_call_tool') {
        return `${action.type}:${action.payload?.toolName || ''}`;
    }
    return action.type;
}

function filterAlreadyExecutedActions(actions: AgentToolAction[], results: AgentToolExecutionResult[]): AgentToolAction[] {
    const executed = new Set(results.map((result) => {
        if (result.input.type === 'mcp_call_tool') {
            return `${result.input.type}:${result.input.payload?.toolName || result.toolName}`;
        }
        return result.input.type;
    }));

    return actions.filter((action) => !executed.has(actionKey(action)));
}

async function listRuntimeAgentToolCatalog(workspaceId: string): Promise<AgentToolCatalogItem[]> {
    const mcpTools = await listMcpToolsForWorkspace(workspaceId).catch((error) => {
        console.error('[AUTOPILOT_MCP] Failed to list MCP tools:', error);
        return [];
    });

    const mcpCatalogItems: AgentToolCatalogItem[] = mcpTools.map((tool) => ({
        name: tool.qualifiedName as any,
        version: 'mcp',
        description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
        class: tool.annotations?.readOnlyHint ? 'read_only' : 'retrieval',
        riskLevel: tool.annotations?.destructiveHint ? 'high' : 'medium',
        idempotent: Boolean(tool.annotations?.idempotentHint || tool.annotations?.readOnlyHint),
        timeoutMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOOL_TIMEOUT_MS || '', 10) || 8000,
        maxAttempts: 1,
        requiresHumanApproval: Boolean(tool.annotations?.destructiveHint),
        source: 'mcp',
        enabledByDefault: false,
        serverId: tool.serverId,
        serverName: tool.serverName,
        inputSchema: tool.inputSchema || null,
    }));

    return [...listAgentToolCatalogItems(), ...mcpCatalogItems];
}

function resolveEnabledToolNames(config: AutopilotConfig) {
    return Array.isArray(config.enabled_tool_names)
        ? config.enabled_tool_names
        : listDefaultEnabledAgentToolNames();
}

function buildEnabledAgentToolsDescription(config: AutopilotConfig, toolCatalog: AgentToolCatalogItem[]): string {
    const configured = Array.isArray(config.enabled_tool_names)
        ? new Set(config.enabled_tool_names)
        : new Set(listDefaultEnabledAgentToolNames());

    const enabledTools = toolCatalog.filter((tool) => configured.has(tool.name));
    if (enabledTools.length === 0) {
        return 'Nenhuma ferramenta operacional esta habilitada. Nao solicite actions.';
    }

    return enabledTools
        .map((tool) => {
            const schema = tool.inputSchema ? ` Entrada JSON: ${JSON.stringify(tool.inputSchema).slice(0, 600)}` : '';
            return `- ${tool.name}: ${tool.description}${schema}`;
        })
        .join('\n');
}

const MAX_AI_ANALYSIS_CHARS = 1000;
const MAX_PROMPT_DOCUMENT_CHARS = 1200;
const MAX_PROMPT_DOCUMENT_TOTAL_CHARS = 4500;

function compactAiAnalysis(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= MAX_AI_ANALYSIS_CHARS) return normalized;
    return `${normalized.slice(0, MAX_AI_ANALYSIS_CHARS - 1).trim()}…`;
}

function compactKnowledgeDocumentsForPrompt(documents: KnowledgeBaseDocument[]): KnowledgeBaseDocument[] {
    let totalChars = 0;
    const compacted: KnowledgeBaseDocument[] = [];

    for (const document of documents || []) {
        const rawContent = String(document.content || '').replace(/\s+/g, ' ').trim();
        if (!rawContent) continue;

        const remaining = MAX_PROMPT_DOCUMENT_TOTAL_CHARS - totalChars;
        if (remaining <= 0) break;

        const maxForDocument = Math.min(MAX_PROMPT_DOCUMENT_CHARS, remaining);
        const content = rawContent.length > maxForDocument
            ? `${rawContent.slice(0, Math.max(0, maxForDocument - 1)).trim()}…`
            : rawContent;

        compacted.push({
            ...document,
            content,
        });
        totalChars += content.length;
    }

    return compacted;
}

function resolveAnalysisKind(type: Message['type']): MessageMetadata['analysisKind'] {
    if (type === 'audio') return 'transcription';
    if (type === 'image') return 'visual_summary';
    if (type === 'video') return 'video_summary';
    return 'media_summary';
}

async function broadcastAiProcessing(chatId: string, event: 'ai_processing_start' | 'ai_processing_stop', payload: Record<string, unknown> = {}) {
    try {
        const { getSupabaseAdmin } = await import('@/lib/supabase');
        const supabase = getSupabaseAdmin();
        await supabase.channel(`chat:${chatId}`).send({
            type: 'broadcast',
            event,
            payload: {
                chatId,
                ...payload,
            },
        });
    } catch (error) {
        console.error(`[AUTOPILOT_SERVICE] Failed to broadcast ${event}:`, error);
    }
}

async function insertAiAnalysisMessage(input: {
    workspaceId: string;
    chatId: string;
    systemAgentId: string;
    content: string;
    sourceMessageId: string;
    sourceType: Message['type'];
    analysisKind: NonNullable<MessageMetadata['analysisKind']>;
}) {
    await db.query(
        `INSERT INTO messages (
            workspace_id,
            chat_id,
            type,
            content,
            from_me,
            api_message_status,
            metadata,
            is_read,
            sender_system_agent_id,
            created_at
         ) VALUES ($1, $2, 'text', $3, true, 'internal', $4, true, $5, clock_timestamp())`,
        [
            input.workspaceId,
            input.chatId,
            input.content,
            JSON.stringify({
                isAiAnalysis: true,
                analysisKind: input.analysisKind,
                sourceMessageId: input.sourceMessageId,
                sourceType: input.sourceType,
                sentBy: 'system_agent',
                tool: 'ai_media_analysis',
            } satisfies MessageMetadata),
            input.systemAgentId,
        ]
    );
}

function describeAgentToolAction(action: AgentToolAction): string {
    if (action.type === 'sgp_fetch_contact_panel_data') return 'Consultar dados do cliente no SGP';
    if (action.type === 'sgp_fetch_contracts') return 'Listar contratos no SGP';
    if (action.type === 'mcp_call_tool') {
        const toolName = String(action.payload?.toolName || '').split(':').at(-1) || 'MCP';
        if (toolName === 'reboot_router') return 'Reinicializar roteador via TR-069';
        return `Executar ferramenta MCP ${toolName}`;
    }
    if (action.type === 'transfer_chat') return 'Transferir atendimento';
    if (action.type === 'add_internal_note') return 'Registrar nota interna';
    if (action.type === 'crm_update_contact_custom_fields') return 'Atualizar dados do CRM';
    if (action.type === 'sgp_generate_invoice_pix') return 'Gerar PIX de fatura no SGP';
    if (action.type === 'sgp_create_payment_promise') return 'Registrar promessa de pagamento no SGP';
    return action.type;
}

function summarizeAgentToolResult(result: AgentToolExecutionResult): string {
    const label = describeAgentToolAction(result.input);
    if (result.status === 'success') {
        if (result.toolName.endsWith(':reboot_router')) {
            const output = result.output as any;
            const text = Array.isArray(output?.content)
                ? output.content.map((item: any) => item?.text).filter(Boolean).join(' ')
                : '';
            return `${label}: comando enviado com sucesso.${text ? ` Retorno: ${text.slice(0, 240)}` : ''}`;
        }
        return `${label}: concluido com sucesso.`;
    }

    if (result.status === 'rejected') {
        return `${label}: nao executado. ${result.error || 'A ferramenta rejeitou a solicitacao.'}`;
    }

    return `${label}: falhou. ${result.error || 'Erro desconhecido na ferramenta.'}`;
}

async function insertAgentToolStatusMessage(input: {
    workspaceId: string;
    chatId: string;
    systemAgentId: string;
    content: string;
    toolName: string;
    status: 'running' | 'success' | 'error' | 'rejected';
}) {
    try {
        await db.query(
            `INSERT INTO messages (
                workspace_id,
                chat_id,
                type,
                content,
                from_me,
                api_message_status,
                metadata,
                is_read,
                sender_system_agent_id,
                created_at
             ) VALUES ($1, $2, 'text', $3, true, 'internal', $4, true, $5, clock_timestamp())`,
            [
                input.workspaceId,
                input.chatId,
                input.content,
                JSON.stringify({
                    isInternalNote: true,
                    isToolExecution: true,
                    analysisKind: 'routing_context',
                    sentBy: 'system_agent',
                    tool: 'agent_tool_status',
                    agentToolName: input.toolName,
                    agentToolStatus: input.status,
                }),
                input.systemAgentId,
            ]
        );
    } catch (error) {
        console.error('[AUTOPILOT_TOOL_STATUS] Failed to insert tool status message:', error);
    }
}

async function isAutopilotSourceMessageStillCurrent(input: {
    chatId: string;
    sourceMessageId?: string | null;
}): Promise<boolean> {
    if (!input.sourceMessageId) return true;

    try {
        const { rows } = await db.query(
            `WITH source_message AS (
                SELECT id, created_at
                FROM messages
                WHERE id = $1
                  AND chat_id = $2
                  AND from_me = false
                LIMIT 1
             ),
             newer_customer_message AS (
                SELECT 1
                FROM messages m
                JOIN source_message sm ON true
                WHERE m.chat_id = $2
                  AND m.from_me = false
                  AND m.created_at > sm.created_at
                  AND m.id <> sm.id
                LIMIT 1
             )
             SELECT
                EXISTS(SELECT 1 FROM source_message) AS source_exists,
                EXISTS(SELECT 1 FROM newer_customer_message) AS has_newer_customer_message`,
            [input.sourceMessageId, input.chatId]
        );
        const row = rows[0];
        return Boolean(row?.source_exists) && !Boolean(row?.has_newer_customer_message);
    } catch (error) {
        console.error('[AUTOPILOT_STALE_GUARD] Failed to verify source message:', error);
        return false;
    }
}

async function buildMediaAnalysisContext(input: {
    workspaceId: string;
    chatId: string;
    messageId?: string | null;
    systemAgentId: string;
}): Promise<string> {
    if (!input.messageId) return '';

    const { rows } = await db.query(
        `SELECT id, type, content, metadata, media_url
         FROM messages
         WHERE id = $1
           AND chat_id = $2
         LIMIT 1`,
        [input.messageId, input.chatId]
    );
    const message = rows[0];
    if (!message) return '';

    const type = message.type as Message['type'];
    if (!['audio', 'image', 'video'].includes(type)) return '';

    let metadata: MessageMetadata = {};
    try {
        metadata = typeof message.metadata === 'string'
            ? JSON.parse(message.metadata)
            : message.metadata || {};
    } catch {
        metadata = {};
    }

    const mediaUrl = metadata.mediaUrl || message.media_url;
    if (!mediaUrl) {
        return `[Midia recebida: ${type}. Nao foi possivel localizar URL publica para analise automatica.]`;
    }

    try {
        const result = await analyzeMediaForAutopilot({
            workspaceId: input.workspaceId,
            mediaUrl,
            mediaType: type as 'audio' | 'image' | 'video',
            mimetype: metadata.mimetype,
            caption: message.content,
        });
        const compact = compactAiAnalysis(result.analysis);
        const label = type === 'audio'
            ? 'Audio do cliente'
            : type === 'image'
                ? 'Imagem do cliente'
                : 'Video do cliente';
        const content = `${label}: ${compact}`;
        await insertAiAnalysisMessage({
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            systemAgentId: input.systemAgentId,
            content,
            sourceMessageId: message.id,
            sourceType: type,
            analysisKind: resolveAnalysisKind(type) as NonNullable<MessageMetadata['analysisKind']>,
        });
        return `[Analise automatica de ${type}] ${compact}`;
    } catch (error) {
        console.error('[AUTOPILOT_MEDIA_ANALYSIS] Failed:', error);
        return `[Midia recebida: ${type}. A analise automatica falhou; se necessario, peca ao cliente para descrever o conteudo.]`;
    }
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
    orchestratorRunId?: string | null;
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
            orchestratorRunId: input.orchestratorRunId ?? null,
        },
        normalizedActions
    );
}

async function runRequestedAgentToolsWithStatus(input: {
    workspaceId: string;
    chat: Chat;
    contact: Contact;
    systemAgentId: string;
    systemAgentName: string;
    autopilotConfig: AutopilotConfig;
    customerMessage: string;
    actions: unknown;
    orchestratorRunId?: string | null;
}): Promise<AgentToolExecutionResult[]> {
    const normalizedActions = normalizeAgentActions(input.actions);
    if (normalizedActions.length === 0) return [];

    for (const action of normalizedActions) {
        await insertAgentToolStatusMessage({
            workspaceId: input.workspaceId,
            chatId: input.chat.id,
            systemAgentId: input.systemAgentId,
            content: `Executando ferramenta: ${describeAgentToolAction(action)}.`,
            toolName: action.type === 'mcp_call_tool' ? String(action.payload?.toolName || action.type) : action.type,
            status: 'running',
        });
    }

    const results = await runRequestedAgentTools({
        ...input,
        actions: normalizedActions,
    });

    for (const result of results) {
        await insertAgentToolStatusMessage({
            workspaceId: input.workspaceId,
            chatId: input.chat.id,
            systemAgentId: input.systemAgentId,
            content: summarizeAgentToolResult(result),
            toolName: result.toolName,
            status: result.status,
        });
    }

    return results;
}

async function loadToolRouterTeams(workspaceId: string): Promise<ToolRouterTeam[]> {
    try {
        const { rows } = await db.query(
            `SELECT id, name, COALESCE(agent_routing_config, '{}'::jsonb) AS agent_routing_config
             FROM teams
             WHERE workspace_id = $1
             ORDER BY name`,
            [workspaceId]
        );
        return rows
            .filter((row) => row.id && row.name)
            .map((row) => ({
                id: row.id as string,
                name: row.name as string,
                routingConfig: row.agent_routing_config || {},
            }));
    } catch (error) {
        console.error('[AUTOPILOT_TOOL_ROUTER] Failed to load teams:', error);
        return [];
    }
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
    instanceName: string,
    sourceMessageId?: string | null
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
    await broadcastAiProcessing(chat.id, 'ai_processing_start');

    try {
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

    const resolvedAiModel = await resolveAutopilotModelFromCatalog(autopilotConfig.ai_model);
    if (resolvedAiModel.fallbackUsed) {
        console.warn(
            `[AUTOPILOT_SERVICE] Modelo salvo "${resolvedAiModel.requestedModel}" nao esta habilitado no catalogo global. Usando "${resolvedAiModel.model}" no chat ${chat.id}.`
        );
    }

    const orchestratorRun = await startOrchestratorRun({
        workspaceId,
        chatId: chat.id,
        sourceMessageId: sourceMessageId ?? null,
        systemAgentId: assignedSystemAgentId,
        autopilotConfigId: autopilotConfig.id,
        metadata: {
            source: 'autopilot-service',
            instanceName,
            copilotMode: currentCopilotMode,
        },
    });
    const orchestratorTimings: Record<string, number> = {};

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

    const mediaAnalysisContext = await buildMediaAnalysisContext({
        workspaceId,
        chatId: chat.id,
        messageId: sourceMessageId,
        systemAgentId: assignedSystemAgentId,
    });
    const enrichedLastMessageContent = [
        lastMessageContent || '',
        mediaAnalysisContext,
    ].filter((part) => part.trim().length > 0).join('\n\n');

    const activeRules = (autopilotRules || []).filter(rule => rule.enabled);
    const sanitizedContact: Contact = {
        ...(chat.contact as Contact),
        email: chat.contact?.email || '',
    };
    const availableTeams = await loadToolRouterTeams(workspaceId);
    let deterministicRouting = routeDeterministicAgentTools({
        customerMessage: enrichedLastMessageContent || '',
        contactName: sanitizedContact.name,
        availableTeams,
    });

    let workspaceGeminiApiKey: string | undefined;
    try {
        const configRes = await db.query(
            `SELECT config->>'apiKey' as api_key
             FROM workspace_integrations
             WHERE workspace_id = $1
               AND provider = 'gemini'
               AND is_active = true
               AND COALESCE(config->>'apiKey', '') <> ''
             ORDER BY updated_at DESC
             LIMIT 1`,
            [workspaceId]
        );
        if (configRes.rows.length > 0) {
            workspaceGeminiApiKey = configRes.rows[0].api_key;
        }
    } catch (error) {
        console.error('[AUTOPILOT_SERVICE] Failed to fetch integration key:', error);
    }

    if (deterministicRouting.actions.length === 0 && deterministicRouting.candidates.length > 0) {
        const candidate = deterministicRouting.candidates[0];
        try {
            const gateStage = await timeOrchestratorStage(
                orchestratorRun,
                'tool_intent_gate',
                () => withTimeout(
                    classifyToolIntent({
                        customerMessage: enrichedLastMessageContent || '',
                        chatHistory: chatHistoryForAI,
                        toolName: candidate.toolName,
                        targetTeamName: candidate.team.name,
                        candidateReason: candidate.reason,
                        model: process.env.AI_TOOL_INTENT_GATE_MODEL || resolvedAiModel.model,
                        apiKey: workspaceGeminiApiKey,
                        timeoutMs: Number(process.env.AI_TOOL_INTENT_GATE_TIMEOUT_MS || 2500),
                    }),
                    Number(process.env.AI_TOOL_INTENT_GATE_TIMEOUT_MS || 2500) + 500,
                    'tool intent gate'
                ),
                {
                    candidateTool: candidate.toolName,
                    candidateTeam: candidate.team.name,
                    candidateSource: candidate.source,
                }
            );
            orchestratorTimings.tool_intent_gate_ms = gateStage.durationMs;

            if (gateStage.value.execute && gateStage.value.confidence === 'high') {
                const reason = `Gate de intencao aprovou ${candidate.toolName} para ${candidate.team.name}: ${gateStage.value.reason}`;
                deterministicRouting = {
                    actions: [
                        {
                            type: 'add_internal_note',
                            reason,
                            payload: {
                                content: `${sanitizedContact.name ? `${sanitizedContact.name}: ` : ''}${(enrichedLastMessageContent || '').replace(/\s+/g, ' ').trim().slice(0, 180)}. Motivo do roteamento: ${reason}.`,
                            },
                        },
                        {
                            type: 'transfer_chat',
                            reason,
                            payload: { teamId: candidate.team.id },
                        },
                    ],
                    matchedReason: reason,
                    responseHint: candidate.responseHint,
                    candidates: deterministicRouting.candidates,
                };
            } else {
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'tool_intent_gate',
                    status: 'skipped',
                    durationMs: gateStage.durationMs,
                    payload: {
                        candidate,
                        decision: gateStage.value,
                    },
                });
            }
        } catch (error) {
            console.warn('[AUTOPILOT_TOOL_INTENT_GATE] Gate failed, continuing without candidate tool:', error);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'tool_intent_gate',
                status: 'fallback',
                payload: {
                    candidate,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    if (deterministicRouting.actions.length > 0) {
        console.log(
            `[AUTOPILOT_TOOL_ROUTER] Matched deterministic actions for chat ${chat.id}: ${deterministicRouting.matchedReason}`
        );
    }

    if (deterministicRouting.actions.length > 0 && deterministicRouting.responseHint) {
        const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
            chatId: chat.id,
            sourceMessageId: sourceMessageId ?? null,
        });
        if (!sourceMessageStillCurrent) {
            console.warn(`[AUTOPILOT_STALE_GUARD] Skipping stale deterministic response/tool execution for chat ${chat.id}, sourceMessageId=${sourceMessageId || 'none'}.`);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'stale_source_message_guard',
                status: 'skipped',
                payload: {
                    sourceMessageId: sourceMessageId ?? null,
                    reason: 'newer_customer_message_exists',
                    deterministicRouting: deterministicRouting.matchedReason,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'skipped',
                timings: orchestratorTimings,
                metadata: {
                    responseSent: false,
                    toolCount: 0,
                    staleSourceMessage: true,
                    sourceMessageId: sourceMessageId ?? null,
                    deterministicRouting: deterministicRouting.matchedReason,
                },
            });
            return;
        }

        const finalResponse = formatCustomerFacingAiResponse(deterministicRouting.responseHint);

        if (currentCopilotMode === 'suggest') {
            const { getSupabaseAdmin } = await import('@/lib/supabase');
            const supabase = getSupabaseAdmin();
            await supabase.channel(`chat:${chat.id}`).send({
                type: 'broadcast',
                event: 'ai_suggestion',
                payload: {
                    suggestion: finalResponse,
                    chatId: chat.id,
                    configName: autopilotConfig.name,
                },
            });
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: 'deterministic-router',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: 'suggested',
                triggeredRule: deterministicRouting.matchedReason,
                metadata: { deterministicRouting: deterministicRouting.matchedReason },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'success',
                timings: orchestratorTimings,
                intent: 'deterministic_tool_routing',
                confidenceLevel: 'deterministic',
                metadata: {
                    suggestionOnly: true,
                    skippedLlm: true,
                    deterministicRouting: deterministicRouting.matchedReason,
                },
            });
            return;
        }

        const sendStage = await timeOrchestratorStage(
            orchestratorRun,
            'message_send',
            () => sendMultiBlockResponse(
                chat.id,
                finalResponse,
                assignedSystemAgentId,
                true,
                instanceName
            ),
            { responseLength: finalResponse.length, skippedLlm: true }
        );
        orchestratorTimings.send_ms = sendStage.durationMs;

        const toolsStage = await timeOrchestratorStage(
            orchestratorRun,
            'tool_execution',
            () => runRequestedAgentToolsWithStatus({
                workspaceId,
                chat,
                contact: sanitizedContact,
                systemAgentId: assignedSystemAgentId,
                systemAgentName: assignedSystemAgentName,
                autopilotConfig,
                customerMessage: enrichedLastMessageContent || '',
                actions: deterministicRouting.actions,
                orchestratorRunId: orchestratorRun.id,
            }),
            { requestedActions: deterministicRouting.actions.map((action) => action.type), skippedLlm: true }
        );
        orchestratorTimings.tool_ms = toolsStage.durationMs;
        const toolResults = toolsStage.value;

        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'deterministic-router',
            customerMessage: enrichedLastMessageContent || '',
            response: finalResponse,
            status: 'sent',
            triggeredRule: deterministicRouting.matchedReason,
            metadata: {
                deterministicRouting: deterministicRouting.matchedReason,
                skippedLlm: true,
                toolResults,
            },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'success',
            timings: orchestratorTimings,
            intent: 'deterministic_tool_routing',
            confidenceLevel: 'deterministic',
            metadata: {
                responseSent: true,
                toolCount: toolResults.length,
                skippedLlm: true,
                deterministicRouting: deterministicRouting.matchedReason,
            },
        });
        return;
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
        if (enrichedLastMessageContent && enrichedLastMessageContent.trim().length > 3) {
            console.log(`[AUTOPILOT_RAG] Searching support context for: "${enrichedLastMessageContent.substring(0, 50)}..."`);
            const ragStage = await timeOrchestratorStage(
                orchestratorRun,
                'rag_retrieval',
                () => withTimeout(
                    retrieveSupportContext({
                        workspaceId,
                        autopilotConfigId: autopilotConfig.id,
                        query: enrichedLastMessageContent,
                        excludeChatId: chat.id,
                    }),
                    orchestratorRun.budget.maxRagMs,
                    'rag retrieval'
                ),
                { queryLength: enrichedLastMessageContent.length }
            );
            orchestratorTimings.rag_ms = ragStage.durationMs;
            const retrieval = ragStage.value;

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
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'rag_retrieval',
            status: 'fallback',
            payload: { error: ragError instanceof Error ? ragError.message : String(ragError) },
        });
    }

    const runtimeToolCatalog = await listRuntimeAgentToolCatalog(workspaceId);
    const knowledgeToolProcedures = formatKnowledgeToolProcedures(
        extractKnowledgeToolProcedures({
            documents: ragDocuments,
            tools: runtimeToolCatalog,
            enabledToolNames: resolveEnabledToolNames(autopilotConfig),
        })
    );
    const promptKnowledgeDocuments = compactKnowledgeDocumentsForPrompt(ragDocuments);

    try {
        const llmStage = await timeOrchestratorStage(
            orchestratorRun,
            'llm_response',
            () => withTimeout(generateAgentResponse({
            config: autopilotConfig,
            chatId: chat.id,
            customerMessage: enrichedLastMessageContent || '',
            chatHistory: chatHistoryForAI,
            relevantHistory,
            rules: activeRules,
            knowledgeBase: autopilotConfig.knowledge_base || '',
            knowledgeBaseDocuments: promptKnowledgeDocuments,
            resolvedCases,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            escalationPolicy: [
                autopilotConfig.escalation_policy || '',
                deterministicRouting.matchedReason
                    ? `Roteamento interno ja identificado pelo servidor: ${deterministicRouting.matchedReason} Responda ao cliente de forma natural informando que o atendimento sera encaminhado.`
                    : '',
            ].filter(Boolean).join('\n\n'),
            closingPolicy: autopilotConfig.closing_policy || '',
            model: resolvedAiModel.model,
            contact: sanitizedContact,
            workspaceGeminiApiKey,
            enabledAgentToolsDescription: buildEnabledAgentToolsDescription(autopilotConfig, runtimeToolCatalog),
            knowledgeToolProcedures,
            }), orchestratorRun.budget.maxLlmMs, 'llm response'),
            {
                model: resolvedAiModel.model,
                requestedModel: resolvedAiModel.requestedModel,
                modelFallbackUsed: resolvedAiModel.fallbackUsed,
                deterministicRouting: deterministicRouting.matchedReason,
            }
        );
        orchestratorTimings.llm_ms = llmStage.durationMs;
        const result = llmStage.value;

        if (result?.response) {
            let finalResponse = result.response;
            let aiMessageBlocks: string[] | null = (result as any).messageBlocks?.length > 1
                ? (result as any).messageBlocks as string[]
                : null;
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
                        message: enrichedLastMessageContent || '',
                        agentResponse: result.response,
                    });
                    if (webhookExecution?.reply) {
                        finalResponse = webhookExecution.reply;
                        aiMessageBlocks = null; // Webhook overrode the AI response
                    }
                } catch (webhookError) {
                    console.error('[AUTOPILOT_WEBHOOK_ACTION] Failed to execute webhook rule:', webhookError);
                    finalResponse = autopilotConfig.default_fallback_reply || result.response;
                    aiMessageBlocks = null; // Webhook error, blocks no longer valid
                    webhookExecution = {
                        reply: finalResponse,
                        response: {
                            error: webhookError instanceof Error ? webhookError.message : String(webhookError),
                        },
                    };
                }
            }

            finalResponse = formatCustomerFacingAiResponse(finalResponse);

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
                    modelName: resolvedAiModel.model,
                    customerMessage: enrichedLastMessageContent || '',
                    response: finalResponse,
                    status: 'suggested',
                    triggeredRule: result.triggeredRule || null,
                });
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'success',
                    timings: orchestratorTimings,
                    intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : null,
                    confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'plausible',
                    metadata: {
                        suggestionOnly: true,
                        deterministicRouting: deterministicRouting.matchedReason,
                    },
                });
            } else {
                const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
                    chatId: chat.id,
                    sourceMessageId: sourceMessageId ?? null,
                });
                if (!sourceMessageStillCurrent) {
                    console.warn(`[AUTOPILOT_STALE_GUARD] Skipping stale autopilot response/tool execution for chat ${chat.id}, sourceMessageId=${sourceMessageId || 'none'}.`);
                    await recordOrchestratorEvent({
                        run: orchestratorRun,
                        kind: 'stale_source_message_guard',
                        status: 'skipped',
                        payload: {
                            sourceMessageId: sourceMessageId ?? null,
                            reason: 'newer_customer_message_exists',
                        },
                    });
                    await finishOrchestratorRun({
                        run: orchestratorRun,
                        status: 'skipped',
                        timings: orchestratorTimings,
                        metadata: {
                            responseSent: false,
                            toolCount: 0,
                            staleSourceMessage: true,
                            sourceMessageId: sourceMessageId ?? null,
                        },
                    });
                    return;
                }

                const enabledToolNames = resolveEnabledToolNames(autopilotConfig);
                const promisedLookupActions = ensurePromisedSgpLookupAction({
                    response: finalResponse,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: normalizeAgentActions(result.actions),
                    enabledToolNames,
                });
                const llmActions = ensureProcedureSgpLookupAction({
                    response: finalResponse,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: promisedLookupActions,
                    enabledToolNames,
                    knowledgeToolProcedures,
                });
                const requestedActions = filterImplicitTransferActions({
                    actions: mergeAgentActions(deterministicRouting.actions, llmActions),
                    customerMessage: enrichedLastMessageContent || '',
                    availableTeams,
                });
                const preResponseActions = requestedActions
                    .filter(isPreResponseDataAction)
                    .sort((left, right) => {
                        if (left.type === 'crm_update_contact_custom_fields' && right.type !== left.type) return -1;
                        if (right.type === 'crm_update_contact_custom_fields' && left.type !== right.type) return 1;
                        return 0;
                    });
                const postResponseActions = requestedActions.filter((action) => !isPreResponseDataAction(action));
                let toolResults: AgentToolExecutionResult[] = [];

                if (preResponseActions.length > 0) {
                    const preToolsStage = await timeOrchestratorStage(
                        orchestratorRun,
                        'tool_execution',
                        () => runRequestedAgentToolsWithStatus({
                            workspaceId,
                            chat,
                            contact: sanitizedContact,
                            systemAgentId: assignedSystemAgentId,
                            systemAgentName: assignedSystemAgentName,
                            autopilotConfig,
                            customerMessage: enrichedLastMessageContent || '',
                            actions: preResponseActions,
                            orchestratorRunId: orchestratorRun.id,
                        }),
                        { requestedActions: preResponseActions.map((action) => action.type), beforeResponse: true }
                    );
                    orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + preToolsStage.durationMs;
                    toolResults = preToolsStage.value;

                    const deterministicProcedureAction = buildRouterRebootActionFromSgpResults({
                        toolResults,
                        customerMessage: enrichedLastMessageContent || '',
                        response: finalResponse,
                        knowledgeToolProcedures,
                    });

                    if (deterministicProcedureAction) {
                        const procedureToolsStage = await timeOrchestratorStage(
                            orchestratorRun,
                            'tool_execution',
                            () => runRequestedAgentToolsWithStatus({
                                workspaceId,
                                chat,
                                contact: sanitizedContact,
                                systemAgentId: assignedSystemAgentId,
                                systemAgentName: assignedSystemAgentName,
                                autopilotConfig,
                                customerMessage: enrichedLastMessageContent || '',
                                actions: [deterministicProcedureAction],
                                orchestratorRunId: orchestratorRun.id,
                            }),
                            {
                                requestedActions: [deterministicProcedureAction.type],
                                deterministicProcedure: 'router_reboot',
                            }
                        );
                        orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + procedureToolsStage.durationMs;
                        toolResults = [...toolResults, ...procedureToolsStage.value];
                    }

                    const continuationContext = buildToolContinuationContext(toolResults);
                    const hasProcedureToolPending =
                        Boolean(knowledgeToolProcedures) &&
                        Boolean(continuationContext) &&
                        !toolResults.some((toolResult) => toolResult.toolName.startsWith('mcp:'));

                    if (hasProcedureToolPending) {
                        try {
                            const continuationStage = await timeOrchestratorStage(
                                orchestratorRun,
                                'llm_tool_continuation',
                                () => withTimeout(generateAgentResponse({
                                    config: autopilotConfig,
                                    chatId: chat.id,
                                    customerMessage: enrichedLastMessageContent || '',
                                    chatHistory: chatHistoryForAI,
                                    relevantHistory: [
                                        relevantHistory,
                                        continuationContext,
                                    ].filter(Boolean).join('\n\n'),
                                    rules: activeRules,
                                    knowledgeBase: autopilotConfig.knowledge_base || '',
                                    knowledgeBaseDocuments: promptKnowledgeDocuments,
                                    resolvedCases,
                                    fallbackReply: autopilotConfig.default_fallback_reply || '',
                                    escalationPolicy: autopilotConfig.escalation_policy || '',
                                    closingPolicy: autopilotConfig.closing_policy || '',
                                    model: resolvedAiModel.model,
                                    contact: sanitizedContact,
                                    workspaceGeminiApiKey,
                                    enabledAgentToolsDescription: buildEnabledAgentToolsDescription(autopilotConfig, runtimeToolCatalog),
                                    knowledgeToolProcedures,
                                }), orchestratorRun.budget.maxLlmMs, 'llm tool continuation'),
                                {
                                    model: resolvedAiModel.model,
                                    reason: 'procedure_tool_continuation',
                                    priorToolResults: toolResults.map((toolResult) => toolResult.toolName),
                                }
                            );
                            orchestratorTimings.llm_tool_continuation_ms = continuationStage.durationMs;

                            const continuation = continuationStage.value;
                            const continuationActions = filterAlreadyExecutedActions(
                                normalizeAgentActions(continuation?.actions),
                                toolResults
                            ).filter(isPreResponseDataAction);

                            if (continuation?.response) {
                                finalResponse = continuation.response;
                            }

                            if (continuationActions.length > 0) {
                                const continuationToolsStage = await timeOrchestratorStage(
                                    orchestratorRun,
                                    'tool_execution',
                                    () => runRequestedAgentToolsWithStatus({
                                        workspaceId,
                                        chat,
                                        contact: sanitizedContact,
                                        systemAgentId: assignedSystemAgentId,
                                        systemAgentName: assignedSystemAgentName,
                                        autopilotConfig,
                                        customerMessage: enrichedLastMessageContent || '',
                                        actions: continuationActions,
                                        orchestratorRunId: orchestratorRun.id,
                                    }),
                                    {
                                        requestedActions: continuationActions.map((action) => action.type),
                                        procedureContinuation: true,
                                    }
                                );
                                orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + continuationToolsStage.durationMs;
                                toolResults = [...toolResults, ...continuationToolsStage.value];
                            }
                        } catch (continuationError) {
                            console.warn('[AUTOPILOT_TOOL_CONTINUATION] Failed, falling back to first tool response:', continuationError);
                            await recordOrchestratorEvent({
                                run: orchestratorRun,
                                kind: 'llm_tool_continuation',
                                status: 'fallback',
                                payload: {
                                    error: continuationError instanceof Error ? continuationError.message : String(continuationError),
                                },
                            });
                        }
                    }

                    let postToolAiResponse: string | null = null;
                    const shouldGeneratePostToolResponse = toolResults.some((toolResult) => toolResult.toolName.startsWith('mcp:'));
                    if (shouldGeneratePostToolResponse) {
                        try {
                            const finalToolContext = [
                                buildToolContinuationContext(toolResults),
                                'Escreva a resposta final ao cliente com base no resultado real das ferramentas. Nao exponha JSON, command_id, stack trace ou mensagem tecnica bruta. Se a acao falhou, explique de forma simples e diga que sera verificado manualmente.',
                            ].filter(Boolean).join('\n\n');
                            const finalResponseStage = await timeOrchestratorStage(
                                orchestratorRun,
                                'llm_tool_final_response',
                                () => withTimeout(generateAgentResponse({
                                    config: autopilotConfig,
                                    chatId: chat.id,
                                    customerMessage: enrichedLastMessageContent || '',
                                    chatHistory: chatHistoryForAI,
                                    relevantHistory: [
                                        relevantHistory,
                                        finalToolContext,
                                    ].filter(Boolean).join('\n\n'),
                                    rules: activeRules,
                                    knowledgeBase: autopilotConfig.knowledge_base || '',
                                    knowledgeBaseDocuments: promptKnowledgeDocuments,
                                    resolvedCases,
                                    fallbackReply: '',
                                    escalationPolicy: autopilotConfig.escalation_policy || '',
                                    closingPolicy: autopilotConfig.closing_policy || '',
                                    model: resolvedAiModel.model,
                                    contact: sanitizedContact,
                                    workspaceGeminiApiKey,
                                    enabledAgentToolsDescription: buildEnabledAgentToolsDescription(autopilotConfig, runtimeToolCatalog),
                                    knowledgeToolProcedures,
                                }), orchestratorRun.budget.maxLlmMs, 'llm tool final response'),
                                {
                                    model: resolvedAiModel.model,
                                    reason: 'post_tool_customer_response',
                                    toolResults: toolResults.map((toolResult) => ({
                                        toolName: toolResult.toolName,
                                        status: toolResult.status,
                                    })),
                                }
                            );
                            orchestratorTimings.llm_tool_final_response_ms = finalResponseStage.durationMs;
                            if (finalResponseStage.value?.response) {
                                postToolAiResponse = finalResponseStage.value.response;
                            }
                        } catch (finalResponseError) {
                            console.warn('[AUTOPILOT_TOOL_FINAL_RESPONSE] Failed, using deterministic tool response:', finalResponseError);
                            await recordOrchestratorEvent({
                                run: orchestratorRun,
                                kind: 'llm_tool_final_response',
                                status: 'fallback',
                                payload: {
                                    error: finalResponseError instanceof Error ? finalResponseError.message : String(finalResponseError),
                                },
                            });
                        }
                    }

                    const sgpResponse = buildSgpResponseFromToolResults(
                        toolResults,
                        `${enrichedLastMessageContent || ''}\n${finalResponse || ''}`
                    );
                    if (sgpResponse) {
                        finalResponse = formatCustomerFacingAiResponse(sgpResponse);
                        aiMessageBlocks = null; // Tool response overrode AI blocks
                    }
                    const mcpResponse = buildMcpCustomerResponseFromToolResults(toolResults) ||
                        buildMcpResponseFromToolResults(toolResults);
                    if (mcpResponse) {
                        finalResponse = formatCustomerFacingAiResponse(mcpResponse);
                        aiMessageBlocks = null;
                    }
                    const toolFailureResponse = buildToolFailureResponse(toolResults, finalResponse);
                    if (toolFailureResponse) {
                        finalResponse = formatCustomerFacingAiResponse(toolFailureResponse);
                        aiMessageBlocks = null;
                    }
                    if (postToolAiResponse) {
                        finalResponse = formatCustomerFacingAiResponse(postToolAiResponse);
                        aiMessageBlocks = null;
                    }
                }

                finalResponse = formatCustomerFacingAiResponse(finalResponse);

                console.log(`[AUTOPILOT_SERVICE] Enviando resposta: ${finalResponse}`);
                const agentId = assignedSystemAgentId;
                const sendStage = await timeOrchestratorStage(
                    orchestratorRun,
                    'message_send',
                    () => sendMultiBlockResponse(
                        chat.id,
                        finalResponse,
                        agentId,
                        true,
                        instanceName,
                        aiMessageBlocks
                    ),
                    { responseLength: finalResponse.length }
                );
                orchestratorTimings.send_ms = sendStage.durationMs;
                const toolsStage = await timeOrchestratorStage(
                    orchestratorRun,
                    'tool_execution',
                    () => runRequestedAgentToolsWithStatus({
                        workspaceId,
                        chat,
                        contact: sanitizedContact,
                        systemAgentId: assignedSystemAgentId,
                        systemAgentName: assignedSystemAgentName,
                        autopilotConfig,
                        customerMessage: enrichedLastMessageContent || '',
                        actions: postResponseActions,
                        orchestratorRunId: orchestratorRun.id,
                    }),
                    { requestedActions: postResponseActions.map((action) => action.type), afterResponse: true }
                );
                orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
                toolResults = [...toolResults, ...toolsStage.value];
                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: resolvedAiModel.model,
                    customerMessage: enrichedLastMessageContent || '',
                    response: finalResponse,
                    status: 'sent',
                    triggeredRule: result.triggeredRule || null,
                    metadata: {
                        ...(webhookExecution ? { webhookExecution: webhookExecution.response } : {}),
                        ...(deterministicRouting.matchedReason ? { deterministicRouting: deterministicRouting.matchedReason } : {}),
                        ...(toolResults.length > 0 ? { toolResults } : {}),
                    },
                });
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'success',
                    timings: orchestratorTimings,
                    intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : null,
                    confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'plausible',
                    metadata: {
                        responseSent: true,
                        toolCount: toolResults.length,
                        deterministicRouting: deterministicRouting.matchedReason,
                    },
                });
            }
        } else {
            console.log('[AUTOPILOT_SERVICE] Nenhuma resposta gerada.');
            const fallbackActions = filterImplicitTransferActions({
                actions: mergeAgentActions(deterministicRouting.actions, normalizeAgentActions(result?.actions)),
                customerMessage: enrichedLastMessageContent || '',
                availableTeams,
            });
            const toolResults = currentCopilotMode === 'auto'
                ? (await timeOrchestratorStage(
                    orchestratorRun,
                    'tool_execution',
                    () => runRequestedAgentToolsWithStatus({
                        workspaceId,
                        chat,
                        contact: sanitizedContact,
                        systemAgentId: assignedSystemAgentId,
                        systemAgentName: assignedSystemAgentName,
                        autopilotConfig,
                        customerMessage: enrichedLastMessageContent || '',
                        actions: fallbackActions,
                        orchestratorRunId: orchestratorRun.id,
                    }),
                    { requestedActions: fallbackActions.map((action) => action.type), noLlmResponse: true }
                )).value
                : [];
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: resolvedAiModel.model,
                customerMessage: enrichedLastMessageContent || '',
                response: null,
                status: 'empty',
                triggeredRule: result?.triggeredRule || null,
                metadata: toolResults.length > 0 || deterministicRouting.matchedReason
                    ? {
                        ...(deterministicRouting.matchedReason ? { deterministicRouting: deterministicRouting.matchedReason } : {}),
                        ...(toolResults.length > 0 ? { toolResults } : {}),
                    }
                    : null,
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: toolResults.length > 0 ? 'success' : 'fallback',
                timings: orchestratorTimings,
                intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : null,
                confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'low',
                metadata: {
                    responseSent: false,
                    toolCount: toolResults.length,
                    deterministicRouting: deterministicRouting.matchedReason,
                },
            });
        }
    } catch (error) {
        console.error('[AUTOPILOT_SERVICE] Erro ao processar:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (currentCopilotMode === 'auto' && errorMessage.includes('llm response timed out')) {
            const timeoutFallback = formatCustomerFacingAiResponse(
                autopilotConfig.default_fallback_reply?.trim() ||
                'Estou com uma instabilidade para responder agora. Pode aguardar um instante? Nossa equipe vai acompanhar por aqui.'
            );
            try {
                const sendStage = await timeOrchestratorStage(
                    orchestratorRun,
                    'message_send',
                    () => sendAutomatedMessageAction(
                        chat.id,
                        timeoutFallback,
                        assignedSystemAgentId,
                        true,
                        instanceName
                    ),
                    { responseLength: timeoutFallback.length, fallbackReason: 'llm_timeout' }
                );
                orchestratorTimings.send_ms = sendStage.durationMs;
                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: resolvedAiModel.model,
                    customerMessage: enrichedLastMessageContent || lastMessageContent || '',
                    response: timeoutFallback,
                    status: 'sent',
                    triggeredRule: null,
                    metadata: {
                        fallbackReason: 'llm_timeout',
                        deterministicRouting: deterministicRouting.matchedReason,
                    },
                });
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'fallback',
                    timings: orchestratorTimings,
                    confidenceLevel: 'low',
                    error: errorMessage,
                    metadata: {
                        responseSent: true,
                        fallbackReason: 'llm_timeout',
                        deterministicRouting: deterministicRouting.matchedReason,
                    },
                });
                return;
            } catch (fallbackError) {
                console.error('[AUTOPILOT_SERVICE] Falha ao enviar fallback de timeout:', fallbackError);
            }
        }
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'error',
            timings: orchestratorTimings,
            error: errorMessage,
            metadata: {
                deterministicRouting: deterministicRouting.matchedReason,
            },
        });
        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: resolvedAiModel.model,
            customerMessage: lastMessageContent || '',
            response: null,
            status: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
        });
    }
    } finally {
        await broadcastAiProcessing(chat.id, 'ai_processing_stop');
    }
}
