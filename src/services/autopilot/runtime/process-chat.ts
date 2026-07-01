import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { AutopilotConfig, NexusFlowInstance, KnowledgeBaseDocument, Chat, Contact, Message, MessageMetadata } from '@/lib/types';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { generateProcedureRuntimeOutput } from '@/ai/flows/procedure-runtime';
import { logToDebugFile } from '@/lib/debug-file';
import { resolveCanonicalWhatsappChatIdByIdentity } from '@/lib/whatsapp/contact-identity';
import { retrieveHybridSupportContext, type KnowledgeRetrievalStrategy } from '@/services/rag/hybrid-retrieval';
import { partitionKnowledgeDocuments } from '@/services/rag/knowledge-document';
import { runAgentTools } from '@/services/agent-tools/runtime';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';
import { classifyMcpToolSafety, resolveMcpToolTimeoutMs } from '@/services/mcp/tool-safety';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { extractKnowledgeToolProcedures, formatKnowledgeToolProcedures } from '@/services/agent-tools/knowledge-procedures';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import {
    routeDeterministicAgentTools,
    shouldHandoffToHuman,
    type ToolRouterTeam,
} from '@/services/agent-tools/router';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import { isLmStudioModel } from '@/services/ai/lm-studio';
import { formatCustomerFacingAiResponse } from '@/lib/ai-response-format';
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
    extractFocusedContractId,
    getScopedContractIdFromToolResults,
    hydrateFindRouterByIpActionsFromSgpResults,
    scopeSgpLookupActionsToAddressedContract,
    scopeSgpLookupActionsToFocusedContract,
} from '@/plugins/sgp/autopilot-response';
import { resolveAutopilotIntent, resolveAutopilotIntentWithOverride } from '@/services/autopilot-intent';
import type { AutopilotSlotName, KnowledgeCoverage } from '@/services/autopilot/intent-types';
import { resolveAutopilotWorkflowPlan } from '@/services/autopilot/workflow-engine';
import {
    buildIntentScopedKnowledgeBase,
    formatFlowFormGuidanceForPrompt,
    formatFlowReferencesForPrompt,
    formatFlowSwitchGuidanceForPrompt,
    filterKnowledgeDocumentsForScope,
    renderDeterministicFlowMessage,
    resolveActiveFlowIntentScope,
    resolveActiveFlowIntentScopeByNodeId,
    resolveDeterministicFlowMessage,
    resolveEntryDeterministicFlowMessage,
    resolveFlowSwitchRouteForActivePath,
    resolveFlowCompletionPlan,
    resolveFlowFormGuidance,
} from '@/services/autopilot/flow-routing';
import type { CloseIntentGateDecision, WorkflowSlotMappings } from '@/services/autopilot/workflow-engine';
import { isPotentialConversationCloseRequest } from '@/services/autopilot/close-intent';
import { planAutopilotTools } from '@/services/autopilot/tool-planner';
import { buildToolPrearmContent, deriveToolPrearmSignal, type ToolPrearmSignal } from '@/services/autopilot/tool-prearm';
import { validateAutopilotResponse } from '@/services/autopilot/response-validator';
import { completeProcedureExecution, createProcedureExecution, getActiveProcedureExecution, saveProcedureExecution } from '@/services/autopilot/procedure-store';
import { compileAllProcedures } from '@/services/autopilot/procedure-compiler';
import { compileProcedureFromFlowGraph } from '@/services/autopilot/procedure-flow-compiler';
import { matchProcedure } from '@/services/autopilot/procedure-matcher';
import {
    advanceProcedure,
    type ProcedureDecisionResolver,
    type ProcedureKnowledgeResolver,
    type ProcedureResponseResolver,
} from '@/services/autopilot/procedure-executor';
import type { ProcedureGraph, ProcedureAdvanceResult, ProcedureExecutionContext } from '@/services/autopilot/procedure-types';
import {
    buildProcedureSlimChatHistory,
    compactProcedureText,
    compactProcedureToolResults,
    PROCEDURE_SLIM_LIMITS,
} from '@/services/autopilot/procedure-prompt-slim';
import { sendMultiBlockResponse } from '@/services/autopilot/runtime/message-sender';
import { isProviderDeliveryError } from '@/services/autopilot/runtime/provider-delivery';
import type { AutopilotResponseTrace } from '@/services/autopilot/runtime/response-delivery';
import {
    assertAutopilotSourceMessageCurrent,
    AutopilotSourceSupersededError,
    isAutopilotSourceMessageStillCurrent,
} from '@/services/autopilot/runtime/stale-source-guard';
import { handoffAutopilotFailureToHuman } from '@/services/autopilot/runtime/failure-handoff';
import { hasSentFlowNodeMessage, logIntelligentAttendantResponse } from '@/services/autopilot/runtime/response-log';
import {
    acquireAutopilotChatLease,
    AutopilotChatLeaseTimeoutError,
    hasCompletedAutopilotSourceMessage,
} from '@/services/autopilot/runtime/chat-lease';
import {
    filterAlreadyExecutedActions,
    filterImplicitTransferActions,
    isPreResponseDataAction,
    mergeAgentActions,
    normalizeAgentActions,
} from '@/services/autopilot/runtime/action-utils';
import {
    completeProcedureToolReuse,
    planProcedureToolReuse,
} from '@/services/autopilot/runtime/procedure-tool-reuse';
import {
    buildMcpResponseFromToolResults,
    buildRecentToolMemoryContext,
    buildToolContinuationContext,
    compactToolOutputForContinuation,
    loadRecentToolResultsForAutopilot,
    shouldAnswerFromRecentToolMemory,
} from '@/services/autopilot/runtime/tool-memory';
import { getAutopilotConfigService } from '@/services/autopilot/runtime/config-service';
import { executeTriggeredWebhookRule } from '@/services/autopilot/runtime/webhook-rules';
import {
    authorizeAutopilotTurnPlanTools,
    compileAutopilotTurnPolicy,
    resolveAllowedKnowledgeDocumentIds,
    type AutopilotTurnPolicy,
} from '@/services/autopilot/turn-policy';
import { analyzeAutopilotToolCoverage } from '@/services/autopilot/tool-coverage';
import {
    completeAgentToolRun,
    planAgentToolRun,
} from '@/services/autopilot/runtime/tool-run-ledger';
import {
    consumeConfirmedPendingAction,
    consumePendingActionCancellation,
    consumeSupersededPendingAction,
    getAutopilotConversationState,
    saveAutopilotTurnState,
    setPendingToolConfirmation,
} from '@/services/autopilot/flow-state-store';
import { mapAgentToolActionsToResources } from '@/services/resource-mapper/agent-tool-actions';
import type { SlotExtractionResult } from '@/services/autopilot/slots';
import { recordAgentDecisionLedger } from '@/services/autopilot/decision-ledger';
import { decideAgentNextAction } from '@/services/autopilot/agent-decision-engine';
import { loadLatestActiveToolSelectionScoreWeights } from '@/services/autopilot/score-history';
import {
    buildAutopilotTurnPlan,
    buildAutopilotTurnPlanCustomerResponse,
    buildAutopilotTurnPlanFollowUpActions,
    buildAutopilotTurnPlanRecoveryActions,
    hasRequiredAutopilotTurnPlanFailure,
    hasSatisfiedAutopilotTurnPlan,
    inferAutopilotCustomerNeed,
    isTerminalAutopilotTurnPlan,
    shouldBypassKnowledgeForOperationalTurn,
    shouldPrioritizeAutopilotTurnPlan,
} from '@/services/autopilot/turn-plan';

function compileRuntimeProcedures(input: {
    config: AutopilotConfig;
    documents: KnowledgeBaseDocument[];
    tools: AgentToolCatalogItem[];
    enabledToolNames: string[];
}): ProcedureGraph[] {
    const documentProcedures = compileAllProcedures({
        documents: input.documents,
        tools: input.tools,
        enabledToolNames: input.enabledToolNames,
    });
    const flowProcedure = compileProcedureFromFlowGraph({
        flowGraph: input.config.flow_graph,
        configId: input.config.id,
        name: `Fluxo visual: ${input.config.name}`,
    });

    return flowProcedure.success && flowProcedure.graph
        ? [...documentProcedures, flowProcedure.graph]
        : documentProcedures;
}

async function listRuntimeAgentToolCatalog(workspaceId: string, enabledToolNames: string[]): Promise<AgentToolCatalogItem[]> {
    const enabledToolSet = new Set(enabledToolNames);
    const mcpTools = await listMcpToolsForWorkspace(workspaceId).catch((error) => {
        console.error('[AUTOPILOT_MCP] Failed to list MCP tools:', error);
        return [];
    });

    const mcpCatalogItems: AgentToolCatalogItem[] = mcpTools
        .filter((tool) => enabledToolSet.has(tool.qualifiedName))
        .map((tool) => {
            const safety = classifyMcpToolSafety(tool.qualifiedName, tool);
            return {
                name: tool.qualifiedName as any,
                version: 'mcp',
                description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
                class: safety.class,
                riskLevel: safety.riskLevel,
                sideEffect: safety.sideEffect,
                idempotent: safety.idempotent,
                timeoutMs: resolveMcpToolTimeoutMs(),
                maxAttempts: 1,
                requiresHumanApproval: safety.requiresHumanApproval,
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
            };
        });

    return [...listAgentToolCatalogItems(), ...mcpCatalogItems];
}

function resolveEnabledToolNames(config: AutopilotConfig) {
    return Array.isArray(config.enabled_tool_names)
        ? config.enabled_tool_names
        : [];
}

function shouldRunCloseIntentGate(input: {
    customerMessage: string;
    enabledToolNames: string[];
}) {
    const message = input.customerMessage.trim();
    if (!input.enabledToolNames.includes('close_chat')) return false;
    return isPotentialConversationCloseRequest(message);
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

function buildEnabledAgentToolsDescription(
    enabledToolNames: string[],
    toolCatalog: AgentToolCatalogItem[],
    toolInstructionsByName: Record<string, string> = {},
): string {
    const configured = new Set(enabledToolNames);

    const enabledTools = toolCatalog.filter((tool) => configured.has(tool.name));
    if (enabledTools.length === 0) {
        return 'Nenhuma ferramenta operacional esta habilitada. Nao solicite actions.';
    }

    return enabledTools
        .map((tool) => {
            const schema = tool.inputSchema ? ` Entrada JSON: ${JSON.stringify(tool.inputSchema).slice(0, 600)}` : '';
            const instructions = toolInstructionsByName[tool.name]
                ? ` Instrucao configurada no flow: ${toolInstructionsByName[tool.name]}`
                : '';
            return `- ${tool.name}: ${tool.description}${schema}${instructions}`;
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

function resolvePromptDocumentLimit(document: KnowledgeBaseDocument): number {
    return typeof document.maxPromptChars === 'number' && Number.isFinite(document.maxPromptChars) && document.maxPromptChars > 0
        ? Math.floor(document.maxPromptChars)
        : MAX_PROMPT_DOCUMENT_CHARS;
}

function resolvePromptDocumentsTotalLimit(documents: KnowledgeBaseDocument[]): number {
    const configuredExtra = (documents || []).reduce((total, document) => {
        const limit = resolvePromptDocumentLimit(document);
        return total + Math.max(0, limit - MAX_PROMPT_DOCUMENT_CHARS);
    }, 0);
    return MAX_PROMPT_DOCUMENT_TOTAL_CHARS + configuredExtra;
}

function compactKnowledgeDocumentsForPrompt(documents: KnowledgeBaseDocument[]): KnowledgeBaseDocument[] {
    let totalChars = 0;
    const compacted: KnowledgeBaseDocument[] = [];
    const totalLimit = resolvePromptDocumentsTotalLimit(documents);

    for (const document of documents || []) {
        const rawContent = String(document.content || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => line.replace(/[ \t]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (!rawContent) continue;

        const remaining = totalLimit - totalChars;
        if (remaining <= 0) break;

        const configuredDocumentLimit = resolvePromptDocumentLimit(document);
        const maxForDocument = Math.min(configuredDocumentLimit, remaining);
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
        await supabase.channel(`chat:${chatId}`).httpSend(event, {
                chatId,
                ...payload,
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
            await supabase.channel(`chat:${input.chatId}`).httpSend('agent_tool_status', {
                    chatId: input.chatId,
                    toolName: input.toolName,
                    status: input.status,
                    content: input.content,
                    ...(input.runId ? { runId: input.runId } : {}),
                    ...(input.prearm ? { prearm: input.prearm } : {}),
                    ...(compactOutput ? { output: compactOutput } : {}),
                    ...(input.toolResult?.error ? { error: input.toolResult.error } : {}),
            });
        } catch (broadcastError) {
            console.warn('[AUTOPILOT_TOOL_STATUS] Broadcast failed (non-blocking):', broadcastError);
        }
    } catch (error) {
        console.error('[AUTOPILOT_TOOL_STATUS] Failed to insert tool status message:', error);
    }
}

async function buildMediaAnalysisContext(input: {
    workspaceId: string;
    chatId: string;
    messageId?: string | null;
    systemAgentId: string;
    model?: string | null;
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
            model: input.model,
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
    turnPolicy: AutopilotTurnPolicy;
    customerMessage: string;
    actions: unknown;
    chatHistory?: string;
    slotExtraction?: SlotExtractionResult | null;
    confirmedActionFingerprint?: string | null;
    orchestratorRunId?: string | null;
    sourceMessageId: string | null | undefined;
}): Promise<AgentToolExecutionResult[]> {
    const normalizedActions = normalizeAgentActions(input.actions);
    if (normalizedActions.length === 0) return [];
    const resourceMapped = await mapAgentToolActionsToResources({
        workspaceId: input.workspaceId,
        customerMessage: input.customerMessage,
        chatHistory: input.chatHistory,
        contact: input.contact,
        slotExtraction: input.slotExtraction,
        actions: normalizedActions,
    });

    return runAgentTools(
        {
            workspaceId: input.workspaceId,
            chat: input.chat,
            contact: input.contact,
            systemAgentId: input.systemAgentId,
            systemAgentName: input.systemAgentName,
            autopilotConfig: input.autopilotConfig,
            turnPolicy: input.turnPolicy,
            customerMessage: input.customerMessage,
            confirmedActionFingerprint: input.confirmedActionFingerprint ?? null,
            orchestratorRunId: input.orchestratorRunId ?? null,
        },
        resourceMapped.actions
    );
}

async function runRequestedAgentToolsWithStatus(input: {
    workspaceId: string;
    chat: Chat;
    contact: Contact;
    systemAgentId: string;
    systemAgentName: string;
    autopilotConfig: AutopilotConfig;
    turnPolicy: AutopilotTurnPolicy;
    customerMessage: string;
    actions: unknown;
    chatHistory?: string;
    slotExtraction?: SlotExtractionResult | null;
    confirmedActionFingerprint?: string | null;
    orchestratorRunId?: string | null;
    sourceMessageId: string | null | undefined;
}): Promise<AgentToolExecutionResult[]> {
    const normalizedActions = normalizeAgentActions(input.actions);
    if (normalizedActions.length === 0) return [];
    await assertAutopilotSourceMessageCurrent({
        chatId: input.chat.id,
        sourceMessageId: input.sourceMessageId,
    });
    const resourceMapped = await mapAgentToolActionsToResources({
        workspaceId: input.workspaceId,
        customerMessage: input.customerMessage,
        chatHistory: input.chatHistory,
        contact: input.contact,
        slotExtraction: input.slotExtraction,
        actions: normalizedActions,
    });
    const toolRunPlan = planAgentToolRun(input.orchestratorRunId, resourceMapped.actions);
    const actionsToRun = toolRunPlan.actionsToExecute;
    const reusedCount = toolRunPlan.entries.filter((entry) => entry.kind === 'reuse').length;

    console.log(`[ORCHESTRATOR_TOOL_FEEDBACK] chat=${input.chat.id} planned_tools=${resourceMapped.actions.length} execute=${actionsToRun.length} reused=${reusedCount} tools=[${actionsToRun.map((a) => a.type === 'mcp_call_tool' ? String(a.payload?.toolName || a.type) : a.type).join(',')}]`);

    if (actionsToRun.length === 0) {
        return completeAgentToolRun(toolRunPlan, []);
    }

    const toolRuns = actionsToRun.map((action) => ({
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
        actions: actionsToRun,
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

    return completeAgentToolRun(toolRunPlan, results);
}

function resolveActionToolName(action: AgentToolAction) {
    return action.type === 'mcp_call_tool'
        ? String(action.payload?.toolName || '')
        : action.type;
}

async function sendToolFailureFollowUp(input: {
    chatId: string;
    systemAgentId: string;
    instanceName?: string;
    toolResults: AgentToolExecutionResult[];
    previousResponse?: string | null;
    responseTrace?: AutopilotResponseTrace;
    deliveryKey?: string;
}): Promise<string | null> {
    const failureResponse = buildToolFailureResponse(
        input.toolResults,
        input.previousResponse || ''
    );
    if (!failureResponse) return null;

    const formattedResponse = formatCustomerFacingAiResponse(failureResponse);
    await sendMultiBlockResponse(
        input.chatId,
        formattedResponse,
        input.systemAgentId,
        true,
        input.instanceName,
        null,
        input.responseTrace
            ? { ...input.responseTrace, deliveryKey: input.deliveryKey || 'tool-failure' }
            : undefined
    );
    return formattedResponse;
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

    const chatLease = await acquireAutopilotChatLease({
        workspaceId,
        chatId: chat.id,
        sourceMessageId,
    });
    if (chatLease.status === 'superseded') {
        console.log(
            `[AUTOPILOT_CHAT_LEASE] Mensagem ${sourceMessageId || 'sem-id'} do chat ${chat.id} foi substituida por uma mensagem mais recente enquanto aguardava processamento.`,
        );
        return;
    }
    if (chatLease.status === 'timeout') {
        console.error(
            `[AUTOPILOT_CHAT_LEASE] Tempo limite de ${chatLease.waitedMs}ms aguardando processamento exclusivo do chat ${chat.id}.`,
        );
        throw new AutopilotChatLeaseTimeoutError(chat.id, chatLease.waitedMs);
    }

    try {
    if (await hasCompletedAutopilotSourceMessage({
        workspaceId,
        chatId: chat.id,
        sourceMessageId,
    })) {
        console.log(
            `[AUTOPILOT_CHAT_LEASE] Mensagem ${sourceMessageId || 'sem-id'} do chat ${chat.id} ja possui resposta persistida. Ignorando execucao duplicada.`,
        );
        return;
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
    const responseTrace: AutopilotResponseTrace = {
        workspaceId,
        sourceMessageId: sourceMessageId ?? null,
        orchestratorRunId: orchestratorRun.id,
    };

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
    const focusedContractMessagesRes = await db.query(
        `SELECT content
         FROM messages
         WHERE chat_id = $1
           AND from_me = false
           AND content ILIKE '%contrato%'
         ORDER BY created_at DESC
         LIMIT 20`,
        [chat.id]
    );
    const focusedContractId = extractFocusedContractId(
        ...focusedContractMessagesRes.rows.reverse().map((message: any) => String(message.content || ''))
    );
    let focusedContractContext = focusedContractId
        ? `Contrato em foco explicitamente informado pelo cliente: ${focusedContractId}.`
        : '';

    const mediaAnalysisContext = await buildMediaAnalysisContext({
        workspaceId,
        chatId: chat.id,
        messageId: sourceMessageId,
        systemAgentId: assignedSystemAgentId,
        model: resolvedAiModel.model,
    });
    const enrichedLastMessageContent = [
        lastMessageContent || '',
        mediaAnalysisContext,
    ].filter((part) => part.trim().length > 0).join('\n\n');
    let focusedOperationalContext = [
        focusedContractContext,
        enrichedLastMessageContent,
    ].filter(Boolean).join('\n');
    const staticKnowledgeDocuments = autopilotConfig.knowledge_base_documents || [];
    let enabledToolNames = resolveEnabledToolNames(autopilotConfig);
    const runtimeToolCatalog = await listRuntimeAgentToolCatalog(workspaceId, enabledToolNames);
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

    const earlyCustomerNeed = inferAutopilotCustomerNeed(
        enrichedLastMessageContent || '',
        chatHistoryForAI,
    );
    const deterministicOperationalTurn = shouldBypassKnowledgeForOperationalTurn({
        customerNeed: earlyCustomerNeed,
        enabledToolNames,
        customerMessage: enrichedLastMessageContent || '',
        chatHistory: chatHistoryForAI,
        toolCatalog: runtimeToolCatalog,
    });
    let intentResolution = resolveAutopilotIntent({
        customerMessage: enrichedLastMessageContent || '',
        chatHistory: chatHistoryForAI,
        knowledgeDocuments: staticKnowledgeDocuments,
    });
    const deterministicIntentResolution = intentResolution;

    if (!deterministicOperationalTurn && shouldUseAiIntentClassifier({
        intent: deterministicIntentResolution.intent,
        confidence: deterministicIntentResolution.confidence,
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

    let activeFlowIntentScope = resolveActiveFlowIntentScope(autopilotConfig, intentResolution.intent);
    const persistedFlowState = await getAutopilotConversationState(chat.id).catch((error) => {
        console.warn('[AUTOPILOT_FLOW_STATE] Failed to load persisted state:', error);
        return null;
    });
    const switchResolution = resolveFlowSwitchRouteForActivePath({
        config: autopilotConfig,
        customerMessage: enrichedLastMessageContent || '',
        activeNodeId: persistedFlowState?.activeNodeId,
    });
    if (switchResolution) {
        if (switchResolution.targetNodeId) {
            activeFlowIntentScope = resolveActiveFlowIntentScopeByNodeId(autopilotConfig, switchResolution.targetNodeId);
        }
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'switch_resolution',
            status: switchResolution.fallbackUsed ? 'fallback' : 'success',
            payload: switchResolution,
        });
    }
    const effectivePersistedActiveNodeId = switchResolution?.targetNodeId || persistedFlowState?.activeNodeId;
    const scopedStaticKnowledgeDocuments = filterKnowledgeDocumentsForScope(autopilotConfig, staticKnowledgeDocuments, activeFlowIntentScope);
    const turnPolicy = compileAutopilotTurnPolicy({
        config: autopilotConfig,
        documents: staticKnowledgeDocuments,
        intentScope: activeFlowIntentScope,
        persistedActiveNodeId: effectivePersistedActiveNodeId,
    });
    enabledToolNames = turnPolicy.allowedToolNames;
    const flowCompletionPlan = resolveFlowCompletionPlan(autopilotConfig, turnPolicy.activeNodeId);
    const allowedDocumentIds = resolveAllowedKnowledgeDocumentIds({
        config: autopilotConfig,
        documents: staticKnowledgeDocuments,
        intentScope: activeFlowIntentScope,
    });
    await saveAutopilotTurnState({
        chatId: chat.id,
        workspaceId,
        autopilotConfigId: autopilotConfig.id,
        activeNodeId: switchResolution?.targetNodeId || turnPolicy.activeNodeId,
    }).catch((error) => {
        console.warn('[AUTOPILOT_FLOW_STATE] Failed to persist active node:', error);
    });
    const pendingActionSuperseded = currentCopilotMode === 'auto'
        ? await consumeSupersededPendingAction({
            state: persistedFlowState,
            message: enrichedLastMessageContent || '',
        }).catch((error) => {
            console.warn('[AUTOPILOT_FLOW_STATE] Failed to supersede pending action:', error);
            return false;
        })
        : false;
    if (pendingActionSuperseded) {
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'pending_confirmation_superseded',
            status: 'success',
            payload: {
                reason: 'customer_sent_new_request_before_confirmation',
            },
        });
    }
    const pendingActionCancelled = currentCopilotMode === 'auto'
        ? await consumePendingActionCancellation({
            state: persistedFlowState,
            message: enrichedLastMessageContent || '',
        }).catch((error) => {
            console.warn('[AUTOPILOT_FLOW_STATE] Failed to cancel pending action:', error);
            return false;
        })
        : false;
    if (pendingActionCancelled) {
        await sendMultiBlockResponse(
            chat.id,
            'Tudo bem. A acao pendente foi cancelada e nao sera executada.',
            assignedSystemAgentId,
            true,
            instanceName,
            null,
            responseTrace,
        );
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'success',
            timings: orchestratorTimings,
            metadata: {
                pendingActionCancelled: true,
                responseSent: true,
            },
        });
        return;
    }
    const confirmedPendingAction = currentCopilotMode === 'auto'
        ? await consumeConfirmedPendingAction({
            state: persistedFlowState,
            message: enrichedLastMessageContent || '',
            allowedToolNames: turnPolicy.allowedToolNames,
        }).catch((error) => {
            console.warn('[AUTOPILOT_FLOW_STATE] Failed to consume confirmed action:', error);
            return null;
        })
        : null;
    if (confirmedPendingAction) {
        const confirmedResults = await runRequestedAgentToolsWithStatus({
            workspaceId,
            chat,
            contact: sanitizedContact,
            systemAgentId: assignedSystemAgentId,
            systemAgentName: assignedSystemAgentName,
            autopilotConfig,
            turnPolicy,
            customerMessage: enrichedLastMessageContent || '',
            actions: [confirmedPendingAction],
            confirmedActionFingerprint: fingerprintToolAction(confirmedPendingAction),
            orchestratorRunId: orchestratorRun.id,
            sourceMessageId,
        });
        const confirmedResponse = buildMcpCustomerResponseFromToolResults(confirmedResults)
            || buildMcpResponseFromToolResults(confirmedResults)
            || buildSgpResponseFromToolResults(confirmedResults, enrichedLastMessageContent || '')
            || buildToolFailureResponse(confirmedResults, '')
            || (confirmedResults.some((result) => result.status === 'success')
                ? 'Pronto, a acao confirmada foi executada com sucesso.'
                : 'Nao consegui executar a acao confirmada. Vou encaminhar o contexto para atendimento humano.');
        await sendMultiBlockResponse(
            chat.id,
            confirmedResponse,
            assignedSystemAgentId,
            true,
            instanceName,
            null,
            responseTrace,
        );
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: confirmedResults.some((result) => result.status === 'success') ? 'success' : 'fallback',
            timings: orchestratorTimings,
            metadata: {
                confirmedPendingAction: resolveActionToolName(confirmedPendingAction),
                toolCount: confirmedResults.length,
                responseSent: true,
            },
        });
        return;
    }
    let ragStrategy: KnowledgeRetrievalStrategy = scopedStaticKnowledgeDocuments.length > 0 ? 'static_documents' : 'none';
    let knowledgeCoverage: KnowledgeCoverage = scopedStaticKnowledgeDocuments.length > 0 ? 'low' : 'none';
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
            sourceDocumentId: null,
            sourceDocumentName: null,
            hasOfficialResponse: false,
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
            await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                    suggestion: finalResponse,
                    chatId: chat.id,
                    configName: autopilotConfig.name,
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
                instanceName,
                null,
                responseTrace
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
                turnPolicy,
                customerMessage: enrichedLastMessageContent || '',
                actions: deterministicRouting.actions,
                orchestratorRunId: orchestratorRun.id,
                sourceMessageId,
            }),
            { requestedActions: deterministicRouting.actions.map(resolveActionToolName), skippedLlm: true }
        );
        orchestratorTimings.tool_ms = toolsStage.durationMs;
        const toolResults = toolsStage.value;
        await sendToolFailureFollowUp({
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            instanceName,
            toolResults,
            previousResponse: finalResponse,
            responseTrace,
        });

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

    let ragDocuments: KnowledgeBaseDocument[] = scopedStaticKnowledgeDocuments;
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
        if (
            enrichedLastMessageContent &&
            enrichedLastMessageContent.trim().length > 3 &&
            !deterministicOperationalTurn
        ) {
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
                        staticDocuments: scopedStaticKnowledgeDocuments,
                        intent: intentResolution,
                        allowedDocumentIds,
                    }),
                    orchestratorRun.budget.maxRagMs,
                    'rag retrieval'
                ),
                {
                    queryLength: enrichedLastMessageContent.length,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    initialStaticDocuments: scopedStaticKnowledgeDocuments.length,
                    allowedKnowledgeCollections: activeFlowIntentScope?.knowledgeCollectionIds || null,
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
                    internalKnowledgeSources: retrieval.diagnostics?.internalKnowledgeSources || [],
                    correctiveRetrieval: retrieval.diagnostics?.correctiveRetrieval || null,
                    discarded: retrieval.discarded.slice(0, 8),
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
        } else if (deterministicOperationalTurn) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'rag_retrieval',
                status: 'skipped',
                payload: {
                    reason: 'deterministic_operational_turn',
                    customerNeed: earlyCustomerNeed,
                },
            });
        }
    } catch (ragError) {
        console.error('[AUTOPILOT_RAG] Error during retrieval:', ragError);
        const errorMessage = ragError instanceof Error ? ragError.message : String(ragError);
        const hasStaticFallback = scopedStaticKnowledgeDocuments.length > 0;
        ragStrategy = hasStaticFallback ? 'static_documents' : 'none';
        knowledgeCoverage = hasStaticFallback ? 'low' : 'none';
        ragDocuments = hasStaticFallback ? scopedStaticKnowledgeDocuments : [];
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: hasStaticFallback ? 'rag_fallback_static_documents' : 'rag_retrieval',
            status: 'fallback',
            payload: {
                error: errorMessage,
                fallbackReason: errorMessage.includes('timed out') ? 'rag_timeout' : 'rag_error',
                strategy: ragStrategy,
                knowledgeCoverage,
                staticDocuments: scopedStaticKnowledgeDocuments.length,
                intent: intentResolution.intent,
                workflowId: intentResolution.workflowId,
            },
        });
    }

    const activeToolSelectionScore = await loadLatestActiveToolSelectionScoreWeights({
        workspaceId,
        agentId: assignedSystemAgentId,
        autopilotConfigId: autopilotConfig.id,
    }).catch((error) => {
        console.warn('[AUTOPILOT_SCORE_HISTORY] Failed to load active score weights:', error);
        return null;
    });
    if (activeToolSelectionScore) {
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'tool_score_weights',
            status: 'success',
            payload: {
                historyId: activeToolSelectionScore.id,
                source: activeToolSelectionScore.source,
                agentId: activeToolSelectionScore.agentId,
                autopilotConfigId: activeToolSelectionScore.autopilotConfigId,
                weights: activeToolSelectionScore.weights,
                reason: activeToolSelectionScore.reason,
            },
        });
    }
    const recentToolMemoryNames = [...new Set([
        'sgp_fetch_contact_panel_data',
        'sgp_fetch_contracts',
        ...turnPolicy.globallyEnabledToolNames,
    ])];
    let recentToolResults = await loadRecentToolResultsForAutopilot({
        workspaceId,
        chatId: chat.id,
        toolNames: recentToolMemoryNames,
        maxAgeMinutes: 30,
        limit: Math.max(12, Math.min(40, recentToolMemoryNames.length * 3)),
    });
    const recentScopedContractId = getScopedContractIdFromToolResults(recentToolResults);
    if (recentScopedContractId) {
        focusedContractContext = [
            `Contrato em foco da ultima consulta especifica: ${recentScopedContractId}.`,
            focusedContractContext,
        ].filter(Boolean).join('\n');
        focusedOperationalContext = [
            focusedContractContext,
            enrichedLastMessageContent,
        ].filter(Boolean).join('\n');
    }

    const flowScopedDeterministicActions = deterministicRouting.actions.filter((action) => (
        turnPolicy.allowedToolNames.includes(resolveActionToolName(action))
    ));
    if (flowScopedDeterministicActions.length !== deterministicRouting.actions.length) {
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'turn_policy_tool_filter',
            status: 'skipped',
            payload: {
                reason: turnPolicy.reason,
                requestedTools: deterministicRouting.actions.map(resolveActionToolName),
                allowedTools: turnPolicy.allowedToolNames,
            },
        });
        deterministicRouting = {
            ...deterministicRouting,
            actions: flowScopedDeterministicActions,
            responseHint: flowScopedDeterministicActions.length > 0 ? deterministicRouting.responseHint : null,
        };
    }
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
    const knowledgePartitions = partitionKnowledgeDocuments(ragDocuments);
    const factKnowledgeDocuments = knowledgePartitions.facts;
    const procedureKnowledgeDocuments = knowledgePartitions.procedures;
    const knowledgeToolProcedures = formatKnowledgeToolProcedures(
        extractKnowledgeToolProcedures({
            documents: procedureKnowledgeDocuments,
            tools: runtimeToolCatalog,
            enabledToolNames,
        })
    );
    const promptKnowledgeDocuments = compactKnowledgeDocumentsForPrompt(factKnowledgeDocuments);
    const promptWorkflowKnowledgeDocuments = compactKnowledgeDocumentsForPrompt(procedureKnowledgeDocuments);
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
        plannedActions: workflowPlan.actions.map(resolveActionToolName),
        missingSlots: workflowPlan.missingSlots,
        enabledToolNames,
        hasCustomerIdentifier: Boolean(workflowPlan.slotExtraction.slots.customer_identifier),
        customerMessage: enrichedLastMessageContent || '',
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
                        deterministicPlannedTools: workflowPlan.actions.map(resolveActionToolName),
                        agentName: autopilotConfig.name,
                        agentKnowledgeBase: autopilotConfig.knowledge_base || '',
                        knowledgeDocuments: scopedStaticKnowledgeDocuments,
                        enabledToolNames,
                        contactSignals: buildIntentClassifierContactSignals(sanitizedContact),
                        recentToolResults: recentToolResults.map((result) => ({
                            toolName: result.toolName,
                            status: result.status,
                        })),
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
                    deterministicPlannedTools: workflowPlan.actions.map(resolveActionToolName),
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
                    appliedActions: workflowPlan.actions.map(resolveActionToolName),
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
    workflowPlan.actions = scopeSgpLookupActionsToFocusedContract(
        workflowPlan.actions,
        focusedContractContext,
        enrichedLastMessageContent || ''
    );
    workflowPlan.actions = scopeSgpLookupActionsToAddressedContract(
        workflowPlan.actions,
        recentToolResults,
        enrichedLastMessageContent || ''
    );
    const toolCoverage = analyzeAutopilotToolCoverage({
        graph: autopilotConfig.flow_graph,
        enabledToolNames: turnPolicy.globallyEnabledToolNames,
        toolCatalog: runtimeToolCatalog,
    });
    const initialTurnPlanAuthorization = authorizeAutopilotTurnPlanTools(
        turnPolicy,
        [],
        toolCoverage.safeFallbackToolNames,
    );
    const turnPlanEnabledToolNames = initialTurnPlanAuthorization.planningToolNames;
    const turnPlan = buildAutopilotTurnPlan({
        customerMessage: enrichedLastMessageContent || '',
        chatHistory: chatHistoryForAI,
        intentResolution,
        slotExtraction: workflowPlan.slotExtraction,
        enabledToolNames: turnPlanEnabledToolNames,
        allowedToolNames: turnPolicy.allowedToolNames,
        toolCatalog: runtimeToolCatalog,
        recentToolResults,
    });
    const turnPlanToolNames = [...new Set([
        ...turnPlan.requiredToolNames,
        ...turnPlan.preResponseActions.map(resolveActionToolName),
    ])].filter((toolName) => turnPlanEnabledToolNames.includes(toolName));
    const turnPlanAuthorization = authorizeAutopilotTurnPlanTools(
        turnPolicy,
        turnPlanToolNames,
        toolCoverage.safeFallbackToolNames,
    );
    const turnPlanMissingAllowedToolNames = turnPlanAuthorization.widenedToolNames;
    if (turnPlanMissingAllowedToolNames.length > 0) {
        turnPolicy.allowedToolNames = turnPlanAuthorization.allowedToolNames;
        turnPolicy.reason = `${turnPolicy.reason}+turn_plan_required_tools`;
    }
    if (turnPlan.responseOverride) {
        workflowPlan = {
            ...workflowPlan,
            executionMode: 'direct_response',
            response: turnPlan.responseOverride,
            actions: [],
            missingSlots: turnPlan.missingSlots,
            handledByWorkflow: true,
            reason: `Turn Plan: ${turnPlan.reasons.join(', ') || turnPlan.customerNeed}`,
            metadata: {
                ...workflowPlan.metadata,
                turnPlan,
            },
        };
    } else if (turnPlan.preResponseActions.length > 0) {
        workflowPlan = {
            ...workflowPlan,
            executionMode: 'pre_response_tools',
            actions: mergeAgentActions(turnPlan.preResponseActions, workflowPlan.actions),
            handledByWorkflow: true,
            reason: `Turn Plan: ${turnPlan.reasons.join(', ') || turnPlan.customerNeed}`,
            metadata: {
                ...workflowPlan.metadata,
                turnPlan,
            },
        };
    } else {
        workflowPlan = {
            ...workflowPlan,
            metadata: {
                ...workflowPlan.metadata,
                turnPlan,
            },
        };
    }
    await recordOrchestratorEvent({
        run: orchestratorRun,
        kind: 'turn_plan',
        status: turnPlan.responseOverride || turnPlan.preResponseActions.length > 0 ? 'success' : 'skipped',
        payload: {
            customerNeed: turnPlan.customerNeed,
            expectedNextAction: turnPlan.expectedNextAction,
            requiredToolNames: turnPlan.requiredToolNames,
            forbiddenToolNames: turnPlan.forbiddenToolNames,
            missingSlots: turnPlan.missingSlots,
            missingInputFields: turnPlan.missingInputFields,
            preResponseActions: turnPlan.preResponseActions.map(resolveActionToolName),
            widenedAllowedToolNames: turnPlanMissingAllowedToolNames,
            blockedToolNames: turnPlanAuthorization.blockedToolNames,
            toolCoverage: {
                status: toolCoverage.status,
                coverageRatio: toolCoverage.coverageRatio,
                safeFallbackToolNames: toolCoverage.safeFallbackToolNames,
                branchRequiredToolNames: toolCoverage.branchRequiredToolNames,
                unknownEnabledToolNames: toolCoverage.unknownEnabledToolNames,
            },
            reasons: turnPlan.reasons,
            metadata: turnPlan.metadata,
        },
    });
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
    const workflowAgentDecision = decideAgentNextAction({
        workspaceId,
        chatId: chat.id,
        messageId: sourceMessageId ?? null,
        runId: orchestratorRun.id,
        autopilotConfigId: autopilotConfig.id,
        stage: 'workflow_plan',
        intentResolution,
        workflowPlan: {
            executionMode: workflowPlan.executionMode,
            reason: workflowPlan.reason,
            handledByWorkflow: workflowPlan.handledByWorkflow,
            missingSlots: workflowPlan.missingSlots,
            actions: workflowPlan.actions,
            slotExtraction: workflowPlan.slotExtraction,
        },
        policyContext: {
            activeNodeId: turnPolicy.activeNodeId,
            allowedToolNames: turnPolicy.allowedToolNames,
            reason: turnPolicy.reason,
        },
        switchResolution,
        metadata: {
            prearmedTool: workflowPrearmSignal?.toolName ?? null,
            knowledgeCoverage,
            candidateTools: deterministicRouting.candidates.slice(0, 8).map((candidate) => ({
                tool: candidate.toolName,
                source: candidate.source,
                reason: candidate.reason,
                team: candidate.team.name,
            })),
        },
    });
    await recordAgentDecisionLedger(workflowAgentDecision.ledgerEntry);
    let workflowPlannedActions: AgentToolAction[] = workflowPlan.executionMode === 'continue_llm'
        ? []
        : workflowPlan.actions;
    const activePEC = await getActiveProcedureExecution(chat.id);
    const shouldPrioritizeTurnPlan = shouldPrioritizeAutopilotTurnPlan(turnPlan);
    const entryFlowMessageNode = resolveEntryDeterministicFlowMessage(autopilotConfig);
    const shouldSendEntryFlowMessage = entryFlowMessageNode && !shouldPrioritizeTurnPlan
        ? !activePEC && !(await hasSentFlowNodeMessage({
            configId: autopilotConfig.id,
            chatId: chat.id,
            nodeId: entryFlowMessageNode.nodeId,
        }))
        : false;
    const deterministicFlowMessageNode = shouldPrioritizeTurnPlan
        ? null
        : shouldSendEntryFlowMessage
            ? entryFlowMessageNode
            : activePEC
                ? null
                : resolveDeterministicFlowMessage(autopilotConfig, activeFlowIntentScope);
    const deterministicFlowMessage = deterministicFlowMessageNode
        ? renderDeterministicFlowMessage(autopilotConfig, deterministicFlowMessageNode.message, {
            customerMessage: enrichedLastMessageContent || '',
            contactName: sanitizedContact.name,
        })
        : null;
    const flowFormGuidance = resolveFlowFormGuidance(autopilotConfig, activeFlowIntentScope);
    const flowFormGuidanceForPrompt = formatFlowFormGuidanceForPrompt(flowFormGuidance);
    const flowReferencesForPrompt = formatFlowReferencesForPrompt(autopilotConfig, activeRules);
    const flowSwitchGuidanceForPrompt = formatFlowSwitchGuidanceForPrompt(autopilotConfig);
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
        flowReferencesForPrompt,
        flowSwitchGuidanceForPrompt,
        flowFormGuidanceForPrompt,
    ].join('\n');

    if (deterministicFlowMessage) {
        if (currentCopilotMode === 'suggest') {
            const { getSupabaseAdmin } = await import('@/lib/supabase');
            const supabase = getSupabaseAdmin();
            await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                    suggestion: deterministicFlowMessage,
                    chatId: chat.id,
                    configName: autopilotConfig.name,
            });
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: 'flow-message',
                customerMessage: enrichedLastMessageContent || '',
                response: deterministicFlowMessage,
                status: 'suggested',
                triggeredRule: null,
                metadata: {
                    deterministicFlowMessage: true,
                    flowNodeId: deterministicFlowMessageNode?.nodeId,
                    flowSubAgent: activeFlowIntentScope?.title,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                    workflowId: intentResolution.workflowId,
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
                    deterministicFlowMessage: true,
                    flowNodeId: deterministicFlowMessageNode?.nodeId,
                    flowSubAgent: activeFlowIntentScope?.title,
                },
            });
            return;
        }

        const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
            chatId: chat.id,
            sourceMessageId: sourceMessageId ?? null,
        });
        if (!sourceMessageStillCurrent) {
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'skipped',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceScore: intentResolution.confidence,
                metadata: {
                    responseSent: false,
                    staleSourceMessage: true,
                    deterministicFlowMessage: true,
                    flowNodeId: deterministicFlowMessageNode?.nodeId,
                },
            });
            return;
        }

        const sendStage = await timeOrchestratorStage(
            orchestratorRun,
            'message_send',
            () => sendMultiBlockResponse(
                chat.id,
                deterministicFlowMessage,
                assignedSystemAgentId,
                true,
                instanceName,
                null,
                responseTrace
            ),
            { responseLength: deterministicFlowMessage.length, deterministicFlowMessage: true }
        );
        orchestratorTimings.send_ms = sendStage.durationMs;
        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'flow-message',
            customerMessage: enrichedLastMessageContent || '',
            response: deterministicFlowMessage,
            status: 'sent',
            triggeredRule: null,
            metadata: {
                deterministicFlowMessage: true,
                flowNodeId: deterministicFlowMessageNode?.nodeId,
                flowSubAgent: activeFlowIntentScope?.title,
                intent: intentResolution.intent,
                confidence: intentResolution.confidence,
                workflowId: intentResolution.workflowId,
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
                deterministicFlowMessage: true,
                flowNodeId: deterministicFlowMessageNode?.nodeId,
                flowSubAgent: activeFlowIntentScope?.title,
            },
        });
        return;
    }

    // Pre-load active procedure and compiled procedures early to be used by tool memory and lookup bypasses.
    const compiledProcedures = compileRuntimeProcedures({
        config: autopilotConfig,
        documents: scopedStaticKnowledgeDocuments,
        tools: runtimeToolCatalog,
        enabledToolNames,
    });
    const hasMatchingProcedure = compiledProcedures.length > 0 && matchProcedure({
        intent: intentResolution.intent,
        customerMessage: enrichedLastMessageContent || '',
        compiledProcedures,
    }) !== null;

    const isTroubleshootingOrSupport =
        intentResolution.intent === 'troubleshooting' ||
        intentResolution.intent === 'support_request';

    const shouldBypassToolMemoryResponse =
        isTroubleshootingOrSupport || activePEC !== null || hasMatchingProcedure;

    const recentToolMemoryResponse = shouldAnswerFromRecentToolMemory({
        customerMessage: enrichedLastMessageContent || '',
        intent: intentResolution.intent,
        recentToolResults,
    })
        ? buildSgpResponseFromToolResults(recentToolResults, focusedOperationalContext)
        : null;

    if (recentToolMemoryResponse && !shouldBypassToolMemoryResponse) {
        let finalResponse = formatCustomerFacingAiResponse(recentToolMemoryResponse);
        const responseValidator = validateAutopilotResponse({
            response: finalResponse,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            customerMessage: enrichedLastMessageContent || '',
            chatHistory: chatHistoryForAI,
            continuationRequiredSlots: workflowPlan.missingSlots,
            completionActions: flowCompletionPlan?.actions,
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            plannedActions: [],
            toolResults: recentToolResults,
            enabledToolNames,
            availableTeams,
            contact: sanitizedContact,
            knowledgeCoverage,
            source: 'workflow_tools',
            systemAgentName: assignedSystemAgentName,
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
            await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                    suggestion: finalResponse,
                    chatId: chat.id,
                    configName: autopilotConfig.name,
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
                instanceName,
                null,
                responseTrace
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
        if (
            currentCopilotMode === 'auto'
            && turnPlan.expectedNextAction === 'require_confirmation'
            && turnPlan.confirmationAction
        ) {
            try {
                await setPendingToolConfirmation({
                    chatId: chat.id,
                    workspaceId,
                    autopilotConfigId: autopilotConfig.id,
                    activeNodeId: turnPolicy.activeNodeId,
                    action: turnPlan.confirmationAction,
                });
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'pending_confirmation_staged',
                    status: 'success',
                    payload: {
                        toolName: resolveActionToolName(turnPlan.confirmationAction),
                        source: 'turn_plan',
                    },
                });
            } catch (error) {
                console.error('[AUTOPILOT_TURN_PLAN] Failed to persist pending confirmation:', error);
                finalResponse = 'Nao consegui preparar esta acao com seguranca agora. Nenhuma alteracao foi executada.';
            }
        }

        if (currentCopilotMode === 'suggest') {
            const { getSupabaseAdmin } = await import('@/lib/supabase');
            const supabase = getSupabaseAdmin();
            await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                    suggestion: finalResponse,
                    chatId: chat.id,
                    configName: autopilotConfig.name,
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
            chatHistory: chatHistoryForAI,
            continuationRequiredSlots: workflowPlan.missingSlots,
            completionActions: flowCompletionPlan?.actions,
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            plannedActions: workflowPlan.actions,
            toolResults: [],
            enabledToolNames,
            availableTeams,
            contact: sanitizedContact,
            knowledgeCoverage,
            source: 'workflow_direct',
            systemAgentName: assignedSystemAgentName,
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
                instanceName,
                null,
                responseTrace
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
                    turnPolicy,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: validatedWorkflowActions,
                    orchestratorRunId: orchestratorRun.id,
                    sourceMessageId,
                }),
                {
                    requestedActions: validatedWorkflowActions.map((action) => action.type),
                    workflowEngine: true,
                    afterResponse: true,
                }
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
            toolResults = toolsStage.value;
            await sendToolFailureFollowUp({
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                instanceName,
                toolResults,
                previousResponse: finalResponse,
                responseTrace,
            });
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

    // Check if we should run read-only SGP lookups in pass-through mode
    // to avoid the static template response loop on troubleshooting / support intents and procedures.
    const isReadOnlySgpLookupOnly =
        workflowPlan.actions.length > 0 &&
        workflowPlan.actions.every(
            (action) =>
                action.type === 'sgp_fetch_contact_panel_data' ||
                action.type === 'sgp_fetch_contracts'
        );

    const shouldPassThroughReadOnlySgpLookup =
        workflowPlan.executionMode === 'pre_response_tools' &&
        isReadOnlySgpLookupOnly &&
        (activePEC !== null || hasMatchingProcedure || isTroubleshootingOrSupport);

    let passThroughToolResults: AgentToolExecutionResult[] = [];
    if (shouldPassThroughReadOnlySgpLookup) {
        console.log(`[PROCEDURE_BYPASS] Running SGP lookup in pass-through mode to avoid static response loop for chat=${chat.id}`);
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
                turnPolicy,
                customerMessage: enrichedLastMessageContent || '',
                actions: workflowPlan.actions,
                orchestratorRunId: orchestratorRun.id,
                sourceMessageId,
            }),
            {
                requestedActions: workflowPlan.actions.map((action) => action.type),
                workflowEngine: true,
                beforeResponse: true,
            }
        );
        orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
        passThroughToolResults = toolsStage.value;
        const postToolTurnPlan = buildAutopilotTurnPlan({
            customerMessage: enrichedLastMessageContent || '',
            chatHistory: chatHistoryForAI,
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            enabledToolNames: turnPlanEnabledToolNames,
            allowedToolNames: turnPolicy.allowedToolNames,
            toolCatalog: runtimeToolCatalog,
            recentToolResults: [...recentToolResults, ...passThroughToolResults],
        });
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'turn_plan_post_tool',
            status: isTerminalAutopilotTurnPlan(postToolTurnPlan)
                ? 'success'
                : postToolTurnPlan.preResponseActions.length > 0
                    ? 'success'
                    : 'skipped',
            payload: {
                customerNeed: postToolTurnPlan.customerNeed,
                expectedNextAction: postToolTurnPlan.expectedNextAction,
                requiredToolNames: postToolTurnPlan.requiredToolNames,
                forbiddenToolNames: postToolTurnPlan.forbiddenToolNames,
                preResponseActions: postToolTurnPlan.preResponseActions.map(resolveActionToolName),
                terminal: isTerminalAutopilotTurnPlan(postToolTurnPlan),
                reasons: postToolTurnPlan.reasons,
            },
        });

        if (isTerminalAutopilotTurnPlan(postToolTurnPlan) && postToolTurnPlan.responseOverride) {
            let finalResponse = formatCustomerFacingAiResponse(postToolTurnPlan.responseOverride);
            if (
                currentCopilotMode === 'auto'
                && postToolTurnPlan.expectedNextAction === 'require_confirmation'
                && postToolTurnPlan.confirmationAction
            ) {
                try {
                    await setPendingToolConfirmation({
                        chatId: chat.id,
                        workspaceId,
                        autopilotConfigId: autopilotConfig.id,
                        activeNodeId: turnPolicy.activeNodeId,
                        action: postToolTurnPlan.confirmationAction,
                    });
                    await recordOrchestratorEvent({
                        run: orchestratorRun,
                        kind: 'pending_confirmation_staged',
                        status: 'success',
                        payload: {
                            toolName: resolveActionToolName(postToolTurnPlan.confirmationAction),
                            source: 'turn_plan_post_tool',
                        },
                    });
                } catch (error) {
                    console.error('[AUTOPILOT_TURN_PLAN] Failed to persist post-tool confirmation:', error);
                    finalResponse = 'Nao consegui preparar esta acao com seguranca agora. Nenhuma alteracao foi executada.';
                }
            }

            if (currentCopilotMode === 'suggest') {
                const { getSupabaseAdmin } = await import('@/lib/supabase');
                const supabase = getSupabaseAdmin();
                await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                    suggestion: finalResponse,
                    chatId: chat.id,
                    configName: autopilotConfig.name,
                });
            } else {
                const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
                    chatId: chat.id,
                    sourceMessageId: sourceMessageId ?? null,
                });
                if (!sourceMessageStillCurrent) {
                    await finishOrchestratorRun({
                        run: orchestratorRun,
                        status: 'skipped',
                        timings: orchestratorTimings,
                        intent: intentResolution.intent,
                        confidenceScore: intentResolution.confidence,
                        metadata: {
                            responseSent: false,
                            staleSourceMessage: true,
                            terminalPostToolTurnPlan: true,
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
                        instanceName,
                        null,
                        responseTrace,
                    ),
                    {
                        responseLength: finalResponse.length,
                        terminalPostToolTurnPlan: true,
                    },
                );
                orchestratorTimings.send_ms = sendStage.durationMs;
            }

            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'turn_plan_post_tool_terminal',
                status: 'success',
                payload: {
                    customerNeed: postToolTurnPlan.customerNeed,
                    expectedNextAction: postToolTurnPlan.expectedNextAction,
                    reasons: postToolTurnPlan.reasons,
                    procedureRuntimeSuppressed: true,
                    toolCount: passThroughToolResults.length,
                },
            });
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: 'turn-plan',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: currentCopilotMode === 'suggest' ? 'suggested' : 'sent',
                triggeredRule: null,
                metadata: {
                    terminalPostToolTurnPlan: true,
                    procedureRuntimeSuppressed: true,
                    customerNeed: postToolTurnPlan.customerNeed,
                    expectedNextAction: postToolTurnPlan.expectedNextAction,
                    reasons: postToolTurnPlan.reasons,
                    resultToolNames: passThroughToolResults.map((result) => result.toolName),
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
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
                    responseSent: currentCopilotMode !== 'suggest',
                    suggestionOnly: currentCopilotMode === 'suggest',
                    terminalPostToolTurnPlan: true,
                    procedureRuntimeSuppressed: true,
                    customerNeed: postToolTurnPlan.customerNeed,
                    toolCount: passThroughToolResults.length,
                },
            });
            return;
        }

        const effectiveTurnPlan = postToolTurnPlan;
        const turnPlanFollowUpActions = buildAutopilotTurnPlanFollowUpActions({
            turnPlan: effectiveTurnPlan,
            customerMessage: enrichedLastMessageContent || '',
            enabledToolNames: turnPlanEnabledToolNames,
            allowedToolNames: turnPolicy.allowedToolNames,
            toolCatalog: runtimeToolCatalog,
            toolResults: passThroughToolResults,
        });
        if (turnPlanFollowUpActions.length > 0) {
            const followUpStage = await timeOrchestratorStage(
                orchestratorRun,
                'tool_execution',
                () => runRequestedAgentToolsWithStatus({
                    workspaceId,
                    chat,
                    contact: sanitizedContact,
                    systemAgentId: assignedSystemAgentId,
                    systemAgentName: assignedSystemAgentName,
                    autopilotConfig,
                    turnPolicy,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: turnPlanFollowUpActions,
                    orchestratorRunId: orchestratorRun.id,
                    sourceMessageId,
                }),
                {
                    requestedActions: turnPlanFollowUpActions.map(resolveActionToolName),
                    turnPlanFollowUp: true,
                    beforeResponse: true,
                }
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + followUpStage.durationMs;
            passThroughToolResults = [...passThroughToolResults, ...followUpStage.value];
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'turn_plan_follow_up',
                status: followUpStage.value.some((result) => result.status === 'success') ? 'success' : 'fallback',
                durationMs: followUpStage.durationMs,
                payload: {
                    requestedActions: turnPlanFollowUpActions.map(resolveActionToolName),
                    resultToolNames: followUpStage.value.map((result) => result.toolName),
                },
            });
        }
        const turnPlanRecoveryActions = buildAutopilotTurnPlanRecoveryActions({
            turnPlan: effectiveTurnPlan,
            customerMessage: enrichedLastMessageContent || '',
            enabledToolNames,
            allowedToolNames: turnPolicy.allowedToolNames,
            toolCatalog: runtimeToolCatalog,
            toolResults: passThroughToolResults,
        });
        if (turnPlanRecoveryActions.length > 0) {
            const recoveryToolNames = turnPlanRecoveryActions.map(resolveActionToolName);
            const recoveryAuthorization = authorizeAutopilotTurnPlanTools(
                turnPolicy,
                recoveryToolNames,
                toolCoverage.safeFallbackToolNames,
            );
            if (recoveryAuthorization.widenedToolNames.length > 0) {
                turnPolicy.allowedToolNames = recoveryAuthorization.allowedToolNames;
                turnPolicy.reason = `${turnPolicy.reason}+turn_plan_recovery_tools`;
            }
            const recoveryStage = await timeOrchestratorStage(
                orchestratorRun,
                'tool_execution',
                () => runRequestedAgentToolsWithStatus({
                    workspaceId,
                    chat,
                    contact: sanitizedContact,
                    systemAgentId: assignedSystemAgentId,
                    systemAgentName: assignedSystemAgentName,
                    autopilotConfig,
                    turnPolicy,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: turnPlanRecoveryActions,
                    orchestratorRunId: orchestratorRun.id,
                    sourceMessageId,
                }),
                {
                    requestedActions: recoveryToolNames,
                    turnPlanRecovery: true,
                    beforeResponse: true,
                },
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + recoveryStage.durationMs;
            passThroughToolResults = [...passThroughToolResults, ...recoveryStage.value];
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'turn_plan_tool_recovery',
                status: recoveryStage.value.some((result) => result.status === 'success') ? 'success' : 'fallback',
                durationMs: recoveryStage.durationMs,
                payload: {
                    requestedActions: recoveryToolNames,
                    resultToolNames: recoveryStage.value.map((result) => result.toolName),
                    reason: 'live_wifi_scan_failed_use_read_only_cache',
                },
            });
        }
        recentToolResults = [...recentToolResults, ...passThroughToolResults];
        if (
            currentCopilotMode === 'auto' &&
            hasRequiredAutopilotTurnPlanFailure(effectiveTurnPlan, passThroughToolResults)
        ) {
            const sourceMessageStillCurrent = await isAutopilotSourceMessageStillCurrent({
                chatId: chat.id,
                sourceMessageId: sourceMessageId ?? null,
            });
            if (!sourceMessageStillCurrent) {
                await finishOrchestratorRun({
                    run: orchestratorRun,
                    status: 'skipped',
                    timings: orchestratorTimings,
                    intent: intentResolution.intent,
                    confidenceScore: intentResolution.confidence,
                    metadata: {
                        responseSent: false,
                        staleSourceMessage: true,
                        requiredTurnPlanToolFailure: true,
                    },
                });
                return;
            }

            const failureStage = await timeOrchestratorStage(
                orchestratorRun,
                'message_send',
                () => sendToolFailureFollowUp({
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    instanceName,
                    toolResults: passThroughToolResults,
                    responseTrace,
                    deliveryKey: 'primary',
                }),
                {
                    requiredTurnPlanToolFailure: true,
                    failedToolNames: passThroughToolResults
                        .filter((result) => result.status !== 'success')
                        .map((result) => result.toolName),
                },
            );
            orchestratorTimings.send_ms = failureStage.durationMs;
            const finalResponse = failureStage.value
                || 'Nao consegui concluir a consulta automatica agora. Nossa equipe vai acompanhar por aqui.';
            const failedToolNames = passThroughToolResults
                .filter((result) => result.status !== 'success')
                .map((result) => result.toolName);
            const handoffTriggered = await handoffAutopilotFailureToHuman({
                workspaceId,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                sourceMessageId,
                failedToolNames,
                reason: 'required_tool_failure',
            });
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'required_tool_failure_terminal',
                status: 'fallback',
                payload: {
                    requiredToolNames: effectiveTurnPlan.requiredToolNames,
                    failedToolNames,
                    handoffTriggered,
                },
            });
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: 'turn-plan',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: 'sent',
                triggeredRule: null,
                metadata: {
                    requiredTurnPlanToolFailure: true,
                    handoffTriggered,
                    turnPlan: effectiveTurnPlan,
                    toolResults: passThroughToolResults,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'fallback',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceLevel: 'low',
                confidenceScore: intentResolution.confidence,
                metadata: {
                    responseSent: true,
                    requiredTurnPlanToolFailure: true,
                    handoffTriggered,
                    toolCount: passThroughToolResults.length,
                    failedToolNames,
                },
            });
            return;
        }
        const completedTurnPlanResponse = hasSatisfiedAutopilotTurnPlan(
            effectiveTurnPlan,
            passThroughToolResults,
        )
            ? buildAutopilotTurnPlanCustomerResponse({
                turnPlan: effectiveTurnPlan,
                toolResults: passThroughToolResults,
            })
            : null;
        if (completedTurnPlanResponse) {
            let finalResponse = formatCustomerFacingAiResponse(completedTurnPlanResponse);
            const completedToolActions = passThroughToolResults.map((result) => result.input);
            const responseValidator = validateAutopilotResponse({
                response: finalResponse,
                fallbackReply: autopilotConfig.default_fallback_reply || '',
                customerMessage: enrichedLastMessageContent || '',
                chatHistory: chatHistoryForAI,
                continuationRequiredSlots: [],
                intentResolution,
                slotExtraction: workflowPlan.slotExtraction,
                plannedActions: completedToolActions,
                toolResults: passThroughToolResults,
                enabledToolNames,
                availableTeams,
                contact: sanitizedContact,
                knowledgeCoverage,
                source: 'workflow_tools',
                systemAgentName: assignedSystemAgentName,
            });
            if (responseValidator.decision !== 'approve') {
                finalResponse = formatCustomerFacingAiResponse(responseValidator.response);
            }

            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'turn_plan_completion',
                status: 'success',
                payload: {
                    customerNeed: effectiveTurnPlan.customerNeed,
                    expectedNextAction: 'respond_from_tool_result',
                    requiredToolNames: effectiveTurnPlan.requiredToolNames,
                    resultToolNames: passThroughToolResults.map((result) => result.toolName),
                    responseValidator: responseValidator.metadata,
                    suppressedValidatorActions: responseValidator.actions.map(resolveActionToolName),
                },
            });

            const sendStage = await timeOrchestratorStage(
                orchestratorRun,
                'message_send',
                () => sendMultiBlockResponse(
                    chat.id,
                    finalResponse,
                    assignedSystemAgentId,
                    true,
                    instanceName,
                    null,
                    responseTrace,
                ),
                {
                    responseLength: finalResponse.length,
                    completedTurnPlan: true,
                    customerNeed: effectiveTurnPlan.customerNeed,
                },
            );
            orchestratorTimings.send_ms = sendStage.durationMs;

            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: 'turn-plan',
                customerMessage: enrichedLastMessageContent || '',
                response: finalResponse,
                status: 'sent',
                triggeredRule: null,
                metadata: {
                    completedTurnPlan: true,
                    turnPlan: effectiveTurnPlan,
                    toolResults: passThroughToolResults,
                    responseValidator: responseValidator.metadata,
                    suppressedValidatorActions: responseValidator.actions.map(resolveActionToolName),
                    intent: intentResolution.intent,
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
                    completedTurnPlan: true,
                    customerNeed: effectiveTurnPlan.customerNeed,
                    toolCount: passThroughToolResults.length,
                    requiredToolNames: effectiveTurnPlan.requiredToolNames,
                    toolResults: passThroughToolResults,
                    responseValidator: responseValidator.metadata,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            return;
        }
        const passThroughContinuationContext = buildToolContinuationContext(passThroughToolResults);
        if (passThroughContinuationContext) {
            relevantHistory = [
                relevantHistory,
                passThroughContinuationContext,
            ].filter(Boolean).join('\n\n');
        }

        // Prevent the static pre_response_tools return by switching to continue_llm
        workflowPlan.executionMode = 'continue_llm';
        workflowPlan.actions = [];
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
                turnPolicy,
                customerMessage: enrichedLastMessageContent || '',
                actions: workflowPlan.actions,
                orchestratorRunId: orchestratorRun.id,
                sourceMessageId,
            }),
            {
                requestedActions: workflowPlan.actions.map((action) => action.type),
                workflowEngine: true,
                beforeResponse: true,
            }
        );
        orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
        let toolResults = toolsStage.value;
        const turnPlanFollowUpActions = buildAutopilotTurnPlanFollowUpActions({
            turnPlan,
            customerMessage: enrichedLastMessageContent || '',
            enabledToolNames: turnPlanEnabledToolNames,
            allowedToolNames: turnPolicy.allowedToolNames,
            toolCatalog: runtimeToolCatalog,
            toolResults,
        });
        if (turnPlanFollowUpActions.length > 0) {
            const followUpStage = await timeOrchestratorStage(
                orchestratorRun,
                'tool_execution',
                () => runRequestedAgentToolsWithStatus({
                    workspaceId,
                    chat,
                    contact: sanitizedContact,
                    systemAgentId: assignedSystemAgentId,
                    systemAgentName: assignedSystemAgentName,
                    autopilotConfig,
                    turnPolicy,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: turnPlanFollowUpActions,
                    orchestratorRunId: orchestratorRun.id,
                    sourceMessageId,
                }),
                {
                    requestedActions: turnPlanFollowUpActions.map(resolveActionToolName),
                    turnPlanFollowUp: true,
                    beforeResponse: true,
                }
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + followUpStage.durationMs;
            toolResults = [...toolResults, ...followUpStage.value];
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'turn_plan_follow_up',
                status: followUpStage.value.some((result) => result.status === 'success') ? 'success' : 'fallback',
                durationMs: followUpStage.durationMs,
                payload: {
                    requestedActions: turnPlanFollowUpActions.map(resolveActionToolName),
                    resultToolNames: followUpStage.value.map((result) => result.toolName),
                },
            });
        }
        const turnPlanRecoveryActions = buildAutopilotTurnPlanRecoveryActions({
            turnPlan,
            customerMessage: enrichedLastMessageContent || '',
            enabledToolNames,
            allowedToolNames: turnPolicy.allowedToolNames,
            toolCatalog: runtimeToolCatalog,
            toolResults: [...recentToolResults, ...toolResults],
        });
        if (turnPlanRecoveryActions.length > 0) {
            const recoveryToolNames = turnPlanRecoveryActions.map(resolveActionToolName);
            const recoveryAuthorization = authorizeAutopilotTurnPlanTools(
                turnPolicy,
                recoveryToolNames,
                toolCoverage.safeFallbackToolNames,
            );
            if (recoveryAuthorization.widenedToolNames.length > 0) {
                turnPolicy.allowedToolNames = recoveryAuthorization.allowedToolNames;
                turnPolicy.reason = `${turnPolicy.reason}+turn_plan_recovery_tools`;
            }
            const recoveryStage = await timeOrchestratorStage(
                orchestratorRun,
                'tool_execution',
                () => runRequestedAgentToolsWithStatus({
                    workspaceId,
                    chat,
                    contact: sanitizedContact,
                    systemAgentId: assignedSystemAgentId,
                    systemAgentName: assignedSystemAgentName,
                    autopilotConfig,
                    turnPolicy,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: turnPlanRecoveryActions,
                    orchestratorRunId: orchestratorRun.id,
                    sourceMessageId,
                }),
                {
                    requestedActions: recoveryToolNames,
                    turnPlanRecovery: true,
                    beforeResponse: true,
                },
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + recoveryStage.durationMs;
            toolResults = [...toolResults, ...recoveryStage.value];
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'turn_plan_tool_recovery',
                status: recoveryStage.value.some((result) => result.status === 'success') ? 'success' : 'fallback',
                durationMs: recoveryStage.durationMs,
                payload: {
                    requestedActions: recoveryToolNames,
                    resultToolNames: recoveryStage.value.map((result) => result.toolName),
                    reason: 'live_wifi_scan_failed_use_read_only_cache',
                },
            });
        }
        const turnPlanResponse = buildAutopilotTurnPlanCustomerResponse({
            turnPlan,
            toolResults,
        });
        const mcpResponse = buildMcpCustomerResponseFromToolResults(toolResults) ||
            buildMcpResponseFromToolResults(toolResults);
        const sgpResponse = buildSgpResponseFromToolResults(
            toolResults,
            focusedOperationalContext
        );
        const toolFailureResponse = buildToolFailureResponse(
            toolResults,
            'Vou consultar o sistema para verificar status, cadastro, fatura ou contrato.'
        );
        let finalResponse = formatCustomerFacingAiResponse(
            turnPlanResponse ||
            mcpResponse ||
            sgpResponse ||
            toolFailureResponse ||
            autopilotConfig.default_fallback_reply?.trim() ||
            'Nao consegui concluir a consulta automatica agora. Nossa equipe vai acompanhar por aqui.'
        );
        const responseValidator = validateAutopilotResponse({
            response: finalResponse,
            fallbackReply: autopilotConfig.default_fallback_reply || '',
            customerMessage: enrichedLastMessageContent || '',
            chatHistory: chatHistoryForAI,
            continuationRequiredSlots: workflowPlan.missingSlots,
            completionActions: flowCompletionPlan?.actions,
            intentResolution,
            slotExtraction: workflowPlan.slotExtraction,
            plannedActions: workflowPlan.actions,
            toolResults,
            enabledToolNames,
            availableTeams,
            contact: sanitizedContact,
            knowledgeCoverage,
            source: 'workflow_tools',
            systemAgentName: assignedSystemAgentName,
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
                instanceName,
                null,
                responseTrace
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
                    turnPolicy,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: responseValidator.actions,
                    orchestratorRunId: orchestratorRun.id,
                    sourceMessageId,
                }),
                {
                    requestedActions: responseValidator.actions.map((action) => action.type),
                    responseValidator: true,
                    afterResponse: true,
                }
            );
            orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + validatorToolsStage.durationMs;
            toolResults = [...toolResults, ...validatorToolsStage.value];
            await sendToolFailureFollowUp({
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                instanceName,
                toolResults: validatorToolsStage.value,
                previousResponse: finalResponse,
                responseTrace,
            });
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
        // 1. Re-use preloaded active procedure
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

        const procedureKnowledgeResolver: ProcedureKnowledgeResolver = async ({ step, context, query, requiredCoverage }) => {
            const retrieval = await retrieveHybridSupportContext({
                workspaceId,
                autopilotConfigId: autopilotConfig.id,
                query: query || enrichedLastMessageContent || context.procedureName,
                excludeChatId: chat.id,
                staticDocuments: scopedStaticKnowledgeDocuments,
                intent: intentResolution,
                allowedDocumentIds,
            });
            const selectedById = new Map(retrieval.selected.map((item) => [item.id, item]));
            const chunks = retrieval.knowledgeBaseDocuments.map((document) => {
                const selected = selectedById.get(document.id);
                const rawDocument = document as KnowledgeBaseDocument & Record<string, unknown>;
                const content = String(document.content || rawDocument.canonicalAnswer || rawDocument.summary || '').trim();
                return {
                    documentId: document.id,
                    chunkId: String(rawDocument.chunkId || rawDocument.chunkIndex || document.id),
                    title: document.name || 'Base de conhecimento',
                    category: selected?.category || String(rawDocument.category || 'uncategorized'),
                    score: selected?.score || 0,
                    excerpt: content.length > 900 ? `${content.slice(0, 899).trim()}...` : content,
                    source: selected?.source || String(rawDocument.source || 'static'),
                    coverage: retrieval.knowledgeCoverage,
                };
            }).filter((chunk) => chunk.excerpt);

            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'procedure_knowledge_retrieval',
                status: retrieval.knowledgeCoverage === 'none' || retrieval.knowledgeCoverage === 'low' ? 'fallback' : 'success',
                payload: {
                    procedureId: context.procedureId,
                    stepId: step.id,
                    query,
                    requiredCoverage,
                    strategy: retrieval.strategy,
                    knowledgeCoverage: retrieval.knowledgeCoverage,
                    selected: retrieval.selected,
                    chunkCount: chunks.length,
                },
            });

            return {
                coverage: retrieval.knowledgeCoverage,
                chunks,
                strategy: retrieval.strategy,
                reason: retrieval.fallbackReason || retrieval.error || undefined,
            };
        };

        let procedureRuntimeSource: 'active' | 'matched' | null = null;
        let procedureRuntimeMatch: { score: number; matchReason: string } | null = null;

        if (activePEC) {
            // Resume the active procedure
            const compiledProcedures = compileRuntimeProcedures({
                config: autopilotConfig,
                documents: scopedStaticKnowledgeDocuments,
                tools: runtimeToolCatalog,
                enabledToolNames,
            });
            const graph = compiledProcedures.find((g) => g.id === activePEC.procedureId);
            if (graph) {
                procedureRuntimeSource = 'active';
                procedureGraph = graph;
                procedureContext = activePEC;
                procedureResult = await advanceProcedure({
                    graph,
                    context: activePEC,
                    customerMessage: enrichedLastMessageContent || '',
                    availableTeams: availableTeams.map((t) => ({ id: t.id, name: t.name })),
                    decisionResolver: procedureDecisionResolver,
                    responseResolver: procedureResponseResolver,
                    knowledgeResolver: procedureKnowledgeResolver,
                    forceLlmRespond: isLmStudioModel(resolvedAiModel.model),
                });
            }
        }

        if (!procedureResult) {
            // 2. Try to match a new procedure
            const compiledProcedures = compileRuntimeProcedures({
                config: autopilotConfig,
                documents: scopedStaticKnowledgeDocuments,
                tools: runtimeToolCatalog,
                enabledToolNames,
            });

            if (compiledProcedures.length > 0) {
                const match = matchProcedure({
                    intent: intentResolution.intent,
                    customerMessage: enrichedLastMessageContent || '',
                    compiledProcedures,
                });

                if (match) {
                    procedureRuntimeSource = 'matched';
                    procedureRuntimeMatch = {
                        score: match.score,
                        matchReason: match.matchReason,
                    };
                    console.log(
                        `[PROCEDURE_RUNTIME] Starting procedure "${match.graph.documentName}" ` +
                        `(score=${match.score}, reason=${match.matchReason}) for chat=${chat.id}`,
                    );
                    const firstStep = match.graph.steps[0];
                    if (firstStep) {
                        const initialSlots: Record<string, string> = {};
                        for (const detail of workflowPlan.slotExtraction?.details || []) {
                            if (
                                (detail.source === 'message' || detail.source === 'contact') &&
                                detail.value
                            ) {
                                initialSlots[detail.name] = String(detail.value);
                            }
                        }

                        const newPEC = await createProcedureExecution({
                            chatId: chat.id,
                            workspaceId: workspaceId,
                            systemAgentId: assignedSystemAgentId,
                            procedureId: match.graph.id,
                            procedureName: match.graph.documentName,
                            currentStepId: firstStep.id,
                            status: 'running',
                            collectedSlots: initialSlots,
                            graph: match.graph,
                            goal: intentResolution.intent,
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
                                knowledgeResolver: procedureKnowledgeResolver,
                                forceLlmRespond: isLmStudioModel(resolvedAiModel.model),
                                priorToolResults: passThroughToolResults,
                            });
                        }
                    }
                }
            }
        }

        // Process PRE result
        if (procedureResult && procedureResult.handled) {
            const currentProcedureStep = procedureGraph?.steps.find((step) => step.id === procedureContext?.currentStepId) || null;
            const procedureActionsForLedger = normalizeAgentActions(procedureResult.actions.map((action) => ({
                type: action.type as any,
                reason: action.reason,
                payload: action.payload,
            })));
            const procedureMissingSlots = procedureResult.status === 'waiting_input'
                ? (currentProcedureStep?.requiredSlots || [])
                : [];
            const procedureExecutionMode = procedureActionsForLedger.length > 0
                ? 'pre_response_tools'
                : procedureResult.response
                    ? 'direct_response'
                    : 'continue_llm';
            const procedureAgentDecision = decideAgentNextAction({
                workspaceId,
                chatId: chat.id,
                messageId: sourceMessageId ?? null,
                runId: orchestratorRun.id,
                autopilotConfigId: autopilotConfig.id,
                stage: 'procedure_runtime',
                intentResolution,
                workflowPlan: {
                    executionMode: procedureExecutionMode,
                    reason: procedureResult.completionReason
                        || `Procedure runtime ${procedureRuntimeSource || 'unknown'} advanced with status ${procedureResult.status}.`,
                    handledByWorkflow: true,
                    actions: procedureActionsForLedger,
                    missingSlots: procedureMissingSlots,
                    slotExtraction: workflowPlan.slotExtraction,
                },
                procedure: procedureContext ? {
                    activeProcedureId: procedureContext.id,
                    procedureId: procedureContext.procedureId,
                    procedureName: procedureContext.procedureName,
                    currentStepId: procedureContext.currentStepId,
                    matchScore: procedureRuntimeMatch?.score ?? null,
                    matchReason: procedureRuntimeMatch?.matchReason
                        || (procedureRuntimeSource === 'active' ? 'Retomou procedimento ativo.' : null),
                    status: procedureResult.status,
                } : null,
                policyContext: {
                    procedureHandled: procedureResult.handled,
                    procedureRuntimeSource,
                    procedureStatus: procedureResult.status,
                    executedSteps: procedureResult.executedSteps,
                    actionCount: procedureResult.actions.length,
                    hasResponse: Boolean(procedureResult.response),
                    completionReason: procedureResult.completionReason || null,
                },
                metadata: {
                    procedureRuntime: true,
                    procedureRuntimeSource,
                    procedureGraphId: procedureGraph?.id || null,
                    procedureStepLabel: currentProcedureStep?.label || null,
                    procedureActions: procedureActionsForLedger.map(resolveActionToolName),
                },
            });
            await recordAgentDecisionLedger(procedureAgentDecision.ledgerEntry);

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
            const procedureToolResults: AgentToolExecutionResult[] = [];
            while (
                procedureResult.actions.length > 0 &&
                procedureGraph &&
                procedureContext &&
                procedureToolCycles < 3
            ) {
                procedureToolCycles += 1;
                let preToolActions: AgentToolAction[] = procedureResult.actions.map((a) => ({
                    type: a.type as any,
                    reason: a.reason,
                    payload: a.payload,
                }));
                preToolActions = scopeSgpLookupActionsToFocusedContract(
                    preToolActions,
                    focusedContractContext,
                    enrichedLastMessageContent || ''
                );
                preToolActions = scopeSgpLookupActionsToAddressedContract(
                    preToolActions,
                    [...recentToolResults, ...procedureToolResults],
                    enrichedLastMessageContent || ''
                );
                preToolActions = hydrateFindRouterByIpActionsFromSgpResults({
                    actions: preToolActions,
                    toolResults: [...recentToolResults, ...procedureToolResults],
                    contextText: [
                        focusedContractContext,
                        enrichedLastMessageContent || '',
                    ].filter(Boolean).join('\n'),
                });
                procedureExecutedActions.push(...preToolActions.map(resolveActionToolName));

                const procedureReusePlan = planProcedureToolReuse({
                    actions: preToolActions,
                    currentTurnResults: passThroughToolResults,
                    toolCatalog: runtimeToolCatalog,
                });
                let executedPreToolResults: AgentToolExecutionResult[] = [];
                if (procedureReusePlan.actionsToExecute.length > 0) {
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
                            turnPolicy,
                            customerMessage: enrichedLastMessageContent || '',
                            actions: procedureReusePlan.actionsToExecute,
                            orchestratorRunId: orchestratorRun?.id,
                            sourceMessageId,
                        }),
                        {
                            procedureRuntime: true,
                            requestedActions: procedureReusePlan.actionsToExecute.map(resolveActionToolName),
                            reusedActions: procedureReusePlan.reusedToolNames,
                        }
                    );
                    orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + preToolStage.durationMs;
                    executedPreToolResults = preToolStage.value;
                }
                if (procedureReusePlan.reusedToolNames.length > 0) {
                    await recordOrchestratorEvent({
                        run: orchestratorRun,
                        kind: 'procedure_tool_reuse',
                        status: 'success',
                        payload: {
                            toolNames: procedureReusePlan.reusedToolNames,
                            source: 'current_turn',
                        },
                    });
                }
                const preToolResults = completeProcedureToolReuse(
                    procedureReusePlan,
                    executedPreToolResults,
                );
                procedureToolResults.push(...preToolResults);

                if (preToolResults.length > 0) {
                    console.log(
                        `[PROCEDURE_RUNTIME] Executed ${preToolResults.length} tool(s): ` +
                        preToolResults.map((r) => `${r.toolName}=${r.status}`).join(', '),
                    );
                }

                if (preToolResults.some((result) => (
                    result.toolName === 'transfer_chat' && result.status === 'success'
                ))) {
                    procedureResult = {
                        ...procedureResult,
                        actions: [],
                        status: 'completed',
                        completionReason: 'Atendimento transferido com sucesso.',
                    };
                    break;
                }

                const preToolFailureResponse = buildToolFailureResponse(preToolResults, '');
                if (preToolFailureResponse) {
                    const waitsForCustomerConfirmation = preToolResults.some((result) => (
                        result.status === 'rejected' &&
                        result.error?.includes('[tool_policy:confirmation_required]')
                    ));
                    if (waitsForCustomerConfirmation) {
                        procedureContext.status = 'waiting_input';
                        await saveProcedureExecution(procedureContext);
                    } else {
                        await completeProcedureExecution(procedureContext.id, 'failed');
                    }
                    procedureResult = {
                        ...procedureResult,
                        response: preToolFailureResponse,
                        actions: [],
                        status: waitsForCustomerConfirmation ? 'waiting_input' : 'failed',
                        completionReason: preToolResults
                            .filter((result) => result.status !== 'success')
                            .map((result) => result.error || `${result.toolName} falhou`)
                            .join('; '),
                    };
                    break;
                }

                procedureResult = await advanceProcedure({
                    graph: procedureGraph,
                    context: procedureContext,
                    customerMessage: enrichedLastMessageContent || '',
                    availableTeams: availableTeams.map((t) => ({ id: t.id, name: t.name })),
                    toolResults: preToolResults,
                    decisionResolver: procedureDecisionResolver,
                    responseResolver: procedureResponseResolver,
                    knowledgeResolver: procedureKnowledgeResolver,
                    forceLlmRespond: isLmStudioModel(resolvedAiModel.model),
                });
            }

            // Send the response to the customer
            if (procedureResult.response) {
                let finalResponse = formatCustomerFacingAiResponse(procedureResult.response);
                const procedureValidatorPlannedActions: AgentToolAction[] = procedureResult.actions.map((action) => ({
                    type: action.type as any,
                    reason: action.reason,
                    payload: action.payload,
                }));
                if (
                    procedureExecutedActions.includes('transfer_chat') &&
                    !procedureValidatorPlannedActions.some((action) => action.type === 'transfer_chat')
                ) {
                    procedureValidatorPlannedActions.push({
                        type: 'transfer_chat',
                        reason: 'Procedure handoff already executed.',
                        payload: {},
                    });
                }
                const procedureResponseValidator = validateAutopilotResponse({
                    response: finalResponse,
                    fallbackReply: autopilotConfig.default_fallback_reply || '',
                    customerMessage: enrichedLastMessageContent || '',
                    chatHistory: chatHistoryForAI,
                    continuationRequiredSlots: procedureMissingSlots.length > 0
                        ? procedureMissingSlots as AutopilotSlotName[]
                        : workflowPlan.missingSlots,
                    intentResolution,
                    slotExtraction: workflowPlan.slotExtraction,
                    plannedActions: procedureValidatorPlannedActions,
                    toolResults: [...recentToolResults, ...procedureToolResults],
                    enabledToolNames,
                    availableTeams,
                    contact: sanitizedContact,
                    knowledgeCoverage,
                    knowledgeDocuments: ragDocuments,
                    source: 'llm',
                    systemAgentName: assignedSystemAgentName,
                });
                if (procedureResponseValidator.decision !== 'approve') {
                    finalResponse = formatCustomerFacingAiResponse(procedureResponseValidator.response);
                }

                if (currentCopilotMode === 'suggest') {
                    const { getSupabaseAdmin } = await import('@/lib/supabase');
                    const supabase = getSupabaseAdmin();
                    await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                            suggestion: finalResponse,
                            chatId: chat.id,
                            configName: autopilotConfig.name,
                    });
                } else {
                    await sendMultiBlockResponse(
                        chat.id,
                        finalResponse,
                        assignedSystemAgentId,
                        true,
                        instanceName,
                        null,
                        responseTrace,
                    );
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
                        responseValidator: procedureResponseValidator.metadata,
                    },
                });
            }

            const shouldFallThroughToLlm =
                (procedureResult.status === 'completed' || procedureResult.status === 'running') &&
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
            workflowKnowledgeDocuments: promptWorkflowKnowledgeDocuments,
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
            enabledAgentToolsDescription: buildEnabledAgentToolsDescription(enabledToolNames, runtimeToolCatalog, turnPolicy.toolInstructionsByName),
            enabledAgentToolNames: enabledToolNames,
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
            let aiMessageBlocks: string[] | null = null;
            if (Array.isArray((result as any).messageBlocks) && (result as any).messageBlocks.length > 0) {
                const rawBlocks = ((result as any).messageBlocks as string[]).map(b => b.trim()).filter(Boolean);
                if (rawBlocks.length > 0) {
                    const firstBlock = rawBlocks[0];
                    const cleanedResponse = finalResponse.trim();
                    const responseContainsBlocks = rawBlocks.every(block =>
                        cleanedResponse.toLowerCase().includes(block.toLowerCase())
                    );

                    let reconciledBlocks = [...rawBlocks];
                    if (!responseContainsBlocks) {
                        if (cleanedResponse && !firstBlock.toLowerCase().includes(cleanedResponse.toLowerCase()) && !cleanedResponse.toLowerCase().includes(firstBlock.toLowerCase())) {
                            reconciledBlocks.unshift(cleanedResponse);
                        }
                    }

                    if (reconciledBlocks.length > 1) {
                        aiMessageBlocks = reconciledBlocks;
                        if (!responseContainsBlocks) {
                            finalResponse = reconciledBlocks.join('\n\n');
                        }
                    }
                }
            }
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
                await supabase.channel(`chat:${chat.id}`).httpSend('ai_suggestion', {
                        suggestion: finalResponse,
                        chatId: chat.id,
                        configName: autopilotConfig.name
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
                let llmActions = scopeSgpLookupActionsToFocusedContract(ensureProcedureSgpLookupAction({
                    response: finalResponse,
                    customerMessage: enrichedLastMessageContent || '',
                    actions: promisedLookupActions,
                    enabledToolNames,
                    knowledgeToolProcedures,
                }), focusedContractContext, enrichedLastMessageContent || '');
                llmActions = scopeSgpLookupActionsToAddressedContract(
                    llmActions,
                    recentToolResults,
                    enrichedLastMessageContent || ''
                );
                const resourceMappedActions = await mapAgentToolActionsToResources({
                    workspaceId,
                    chatId: chat.id,
                    messageId: sourceMessageId ?? null,
                    procedureExecutionId: activePEC?.id ?? null,
                    customerMessage: enrichedLastMessageContent || '',
                    chatHistory: chatHistoryForAI,
                    contact: sanitizedContact,
                    slotExtraction: workflowPlan.slotExtraction,
                    actions: mergeAgentActions(deterministicRouting.actions, workflowPlannedActions, llmActions),
                    enabledToolNames,
                    inferCrmUpdateFromSlots: true,
                });
                if (resourceMappedActions.mappings.length > 0) {
                    await recordOrchestratorEvent({
                        run: orchestratorRun,
                        kind: 'resource_mapper',
                        status: resourceMappedActions.mappings.some((mapping) => mapping.status === 'mapped' || mapping.status === 'partial') ? 'success' : 'fallback',
                        payload: {
                            resources: resourceMappedActions.mappings.map((mapping) => ({
                                resource: mapping.resource,
                                operation: mapping.operation,
                                status: mapping.status,
                                confidence: mapping.confidence,
                                payloadHash: mapping.payloadHash,
                                mappedFields: mapping.mappings.map((item) => ({
                                    fieldId: item.fieldId,
                                    fieldLabel: item.fieldLabel,
                                    slot: item.slot,
                                    confidence: item.confidence,
                                    source: item.source,
                                    reason: item.reason,
                                })),
                                rejected: mapping.rejected.slice(0, 8),
                            })),
                        },
                    });
                }

                const toolPlanner = planAutopilotTools({
                    response: finalResponse,
                    customerMessage: enrichedLastMessageContent || '',
                    intentResolution,
                    slotExtraction: workflowPlan.slotExtraction,
                    actions: resourceMappedActions.actions,
                    enabledToolNames,
                    toolCatalog: runtimeToolCatalog,
                    availableTeams,
                    contact: sanitizedContact,
                    scoringWeights: activeToolSelectionScore?.weights || null,
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
                const toolPlannerAgentDecision = decideAgentNextAction({
                    workspaceId,
                    chatId: chat.id,
                    messageId: sourceMessageId ?? null,
                    runId: orchestratorRun.id,
                    autopilotConfigId: autopilotConfig.id,
                    stage: 'tool_planner',
                    intentResolution,
                    workflowPlan: {
                        executionMode: workflowPlan.executionMode,
                        reason: workflowPlan.reason,
                        handledByWorkflow: workflowPlan.handledByWorkflow,
                        missingSlots: workflowPlan.missingSlots,
                        actions: workflowPlan.actions,
                        slotExtraction: workflowPlan.slotExtraction,
                    },
                    toolPlanner: {
                        actions: toolPlanner.actions,
                        rejectedActions: toolPlanner.rejectedActions,
                        responseOverride: toolPlanner.responseOverride,
                        metadata: toolPlanner.metadata,
                    },
                    procedure: activePEC ? {
                        activeProcedureId: activePEC.id,
                        procedureId: activePEC.procedureId,
                        procedureName: activePEC.procedureName,
                        currentStepId: activePEC.currentStepId,
                        status: activePEC.status,
                    } : null,
                    policyContext: {
                        allowedToolNames: turnPolicy.allowedToolNames,
                        rejectedActions: toolPlanner.metadata.rejectedActions,
                        promiseValidation: toolPlanner.promiseValidation,
                    },
                    metadata: {
                        candidateTools: deterministicRouting.candidates.slice(0, 8).map((candidate) => ({
                            tool: candidate.toolName,
                            source: candidate.source,
                            reason: candidate.reason,
                            team: candidate.team.name,
                        })),
                    },
                });
                await recordAgentDecisionLedger(toolPlannerAgentDecision.ledgerEntry);
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

                const requestedActions = filterAlreadyExecutedActions(
                    filterImplicitTransferActions({
                        actions: toolPlanner.actions,
                        customerMessage: enrichedLastMessageContent || '',
                        availableTeams,
                        candidates: deterministicRouting.candidates,
                    }),
                    passThroughToolResults
                );
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
                            turnPolicy,
                            customerMessage: enrichedLastMessageContent || '',
                            actions: preResponseActions,
                            orchestratorRunId: orchestratorRun.id,
                            sourceMessageId,
                        }),
                        { requestedActions: preResponseActions.map((action) => action.type), beforeResponse: true }
                    );
                    orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + preToolsStage.durationMs;
                    toolResults = preToolsStage.value;

                    const deterministicProcedureAction = buildRouterRebootActionFromSgpResults({
                        toolResults,
                        customerMessage: enrichedLastMessageContent || '',
                        response: finalResponse,
                        chatHistory: focusedContractContext,
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
                                turnPolicy,
                                customerMessage: enrichedLastMessageContent || '',
                                actions: [deterministicProcedureAction],
                                orchestratorRunId: orchestratorRun.id,
                                sourceMessageId,
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
                                    workflowKnowledgeDocuments: promptWorkflowKnowledgeDocuments,
                                    resolvedCases,
                                    fallbackReply: autopilotConfig.default_fallback_reply || '',
                                    escalationPolicy: autopilotConfig.escalation_policy || '',
                                    closingPolicy: autopilotConfig.closing_policy || '',
                                    model: resolvedAiModel.model,
                                    contact: sanitizedContact,
                                    workspaceGeminiApiKey,
                                    enabledAgentToolsDescription: buildEnabledAgentToolsDescription(enabledToolNames, runtimeToolCatalog, turnPolicy.toolInstructionsByName),
                                    enabledAgentToolNames: enabledToolNames,
                                    allowNativeLmStudioToolCalls: false,
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
                                        turnPolicy,
                                        customerMessage: enrichedLastMessageContent || '',
                                        actions: continuationActions,
                                        orchestratorRunId: orchestratorRun.id,
                                        sourceMessageId,
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

                    // SGP tool mapping unconditional override is disabled so the configured agent can formulate a natural response.
                    // The deterministic SGP response builder remains active in response-validator.ts as a safe guardrail/fallback.
                    const sgpResponse = null;
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
                                'Escreva a resposta final ao cliente usando exclusivamente fatos literais presentes no resultado real das ferramentas. Nunca invente, complete ou sugira links, protocolos, prazos, procedimentos, disponibilidade, diagnosticos, valores ou datas ausentes. Nao exponha JSON, nomes internos de campos, timestamps ISO brutos, command_id, stack trace ou mensagem tecnica. Converta datas para dd/MM/yyyy e data-hora para dd/MM/yyyy HH:mm. Se faltar informacao ou a acao falhou, diga de forma simples que ela nao esta disponivel e que sera necessario verificar manualmente.',
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
                                    workflowKnowledgeDocuments: promptWorkflowKnowledgeDocuments,
                                    resolvedCases,
                                    fallbackReply: '',
                                    escalationPolicy: autopilotConfig.escalation_policy || '',
                                    closingPolicy: autopilotConfig.closing_policy || '',
                                    model: resolvedAiModel.model,
                                    contact: sanitizedContact,
                                    workspaceGeminiApiKey,
                                    enabledAgentToolsDescription: buildEnabledAgentToolsDescription(enabledToolNames, runtimeToolCatalog, turnPolicy.toolInstructionsByName),
                                    enabledAgentToolNames: enabledToolNames,
                                    allowNativeLmStudioToolCalls: false,
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
                    chatHistory: chatHistoryForAI,
                    continuationRequiredSlots: workflowPlan.missingSlots,
                    completionActions: flowCompletionPlan?.actions,
                    intentResolution,
                    slotExtraction: workflowPlan.slotExtraction,
                    plannedActions: requestedActions,
                    toolResults: validatorToolResults,
                    enabledToolNames,
                    availableTeams,
                    contact: sanitizedContact,
                    knowledgeCoverage,
                    knowledgeDocuments: promptKnowledgeDocuments,
                    source: 'llm',
                    systemAgentName: assignedSystemAgentName,
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
                        aiMessageBlocks,
                        responseTrace
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
                        turnPolicy,
                        customerMessage: enrichedLastMessageContent || '',
                        actions: finalPostResponseActions,
                        orchestratorRunId: orchestratorRun.id,
                        sourceMessageId,
                    }),
                    { requestedActions: finalPostResponseActions.map((action) => action.type), afterResponse: true }
                );
                orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + toolsStage.durationMs;
                toolResults = [...toolResults, ...toolsStage.value];
                await sendToolFailureFollowUp({
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    instanceName,
                    toolResults: toolsStage.value,
                    previousResponse: finalResponse,
                    responseTrace,
                });
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
            const emptyResponseResourceMappedActions = await mapAgentToolActionsToResources({
                workspaceId,
                chatId: chat.id,
                messageId: sourceMessageId ?? null,
                procedureExecutionId: activePEC?.id ?? null,
                customerMessage: enrichedLastMessageContent || '',
                chatHistory: chatHistoryForAI,
                contact: sanitizedContact,
                slotExtraction: workflowPlan.slotExtraction,
                actions: mergeAgentActions(deterministicRouting.actions, workflowPlannedActions, normalizeAgentActions(result?.actions)),
                enabledToolNames,
                inferCrmUpdateFromSlots: true,
            });
            if (emptyResponseResourceMappedActions.mappings.length > 0) {
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'resource_mapper',
                    status: emptyResponseResourceMappedActions.mappings.some((mapping) => mapping.status === 'mapped' || mapping.status === 'partial') ? 'success' : 'fallback',
                    payload: {
                        emptyResponse: true,
                        resources: emptyResponseResourceMappedActions.mappings.map((mapping) => ({
                            resource: mapping.resource,
                            operation: mapping.operation,
                            status: mapping.status,
                            confidence: mapping.confidence,
                            payloadHash: mapping.payloadHash,
                            mappedFields: mapping.mappings.map((item) => ({
                                fieldId: item.fieldId,
                                fieldLabel: item.fieldLabel,
                                slot: item.slot,
                                confidence: item.confidence,
                                source: item.source,
                                reason: item.reason,
                            })),
                            rejected: mapping.rejected.slice(0, 8),
                        })),
                    },
                });
            }
            const emptyResponseToolPlanner = planAutopilotTools({
                response: null,
                customerMessage: enrichedLastMessageContent || '',
                intentResolution,
                slotExtraction: workflowPlan.slotExtraction,
                actions: emptyResponseResourceMappedActions.actions,
                enabledToolNames,
                toolCatalog: runtimeToolCatalog,
                availableTeams,
                contact: sanitizedContact,
                scoringWeights: activeToolSelectionScore?.weights || null,
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
                        turnPolicy,
                        customerMessage: enrichedLastMessageContent || '',
                        actions: fallbackActions,
                        orchestratorRunId: orchestratorRun.id,
                        sourceMessageId,
                    }),
                    { requestedActions: fallbackActions.map((action) => action.type), noLlmResponse: true }
                )).value
                : [];
            const emptyResponseFallback = currentCopilotMode === 'auto'
                ? formatCustomerFacingAiResponse(
                    buildToolFailureResponse(toolResults, '') ||
                    autopilotConfig.default_fallback_reply?.trim() ||
                    'Estou com uma instabilidade para responder agora. Nossa equipe vai acompanhar por aqui.'
                )
                : null;
            if (emptyResponseFallback) {
                const fallbackSendStage = await timeOrchestratorStage(
                    orchestratorRun,
                    'message_send',
                    () => sendMultiBlockResponse(
                        chat.id,
                        emptyResponseFallback,
                        assignedSystemAgentId,
                        true,
                        instanceName,
                        null,
                        responseTrace
                    ),
                    { responseLength: emptyResponseFallback.length, fallbackReason: 'empty_llm_response' }
                );
                orchestratorTimings.send_ms = fallbackSendStage.durationMs;
            }
            await logIntelligentAttendantResponse({
                configId: autopilotConfig.id,
                chatId: chat.id,
                systemAgentId: assignedSystemAgentId,
                modelName: resolvedAiModel.model,
                customerMessage: enrichedLastMessageContent || '',
                response: emptyResponseFallback,
                status: emptyResponseFallback ? 'sent' : 'empty',
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
                status: 'fallback',
                timings: orchestratorTimings,
                intent: deterministicRouting.matchedReason ? 'deterministic_tool_routing' : intentResolution.intent,
                confidenceLevel: deterministicRouting.matchedReason ? 'deterministic' : 'low',
                confidenceScore: deterministicRouting.matchedReason ? null : intentResolution.confidence,
                metadata: {
                    responseSent: Boolean(emptyResponseFallback),
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
        if (error instanceof AutopilotSourceSupersededError) {
            console.log(
                `[AUTOPILOT_STALE_GUARD] Mensagem ${sourceMessageId || 'sem-id'} do chat ${chat.id} foi substituida durante o processamento.`,
            );
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: 'skipped',
                timings: orchestratorTimings,
                intent: intentResolution.intent,
                confidenceScore: intentResolution.confidence,
                metadata: {
                    responseSent: false,
                    staleSourceMessage: true,
                    staleGuardCode: error.code,
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                    ragStrategy,
                    knowledgeCoverage,
                },
            });
            return;
        }
        console.error('[AUTOPILOT_SERVICE] Erro ao processar:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (currentCopilotMode === 'auto' && !isProviderDeliveryError(error)) {
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
                    () => sendMultiBlockResponse(
                        chat.id,
                        automaticFallback,
                        assignedSystemAgentId,
                        true,
                        instanceName,
                        null,
                        {
                            ...responseTrace,
                            deliveryKey: 'runtime-fallback',
                        }
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
        throw error instanceof Error ? error : new Error(errorMessage);
    }
    } finally {
        await broadcastAiProcessing(chat.id, 'ai_processing_stop');
    }
    } finally {
        await chatLease.release().catch((error) => {
            console.error(`[AUTOPILOT_CHAT_LEASE] Falha ao liberar lease do chat ${chat.id}:`, error);
        });
    }
}
