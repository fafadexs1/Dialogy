import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { AutopilotConfig, NexusFlowInstance, KnowledgeBaseDocument, Workspace, Chat, Contact, Message, MessageMetadata } from '@/lib/types';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { generateProcedureRuntimeOutput } from '@/ai/flows/procedure-runtime';
import { sendAutomatedMessageAction } from '@/actions/messages';
import { logToDebugFile } from '@/lib/debug-file';
import { resolveCanonicalWhatsappChatIdByIdentity } from '@/lib/whatsapp/contact-identity';
import { retrieveHybridSupportContext, type KnowledgeRetrievalStrategy } from '@/services/rag/hybrid-retrieval';
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
    type ToolRoutingCandidate,
} from '@/services/agent-tools/router';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';
import { classifyToolIntent } from '@/ai/flows/tool-intent-gate';
import { classifyAutopilotIntentWithAi, shouldUseAiIntentClassifier } from '@/ai/flows/intent-classifier';
import { classifyAutopilotWorkflowWithAi, shouldUseAiWorkflowClassifier, type AiWorkflowDecision } from '@/ai/flows/workflow-classifier';
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
import { findOfficialKnowledgeAnswer, resolveAutopilotIntent, resolveAutopilotIntentWithOverride } from '@/services/autopilot-intent';
import type { KnowledgeCoverage } from '@/services/autopilot/intent-types';
import { resolveAutopilotWorkflowPlan } from '@/services/autopilot/workflow-engine';
import { buildIntentScopedKnowledgeBase, resolveActiveFlowIntentScope } from '@/services/autopilot/flow-routing';
import type { CloseIntentGateDecision, WorkflowSlotMappings } from '@/services/autopilot/workflow-engine';
import { planAutopilotTools } from '@/services/autopilot/tool-planner';
import { buildToolPrearmContent, deriveToolPrearmSignal, type ToolPrearmSignal } from '@/services/autopilot/tool-prearm';
import { validateAutopilotResponse } from '@/services/autopilot/response-validator';
import { selectAutopilotConfigForRuntime } from '@/services/autopilot/config-selection';
import { getActiveProcedureExecution, createProcedureExecution } from '@/services/autopilot/procedure-store';
import { compileAllProcedures } from '@/services/autopilot/procedure-compiler';
import { matchProcedure } from '@/services/autopilot/procedure-matcher';
import {
    advanceProcedure,
    type ProcedureDecisionResolver,
    type ProcedureResponseResolver,
} from '@/services/autopilot/procedure-executor';
import type { ProcedureGraph, ProcedureAdvanceResult, ProcedureExecutionContext } from '@/services/autopilot/procedure-types';
import {
    buildProcedureSlimChatHistory,
    compactProcedureText,
    compactProcedureToolResults,
    PROCEDURE_SLIM_LIMITS,
} from '@/services/autopilot/procedure-prompt-slim';

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
    const sourceBlocks = (aiMessageBlocks && aiMessageBlocks.length > 1)
        ? aiMessageBlocks
        : splitIntoMessageBlocks(formattedResponse);
    const blocks = sourceBlocks
        .map((block) => formatCustomerFacingAiResponse(block))
        .filter((block) => block.trim() !== '');

    if (blocks.length <= 1) {
        const singleMessage = blocks[0] || formatCustomerFacingAiResponse(formattedResponse);
        return sendAutomatedMessageAction(chatId, singleMessage, agentId, isSystemAgent, instanceName);
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
        'close_chat',
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
    let hasClose = false;
    let hasInternalNote = false;

    for (const actions of actionSets) {
        for (const action of actions || []) {
            if (action.type === 'transfer_chat') {
                if (hasTransfer) continue;
                hasTransfer = true;
            }

            if (action.type === 'close_chat') {
                if (hasClose) continue;
                hasClose = true;
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
    candidates?: ToolRoutingCandidate[];
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
            // Allow if the customer explicitly asked for this team
            const explicitByTarget = targetTeam ? hasExplicitTeamHandoff(input.customerMessage, targetTeam) : false;
            const explicitByName = teamName ? hasExplicitTeamHandoff(input.customerMessage, { name: teamName }) : false;
            if (explicitByTarget || explicitByName) return true;

            // Domain/keyword matches are only hints. Without an explicit human
            // request, transfer is allowed only when the agent cannot continue
            // safely because an operational lookup/action is unavailable.
            if (isOperationallyUnresolvableTransferReason(reason)) return true;

            return false;
        }

        const hasAllowedImplicitTransfer = input.actions.some((candidateAction) => {
            if (candidateAction.type !== 'transfer_chat') return false;
            const candidateReason = String(candidateAction.reason || '');
            return isOperationallyUnresolvableTransferReason(candidateReason);
        });
        if (hasAllowedImplicitTransfer) return true;
        return !/\b(transfer|encaminh|roteamento)\b/i.test(text);
    });
}

function isOperationallyUnresolvableTransferReason(reason: string) {
    return /\b(lookup_promise_without_executable_tool|lookup_promise_without_tool_or_handoff|promise_handoff|promise_without_tool|tool_failure|tool_error|timeout|indisponivel|indisponível|sem ferramenta|nao ha ferramenta executavel|não há ferramenta executável|nao tenho uma ferramenta|não tenho uma ferramenta|nao consigo consultar|não consigo consultar|consulta.*seguranca|consulta.*segurança)\b/i.test(reason);
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

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : null;
        } catch {
            return null;
        }
    }
    return typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

async function loadRecentToolResultsForAutopilot(input: {
    workspaceId: string;
    chatId: string;
    toolNames: string[];
    maxAgeMinutes?: number;
    limit?: number;
}): Promise<AgentToolExecutionResult[]> {
    if (input.toolNames.length === 0) return [];

    const maxAgeMinutes = Math.max(1, Math.min(input.maxAgeMinutes || 30, 180));
    const limit = Math.max(1, Math.min(input.limit || 3, 10));

    try {
        const { rows } = await db.query(
            `SELECT tool_name, status, input, output, error
             FROM public.agent_tool_executions
             WHERE workspace_id = $1
               AND chat_id = $2
               AND tool_name = ANY($3::text[])
               AND status = 'success'
               AND output IS NOT NULL
               AND created_at >= timezone('utc', now()) - ($4::int * interval '1 minute')
             ORDER BY created_at DESC
             LIMIT $5`,
            [input.workspaceId, input.chatId, input.toolNames, maxAgeMinutes, limit]
        );

        return rows.map((row: any): AgentToolExecutionResult => ({
            toolName: String(row.tool_name || '') as AgentToolExecutionResult['toolName'],
            status: (row.status === 'success' ? 'success' : row.status) as AgentToolExecutionResult['status'],
            input: (parseJsonRecord(row.input) || {
                type: String(row.tool_name || ''),
                payload: {},
            }) as AgentToolAction,
            output: parseJsonRecord(row.output) || row.output || null,
            error: row.error || undefined,
        })).filter((result) => Boolean(result.toolName));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/agent_tool_executions/i.test(message)) {
            console.warn('[AUTOPILOT_TOOL_MEMORY] Failed to load recent tool results:', error);
        }
        return [];
    }
}

function buildRecentToolMemoryContext(results: AgentToolExecutionResult[]): string {
    const successfulResults = results.filter((result) => result.status === 'success');
    if (successfulResults.length === 0) return '';

    const payload = successfulResults.map((result) => ({
        toolName: result.toolName,
        output: compactToolOutputForContinuation(result),
    }));

    return [
        '[MEMORIA OPERACIONAL RECENTE DO CHAT]',
        JSON.stringify(payload).slice(0, 5000),
        'Estes dados vieram de ferramentas executadas recentemente neste mesmo atendimento. Use-os para responder follow-ups sem pedir CPF/CNPJ de novo quando a pergunta puder ser respondida com esta memoria. Se o cliente pedir uma atualizacao em tempo real ou uma acao nova, execute a ferramenta apropriada.',
    ].join('\n');
}

function shouldAnswerFromRecentToolMemory(input: {
    customerMessage: string;
    intent: string;
    recentToolResults: AgentToolExecutionResult[];
}): boolean {
    if (!input.recentToolResults.some((result) => (
        result.status === 'success' &&
        (result.toolName === 'sgp_fetch_contact_panel_data' || result.toolName === 'sgp_fetch_contracts')
    ))) {
        return false;
    }

    if (!['billing_or_payment', 'support_request', 'troubleshooting', 'document_request', 'order_or_request_status'].includes(input.intent)) {
        return false;
    }

    const normalized = input.customerMessage
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const isReadOnlyQuestion = /\b(quais|quantos?|qual|listar|lista|mostra|mostrar|ver|saber|informacoes?|dados|status|situacao|tenho)\b/.test(normalized);
    const mentionsKnownDomain = /\b(contratos?|pontos? de internet|pontos?|internet|conexao|cadastro|faturas?|boletos?|pagamento)\b/.test(normalized);
    const asksForNewAction = /\b(gerar|pagar|pix|promessa|liberar|desbloquear|reiniciar|reinicializar|resetar|abrir chamado|alterar|trocar|cancelar|contratar)\b/.test(normalized);

    return isReadOnlyQuestion && mentionsKnownDomain && !asksForNewAction;
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

async function listRuntimeAgentToolCatalog(workspaceId: string, enabledToolNames: string[]): Promise<AgentToolCatalogItem[]> {
    const enabledToolSet = new Set(enabledToolNames);
    const mcpTools = await listMcpToolsForWorkspace(workspaceId).catch((error) => {
        console.error('[AUTOPILOT_MCP] Failed to list MCP tools:', error);
        return [];
    });

    const mcpCatalogItems: AgentToolCatalogItem[] = mcpTools
        .filter((tool) => enabledToolSet.has(tool.qualifiedName))
        .map((tool) => ({
            name: tool.qualifiedName as any,
            version: 'mcp',
            description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
            class: tool.annotations?.readOnlyHint ? 'read_only' : 'retrieval',
            riskLevel: tool.annotations?.destructiveHint ? 'high' : 'medium',
            sideEffect: tool.annotations?.destructiveHint ? 'high' : tool.annotations?.readOnlyHint ? 'none' : 'medium',
            idempotent: Boolean(tool.annotations?.idempotentHint || tool.annotations?.readOnlyHint),
            timeoutMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOOL_TIMEOUT_MS || '', 10) || 8000,
            maxAttempts: 1,
            requiresHumanApproval: Boolean(tool.annotations?.destructiveHint),
            customerVisible: true,
            allowedIntents: [
                'purchase_inquiry',
                'catalog_request',
                'pricing_request',
                'promotion_request',
                'availability_request',
                'billing_or_payment',
                'scheduling_request',
                'order_or_request_status',
                'support_request',
                'troubleshooting',
                'change_request',
                'return_or_refund',
                'cancellation_request',
                'document_request',
                'complaint',
            ],
            requiredSlots: [],
            fallbackAction: 'handoff',
            source: 'mcp',
            enabledByDefault: false,
            serverId: tool.serverId,
            serverName: tool.serverName,
            inputSchema: tool.inputSchema || null,
            outputSchema: tool.outputSchema || null,
        }));

    return [...listAgentToolCatalogItems(), ...mcpCatalogItems];
}

function resolveEnabledToolNames(config: AutopilotConfig) {
    return Array.isArray(config.enabled_tool_names)
        ? config.enabled_tool_names
        : listDefaultEnabledAgentToolNames();
}

function shouldRunCloseIntentGate(input: {
    customerMessage: string;
    enabledToolNames: string[];
}) {
    const message = input.customerMessage.trim();
    if (!input.enabledToolNames.includes('close_chat')) return false;
    if (!message || message.length > 320) return false;
    return true;
}

async function loadWorkflowSlotMappings(workspaceId: string): Promise<WorkflowSlotMappings> {
    const defaultCustomerIdentifierKeys = ['CPF/CNPJ', 'CPF', 'CNPJ', 'Documento'];
    try {
        const { rows } = await db.query(
            `SELECT config->>'cpfFieldId' AS cpf_field_id
             FROM workspace_integrations
             WHERE workspace_id = $1
               AND provider = 'sgp'
               AND is_active = true
               AND COALESCE(config->>'cpfFieldId', '') <> ''
             ORDER BY updated_at DESC
             LIMIT 1`,
            [workspaceId]
        );
        const cpfFieldId = String(rows[0]?.cpf_field_id || '').trim();
        return {
            customerIdentifierFieldKeys: Array.from(new Set([
                cpfFieldId,
                ...defaultCustomerIdentifierKeys,
            ].filter(Boolean))),
        };
    } catch (error) {
        console.error('[AUTOPILOT_WORKFLOW] Failed to load slot mappings:', error);
        return { customerIdentifierFieldKeys: defaultCustomerIdentifierKeys };
    }
}

async function loadContactCustomFieldsForAutopilot(input: {
    workspaceId: string;
    contactId?: string | null;
}): Promise<Record<string, unknown>> {
    if (!input.contactId) return {};

    try {
        const { rows } = await db.query(
            `SELECT
                ccfv.field_id,
                ccfv.value,
                cfd.label
             FROM contact_custom_field_values ccfv
             LEFT JOIN custom_field_definitions cfd
               ON cfd.id = ccfv.field_id
              AND cfd.workspace_id = $1
             WHERE ccfv.contact_id = $2`,
            [input.workspaceId, input.contactId]
        );

        const fields: Record<string, unknown> = {};
        for (const row of rows) {
            const value = row.value;
            const fieldId = String(row.field_id || '').trim();
            const label = String(row.label || '').trim();
            if (fieldId) fields[fieldId] = value;
            if (label) fields[label] = value;
        }
        return fields;
    } catch (error) {
        console.error('[AUTOPILOT_WORKFLOW] Failed to load contact custom fields:', error);
        return {};
    }
}

function buildIntentClassifierContactSignals(contact: Contact) {
    const customFields = contact.custom_fields || {};
    const customFieldLabels = Object.keys(customFields)
        .map((key) => key.trim())
        .filter(Boolean)
        .slice(0, 20);
    const hasCustomerIdentifier = Object.values(customFields)
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .some((value) => /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/.test(String(value ?? '')));

    return {
        hasCustomerIdentifier,
        customFieldLabels,
    };
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
        const rawContent = String(document.content || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => line.replace(/[ \t]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
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

function cleanKnowledgeCatalogContent(content: string): string {
    let normalized = content
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, '').trimStart())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const firstCatalogLine = normalized.search(/(?:[\p{Extended_Pictographic}]|\*)\s*\*?.{0,80}(?:PLANOS?|PROMO|CONHE[ÇC]A|INTERNET|FIBRA)/iu);
    if (firstCatalogLine > 0) {
        normalized = normalized.slice(firstCatalogLine).trim();
    }

    return normalized;
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
    if (action.type === 'close_chat') return 'Encerrar atendimento';
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
    status: 'prearmed' | 'running' | 'success' | 'error' | 'rejected';
    runId?: string;
    toolResult?: AgentToolExecutionResult | null;
    prearm?: ToolPrearmSignal | null;
}) {
    try {
        const compactOutput = input.toolResult?.output
            ? compactToolOutputForContinuation(input.toolResult)
            : null;
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
                    ...(input.runId ? { agentToolRunId: input.runId } : {}),
                    agentToolName: input.toolName,
                    agentToolStatus: input.status,
                    ...(input.prearm ? { agentToolPrearm: input.prearm } : {}),
                    ...(input.toolResult ? { agentToolInput: input.toolResult.input } : {}),
                    ...(compactOutput ? { agentToolOutput: compactOutput } : {}),
                    ...(input.toolResult?.error ? { agentToolError: input.toolResult.error } : {}),
                }),
                input.systemAgentId,
            ]
        );

        // Broadcast tool status in real-time so the operator panel updates instantly
        try {
            const { getSupabaseAdmin } = await import('@/lib/supabase');
            const supabase = getSupabaseAdmin();
            await supabase.channel(`chat:${input.chatId}`).send({
                type: 'broadcast',
                event: 'agent_tool_status',
                payload: {
                    chatId: input.chatId,
                    toolName: input.toolName,
                    status: input.status,
                    content: input.content,
                    ...(input.runId ? { runId: input.runId } : {}),
                    ...(input.prearm ? { prearm: input.prearm } : {}),
                    ...(compactOutput ? { output: compactOutput } : {}),
                    ...(input.toolResult?.error ? { error: input.toolResult.error } : {}),
                },
            });
        } catch (broadcastError) {
            console.warn('[AUTOPILOT_TOOL_STATUS] Broadcast failed (non-blocking):', broadcastError);
        }
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

    console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${input.chat.id} planned_tools=${normalizedActions.length} tools=[${normalizedActions.map((a) => a.type === 'mcp_call_tool' ? String(a.payload?.toolName || a.type) : a.type).join(',')}]`);

    const toolRuns = normalizedActions.map((action) => ({
        action,
        runId: randomUUID(),
        toolName: action.type === 'mcp_call_tool' ? String(action.payload?.toolName || action.type) : action.type,
    }));

    for (const run of toolRuns) {
        await insertAgentToolStatusMessage({
            workspaceId: input.workspaceId,
            chatId: input.chat.id,
            systemAgentId: input.systemAgentId,
            content: `Executando ferramenta: ${describeAgentToolAction(run.action)}.`,
            toolName: run.toolName,
            status: 'running',
            runId: run.runId,
        });
    }

    const results = await runRequestedAgentTools({
        ...input,
        actions: normalizedActions,
    });

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${input.chat.id} executed=${results.length} success=${succeeded} error=${failed} rejected=${rejected}`);

    for (const [index, result] of results.entries()) {
        const run = toolRuns[index];
        await insertAgentToolStatusMessage({
            workspaceId: input.workspaceId,
            chatId: input.chat.id,
            systemAgentId: input.systemAgentId,
            content: summarizeAgentToolResult(result),
            toolName: result.toolName,
            status: result.status,
            runId: run?.runId,
            toolResult: result,
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
                    ? (() => {
                        try {
                            return JSON.parse(documentsRaw);
                        } catch {
                            return [];
                        }
                    })()
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
        });

        const selectedConfig = selectAutopilotConfigForRuntime(agents, agentId);

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
            c.workspace_id,
            c.copilot_mode,
            c.is_autopilot_active,
            c.assigned_system_agent_id,
            c.autopilot_config_id,
            sa.name AS assigned_system_agent_name,
            sa.type AS assigned_system_agent_type,
            sa.is_active AS assigned_system_agent_active,
            sa.autopilot_config_id AS assigned_autopilot_config_id,
            ac.id AS assigned_config_id,
            ac.is_active AS assigned_config_active
         FROM chats c
         LEFT JOIN system_agents sa
           ON sa.id = c.assigned_system_agent_id
          AND sa.workspace_id = c.workspace_id
         LEFT JOIN autopilot_configs ac
           ON ac.id = sa.autopilot_config_id
          AND ac.workspace_id = c.workspace_id
         WHERE c.id = $1
           AND c.workspace_id = $2`,
        [chat.id, workspaceId]
    );
    const chatConfig = chatConfigRes.rows[0];
    if (!chatConfig) {
        console.log(`[AUTOPILOT_SERVICE] Chat ${chat.id} nao encontrado no workspace ${workspaceId}. Ignorando.`);
        return;
    }
    const currentCopilotMode = chatConfig?.copilot_mode || 'auto';
    const rawIsActive = chatConfig?.is_autopilot_active ?? chat.is_autopilot_active;
    const currentIsActive = rawIsActive === true;
    const assignedSystemAgentId = chatConfig?.assigned_system_agent_id || null;
    const assignedSystemAgentName = chatConfig?.assigned_system_agent_name || 'Atendente Inteligente';
    const assignedAutopilotConfigId = chatConfig?.assigned_config_id || null;

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

    if (chatConfig.autopilot_config_id !== assignedAutopilotConfigId) {
        await db.query(
            `UPDATE chats
             SET autopilot_config_id = $1
             WHERE id = $2
               AND workspace_id = $3`,
            [assignedAutopilotConfigId, chat.id, workspaceId]
        );
        chat = {
            ...chat,
            autopilot_config_id: assignedAutopilotConfigId,
        };
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
    const staticKnowledgeDocuments = autopilotConfig.knowledge_base_documents || [];
    const enabledToolNames = resolveEnabledToolNames(autopilotConfig);
    const crmCustomFields = await loadContactCustomFieldsForAutopilot({
        workspaceId,
        contactId: chat.contact?.id || (chat as { contact_id?: string | null }).contact_id,
    });
    const sanitizedContact: Contact = {
        ...(chat.contact as Contact),
        email: chat.contact?.email || '',
        custom_fields: {
            ...(chat.contact?.custom_fields || {}),
            ...crmCustomFields,
        },
    };
    const availableTeams = await loadToolRouterTeams(workspaceId);

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

    let intentResolution = resolveAutopilotIntent({
        customerMessage: enrichedLastMessageContent || '',
        chatHistory: chatHistoryForAI,
        knowledgeDocuments: staticKnowledgeDocuments,
    });
    const deterministicIntentResolution = intentResolution;

    if (shouldUseAiIntentClassifier({
        intent: deterministicIntentResolution.intent,
        confidence: deterministicIntentResolution.confidence,
        officialResponse: deterministicIntentResolution.officialResponse,
    })) {
        try {
            const classifierStage = await timeOrchestratorStage(
                orchestratorRun,
                'intent_classifier_ai',
                () => withTimeout(
                    classifyAutopilotIntentWithAi({
                        customerMessage: enrichedLastMessageContent || '',
                        chatHistory: chatHistoryForAI,
                        deterministicIntent: deterministicIntentResolution.intent,
                        deterministicConfidence: deterministicIntentResolution.confidence,
                        deterministicReason: deterministicIntentResolution.reason,
                        agentName: autopilotConfig.name,
                        agentKnowledgeBase: autopilotConfig.knowledge_base || '',
                        knowledgeDocuments: staticKnowledgeDocuments,
                        enabledToolNames,
                        contactSignals: buildIntentClassifierContactSignals(sanitizedContact),
                        model: process.env.AI_INTENT_CLASSIFIER_MODEL || resolvedAiModel.model,
                        apiKey: workspaceGeminiApiKey,
                        timeoutMs: Number(process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS || 1800),
                    }),
                    Number(process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS || 1800) + 500,
                    'intent classifier'
                ),
                {
                    deterministicIntent: deterministicIntentResolution.intent,
                    deterministicConfidence: deterministicIntentResolution.confidence,
                    model: process.env.AI_INTENT_CLASSIFIER_MODEL || resolvedAiModel.model,
                }
            );
            orchestratorTimings.intent_classifier_ms = classifierStage.durationMs;
            const aiClassification = classifierStage.value;
            if (
                aiClassification.intent !== deterministicIntentResolution.intent &&
                aiClassification.confidence >= 0.55
            ) {
                intentResolution = resolveAutopilotIntentWithOverride({
                    customerMessage: enrichedLastMessageContent || '',
                    chatHistory: chatHistoryForAI,
                    knowledgeDocuments: staticKnowledgeDocuments,
                }, {
                    intent: aiClassification.intent,
                    confidence: aiClassification.confidence,
                    reason: `Classificador IA: ${aiClassification.reason || 'sem motivo'}. Deterministico anterior: ${deterministicIntentResolution.intent}.`,
                });
            }
        } catch (error) {
            console.warn('[AUTOPILOT_INTENT_CLASSIFIER] Failed, keeping deterministic intent:', error);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'intent_classifier_ai',
                status: 'fallback',
                payload: {
                    deterministicIntent: deterministicIntentResolution.intent,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    let ragStrategy: KnowledgeRetrievalStrategy = staticKnowledgeDocuments.length > 0 ? 'static_documents' : 'none';
    let knowledgeCoverage: KnowledgeCoverage = intentResolution.officialResponse
        ? 'high'
        : staticKnowledgeDocuments.length > 0
            ? 'low'
            : 'none';
    await recordOrchestratorEvent({
        run: orchestratorRun,
        kind: 'intent_resolution',
        status: intentResolution.intent === 'unknown' ? 'fallback' : 'success',
        payload: {
            intent: intentResolution.intent,
            confidence: intentResolution.confidence,
            confidenceLevel: intentResolution.confidence >= 0.85 ? 'high' : intentResolution.confidence >= 0.5 ? 'medium' : 'low',
            workflowId: intentResolution.workflowId,
            shouldRetrieveKnowledge: intentResolution.shouldRetrieveKnowledge,
            shouldUseTool: intentResolution.shouldUseTool,
            shouldTransfer: intentResolution.shouldTransfer,
            requiredSlots: intentResolution.requiredSlots,
            extractedSlots: intentResolution.extractedSlots,
            knowledgeCategories: intentResolution.knowledgeCategories,
            sourceDocumentId: intentResolution.sourceDocumentId ?? null,
            sourceDocumentName: intentResolution.sourceDocumentName ?? null,
            hasOfficialResponse: Boolean(intentResolution.officialResponse),
            reason: intentResolution.reason,
            deterministicIntent: deterministicIntentResolution.intent,
            deterministicConfidence: deterministicIntentResolution.confidence,
        },
    });

    const activeRules = (autopilotRules || []).filter(rule => rule.enabled);
    let deterministicRouting = routeDeterministicAgentTools({
        customerMessage: enrichedLastMessageContent || '',
        contactName: sanitizedContact.name,
        availableTeams,
    });

    if (
        deterministicRouting.actions.length === 0 &&
        deterministicRouting.candidates.length > 0 &&
        shouldHandoffToHuman(enrichedLastMessageContent || '')
    ) {
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
                        escalationPolicy: autopilotConfig.escalation_policy || '',
                        model: resolvedAiModel.model,
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

            if (gateStage.value.execute && gateStage.value.confidence !== 'low') {
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
    } else if (deterministicRouting.actions.length === 0 && deterministicRouting.candidates.length > 0) {
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'tool_intent_gate',
            status: 'skipped',
            payload: {
                candidates: deterministicRouting.candidates,
                reason: 'domain_or_keyword_hint_without_explicit_human_request',
            },
        });
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

    let ragDocuments: KnowledgeBaseDocument[] = staticKnowledgeDocuments;
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
            console.log(`[AUTOPILOT_RAG] Searching hybrid context for: "${enrichedLastMessageContent.substring(0, 50)}..."`);
            const ragStage = await timeOrchestratorStage(
                orchestratorRun,
                'rag_retrieval',
                () => withTimeout(
                    retrieveHybridSupportContext({
                        workspaceId,
                        autopilotConfigId: autopilotConfig.id,
                        query: enrichedLastMessageContent,
                        excludeChatId: chat.id,
                        staticDocuments: staticKnowledgeDocuments,
                        intent: intentResolution,
                    }),
                    orchestratorRun.budget.maxRagMs,
                    'rag retrieval'
                ),
                {
                    queryLength: enrichedLastMessageContent.length,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    initialStaticDocuments: staticKnowledgeDocuments.length,
                }
            );
            orchestratorTimings.rag_ms = ragStage.durationMs;
            const retrieval = ragStage.value;
            ragStrategy = retrieval.strategy;
            knowledgeCoverage = retrieval.knowledgeCoverage;

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

            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: retrieval.fallbackReason ? 'rag_fallback_static_documents' : 'rag_selection',
                status: retrieval.fallbackReason ? 'fallback' : 'success',
                durationMs: ragStage.durationMs,
                payload: {
                    strategy: retrieval.strategy,
                    knowledgeCoverage: retrieval.knowledgeCoverage,
                    fallbackReason: retrieval.fallbackReason ?? null,
                    error: retrieval.error ?? null,
                    retrieved: retrieval.retrieved,
                    selected: retrieval.selected,
                    discarded: retrieval.discarded.slice(0, 8),
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
        }
    } catch (ragError) {
        console.error('[AUTOPILOT_RAG] Error during retrieval:', ragError);
        const errorMessage = ragError instanceof Error ? ragError.message : String(ragError);
        const hasStaticFallback = staticKnowledgeDocuments.length > 0;
        ragStrategy = hasStaticFallback ? 'static_documents' : 'none';
        knowledgeCoverage = hasStaticFallback ? 'low' : 'none';
        ragDocuments = hasStaticFallback ? staticKnowledgeDocuments : [];
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: hasStaticFallback ? 'rag_fallback_static_documents' : 'rag_retrieval',
            status: 'fallback',
            payload: {
                error: errorMessage,
                fallbackReason: errorMessage.includes('timed out') ? 'rag_timeout' : 'rag_error',
                strategy: ragStrategy,
                knowledgeCoverage,
                staticDocuments: staticKnowledgeDocuments.length,
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
            },
        });
    }

    const runtimeToolCatalog = await listRuntimeAgentToolCatalog(workspaceId, enabledToolNames);
    const recentToolResults = await loadRecentToolResultsForAutopilot({
        workspaceId,
        chatId: chat.id,
        toolNames: ['sgp_fetch_contact_panel_data', 'sgp_fetch_contracts'],
        maxAgeMinutes: 30,
        limit: 3,
    });
    const recentToolMemoryContext = buildRecentToolMemoryContext(recentToolResults);
    if (recentToolMemoryContext) {
        relevantHistory = [
            relevantHistory,
            recentToolMemoryContext,
        ].filter(Boolean).join('\n\n');
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'tool_memory',
            status: 'success',
            payload: {
                resultCount: recentToolResults.length,
                toolNames: recentToolResults.map((result) => result.toolName),
            },
        });
    }
    const knowledgeToolProcedures = formatKnowledgeToolProcedures(
        extractKnowledgeToolProcedures({
            documents: ragDocuments,
            tools: runtimeToolCatalog,
            enabledToolNames,
        })
    );
    const promptKnowledgeDocuments = compactKnowledgeDocumentsForPrompt(ragDocuments);
    const retrievedOfficialResponse = intentResolution.officialResponse
        ? null
        : findOfficialKnowledgeAnswer({
            documents: ragDocuments,
            intent: intentResolution.intent,
            customerMessage: enrichedLastMessageContent || '',
        });
    const deterministicOfficialResponse = intentResolution.officialResponse || retrievedOfficialResponse?.content || null;
    const deterministicOfficialResponsePreserveFormatting = intentResolution.officialResponse
        ? intentResolution.officialResponsePreserveFormatting
        : retrievedOfficialResponse?.preserveFormatting;
    const deterministicOfficialSourceDocumentId = intentResolution.sourceDocumentId || retrievedOfficialResponse?.document.id;
    const deterministicOfficialSourceDocumentName = intentResolution.sourceDocumentName || retrievedOfficialResponse?.document.name;
    const workflowSlotMappings = await loadWorkflowSlotMappings(workspaceId);
    let closeIntentGate: CloseIntentGateDecision = null;
    if (shouldRunCloseIntentGate({
        customerMessage: enrichedLastMessageContent || '',
        enabledToolNames,
    })) {
        try {
            const closeGateStage = await timeOrchestratorStage(
                orchestratorRun,
                'close_intent_gate',
                () => withTimeout(
                    classifyToolIntent({
                        customerMessage: enrichedLastMessageContent || '',
                        chatHistory: chatHistoryForAI,
                        toolName: 'close_chat',
                        candidateReason: 'Mensagem curta ou ambigua pode indicar pedido de encerramento do atendimento.',
                        closingPolicy: autopilotConfig.closing_policy || '',
                        model: resolvedAiModel.model,
                        apiKey: workspaceGeminiApiKey,
                        timeoutMs: Number(process.env.AI_TOOL_INTENT_GATE_TIMEOUT_MS || 2500),
                    }),
                    Number(process.env.AI_TOOL_INTENT_GATE_TIMEOUT_MS || 2500) + 500,
                    'close intent gate'
                ),
                { candidateTool: 'close_chat' }
            );
            orchestratorTimings.tool_intent_gate_ms = (orchestratorTimings.tool_intent_gate_ms || 0) + closeGateStage.durationMs;
            closeIntentGate = closeGateStage.value;
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'close_intent_gate',
                status: closeGateStage.value.execute && closeGateStage.value.confidence !== 'low' ? 'success' : 'skipped',
                durationMs: closeGateStage.durationMs,
                payload: {
                    decision: closeGateStage.value,
                },
            });
        } catch (error) {
            console.warn('[AUTOPILOT_CLOSE_INTENT_GATE] Gate failed, continuing with deterministic workflow:', error);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'close_intent_gate',
                status: 'fallback',
                payload: {
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }
    let workflowPlan = resolveAutopilotWorkflowPlan({
        intentResolution,
        customerMessage: enrichedLastMessageContent || '',
        chatHistory: chatHistoryForAI,
        contact: sanitizedContact,
        enabledToolNames,
        availableTeams,
        knowledgeCoverage,
        slotMappings: workflowSlotMappings,
        closeIntentGate,
        recentToolResults,
    });
    let aiWorkflowDecision: AiWorkflowDecision | null = null;
    if (shouldUseAiWorkflowClassifier({
        intent: intentResolution.intent,
        confidence: intentResolution.confidence,
        executionMode: workflowPlan.executionMode,
        plannedActions: workflowPlan.actions.map((action) => action.type),
        missingSlots: workflowPlan.missingSlots,
        enabledToolNames,
        hasCustomerIdentifier: Boolean(workflowPlan.slotExtraction.slots.customer_identifier),
        officialResponse: deterministicOfficialResponse,
    })) {
        try {
            const workflowClassifierStage = await timeOrchestratorStage(
                orchestratorRun,
                'workflow_classifier_ai',
                () => withTimeout(
                    classifyAutopilotWorkflowWithAi({
                        customerMessage: enrichedLastMessageContent || '',
                        chatHistory: chatHistoryForAI,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        intentReason: intentResolution.reason,
                        deterministicExecutionMode: workflowPlan.executionMode,
                        deterministicMissingSlots: workflowPlan.missingSlots,
                        deterministicPlannedTools: workflowPlan.actions.map((action) => action.type),
                        agentName: autopilotConfig.name,
                        agentKnowledgeBase: autopilotConfig.knowledge_base || '',
                        knowledgeDocuments: staticKnowledgeDocuments,
                        enabledToolNames,
                        contactSignals: buildIntentClassifierContactSignals(sanitizedContact),
                        model: process.env.AI_WORKFLOW_CLASSIFIER_MODEL || resolvedAiModel.model,
                        apiKey: workspaceGeminiApiKey,
                        timeoutMs: Number(process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS || 1800),
                    }),
                    Number(process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS || 1800) + 500,
                    'workflow classifier'
                ),
                {
                    intent: intentResolution.intent,
                    deterministicExecutionMode: workflowPlan.executionMode,
                    deterministicPlannedTools: workflowPlan.actions.map((action) => action.type),
                    model: process.env.AI_WORKFLOW_CLASSIFIER_MODEL || resolvedAiModel.model,
                }
            );
            orchestratorTimings.workflow_classifier_ms = workflowClassifierStage.durationMs;
            aiWorkflowDecision = workflowClassifierStage.value;
            const aiWorkflowPlan = resolveAutopilotWorkflowPlan({
                intentResolution,
                customerMessage: enrichedLastMessageContent || '',
                chatHistory: chatHistoryForAI,
                contact: sanitizedContact,
                enabledToolNames,
                availableTeams,
                knowledgeCoverage,
                slotMappings: workflowSlotMappings,
                closeIntentGate,
                aiWorkflowDecision,
                recentToolResults,
            });
            if (
                aiWorkflowPlan.executionMode !== workflowPlan.executionMode ||
                aiWorkflowPlan.actions.length > workflowPlan.actions.length ||
                aiWorkflowPlan.missingSlots.length > workflowPlan.missingSlots.length
            ) {
                workflowPlan = aiWorkflowPlan;
            }
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'workflow_classifier_ai',
                status: aiWorkflowDecision.shouldUseTools || aiWorkflowDecision.needsCustomerIdentifier ? 'success' : 'skipped',
                durationMs: workflowClassifierStage.durationMs,
                payload: {
                    decision: aiWorkflowDecision,
                    appliedExecutionMode: workflowPlan.executionMode,
                    appliedActions: workflowPlan.actions.map((action) => action.type),
                },
            });
        } catch (error) {
            console.warn('[AUTOPILOT_WORKFLOW_CLASSIFIER] Failed, keeping deterministic workflow:', error);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'workflow_classifier_ai',
                status: 'fallback',
                payload: {
                    intent: intentResolution.intent,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }
    const workflowPrearmSignal = deriveToolPrearmSignal({
        intentResolution,
        missingSlots: workflowPlan.missingSlots,
        enabledToolNames,
        plannedActions: workflowPlan.actions,
        reason: workflowPlan.reason,
    });
    await recordOrchestratorEvent({
        run: orchestratorRun,
        kind: 'workflow_plan',
        status: workflowPlan.handledByWorkflow ? 'success' : 'skipped',
        payload: {
            intent: intentResolution.intent,
            workflowId: intentResolution.workflowId,
            executionMode: workflowPlan.executionMode,
            handledByWorkflow: workflowPlan.handledByWorkflow,
            missingSlots: workflowPlan.missingSlots,
            plannedActions: workflowPlan.actions.map((action) => action.type),
            prearmedTool: workflowPrearmSignal?.toolName ?? null,
            knowledgeCoverage,
            reason: workflowPlan.reason,
        },
    });
    let workflowPlannedActions: AgentToolAction[] = workflowPlan.executionMode === 'continue_llm'
        ? []
        : workflowPlan.actions;
    const activeFlowIntentScope = resolveActiveFlowIntentScope(autopilotConfig, intentResolution.intent);
    const scopedKnowledgeBase = buildIntentScopedKnowledgeBase(
        autopilotConfig.knowledge_base || '',
        activeFlowIntentScope
    );
    const intentContextForAI = [
        `intent=${intentResolution.intent}`,
        `confidence=${intentResolution.confidence.toFixed(2)}`,
        `workflowId=${intentResolution.workflowId}`,
        `workflowExecutionMode=${workflowPlan.executionMode}`,
        `workflowReason=${workflowPlan.reason}`,
        `workflowMissingSlots=${workflowPlan.missingSlots.join(',') || 'none'}`,
        `workflowPlannedTools=${workflowPlan.actions.map((action) => action.type).join(',') || 'none'}`,
        `shouldRetrieveKnowledge=${intentResolution.shouldRetrieveKnowledge}`,
        `shouldUseTool=${intentResolution.shouldUseTool}`,
        `shouldTransfer=${intentResolution.shouldTransfer}`,
        `requiredSlots=${intentResolution.requiredSlots.join(',') || 'none'}`,
        `extractedSlots=${JSON.stringify(intentResolution.extractedSlots)}`,
        `ragStrategy=${ragStrategy}`,
        `knowledgeCoverage=${knowledgeCoverage}`,
        `knowledgeCategories=${intentResolution.knowledgeCategories.join(',') || 'none'}`,
        `reason=${intentResolution.reason}`,
        `flowSubAgent=${activeFlowIntentScope?.title || 'main_agent'}`,
    ].join('\n');

    const recentToolMemoryResponse = shouldAnswerFromRecentToolMemory({
        customerMessage: enrichedLastMessageContent || '',
        intent: intentResolution.intent,
        recentToolResults,
    })
        ? buildSgpResponseFromToolResults(recentToolResults, enrichedLastMessageContent || '')
        : null;

    if (recentToolMemoryResponse) {
        let finalResponse = formatCustomerFacingAiResponse(recentToolMemoryResponse);
        const responseValidator = validateAutopilotResponse({
            response: finalResponse,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            customerMessage: enrichedLastMessageContent || '',
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            plannedActions: [],
            toolResults: recentToolResults,
            enabledToolNames,
            availableTeams,
            contact: sanitizedContact,
            knowledgeCoverage,
            source: 'workflow_tools',
        });
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'response_validator',
            status: responseValidator.decision === 'approve' || responseValidator.decision === 'repair' ? 'success' : 'fallback',
            payload: {
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
                reusedToolMemory: true,
                ...responseValidator.metadata,
            },
        });
        if (responseValidator.decision !== 'approve') {
            finalResponse = formatCustomerFacingAiResponse(responseValidator.response);
        }

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
                modelName: 'tool-memory',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: 'suggested',
                triggeredRule: null,
                metadata: {
                    reusedToolMemory: true,
                    recentToolNames: recentToolResults.map((result) => result.toolName),
                    responseValidator: responseValidator.metadata,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'success',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceLevel: 'deterministic',
                confidenceScore: intentResolution.confidence,
                metadata: {
                    suggestionOnly: true,
                    responseSent: false,
                    reusedToolMemory: true,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            return;
        }

        const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
            chatId: chat.id,
            sourceMessageId: sourceMessageId ?? null,
        });
        if (!sourceMessageStillCurrent) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'stale_source_message_guard',
                status: 'skipped',
                payload: {
                    sourceMessageId: sourceMessageId ?? null,
                    reason: 'newer_customer_message_exists',
                    reusedToolMemory: true,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'skipped',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceScore: intentResolution.confidence,
                metadata: {
                    responseSent: false,
                    staleSourceMessage: true,
                    reusedToolMemory: true,
                    sourceMessageId: sourceMessageId ?? null,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
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
            { responseLength: finalResponse.length, reusedToolMemory: true }
        );
        orchestratorTimings.send_ms = sendStage.durationMs;

        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'tool-memory',
            customerMessage: enrichedLastMessageContent || '',
            response: finalResponse,
            status: 'sent',
            triggeredRule: null,
            metadata: {
                reusedToolMemory: true,
                recentToolNames: recentToolResults.map((result) => result.toolName),
                responseValidator: responseValidator.metadata,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'success',
            timings: orchestratorTimings,
            intent: intentResolution.intent,
            confidenceLevel: 'deterministic',
            confidenceScore: intentResolution.confidence,
            metadata: {
                responseSent: true,
                toolCount: 0,
                reusedToolMemory: true,
                recentToolCount: recentToolResults.length,
                responseValidator: responseValidator.metadata,
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        return;
    }

    if (workflowPlan.executionMode === 'direct_response' && workflowPlan.response) {
        let finalResponse = formatCustomerFacingAiResponse(workflowPlan.response);

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
                modelName: 'workflow-engine',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: 'suggested',
                triggeredRule: null,
                metadata: {
                    workflowPlan: workflowPlan.metadata,
                    workflowReason: workflowPlan.reason,
                    workflowMissingSlots: workflowPlan.missingSlots,
                    workflowActions: workflowPlan.actions.map((action) => action.type),
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'success',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceLevel: 'deterministic',
                confidenceScore: intentResolution.confidence,
                metadata: {
                    suggestionOnly: true,
                    responseSent: false,
                    workflowEngine: true,
                    workflowReason: workflowPlan.reason,
                    workflowMissingSlots: workflowPlan.missingSlots,
                    workflowActions: workflowPlan.actions.map((action) => action.type),
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            return;
        }

        const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
            chatId: chat.id,
            sourceMessageId: sourceMessageId ?? null,
        });
        if (!sourceMessageStillCurrent) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'stale_source_message_guard',
                status: 'skipped',
                payload: {
                    sourceMessageId: sourceMessageId ?? null,
                    reason: 'newer_customer_message_exists',
                    workflowEngine: true,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'skipped',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceScore: intentResolution.confidence,
                metadata: {
                    responseSent: false,
                    staleSourceMessage: true,
                    workflowEngine: true,
                    workflowReason: workflowPlan.reason,
                    sourceMessageId: sourceMessageId ?? null,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            return;
        }

        const responseValidator = validateAutopilotResponse({
            response: finalResponse,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            customerMessage: enrichedLastMessageContent || '',
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            plannedActions: workflowPlan.actions,
            toolResults: [],
            enabledToolNames,
            availableTeams,
            contact: sanitizedContact,
            knowledgeCoverage,
            source: 'workflow_direct',
        });
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'response_validator',
            status: responseValidator.decision === 'approve' || responseValidator.decision === 'repair' ? 'success' : 'fallback',
            payload: {
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
                ...responseValidator.metadata,
            },
        });
        if (responseValidator.decision !== 'approve') {
            finalResponse = formatCustomerFacingAiResponse(responseValidator.response);
        }
        const validatedWorkflowActions = responseValidator.actions.length > 0
            ? mergeAgentActions(responseValidator.actions, workflowPlan.actions)
            : workflowPlan.actions;

        if (workflowPrearmSignal) {
            await insertAgentToolStatusMessage({
                workspaceId,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                content: buildToolPrearmContent(workflowPrearmSignal),
                toolName: workflowPrearmSignal.toolName,
                status: 'prearmed',
                runId: `prearm:${orchestratorRun.id}:${workflowPrearmSignal.toolName}`,
                prearm: workflowPrearmSignal,
            });
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
            { responseLength: finalResponse.length, workflowEngine: true }
        );
        orchestratorTimings.send_ms = sendStage.durationMs;

        let toolResults: AgentToolExecutionResult[] = [];
        if (validatedWorkflowActions.length > 0) {
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
                    actions: validatedWorkflowActions,
                    orchestratorRunId: orchestratorRun.id,
                }),
                {
                    requestedActions: validatedWorkflowActions.map((action) => action.type),
                    workflowEngine: true,
                    afterResponse: true,
                }
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
            toolResults = toolsStage.value;
        }

        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'workflow-engine',
            customerMessage: enrichedLastMessageContent || '',
            response: finalResponse,
            status: 'sent',
            triggeredRule: null,
            metadata: {
                workflowPlan: workflowPlan.metadata,
                workflowReason: workflowPlan.reason,
                workflowMissingSlots: workflowPlan.missingSlots,
                workflowActions: validatedWorkflowActions.map((action) => action.type),
                ...(toolResults.length > 0 ? { toolResults } : {}),
                responseValidator: responseValidator.metadata,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'success',
            timings: orchestratorTimings,
            intent: intentResolution.intent,
            confidenceLevel: 'deterministic',
            confidenceScore: intentResolution.confidence,
            metadata: {
                responseSent: true,
                toolCount: toolResults.length,
                workflowEngine: true,
                workflowReason: workflowPlan.reason,
                workflowMissingSlots: workflowPlan.missingSlots,
                workflowActions: validatedWorkflowActions.map((action) => action.type),
                responseValidator: responseValidator.metadata,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        return;
    }

    if (workflowPlan.executionMode === 'pre_response_tools' && currentCopilotMode === 'auto' && workflowPlan.actions.length > 0) {
        const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
            chatId: chat.id,
            sourceMessageId: sourceMessageId ?? null,
        });
        if (!sourceMessageStillCurrent) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'stale_source_message_guard',
                status: 'skipped',
                payload: {
                    sourceMessageId: sourceMessageId ?? null,
                    reason: 'newer_customer_message_exists',
                    workflowEngine: true,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'skipped',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceScore: intentResolution.confidence,
                metadata: {
                    responseSent: false,
                    staleSourceMessage: true,
                    workflowEngine: true,
                    workflowReason: workflowPlan.reason,
                    sourceMessageId: sourceMessageId ?? null,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            return;
        }

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
                actions: workflowPlan.actions,
                orchestratorRunId: orchestratorRun.id,
            }),
            {
                requestedActions: workflowPlan.actions.map((action) => action.type),
                workflowEngine: true,
                beforeResponse: true,
            }
        );
        orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
        let toolResults = toolsStage.value;
        const sgpResponse = buildSgpResponseFromToolResults(
            toolResults,
            enrichedLastMessageContent || ''
        );
        const toolFailureResponse = buildToolFailureResponse(
            toolResults,
            'Vou consultar o sistema para verificar status, cadastro, fatura ou contrato.'
        );
        let finalResponse = formatCustomerFacingAiResponse(
            sgpResponse ||
            toolFailureResponse ||
            autopilotConfig.default_fallback_reply?.trim() ||
            'Nao consegui concluir a consulta automatica agora. Nossa equipe vai acompanhar por aqui.'
        );
        const responseValidator = validateAutopilotResponse({
            response: finalResponse,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            customerMessage: enrichedLastMessageContent || '',
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            plannedActions: workflowPlan.actions,
            toolResults,
            enabledToolNames,
            availableTeams,
            contact: sanitizedContact,
            knowledgeCoverage,
            source: 'workflow_tools',
        });
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'response_validator',
            status: responseValidator.decision === 'approve' || responseValidator.decision === 'repair' ? 'success' : 'fallback',
            payload: {
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
                ...responseValidator.metadata,
            },
        });
        if (responseValidator.decision !== 'approve') {
            finalResponse = formatCustomerFacingAiResponse(responseValidator.response);
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
            { responseLength: finalResponse.length, workflowEngine: true }
        );
        orchestratorTimings.send_ms = sendStage.durationMs;

        if (responseValidator.actions.length > 0) {
            const validatorToolsStage = await timeOrchestratorStage(
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
                    actions: responseValidator.actions,
                    orchestratorRunId: orchestratorRun.id,
                }),
                {
                    requestedActions: responseValidator.actions.map((action) => action.type),
                    responseValidator: true,
                    afterResponse: true,
                }
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + validatorToolsStage.durationMs;
            toolResults = [...toolResults, ...validatorToolsStage.value];
        }

        const workflowHadToolFailure = toolResults.some((result) => result.status !== 'success');

        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'workflow-engine',
            customerMessage: enrichedLastMessageContent || '',
            response: finalResponse,
            status: 'sent',
            triggeredRule: null,
            metadata: {
                workflowPlan: workflowPlan.metadata,
                workflowReason: workflowPlan.reason,
                workflowActions: workflowPlan.actions.map((action) => action.type),
                toolResults,
                responseValidator: responseValidator.metadata,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: workflowHadToolFailure ? 'fallback' : 'success',
            timings: orchestratorTimings,
            intent: intentResolution.intent,
            confidenceLevel: workflowHadToolFailure ? 'low' : 'deterministic',
            confidenceScore: intentResolution.confidence,
            metadata: {
                responseSent: true,
                toolCount: toolResults.length,
                workflowEngine: true,
                workflowReason: workflowPlan.reason,
                workflowActions: workflowPlan.actions.map((action) => action.type),
                toolResults,
                responseValidator: responseValidator.metadata,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROCEDURE RUNTIME ENGINE (PRE) GATE
    //
    // Before falling through to the LLM, check:
    //   1. Is there an active ProcedureExecutionContext for this chat? → resume it
    //   2. Does a compiled ProcedureGraph match the intent? → start a new one
    //
    // If the PRE handles the message, we return immediately (no LLM call).
    // ═══════════════════════════════════════════════════════════════════════
    try {
        // 1. Check for active procedure
        const activePEC = await getActiveProcedureExecution(chat.id);
        let procedureResult: ProcedureAdvanceResult | null = null;
        let procedureGraph: ProcedureGraph | null = null;
        let procedureContext: ProcedureExecutionContext | null = null;
        const procedureSlimChatHistory = buildProcedureSlimChatHistory(chatHistoryForAI);
        const procedureSlimPersona = compactProcedureText(
            scopedKnowledgeBase,
            PROCEDURE_SLIM_LIMITS.personaChars
        );

        const procedureDecisionResolver: ProcedureDecisionResolver = async ({ step, prompt, branches, context, toolResults }) => {
            try {
                const compactToolResults = compactProcedureToolResults(toolResults);
                const decision = await withTimeout(generateProcedureRuntimeOutput({
                    config: autopilotConfig,
                    chatId: chat.id,
                    mode: 'decision',
                    customerMessage: enrichedLastMessageContent || '',
                    chatHistory: procedureSlimChatHistory,
                    persona: procedureSlimPersona,
                    fallbackReply: autopilotConfig.default_fallback_reply || '',
                    escalationPolicy: autopilotConfig.escalation_policy || '',
                    model: resolvedAiModel.model,
                    contact: sanitizedContact,
                    workspaceGeminiApiKey,
                    procedure: {
                        id: context.procedureId,
                        name: context.procedureName,
                        currentStepId: context.currentStepId,
                        stepLabel: step.label,
                        prompt,
                        branchOptions: branches.map((branch) => ({
                            condition: branch.condition,
                            nextStepId: branch.nextStepId,
                        })),
                        collectedSlots: context.collectedSlots,
                        decisions: context.decisions,
                        toolResults: compactToolResults,
                    },
                }), Math.min(orchestratorRun.budget.maxLlmMs, 8000), 'procedure decision');
                console.log(
                    `[PROCEDURE_RUNTIME_SLIM] mode=decision chat=${chat.id} ` +
                    `historyChars=${procedureSlimChatHistory.length} toolResultsChars=${JSON.stringify(compactToolResults).length}`,
                );
                return decision?.decision || null;
            } catch (error) {
                console.warn('[PROCEDURE_RUNTIME] Decision resolver failed, using heuristic:', error);
                return null;
            }
        };

        const procedureResponseResolver: ProcedureResponseResolver = async ({ step, prompt, context, toolResults }) => {
            try {
                const compactToolResults = compactProcedureToolResults(toolResults);
                const response = await withTimeout(generateProcedureRuntimeOutput({
                    config: autopilotConfig,
                    chatId: chat.id,
                    mode: 'response',
                    customerMessage: enrichedLastMessageContent || '',
                    chatHistory: procedureSlimChatHistory,
                    persona: procedureSlimPersona,
                    fallbackReply: autopilotConfig.default_fallback_reply || '',
                    escalationPolicy: autopilotConfig.escalation_policy || '',
                    model: resolvedAiModel.model,
                    contact: sanitizedContact,
                    workspaceGeminiApiKey,
                    procedure: {
                        id: context.procedureId,
                        name: context.procedureName,
                        currentStepId: context.currentStepId,
                        stepLabel: step.label,
                        prompt,
                        collectedSlots: context.collectedSlots,
                        decisions: context.decisions,
                        toolResults: compactToolResults,
                    },
                }), orchestratorRun.budget.maxLlmMs, 'procedure response');
                console.log(
                    `[PROCEDURE_RUNTIME_SLIM] mode=response chat=${chat.id} ` +
                    `historyChars=${procedureSlimChatHistory.length} toolResultsChars=${JSON.stringify(compactToolResults).length}`,
                );
                return response?.response || null;
            } catch (error) {
                console.warn('[PROCEDURE_RUNTIME] Response resolver failed, using template response:', error);
                return null;
            }
        };

        if (activePEC) {
            // Resume the active procedure
            const compiledProcedures = compileAllProcedures({
                documents: staticKnowledgeDocuments,
                tools: runtimeToolCatalog,
                enabledToolNames: resolveEnabledToolNames(autopilotConfig),
            });
            const graph = compiledProcedures.find((g) => g.id === activePEC.procedureId);
            if (graph) {
                procedureGraph = graph;
                procedureContext = activePEC;
                console.log(
                    `[PROCEDURE_RUNTIME] Resuming procedure "${activePEC.procedureName}" ` +
                    `step=${activePEC.currentStepId} for chat=${chat.id}`,
                );
                procedureResult = await advanceProcedure({
                    graph,
                    context: activePEC,
                    customerMessage: enrichedLastMessageContent || '',
                    availableTeams: availableTeams.map((t) => ({ id: t.id, name: t.name })),
                    decisionResolver: procedureDecisionResolver,
                    responseResolver: procedureResponseResolver,
                });
            }
        }

        if (!procedureResult) {
            // 2. Try to match a new procedure
            const compiledProcedures = compileAllProcedures({
                documents: staticKnowledgeDocuments,
                tools: runtimeToolCatalog,
                enabledToolNames: resolveEnabledToolNames(autopilotConfig),
            });

            if (compiledProcedures.length > 0) {
                const match = matchProcedure({
                    intent: intentResolution.intent,
                    customerMessage: enrichedLastMessageContent || '',
                    compiledProcedures,
                });

                if (match) {
                    console.log(
                        `[PROCEDURE_RUNTIME] Starting procedure "${match.graph.documentName}" ` +
                        `(score=${match.score}, reason=${match.matchReason}) for chat=${chat.id}`,
                    );
                    const firstStep = match.graph.steps[0];
                    if (firstStep) {
                        const newPEC = await createProcedureExecution({
                            chatId: chat.id,
                            workspaceId: workspaceId,
                            systemAgentId: assignedSystemAgentId,
                            procedureId: match.graph.id,
                            procedureName: match.graph.documentName,
                            currentStepId: firstStep.id,
                            status: 'running',
                        });

                        if (newPEC) {
                            procedureGraph = match.graph;
                            procedureContext = newPEC;
                            procedureResult = await advanceProcedure({
                                graph: match.graph,
                                context: newPEC,
                                customerMessage: enrichedLastMessageContent || '',
                                availableTeams: availableTeams.map((t) => ({ id: t.id, name: t.name })),
                                decisionResolver: procedureDecisionResolver,
                                responseResolver: procedureResponseResolver,
                            });
                        }
                    }
                }
            }
        }

        // Process PRE result
        if (procedureResult && procedureResult.handled) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'procedure_runtime',
                status: procedureResult.status === 'completed' ? 'success'
                    : procedureResult.status === 'failed' ? 'fallback'
                    : 'success',
                payload: {
                    status: procedureResult.status,
                    executedSteps: procedureResult.executedSteps,
                    actionsCount: procedureResult.actions.length,
                    completionReason: procedureResult.completionReason,
                    hasResponse: Boolean(procedureResult.response),
                },
            });

            // Execute tool actions returned by the PRE and feed their results
            // back into the same procedure step before replying to the customer.
            let procedureToolCycles = 0;
            const procedureExecutedActions: string[] = [];
            while (
                procedureResult.actions.length > 0 &&
                procedureGraph &&
                procedureContext &&
                procedureToolCycles < 3
            ) {
                procedureToolCycles += 1;
                const preToolActions: AgentToolAction[] = procedureResult.actions.map((a) => ({
                    type: a.type as any,
                    reason: a.reason,
                    payload: a.payload,
                }));
                procedureExecutedActions.push(...preToolActions.map((action) => action.type));

                const preToolStage = await timeOrchestratorStage(
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
                        actions: preToolActions,
                        orchestratorRunId: orchestratorRun?.id,
                    }),
                    {
                        procedureRuntime: true,
                        requestedActions: preToolActions.map((action) => action.type),
                    }
                );
                orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + preToolStage.durationMs;
                const preToolResults = preToolStage.value;

                if (preToolResults.length > 0) {
                    console.log(
                        `[PROCEDURE_RUNTIME] Executed ${preToolResults.length} tool(s): ` +
                        preToolResults.map((r) => `${r.toolName}=${r.status}`).join(', '),
                    );
                }

                procedureResult = await advanceProcedure({
                    graph: procedureGraph,
                    context: procedureContext,
                    customerMessage: enrichedLastMessageContent || '',
                    availableTeams: availableTeams.map((t) => ({ id: t.id, name: t.name })),
                    toolResults: preToolResults,
                    decisionResolver: procedureDecisionResolver,
                    responseResolver: procedureResponseResolver,
                });
            }

            // Send the response to the customer
            if (procedureResult.response) {
                const finalResponse = formatCustomerFacingAiResponse(procedureResult.response);

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
                } else {
                    await sendMultiBlockResponse(chat.id, finalResponse, assignedSystemAgentId, true, instanceName);
                }

                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: 'procedure_runtime_engine',
                    customerMessage: enrichedLastMessageContent || '',
                    response: finalResponse,
                    status: currentCopilotMode === 'suggest' ? 'suggested' : 'sent',
                    triggeredRule: null,
                    metadata: {
                        procedureRuntime: true,
                        procedureStatus: procedureResult.status,
                        executedSteps: procedureResult.executedSteps,
                        actionsExecuted: procedureExecutedActions.length > 0
                            ? procedureExecutedActions
                            : procedureResult.actions.map((a) => a.type),
                        completionReason: procedureResult.completionReason,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
                    },
                });
            }

            const shouldFallThroughToLlm =
                procedureResult.status === 'completed' &&
                !procedureResult.response &&
                procedureResult.actions.length === 0;

            if (shouldFallThroughToLlm) {
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'procedure_runtime',
                    status: 'fallback',
                    payload: {
                        reason: 'procedure_completed_without_response',
                        executedSteps: procedureResult.executedSteps,
                    },
                });
            } else {
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: procedureResult.status === 'failed' ? 'fallback' : 'success',
                    timings: orchestratorTimings,
                    intent: intentResolution.intent,
                    confidenceLevel: 'deterministic',
                    confidenceScore: intentResolution.confidence,
                    metadata: {
                        procedureRuntime: true,
                        procedureStatus: procedureResult.status,
                        executedSteps: procedureResult.executedSteps,
                        actionsExecuted: procedureExecutedActions.length > 0
                            ? procedureExecutedActions
                            : procedureResult.actions.map((a) => a.type),
                        responseSent: Boolean(procedureResult.response),
                        intent: intentResolution.intent,
                        ragStrategy,
                        knowledgeCoverage,
                    },
                });
                return;
            }
        }
    } catch (procedureError) {
        console.warn('[PROCEDURE_RUNTIME] PRE gate failed, falling through to LLM:', procedureError);
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'procedure_runtime',
            status: 'fallback',
            payload: {
                error: procedureError instanceof Error ? procedureError.message : String(procedureError),
            },
        });
        // Fall through to LLM
    }
    // ═══════════════════════════════════════════════════════════════════════
    // END PRE GATE — if we reach here, no procedure handled the message
    // ═══════════════════════════════════════════════════════════════════════

    if (deterministicOfficialResponse) {
        const finalResponse = deterministicOfficialResponsePreserveFormatting
            ? deterministicOfficialResponse.replace(/\r\n?/g, '\n').trim()
            : formatCustomerFacingAiResponse(deterministicOfficialResponse);
        if (currentCopilotMode === 'suggest') {
            console.log(`[AUTOPILOT_SERVICE] Modo sugestao - resposta oficial deterministica: ${finalResponse.substring(0, 50)}...`);
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
                modelName: 'deterministic_official_response',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: 'suggested',
                triggeredRule: null,
                metadata: {
                    deterministicOfficialResponse: true,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    reason: intentResolution.reason,
                    workflowId: intentResolution.workflowId,
                    sourceDocumentId: deterministicOfficialSourceDocumentId,
                    sourceDocumentName: deterministicOfficialSourceDocumentName,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'success',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceLevel: 'deterministic',
                confidenceScore: intentResolution.confidence,
                metadata: {
                    suggestionOnly: true,
                    deterministicOfficialResponse: true,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    reason: intentResolution.reason,
                    workflowId: intentResolution.workflowId,
                    sourceDocumentId: deterministicOfficialSourceDocumentId,
                    sourceDocumentName: deterministicOfficialSourceDocumentName,
                    ragStrategy,
                    knowledgeCoverage,
                    responseLength: finalResponse.length,
                },
            });
            return;
        }

        const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
            chatId: chat.id,
            sourceMessageId: sourceMessageId ?? null,
        });
        if (!sourceMessageStillCurrent) {
            console.warn(`[AUTOPILOT_STALE_GUARD] Skipping stale deterministic plan catalog for chat ${chat.id}, sourceMessageId=${sourceMessageId || 'none'}.`);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'stale_source_message_guard',
                status: 'skipped',
                payload: {
                    sourceMessageId: sourceMessageId ?? null,
                    reason: 'newer_customer_message_exists',
                    deterministicOfficialResponse: true,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
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
                    deterministicOfficialResponse: true,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                    sourceMessageId: sourceMessageId ?? null,
                },
            });
            return;
        }

        console.log(`[AUTOPILOT_SERVICE] Enviando resposta oficial deterministica: ${finalResponse}`);
        const sendStage = await timeOrchestratorStage(
            orchestratorRun,
            'message_send',
            () => sendAutomatedMessageAction(chat.id, finalResponse, assignedSystemAgentId, true, instanceName),
            { responseLength: finalResponse.length, deterministicOfficialResponse: true }
        );
        orchestratorTimings.send_ms = sendStage.durationMs;
        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'deterministic_official_response',
            customerMessage: enrichedLastMessageContent || '',
            response: finalResponse,
            status: 'sent',
            triggeredRule: null,
            metadata: {
                deterministicOfficialResponse: true,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                reason: intentResolution.reason,
                workflowId: intentResolution.workflowId,
                sourceDocumentId: deterministicOfficialSourceDocumentId,
                sourceDocumentName: deterministicOfficialSourceDocumentName,
                ragStrategy,
                knowledgeCoverage,
            },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'success',
            timings: orchestratorTimings,
            intent: intentResolution.intent,
            confidenceLevel: 'deterministic',
            confidenceScore: intentResolution.confidence,
            metadata: {
                responseSent: true,
                toolCount: 0,
                deterministicOfficialResponse: true,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                reason: intentResolution.reason,
                workflowId: intentResolution.workflowId,
                sourceDocumentId: deterministicOfficialSourceDocumentId,
                sourceDocumentName: deterministicOfficialSourceDocumentName,
                ragStrategy,
                knowledgeCoverage,
                responseLength: finalResponse.length,
            },
        });
        return;
    }

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
            knowledgeBase: scopedKnowledgeBase,
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
            intentContext: intentContextForAI,
            }), orchestratorRun.budget.maxLlmMs, 'llm response'),
            {
                model: resolvedAiModel.model,
                requestedModel: resolvedAiModel.requestedModel,
                modelFallbackUsed: resolvedAiModel.fallbackUsed,
                deterministicRouting: deterministicRouting.matchedReason,
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
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
                    metadata: {
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
                        deterministicRouting: deterministicRouting.matchedReason,
                    },
                });
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'success',
                    timings: orchestratorTimings,
                    intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : intentResolution.intent,
                    confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'plausible',
                    confidenceScore: deterministicRouting.matchedReason ? null : intentResolution.confidence,
                    metadata: {
                        suggestionOnly: true,
                        deterministicRouting: deterministicRouting.matchedReason,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
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
                            intent: intentResolution.intent,
                            confidence: intentResolution.confidence,
                            workflowId: intentResolution.workflowId,
                            ragStrategy,
                            knowledgeCoverage,
                        },
                    });
                    return;
                }

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
                const toolPlanner = planAutopilotTools({
                    response: finalResponse,
                    customerMessage: enrichedLastMessageContent || '',
                    intentResolution,
                    slotExtraction: workflowPlan.slotExtraction,
                    actions: mergeAgentActions(deterministicRouting.actions, workflowPlannedActions, llmActions),
                    enabledToolNames,
                    toolCatalog: runtimeToolCatalog,
                    availableTeams,
                    contact: sanitizedContact,
                });
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'tool_planner',
                    status: toolPlanner.rejectedActions.length > 0 || toolPlanner.responseOverride ? 'fallback' : 'success',
                    payload: {
                        intent: intentResolution.intent,
                        workflowId: intentResolution.workflowId,
                        ...toolPlanner.metadata,
                    },
                });
                const plannerMissingSlots = Array.from(new Set(
                    toolPlanner.rejectedActions.flatMap((item) => item.missingSlots || [])
                ));
                const plannerPrearmSignal = deriveToolPrearmSignal({
                    intentResolution,
                    missingSlots: plannerMissingSlots,
                    enabledToolNames,
                    plannedActions: toolPlanner.rejectedActions.map((item) => item.action),
                    reason: 'Tool planner identificou ferramenta pretendida aguardando dados obrigatorios.',
                });
                if (plannerPrearmSignal) {
                    await insertAgentToolStatusMessage({
                        workspaceId,
                        chatId: chat.id,
                        systemAgentId: assignedSystemAgentId,
                        content: buildToolPrearmContent(plannerPrearmSignal),
                        toolName: plannerPrearmSignal.toolName,
                        status: 'prearmed',
                        runId: `prearm:${orchestratorRun.id}:${plannerPrearmSignal.toolName}`,
                        prearm: plannerPrearmSignal,
                    });
                }
                if (toolPlanner.responseOverride) {
                    finalResponse = toolPlanner.responseOverride;
                    aiMessageBlocks = null;
                }

                // Log tool planner decisions for observability
                console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${chat.id} tool_planner approved=${toolPlanner.actions.length} rejected=${toolPlanner.rejectedActions.length} override=${!!toolPlanner.responseOverride}`);
                if (toolPlanner.rejectedActions.length > 0) {
                    const rejectionSummary = toolPlanner.rejectedActions
                        .map((r: any) => `${r.type || r.toolName || 'unknown'}: ${r.reason || 'motivo nao especificado'}`)
                        .join('; ');
                    console.warn(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${chat.id} rejected_tools: ${rejectionSummary}`);
                    await insertAgentToolStatusMessage({
                        workspaceId,
                        chatId: chat.id,
                        systemAgentId: assignedSystemAgentId,
                        content: `Ferramentas rejeitadas pelo validador: ${rejectionSummary}`,
                        toolName: 'tool_planner',
                        status: 'rejected',
                    });
                }

                const requestedActions = filterImplicitTransferActions({
                    actions: toolPlanner.actions,
                    customerMessage: enrichedLastMessageContent || '',
                    availableTeams,
                    candidates: deterministicRouting.candidates,
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
                                    knowledgeBase: scopedKnowledgeBase,
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
                                    intentContext: intentContextForAI,
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

                    const sgpResponse = buildSgpResponseFromToolResults(
                        toolResults,
                        `${enrichedLastMessageContent || ''}\n${finalResponse || ''}`
                    );
                    if (sgpResponse) {
                        console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${chat.id} sgp_response_mapped=true`);
                        finalResponse = formatCustomerFacingAiResponse(sgpResponse);
                        aiMessageBlocks = null; // Tool response overrode AI blocks
                    } else {
                        console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${chat.id} sgp_response_mapped=false`);
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

                    // Generate a post-tool LLM response when:
                    // - MCP tools were executed (original behavior), OR
                    // - SGP tools executed successfully but buildSgpResponseFromToolResults returned null
                    //   (data exists but didn't match expected patterns — LLM can still present it)
                    const hasMcpToolResults = toolResults.some((toolResult) => toolResult.toolName.startsWith('mcp:'));
                    const hasSuccessfulSgpWithoutMappedResponse =
                        !sgpResponse &&
                        !toolFailureResponse &&
                        toolResults.some((toolResult) =>
                            toolResult.toolName.startsWith('sgp_') && toolResult.status === 'success'
                        );
                    const shouldGeneratePostToolResponse = hasMcpToolResults || hasSuccessfulSgpWithoutMappedResponse;

                    let postToolAiResponse: string | null = null;
                    if (shouldGeneratePostToolResponse) {
                        console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${chat.id} generating_post_tool_response=true reason=${hasMcpToolResults ? 'mcp_tool' : 'sgp_unmapped'}`);
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
                                    knowledgeBase: scopedKnowledgeBase,
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
                                    intentContext: intentContextForAI,
                                }), orchestratorRun.budget.maxLlmMs, 'llm tool final response'),
                                {
                                    model: resolvedAiModel.model,
                                    reason: hasSuccessfulSgpWithoutMappedResponse ? 'sgp_unmapped_response' : 'post_tool_customer_response',
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

                    if (postToolAiResponse) {
                        finalResponse = formatCustomerFacingAiResponse(postToolAiResponse);
                        aiMessageBlocks = null;
                    }
                }

                finalResponse = formatCustomerFacingAiResponse(finalResponse);
                const validatorToolResults = [...recentToolResults, ...toolResults];
                const responseValidator = validateAutopilotResponse({
                    response: finalResponse,
                    fallbackReply: autopilotConfig.default_fallback_reply || '',
                    customerMessage: enrichedLastMessageContent || '',
                    intentResolution,
                    slotExtraction: workflowPlan.slotExtraction,
                    plannedActions: requestedActions,
                    toolResults: validatorToolResults,
                    enabledToolNames,
                    availableTeams,
                    contact: sanitizedContact,
                    knowledgeCoverage,
                    source: 'llm',
                });
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'response_validator',
                    status: responseValidator.decision === 'approve' || responseValidator.decision === 'repair' ? 'success' : 'fallback',
                    payload: {
                        intent: intentResolution.intent,
                        workflowId: intentResolution.workflowId,
                        ...responseValidator.metadata,
                    },
                });
                if (responseValidator.decision !== 'approve') {
                    finalResponse = formatCustomerFacingAiResponse(responseValidator.response);
                    aiMessageBlocks = null;
                }
                const finalPostResponseActions = responseValidator.actions.length > 0
                    ? mergeAgentActions(responseValidator.actions, postResponseActions)
                    : postResponseActions;

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
                        actions: finalPostResponseActions,
                        orchestratorRunId: orchestratorRun.id,
                    }),
                    { requestedActions: finalPostResponseActions.map((action) => action.type), afterResponse: true }
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
                        toolPlanner: toolPlanner.metadata,
                        responseValidator: responseValidator.metadata,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
                    },
                });
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'success',
                    timings: orchestratorTimings,
                    intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : intentResolution.intent,
                    confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'plausible',
                    confidenceScore: deterministicRouting.matchedReason ? null : intentResolution.confidence,
                    metadata: {
                        responseSent: true,
                        toolCount: toolResults.length,
                        deterministicRouting: deterministicRouting.matchedReason,
                        toolPlanner: toolPlanner.metadata,
                        responseValidator: responseValidator.metadata,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
                    },
                });
            }
        } else {
            console.log('[AUTOPILOT_SERVICE] Nenhuma resposta gerada.');
            const emptyResponseToolPlanner = planAutopilotTools({
                response: null,
                customerMessage: enrichedLastMessageContent || '',
                intentResolution,
                slotExtraction: workflowPlan.slotExtraction,
                actions: mergeAgentActions(deterministicRouting.actions, workflowPlannedActions, normalizeAgentActions(result?.actions)),
                enabledToolNames,
                toolCatalog: runtimeToolCatalog,
                availableTeams,
                contact: sanitizedContact,
            });
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'tool_planner',
                status: emptyResponseToolPlanner.rejectedActions.length > 0 || emptyResponseToolPlanner.responseOverride ? 'fallback' : 'success',
                payload: {
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    emptyResponse: true,
                    ...emptyResponseToolPlanner.metadata,
                },
            });
            const fallbackActions = filterImplicitTransferActions({
                actions: emptyResponseToolPlanner.actions,
                customerMessage: enrichedLastMessageContent || '',
                availableTeams,
                candidates: deterministicRouting.candidates,
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
                metadata: {
                    ...(deterministicRouting.matchedReason ? { deterministicRouting: deterministicRouting.matchedReason } : {}),
                    ...(toolResults.length > 0 ? { toolResults } : {}),
                    toolPlanner: emptyResponseToolPlanner.metadata,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: toolResults.length > 0 ? 'success' : 'fallback',
                timings: orchestratorTimings,
                intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : intentResolution.intent,
                confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'low',
                confidenceScore: deterministicRouting.matchedReason ? null : intentResolution.confidence,
                metadata: {
                    responseSent: false,
                    toolCount: toolResults.length,
                    deterministicRouting: deterministicRouting.matchedReason,
                    toolPlanner: emptyResponseToolPlanner.metadata,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
        }
    } catch (error) {
        console.error('[AUTOPILOT_SERVICE] Erro ao processar:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (currentCopilotMode === 'auto') {
            const fallbackReason = errorMessage.includes('llm response timed out')
                ? 'llm_timeout'
                : 'autopilot_processing_error';
            const automaticFallback = formatCustomerFacingAiResponse(
                autopilotConfig.default_fallback_reply?.trim() ||
                'Estou com uma instabilidade para responder agora. Pode aguardar um instante? Nossa equipe vai acompanhar por aqui.'
            );
            try {
                const sendStage = await timeOrchestratorStage(
                    orchestratorRun,
                    'message_send',
                    () => sendAutomatedMessageAction(
                        chat.id,
                        automaticFallback,
                        assignedSystemAgentId,
                        true,
                        instanceName
                    ),
                    { responseLength: automaticFallback.length, fallbackReason }
                );
                orchestratorTimings.send_ms = sendStage.durationMs;
                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: resolvedAiModel.model,
                    customerMessage: enrichedLastMessageContent || lastMessageContent || '',
                    response: automaticFallback,
                    status: 'sent',
                    triggeredRule: null,
                    metadata: {
                        fallbackReason,
                        deterministicRouting: deterministicRouting.matchedReason,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
                    },
                });
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'fallback',
                    timings: orchestratorTimings,
                    intent: intentResolution.intent,
                    confidenceLevel: 'low',
                    confidenceScore: intentResolution.confidence,
                    error: errorMessage,
                    metadata: {
                        responseSent: true,
                        fallbackReason,
                        deterministicRouting: deterministicRouting.matchedReason,
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                        workflowId: intentResolution.workflowId,
                        ragStrategy,
                        knowledgeCoverage,
                    },
                });
                return;
            } catch (fallbackError) {
                console.error('[AUTOPILOT_SERVICE] Falha ao enviar fallback automatico:', fallbackError);
            }
        }
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'error',
            timings: orchestratorTimings,
            intent: intentResolution.intent,
            confidenceScore: intentResolution.confidence,
            error: errorMessage,
            metadata: {
                deterministicRouting: deterministicRouting.matchedReason,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
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
            metadata: {
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
                ragStrategy,
                knowledgeCoverage,
            },
        });
    }
    } finally {
        await broadcastAiProcessing(chat.id, 'ai_processing_stop');
    }
}
