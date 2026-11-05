import { db } from '@/lib/db';
import { getWorkspaceTimezone } from '@/lib/workspace-config';
import { selectStudioConversationRelease } from '@/services/agent-studio/release-selection';
import { runStudioConversation } from '@/services/agent-studio/runtime';
import { loadStudioRelease } from '@/services/agent-studio/repository';
import { runStudioCopilot } from '@/services/agent-studio/copilot';
import { loadStudioCopilotContext } from '@/services/agent-studio/copilot-context';
import { sendAutomatedMediaAction } from '@/actions/messages';
import { validateRemoteUrl } from '@/lib/security/safe-remote-url';
import { randomUUID } from 'crypto';
import type { AutopilotConfig, KnowledgeBaseDocument, Chat, Contact } from '@/lib/types';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { buildUniversalAgentRuntimeContext } from '@/services/agent-runtime/prompt-context';
import { generateProcedureRuntimeOutput } from '@/ai/flows/procedure-runtime';
import { logToDebugFile } from '@/lib/debug-file';
import { resolveCanonicalWhatsappChatIdByIdentity } from '@/lib/whatsapp/contact-identity';
import { retrieveHybridSupportContext, type KnowledgeRetrievalStrategy } from '@/services/rag/hybrid-retrieval';
import { partitionKnowledgeDocuments } from '@/services/rag/knowledge-document';
import { runAgentTools } from '@/services/agent-tools/runtime';
import {
    publishCopilotSuggestion,
    type CopilotSuggestionInsights,
    type CopilotSuggestionStage,
    type CopilotToolTrace,
} from '@/services/autopilot/runtime/copilot-suggestion';
import { filterNonMutatingToolNames } from '@/services/autopilot/runtime/copilot-tool-guard';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from '@/services/agent-tools/types';
import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';
import { classifyMcpToolSafety, resolveMcpToolTimeoutMs } from '@/services/mcp/tool-safety';
import { getAgentToolDefinition, listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { extractKnowledgeToolProcedures, formatKnowledgeToolProcedures } from '@/services/agent-tools/knowledge-procedures';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import {
    routeDeterministicAgentTools,
    shouldHandoffToHuman,
    type ToolRouterTeam,
} from '@/services/agent-tools/router';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import { getGlobalAiDecisionModelConfig } from '@/services/ai/decision-model-config';
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
import { buildMediaAnalysisContext } from './media-analysis-context';
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
import {
    isConversationCloseRequest,
    hasConversationCloseClaim,
    isPotentialConversationCloseRequest,
} from '@/services/autopilot/close-intent';
import { compactKnowledgeDocumentsForPrompt } from '@/services/autopilot/knowledge-prompt-budget';
import { planAutopilotTools } from '@/services/autopilot/tool-planner';
import { buildToolPrearmContent, deriveToolPrearmSignal, type ToolPrearmSignal } from '@/services/autopilot/tool-prearm';
import { validateAutopilotResponse } from '@/services/autopilot/response-validator';
import { toolInputSchemaForPrompt } from '@/services/workflow-runtime/tool-arguments';
import {
    buildContextualAutopilotFallback,
    isGenericInstabilityReply,
} from '@/services/autopilot/contextual-fallback';
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
import { sendMultiBlockResponse as sendMultiBlockResponseRaw } from '@/services/autopilot/runtime/message-sender';
import { scheduleAutopilotInactivityClose } from '@/services/autopilot/runtime/inactivity-close';
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
    shouldRunAutopilotKnowledgeRetrieval,
    shouldSendDeterministicFlowResponse,
} from '@/services/autopilot/runtime/turn-routing-policy';
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
import { runAutopilotWorkflowRuntimeV2Shadow } from '@/services/workflow-runtime/autopilot-rollout';
import { runAutopilotWorkflowRuntimeV2Primary } from '@/services/workflow-runtime/autopilot-primary';
import {
    canonicalWorkflowFieldName,
    hasKnownWorkflowField,
    isValidWorkflowGoalCompletionEvidence,
} from '@/services/workflow-runtime/goal-completion';
import { extractCollectionFieldsWithAi } from '@/ai/flows/collection-field-extractor';
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
    loadRecentContactVerificationReceipts,
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
    claimAutopilotCollectionCompletion,
    clearAutopilotCollectionCompletion,
    consumePendingActionCancellation,
    consumeSupersededPendingAction,
    getAutopilotConversationState,
    loadAutopilotContactMemory,
    type AutopilotContactMemory,
    saveAutopilotNativeState,
    saveAutopilotSlotMemory,
    saveAutopilotTurnState,
    setPendingToolConfirmation,
} from '@/services/autopilot/flow-state-store';
import { mapAgentToolActionsToResources } from '@/services/resource-mapper/agent-tool-actions';
import { mapCrmContactCustomFields } from '@/services/resource-mapper/crm-contact-custom-fields';
import {
    extractAutopilotSlots,
    isValidCustomerIdentifier,
    type SlotExtractionResult,
} from '@/services/autopilot/slots';
import {
    COLLECTION_COMPLETION_STATE_KEY,
    CONVERSATION_KNOWN_FIELDS_STATE_KEY,
    buildCollectionCompletionCheckpoint,
    chooseNonRepeatingCollectionFallback,
    createPersistedCollectionFieldReceipt,
    directAgentRouteHasFailedToolCalls,
    evaluateCompletedCollectionClose,
    extractPendingCollectionHistoryFields,
    extractPendingCollectionReplyFields,
    findPendingCollectionQuestion,
    inspectCollectionResponseRoute,
    parseCollectionCompletionCheckpoint,
    sanitizeConversationKnownFields,
    type PersistedCollectionFieldReceipt,
} from '@/services/autopilot/collection-completion';
import { persistAutopilotContactFacts } from '@/services/autopilot/contact-facts';
import { recordAgentDecisionLedger } from '@/services/autopilot/decision-ledger';
import { buildStudioDecisionLedgerEntry } from '@/services/agent-studio/decision-record';
import { closingClassifierEligible, evaluateStudioCloseGate, type StudioCloseGateResult } from '@/services/agent-studio/close-gate';
import { guardStudioPromises } from '@/services/agent-studio/promise-guard';
import { studioAutomation } from '@/services/agent-studio/automation';
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
import { listPublishedProcedureGraphs } from '@/services/procedures/repository';

async function compileRuntimeProcedures(input: {
    config: AutopilotConfig;
    documents: KnowledgeBaseDocument[];
    tools: AgentToolCatalogItem[];
    enabledToolNames: string[];
}): Promise<ProcedureGraph[]> {
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

    const studioProcedures = await listPublishedProcedureGraphs({
        workspaceId: input.config.workspace_id,
        configId: input.config.id,
    }).catch((error) => {
        console.error('[PROCEDURE_STUDIO] Failed to load published procedures:', error);
        return [];
    });
    const combined = flowProcedure.success && flowProcedure.graph
        ? [...studioProcedures, ...documentProcedures, flowProcedure.graph]
        : [...studioProcedures, ...documentProcedures];
    return Array.from(new Map(combined.map((procedure) => [procedure.id, procedure])).values());
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

async function recordGeneratedAgentTaskPlan(input: {
    run: OrchestratorRunHandle;
    taskPlan: Record<string, unknown> | null | undefined;
    source: 'initial_response' | 'tool_continuation' | 'tool_final_response';
}) {
    if (!input.taskPlan) return;
    await recordOrchestratorEvent({
        run: input.run,
        kind: 'agent_task_plan',
        status: 'success',
        payload: {
            ...input.taskPlan,
            source: input.source,
        },
    });
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
             JOIN contacts scoped_contact ON scoped_contact.id = ccfv.contact_id AND scoped_contact.workspace_id = $1
             JOIN custom_field_definitions cfd
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

export function buildStructuredKnownFields(
    contact: Contact,
    slots: SlotExtractionResult['slots'],
    invalidSlots: SlotExtractionResult['invalidSlots'] = [],
): Record<string, unknown> {
    const knownFields: Record<string, unknown> = { ...slots };
    const invalidIdentifierInCurrentMessage = invalidSlots.some((slot) => slot.name === 'customer_identifier');
    const coreFields: Record<string, unknown> = {
        name: contact.name,
        email: contact.email,
        phone: contact.phone || contact.phone_number_jid,
        address: contact.address,
    };
    const addEntries = (entries: Array<[string, unknown]>, fromCustomFields: boolean) => {
      for (const [key, value] of entries) {
        if (value === null || value === undefined) continue;
        if (
            invalidIdentifierInCurrentMessage
            && fromCustomFields
            && (
                canonicalWorkflowFieldName(key) === 'customer_identifier'
                || (typeof value === 'string' && isValidCustomerIdentifier(value))
            )
        ) continue;
        let cleanValue: unknown;
        if (typeof value === 'string' && value.trim()) cleanValue = value.trim();
        else if (typeof value === 'number' || typeof value === 'boolean') cleanValue = value;
        else if (Array.isArray(value) && value.length > 0) cleanValue = value;
        if (cleanValue === undefined) continue;
        if (knownFields[key] === undefined) knownFields[key] = cleanValue;
        const canonicalKey = canonicalWorkflowFieldName(key);
        if (canonicalKey && knownFields[canonicalKey] === undefined) {
            knownFields[canonicalKey] = cleanValue;
        }
      }
    };
    addEntries(Object.entries(coreFields), false);
    addEntries(Object.entries(contact.custom_fields || {}), true);
    return knownFields;
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

    const hasRouterTools = enabledTools.some((t) => {
        const lower = t.name.toLowerCase();
        return lower.includes('router') || lower.includes('wifi') || lower.includes('get_tool_manual') || lower.includes('configure_wifi') || lower.includes('reboot_router') || lower.includes('get_operation_status');
    }) || enabledToolNames.some((name) => {
        const lower = name.toLowerCase();
        return lower.includes('router') || lower.includes('wifi') || lower.includes('get_tool_manual') || lower.includes('configure_wifi') || lower.includes('reboot_router') || lower.includes('get_operation_status');
    });

    const description = enabledTools
        .map((tool) => {
            const schema = tool.inputSchema
                ? ` Entrada JSON: ${JSON.stringify(toolInputSchemaForPrompt(tool.inputSchema))}`
                : '';
            const instructions = toolInstructionsByName[tool.name]
                ? ` Instrucao configurada no flow: ${toolInstructionsByName[tool.name]}`
                : '';
            return `- ${tool.name}: ${tool.description}${schema}${instructions}`;
        })
        .join('\n');

    if (!hasRouterTools) {
        return description;
    }

    const routerDirectives = [
        '',
        'DIRETRIZES OPERACIONAIS OBRIGATÓRIAS PARA ROTEADORES (ACS / TR-069):',
        '1. Consulta Obrigatória a /como-usar: Antes de executar qualquer ação técnica em roteadores ou em caso de dúvida sobre parâmetros, consulte o manual da ferramenta via `get_tool_manual` ou siga as instruções oficiais de /como-usar.',
        '2. Zero Plaintext Secrets: NUNCA revele senhas de Wi-Fi ou credenciais em texto claro no chat. Confirme alterações com o usuário antes de aplicá-las.',
        '3. Diagnóstico Prévio Obrigatório: SEMPRE consulte os detalhes atuais do roteador via `get_router_details` antes de alterar o Wi-Fi (`configure_wifi`) ou reiniciar (`reboot_router`).',
        '4. Configuração Atômica de Wi-Fi: Atualize as redes 2.4GHz e 5GHz de forma unificada e consistente (evitando reboots múltiplos).',
        '5. Justificativa Explícita para Reboot: A ferramenta `reboot_router` exige estritamente `confirm: true` e uma justificativa técnica detalhada (`reason`). Nunca reinicie o roteador sem consentimento explícito do cliente.',
        '6. Polling de Operação Assíncrona: Se a operação retornar `operation_id` ou status pendente/em andamento via TR-069, consulte periodicamente o status com `get_operation_status`.'
    ].join('\n');

    return `${description}\n${routerDirectives}`;
}


/** Kill switch for the AI field extractor; collection falls back to the deterministic parser. */
function isAiFieldExtractionEnabled(): boolean {
    const raw = String(process.env.AUTOPILOT_AI_FIELD_EXTRACTION || '').trim().toLowerCase();
    return !['0', 'off', 'false', 'disabled'].includes(raw);
}





async function broadcastAiProcessing(chatId: string, event: 'ai_processing_start' | 'ai_processing_stop', payload: Record<string, unknown> = {}) {
    try {
        const { broadcastRealtimeEvent } = await import('@/lib/realtime/broadcast');
        await broadcastRealtimeEvent(`chat:${chatId}`, event, {
            chatId,
            ...payload,
        });
    } catch (error) {
        console.error(`[AUTOPILOT_SERVICE] Failed to broadcast ${event}:`, error);
    }
}

/**
 * Tools this turn actually ran, so the copilot card can show what the agent
 * consulted (contracts, invoices, MCP servers) before proposing a reply.
 */
async function loadTurnToolTraces(input: {
    chatId: string;
    since: Date;
}): Promise<CopilotToolTrace[]> {
    try {
        const { rows } = await db.query(
            `SELECT tool_name, status
               FROM agent_tool_executions
              WHERE chat_id = $1
                AND created_at >= $2
              ORDER BY created_at ASC
              LIMIT 12`,
            [input.chatId, input.since],
        );
        const seen = new Set<string>();
        const traces: CopilotToolTrace[] = [];
        for (const row of rows) {
            const name = String(row.tool_name || '').trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const definition = getAgentToolDefinition(name as any);
            const status = String(row.status || '').toLowerCase();
            traces.push({
                name,
                displayName: definition?.displayName || null,
                status: status === 'success'
                    ? 'success'
                    : status === 'error' || status === 'failed'
                        ? 'error'
                        : 'skipped',
            });
        }
        return traces;
    } catch (error) {
        console.warn('[COPILOT_SUGGESTION] Failed to load tool traces:', error);
        return [];
    }
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
            const { broadcastRealtimeEvent } = await import('@/lib/realtime/broadcast');
            await broadcastRealtimeEvent(`chat:${input.chatId}`, 'agent_tool_status', {
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
    closeAuthorization?: AgentToolRuntimeContext['closeAuthorization'];
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
            slotExtraction: input.slotExtraction ?? null,
            customerMessage: input.customerMessage,
            confirmedActionFingerprint: input.confirmedActionFingerprint ?? null,
            orchestratorRunId: input.orchestratorRunId ?? null,
            sourceMessageId: input.sourceMessageId ?? null,
            closeAuthorization: input.closeAuthorization ?? null,
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
    closeAuthorization?: AgentToolRuntimeContext['closeAuthorization'];
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
        }).catch((error) => {
            console.warn('[AUTOPILOT_TOOL_STATUS] Failed to persist running status:', error);
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
        }).catch((error) => {
            console.warn('[AUTOPILOT_TOOL_STATUS] Failed to persist terminal status:', error);
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
    await sendMultiBlockResponseRaw(
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
    sourceMessageId?: string | null,
    suggestionRequest?: { agentId: string }
) {
    const resolvedChatId = chat.status === 'encerrados'
        ? chat.id
        : (await resolveCanonicalWhatsappChatIdByIdentity(db, {
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
    if (!suggestionRequest && await hasCompletedAutopilotSourceMessage({
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

    try {
    const chatConfigRes = await db.query(
        `SELECT
            c.workspace_id,
            c.status,
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
    if (chatConfig.status === 'encerrados') {
        console.log(`[AUTOPILOT_SERVICE] Chat ${chat.id} esta encerrado. Ignorando processamento pendente.`);
        return;
    }
    await broadcastAiProcessing(chat.id, 'ai_processing_start');
    const rawIsActive = chatConfig?.is_autopilot_active ?? chat.is_autopilot_active;
    const currentIsActive = rawIsActive === true;
    let assignedSystemAgentId = chatConfig?.assigned_system_agent_id || null;
    let assignedSystemAgentName = chatConfig?.assigned_system_agent_name || 'Atendente Inteligente';
    let effectiveAutopilotConfigId = chatConfig?.assigned_config_id || null;

    // Two runtimes share this orchestrator:
    //  - "attendant": the chat belongs to an Intelligent Attendant that answers the customer.
    //  - "copilot": a human still owns the chat and turned the AI on from the inbox. Same
    //    reasoning, knowledge and tools, but the reply is proposed to the operator instead
    //    of being delivered, so the human keeps the conversation.
    if (suggestionRequest && (chatConfig?.copilot_mode !== 'suggest'
        || assignedSystemAgentId || chatConfig?.autopilot_config_id !== suggestionRequest.agentId)) return;

    const isAttendantRuntime = Boolean(assignedSystemAgentId)
        && chatConfig?.assigned_system_agent_type === 'intelligent_attendant'
        && chatConfig?.assigned_system_agent_active !== false
        && Boolean(effectiveAutopilotConfigId);
    const runtimeMode: 'attendant' | 'copilot' = isAttendantRuntime ? 'attendant' : 'copilot';

    if (runtimeMode === 'attendant') {
        if (chatConfig.autopilot_config_id !== effectiveAutopilotConfigId) {
            await db.query(
                `UPDATE chats
                 SET autopilot_config_id = $1
                 WHERE id = $2
                   AND workspace_id = $3`,
                [effectiveAutopilotConfigId, chat.id, workspaceId]
            );
            chat = {
                ...chat,
                autopilot_config_id: effectiveAutopilotConfigId,
            };
        }
    } else {
        if (assignedSystemAgentId) {
            console.log(
                `[AUTOPILOT_SERVICE] Chat ${chat.id} esta atribuido a um agente do sistema que nao responde conversas. Ignorando.`
            );
            return;
        }
        if (!currentIsActive) {
            console.log(`[AUTOPILOT_SERVICE] Copiloto desativado para o chat ${chat.id}. Ignorando.`);
            return;
        }

        const copilotConfigId = chatConfig?.autopilot_config_id || chat.autopilot_config_id || null;
        if (!copilotConfigId) {
            console.log(`[AUTOPILOT_SERVICE] Copiloto ativo sem agente de IA selecionado. Chat ${chat.id}.`);
            return;
        }
        effectiveAutopilotConfigId = copilotConfigId;

        // Tool executions, notes and logs are attributed to the Intelligent Attendant that
        // shares this AI configuration when one exists. It is optional: the copilot works
        // even for configurations that were never published as a system agent.
        const attributionRes = await db.query(
            `SELECT id, name
               FROM system_agents
              WHERE workspace_id = $1
                AND autopilot_config_id = $2
                AND type = 'intelligent_attendant'
              ORDER BY is_active DESC, created_at ASC
              LIMIT 1`,
            [workspaceId, copilotConfigId]
        );
        assignedSystemAgentId = attributionRes.rows[0]?.id || null;
        assignedSystemAgentName = attributionRes.rows[0]?.name || assignedSystemAgentName;
    }

    // The copilot never speaks to the customer on its own: whatever the pipeline produces
    // is delivered to the operator as a suggestion.
    const currentCopilotMode = runtimeMode === 'copilot'
        ? 'suggest'
        : (chatConfig?.copilot_mode || 'auto');
    const isSuggestionOnlyRuntime = currentCopilotMode === 'suggest';

    console.error(
        `[AUTOPILOT_DEBUG] *** DB FETCH -> copilot_mode: ${currentCopilotMode}, is_autopilot_active (RAW): ${rawIsActive}, (RESOLVED): ${currentIsActive} ***`
    );
    logToDebugFile(`[processAutopilotForChat] ChatId=${chat.id}, CopilotMode=${currentCopilotMode}, IsActive=${currentIsActive} (Raw: ${rawIsActive})`);

    const { config: autopilotConfig, rules: autopilotRules } =
        await getAutopilotConfigService(workspaceId, effectiveAutopilotConfigId || undefined);

    if (!autopilotConfig || !autopilotConfig.is_active) {
        console.log(`[AUTOPILOT_SERVICE] Autopilot desativado ou nao configurado para workspace ${workspaceId}`);
        return;
    }

    if (effectiveAutopilotConfigId && autopilotConfig.id !== effectiveAutopilotConfigId) {
        console.log(`[AUTOPILOT_SERVICE] Configuracao de IA atribuida nao confere com o agente selecionado. Chat ${chat.id}.`);
        return;
    }

    if (runtimeMode === 'copilot' && !assignedSystemAgentId) {
        assignedSystemAgentName = autopilotConfig.name || assignedSystemAgentName;
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
    const aiDecisionModels = await getGlobalAiDecisionModelConfig();

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
            domainPackId: autopilotConfig.agent_domain_pack_id || null,
        },
    });
    const orchestratorTimings: Record<string, number> = {};
    const responseTrace: AutopilotResponseTrace = {
        workspaceId,
        sourceMessageId: sourceMessageId ?? null,
        orchestratorRunId: orchestratorRun.id,
    };

    const turnStartedAt = new Date();
    // Reasoning trail collected while the turn runs. It is what turns a suggestion from a
    // wall of text into something the operator can trust: which intent was detected, what
    // the agent read and which systems it consulted before proposing the reply.
    const copilotTrace: { stage: CopilotSuggestionStage; insights: CopilotSuggestionInsights } = {
        stage: 'model_response',
        insights: { model: resolvedAiModel.model },
    };
    const traceCopilotInsights = (
        patch: Partial<CopilotSuggestionInsights>,
        stage?: CopilotSuggestionStage,
    ) => {
        copilotTrace.insights = { ...copilotTrace.insights, ...patch };
        if (stage) copilotTrace.stage = stage;
    };

    // A turn can produce more than one message (an acknowledgement then the answer).
    // The operator should see every one of them, so drafts accumulate instead of
    // overwriting each other.
    const turnSuggestionBlocks: string[] = [];
    const publishSuggestion = async (input: {
        response: string;
        blocks?: string[] | null;
        stage?: CopilotSuggestionStage;
        insights?: Partial<CopilotSuggestionInsights>;
        assertCurrent?: () => Promise<void>;
    }) => {
        const incoming = (input.blocks && input.blocks.length > 0 ? input.blocks : [input.response])
            .map((block) => (typeof block === 'string' ? block.trim() : ''))
            .filter((block) => block.length > 0);
        for (const block of incoming) {
            if (!turnSuggestionBlocks.includes(block)) {
                turnSuggestionBlocks.push(block);
            }
        }
        if (turnSuggestionBlocks.length === 0) return;

        const toolsUsed = input.stage === 'studio_copilot' ? [] : await loadTurnToolTraces({
            chatId: chat.id,
            since: turnStartedAt,
        });
        await publishCopilotSuggestion({
            workspaceId,
            chatId: chat.id,
            autopilotConfigId: autopilotConfig.id,
            autopilotConfigName: autopilotConfig.name || assignedSystemAgentName,
            systemAgentId: assignedSystemAgentId,
            sourceMessageId: sourceMessageId ?? null,
            orchestratorRunId: orchestratorRun.id,
            stage: input.stage || copilotTrace.stage,
            assertCurrent: input.assertCurrent,
            suggestion: turnSuggestionBlocks.join('\n\n'),
            messageBlocks: turnSuggestionBlocks,
            insights: {
                ...copilotTrace.insights,
                ...(input.insights || {}),
                ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
                latencyMs: Date.now() - turnStartedAt.getTime(),
            },
        });
    };

    const sendMultiBlockResponse: typeof sendMultiBlockResponseRaw = async (...args) => {
        // Single delivery choke point. In suggestion mode nothing reaches the customer:
        // every branch of the orchestrator routes its reply to the operator's copilot card.
        if (isSuggestionOnlyRuntime) {
            const [, formattedResponse, , , , aiMessageBlocks] = args;
            await publishSuggestion({
                response: formattedResponse,
                blocks: aiMessageBlocks,
            });
            return { success: true };
        }

        const result = await sendMultiBlockResponseRaw(...args);
        if (result.success) {
            await scheduleAutopilotInactivityClose({
                workspaceId,
                chatId: chat.id,
                autopilotConfigId: autopilotConfig.id,
                systemAgentId: assignedSystemAgentId,
                timeoutSeconds: autopilotConfig.inactivity_timeout_seconds || null,
                anchorAt: new Date(),
                sourceMessageId: sourceMessageId ?? null,
                orchestratorRunId: orchestratorRun.id,
            });
        }
        return result;
    };

    const messagesRes = await db.query(
        `SELECT id, content, from_me, sender_user_id, sender_system_agent_id, type, api_message_status, created_at
         FROM messages
         WHERE chat_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [chat.id]
    );

    const messages = messagesRes.rows.reverse();
    const customerVisibleMessages = messages.filter((message: any) => (
        String(message.type || '').toLowerCase() !== 'system'
        && String(message.api_message_status || '').toLowerCase() !== 'internal'
        && !['failed', 'error'].includes(String(message.api_message_status || '').toLowerCase())
        && String(message.content || '').trim().length > 0
    ));
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

    let audioTranscriptionText = '';
    if (sourceMessageId) {
        const sourceMsgRes = await db.query(
            `SELECT type, transcription FROM messages WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
            [sourceMessageId, workspaceId]
        );
        const sourceRow = sourceMsgRes.rows[0];
        if (sourceRow?.type === 'audio' && sourceRow?.transcription) {
            audioTranscriptionText = sourceRow.transcription.trim();
        }
    }
    if (!audioTranscriptionText && mediaAnalysisContext) {
        const audioMatch = mediaAnalysisContext.match(/^\[(?:Analise automatica de audio|Áudio do cliente|Audio do cliente)\]\s*([\s\S]+)$/i);
        if (audioMatch?.[1]?.trim()) {
            audioTranscriptionText = audioMatch[1].trim();
        }
    }

    const effectiveCustomerMessage = (lastMessageContent || '').trim()
        ? (audioTranscriptionText ? `${(lastMessageContent || '').trim()}\n\n[Transcrição do áudio]: ${audioTranscriptionText}` : (lastMessageContent || '').trim())
        : (audioTranscriptionText || (mediaAnalysisContext ? mediaAnalysisContext.replace(/^\[(?:Analise automatica de [^\]]+)\]\s*/i, '').trim() : '') || '');

    const enrichedLastMessageContent = [
        effectiveCustomerMessage || lastMessageContent || '',
        mediaAnalysisContext && !effectiveCustomerMessage.includes(mediaAnalysisContext) ? mediaAnalysisContext : '',
    ].filter((part) => part.trim().length > 0).join('\n\n');
    // Human assistance has its own reasoning path and never opens or advances an autonomous Studio session.
    if (isSuggestionOnlyRuntime) {
        try {
            const release = await loadStudioRelease(workspaceId, autopilotConfig.id);
            if (release) {
                if (!sourceMessageId) throw new Error('O copiloto exige uma mensagem identificada.');
                const context = await loadStudioCopilotContext({ workspaceId, agentId: autopilotConfig.id, chatId: chat.id, messageId: sourceMessageId });
                const result = await runStudioCopilot({ release, workspaceId, agentId: autopilotConfig.id, chatId: chat.id,
                    message: effectiveCustomerMessage || lastMessageContent, mediaAnalysisContext, ...context });
                await context.assertCurrent();
                await publishSuggestion({ response: result.response, blocks: result.messageBlocks, stage: 'studio_copilot',
                    insights: { ...result.insights, contextMessageId: context.history.at(-1)?.messageId }, assertCurrent: context.assertCurrent });
                await finishOrchestratorRun({ run: orchestratorRun, status: 'success', timings: orchestratorTimings,
                    intent: result.insights.intent || 'agent_studio', metadata: { studioReleaseId: release.releaseId,
                        studioVersion: release.version, studioDecisionMode: 'copilot_advisory', suggestionOnly: true } });
                return;
            }
        } catch (error) {
            await finishOrchestratorRun({ run: orchestratorRun, status: 'error', timings: orchestratorTimings,
                intent: 'agent_studio', metadata: { studioDecisionMode: 'copilot_advisory', suggestionOnly: true } });
            throw error;
        }
    }
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

    // Studio publications own their entire journey. They never pass through the legacy canvas planner.
    const studioSelection = await selectStudioConversationRelease({ workspaceId, agentId: autopilotConfig.id, chatId: chat.id, sourceMessageId });
    if (studioSelection.release) {
        const pinnedRelease = studioSelection.release;
        let studioExecutionStage: 'runtime' | 'delivery' | 'recording' = 'runtime';
        let studioResultStatus: string | undefined;
        try {
            if (!sourceMessageId) throw new Error('O Estúdio exige uma mensagem identificada para executar com segurança.');
            const store = studioSelection.store;
            const allowedNative = ['transfer_chat', 'sgp_fetch_contracts', 'sgp_fetch_contact_panel_data', ...pinnedRelease.publishedProcedures.flatMap((procedure) => procedure.steps)
                .filter((step) => step.type === 'native_action')
                .map((step) => step.nativeActionType === 'update_crm_field' ? 'crm_update_contact_custom_fields' : step.nativeActionType || '')];
            const studioPolicy: AutopilotTurnPolicy = { activeNodeId: null, toolMode: 'on_demand', globallyEnabledToolNames: allowedNative,
                attachedToolNames: allowedNative, allowedToolNames: allowedNative, toolInstructionsByName: {},
                allowedKnowledgeDocumentIds: (pinnedRelease.knowledgeSnapshot || []).map((document) => String(document.id)), reason: 'studio_release' };
            const studioTurnStartedAt = Date.now();
            const result = await runStudioConversation({
                release: pinnedRelease, state: store.state,
                config: autopilotConfig, chatId: chat.id, messageId: sourceMessageId, message: effectiveCustomerMessage || lastMessageContent,
                mediaAnalysisContext,
                contact: sanitizedContact, chatHistory: chatHistoryForAI, suggestionOnly: isSuggestionOnlyRuntime,
                checkpoint: isSuggestionOnlyRuntime ? async () => {} : store.checkpoint,
                sendCatalogImage: async (image, operationId) => {
                    if (isSuggestionOnlyRuntime) throw new Error('Mídia não é enviada no modo de sugestão.');
                    await validateRemoteUrl(image.url);
                    await assertAutopilotSourceMessageCurrent({ chatId: chat.id, sourceMessageId });
                    const result = await sendAutomatedMediaAction(chat.id, image.caption, [{ base64: image.url, mimetype: image.mimeType, filename: `produto.${image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg'}`, mediatype: 'image' }], assignedSystemAgentId, instanceName,
                        { sourceMessageId: sourceMessageId || undefined, studioOperationId: operationId,
                          studioPresentedProduct: { productId: image.productId, caption: image.caption } });
                    if (!result.success) throw new Error(result.error || 'Não foi possível confirmar o envio da imagem.');
                },
                assertCurrent: () => assertAutopilotSourceMessageCurrent({ chatId: chat.id, sourceMessageId }),
                runNative: async (action, operation) => {
                    if (isSuggestionOnlyRuntime) throw new Error('Ações reais não são permitidas no modo de sugestão.');
                    let handoffBriefing = '';
                    if (action.type === 'transfer_chat') {
                        const team = availableTeams.find((item) => item.id === action.payload?.teamId || item.name === action.payload?.teamName);
                        if (!team) throw new Error('Equipe de destino indisponível neste workspace.');
                        // The briefing travels with the action but must not change what is being authorised.
                        handoffBriefing = (action.payload?.briefing || '').trim().slice(0, 2000);
                        action.payload = { teamId: team.id, teamName: team.name };
                    }
                    const fingerprint = fingerprintToolAction(action);
                    if (action.type === 'close_chat' && operation.confirmed) {
                        const goodbye = pinnedRelease.agentSnapshot.concludeStage.successClosingMessage;
                        if (goodbye) {
                            const delivery = await sendMultiBlockResponse(chat.id, goodbye, assignedSystemAgentId, true, instanceName, null, { ...responseTrace, deliveryKey: `studio-close:${operation.id}` }, { preserveFormatting: true });
                            if (!delivery.success) throw new Error('A despedida não pôde ser entregue; o atendimento não foi encerrado.');
                        }
                    }
                    // A handoff carries an internal note so the person taking over does not ask the customer again.
                    // The note runs first and never decides the outcome: only the action itself can fail the step.
                    const withNote = (names: string[]) => Array.from(new Set([...names, 'add_internal_note']));
                    const runPolicy: AutopilotTurnPolicy = handoffBriefing ? { ...studioPolicy, globallyEnabledToolNames: withNote(studioPolicy.globallyEnabledToolNames),
                        attachedToolNames: withNote(studioPolicy.attachedToolNames), allowedToolNames: withNote(studioPolicy.allowedToolNames) } : studioPolicy;
                    const results = await runRequestedAgentToolsWithStatus({
                        workspaceId, chat, contact: sanitizedContact, systemAgentId: assignedSystemAgentId,
                        systemAgentName: assignedSystemAgentName, autopilotConfig: { ...autopilotConfig, enabled_tool_names: handoffBriefing ? runPolicy.allowedToolNames : allowedNative },
                        turnPolicy: runPolicy, customerMessage: effectiveCustomerMessage || lastMessageContent, sourceMessageId,
                        orchestratorRunId: orchestratorRun.id,
                        actions: handoffBriefing ? [{ type: 'add_internal_note' as const, reason: 'Resumo da IA para continuidade humana.', payload: { content: handoffBriefing } }, action] : [action],
                        confirmedActionFingerprint: operation.confirmed ? fingerprint : null,
                        closeAuthorization: action.type === 'close_chat' && operation.confirmed ? {
                            source: 'procedure_goal_completed', chatId: chat.id, orchestratorRunId: orchestratorRun.id,
                            procedureExecutionId: operation.id, actionFingerprint: fingerprint,
                        } : null,
                    });
                    const actionResult = results[results.length - 1];
                    if (results.length !== (handoffBriefing ? 2 : 1) || actionResult?.status !== 'success') throw new Error(actionResult?.error || 'A ação não foi concluída.');
                    if (action.type === 'transfer_chat' && action.payload?.teamName) return { message: `Vou encaminhar seu atendimento para a equipe ${action.payload.teamName} continuar com você.` };
                },
            });
            studioResultStatus = result.state.status;
            studioExecutionStage = 'delivery';
            const studioSessionResolved = result.state.status === 'resolved' && result.state.phase === 'done' && !isSuggestionOnlyRuntime;
            // What this company chose for this agent in the Studio (versioned with the published release).
            const studioAutomationSettings = studioAutomation(pinnedRelease.agentSnapshot);
            const studioExplicitClose = studioSessionResolved && studioAutomationSettings.closeOnCustomerConfirmation;
            // The close decision comes before the reply is sent, so the promise guard knows whether "vou encerrar" is true.
            let studioCloseGate: StudioCloseGateResult | null = null;
            let studioCloseClassifierUsed = false;
            if (studioExplicitClose) {
                const customerText = effectiveCustomerMessage || lastMessageContent || '';
                studioCloseGate = evaluateStudioCloseGate({ state: result.state, customerMessage: customerText });
                // The phrase list alone refuses many real goodbyes. A model second opinion may only supply the missing
                // confirmation: when anything else blocks the close, it is not even asked.
                if (!studioCloseGate.close && studioCloseGate.blockedBy.length === 1 && studioCloseGate.blockedBy[0] === 'no_customer_confirmation'
                    && closingClassifierEligible(customerText)) {
                    studioCloseClassifierUsed = true;
                    // Replays and early returns of the runtime carry no classifier: the chat then simply stays open.
                    const classifyClosing = (result as { classifyClosing?: (message: string) => Promise<boolean> }).classifyClosing;
                    if (classifyClosing && await classifyClosing(customerText)) {
                        studioCloseGate = evaluateStudioCloseGate({ state: result.state, customerMessage: customerText, confirmedByClassifier: true });
                    }
                }
            }
            // Promise guard (3.4): the reply may not claim a transfer, close or action the system did not perform.
            // Default mode only observes and records; `enforce` removes the unsupported sentence before sending.
            const promiseMode = studioAutomationSettings.promiseGuard;
            let studioPromiseGuard: { mode: string; kinds: string[]; rewritten: boolean } | null = null;
            let studioReply = result.response;
            if (promiseMode !== 'off' && result.response && !isSuggestionOnlyRuntime) {
                // Legacy journeys keep no operation log: their actions are not judged, only transfer and close.
                const turnOperations = (result.state.reasoning?.operations || []).filter((operation) =>
                    operation.status === 'succeeded' && operation.capabilityId !== '_handoff' && Date.parse(operation.at) >= studioTurnStartedAt - 1000);
                const judged = Boolean(result.state.reasoning);
                const guarded = guardStudioPromises({ response: result.response, facts: {
                    transferred: result.state.status === 'transferred',
                    closing: studioCloseGate ? studioCloseGate.close : studioSessionResolved,
                    successfulWrites: judged ? turnOperations.filter((operation) => operation.readOnly === false).length : 1,
                    successfulOperations: judged ? turnOperations.length : 1 } });
                studioPromiseGuard = { mode: promiseMode, kinds: guarded.violations.map((violation) => violation.kind), rewritten: promiseMode === 'enforce' && guarded.changed };
                if (studioPromiseGuard.rewritten) studioReply = guarded.response;
            }
            if (studioReply) {
                await assertAutopilotSourceMessageCurrent({ chatId: chat.id, sourceMessageId });
                const delivery = await sendMultiBlockResponse(chat.id, studioReply, assignedSystemAgentId, true, instanceName, null,
                    { ...responseTrace, deliveryKey: `studio:${result.state.id}:${sourceMessageId}` }, { preserveFormatting: true });
                if (!delivery.success) throw new Error('A resposta do Estúdio não pôde ser entregue.');
            }
            // null = no close was attempted; true/false = the UPDATE below changed a row or not. The ledger records this
            // so "the session resolved" is never mistaken for "the chat was closed".
            let studioChatClosed: boolean | null = null;
            let studioCloseDecision: { mode: 'legacy' | 'explicit'; basis?: string | null; blockedBy?: string[]; classifier?: boolean } | null = null;
            if (studioExplicitClose && studioCloseGate) {
                // Explicit close (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.1): resolving the requests is only a
                // proposal. The chat closes when the gate agrees, through the same audited tool path as any close.
                const gate = studioCloseGate;
                studioCloseDecision = { mode: 'explicit', basis: gate.basis ?? null, blockedBy: gate.blockedBy, classifier: studioCloseClassifierUsed };
                if (gate.close) {
                    studioChatClosed = false;
                    try {
                        const closeAction = { type: 'close_chat' as const, reason: 'Cliente confirmou o encerramento.',
                            payload: { sendCloseMessage: false, notes: 'Encerrado pelo Estúdio com confirmação do cliente.' } };
                        const closeFingerprint = fingerprintToolAction(closeAction);
                        const withClose = (names: string[]) => Array.from(new Set([...names, 'close_chat']));
                        const closePolicy: AutopilotTurnPolicy = { ...studioPolicy, globallyEnabledToolNames: withClose(studioPolicy.globallyEnabledToolNames),
                            attachedToolNames: withClose(studioPolicy.attachedToolNames), allowedToolNames: withClose(studioPolicy.allowedToolNames) };
                        const closeResults = await runRequestedAgentToolsWithStatus({
                            workspaceId, chat, contact: sanitizedContact, systemAgentId: assignedSystemAgentId,
                            systemAgentName: assignedSystemAgentName, autopilotConfig: { ...autopilotConfig, enabled_tool_names: closePolicy.allowedToolNames },
                            turnPolicy: closePolicy, customerMessage: effectiveCustomerMessage || lastMessageContent || '', sourceMessageId,
                            orchestratorRunId: orchestratorRun.id, actions: [closeAction], confirmedActionFingerprint: closeFingerprint,
                            closeAuthorization: { source: 'procedure_goal_completed', chatId: chat.id, orchestratorRunId: orchestratorRun.id,
                                procedureExecutionId: `studio-close:${result.state.id}`, actionFingerprint: closeFingerprint },
                        });
                        const closeResult = closeResults.find((item) => item.toolName === 'close_chat');
                        studioChatClosed = closeResult?.status === 'success';
                        // The reply is already delivered: a failed close must not fail the run, only be visible.
                        if (!studioChatClosed) console.error('[STUDIO_EXPLICIT_CLOSE] O encerramento não foi concluído:', closeResult?.error);
                    } catch (closeError) {
                        console.error('[STUDIO_EXPLICIT_CLOSE] Falha ao encerrar o atendimento:', closeError);
                    }
                }
            } else if (studioSessionResolved) {
                studioCloseDecision = { mode: 'legacy' };
                studioChatClosed = false;
                try {
                    const closedChat = await db.query(
                        `UPDATE chats
                         SET status = 'encerrados',
                             closed_at = clock_timestamp(),
                             close_notes = COALESCE(close_notes, $1),
                             closed_by_system_agent_id = COALESCE(closed_by_system_agent_id, $2),
                             last_action_at = clock_timestamp(),
                             updated_at = clock_timestamp()
                         WHERE id = $3 AND workspace_id = $4 AND status != 'encerrados'`,
                        [
                            pinnedRelease.agentSnapshot.concludeStage.successClosingMessage || 'Atendimento concluído pelo Estúdio.',
                            assignedSystemAgentId,
                            chat.id,
                            workspaceId,
                        ],
                    );
                    studioChatClosed = (closedChat.rowCount ?? 0) > 0;
                } catch (closeError) {
                    console.error('[STUDIO_AUTO_CLOSE_CHAT] Falha ao atualizar status do chat para encerrados:', closeError);
                }
            }
            studioExecutionStage = 'recording';
            // Phase 0 (docs/PLAN-ia-autonoma-transferir-encerrar.md): one auditable decision per turn.
            // Replays are skipped so a redelivered message never counts twice; the recorder never throws.
            if (!result.replay) {
                await recordAgentDecisionLedger(buildStudioDecisionLedgerEntry({
                    workspaceId, chatId: chat.id, messageId: sourceMessageId, runId: orchestratorRun.id,
                    systemAgentId: assignedSystemAgentId, autopilotConfigId: autopilotConfig.id,
                    releaseId: pinnedRelease.releaseId, releaseVersion: pinnedRelease.version, state: result.state,
                    decisionMode: pinnedRelease.agentSnapshot.resolveStage.conversationMode === 'adaptive'
                        && pinnedRelease.agentSnapshot.resolveStage.reasoning?.enabled ? 'model_reasoning' : 'published_journey',
                    suggestionOnly: isSuggestionOnlyRuntime, replay: result.replay, chatClosed: studioChatClosed,
                    closeDecision: studioCloseDecision, promiseGuard: studioPromiseGuard,
                }));
            }
            await finishOrchestratorRun({ run: orchestratorRun, status: 'success', timings: orchestratorTimings,
                intent: 'agent_studio',
                metadata: { studioReleaseId: pinnedRelease.releaseId, studioVersion: pinnedRelease.version,
                    studioDecisionMode: pinnedRelease.agentSnapshot.resolveStage.conversationMode === 'adaptive'
                        && pinnedRelease.agentSnapshot.resolveStage.reasoning?.enabled ? 'model_reasoning' : 'published_journey',
                    studioStatus: result.state.status, suggestionOnly: isSuggestionOnlyRuntime, replay: result.replay } });
        } catch (error) {
            await finishOrchestratorRun({ run: orchestratorRun, status: 'error', timings: orchestratorTimings,
                intent: 'agent_studio', metadata: { studioReleaseId: pinnedRelease.releaseId,
                    studioStatus: studioResultStatus || 'failed', studioFailureStage: studioExecutionStage } });
            // Do not fall back to a second runtime or replay side effects after an uncertain result.
            throw error;
        }
        return;
    }

    const contactIdForMemory = sanitizedContact.id
        || (chat as { contact_id?: string | null }).contact_id
        || null;
    const contactMemoryMaxAgeDays = Math.min(
        730,
        Math.max(1, Number(process.env.AUTOPILOT_CONTACT_MEMORY_TTL_DAYS || 180) || 180),
    );
    const autopilotContactMemory: AutopilotContactMemory = contactIdForMemory
        ? await loadAutopilotContactMemory({
            workspaceId,
            contactId: contactIdForMemory,
            chatId: chat.id,
            maxAgeDays: contactMemoryMaxAgeDays,
        }).catch((error) => {
            console.warn('[AUTOPILOT_CONTACT_MEMORY] Failed to hydrate structured memory:', error);
            return { slots: {}, nativeState: {}, updatedAt: null };
        })
        : { slots: {}, nativeState: {}, updatedAt: null };
    const currentSlotExtraction = extractAutopilotSlots({
        customerMessage: enrichedLastMessageContent || '',
        chatHistory: chatHistoryForAI,
        contact: sanitizedContact,
        rememberedSlots: autopilotContactMemory.slots,
    });
    const rawConversationFieldsState = autopilotContactMemory.nativeState[CONVERSATION_KNOWN_FIELDS_STATE_KEY];
    const rememberedConversationFields = rawConversationFieldsState
        && typeof rawConversationFieldsState === 'object'
        && !Array.isArray(rawConversationFieldsState)
        && String((rawConversationFieldsState as Record<string, unknown>).autopilotConfigId || '') === autopilotConfig.id
        && String((rawConversationFieldsState as Record<string, unknown>).workflowId || '') === String(autopilotConfig.active_workflow_id || '')
        && String((rawConversationFieldsState as Record<string, unknown>).workflowVersion || '') === String(autopilotConfig.active_workflow_version || '')
        ? sanitizeConversationKnownFields((rawConversationFieldsState as Record<string, unknown>).fields)
        : {};
    const structuredKnownFields: Record<string, unknown> = {
        ...rememberedConversationFields,
        ...buildStructuredKnownFields(
            sanitizedContact,
            currentSlotExtraction.slots,
            currentSlotExtraction.invalidSlots,
        ),
    };
    for (const [field, value] of Object.entries(structuredKnownFields)) {
        if (canonicalWorkflowFieldName(field) === 'invoice_or_payment_id'
            && !/^[a-z0-9-]*\d[a-z0-9-]*$/i.test(String(value))) delete structuredKnownFields[field];
    }
    const focusedConversationFields: Record<string, string> = focusedContractId
        ? { contract_id: focusedContractId }
        : {};
    // The latest contract explicitly selected by the customer is authoritative
    // for this chat. Promote it to structured memory instead of leaving it only
    // in prompt prose, so tool dependencies and later turns use the same scope.
    Object.assign(structuredKnownFields, focusedConversationFields);
    const invalidCanonicalFields = new Set(
        currentSlotExtraction.invalidSlots.map((slot) => canonicalWorkflowFieldName(slot.name)),
    );
    for (const field of Object.keys(structuredKnownFields)) {
        if (invalidCanonicalFields.has(canonicalWorkflowFieldName(field))) {
            delete structuredKnownFields[field];
        }
    }
    const parsedCollectionCheckpoint = parseCollectionCompletionCheckpoint(
        autopilotContactMemory.nativeState[COLLECTION_COMPLETION_STATE_KEY],
    );
    const activeCollectionCheckpoint = (
        parsedCollectionCheckpoint?.status === 'awaiting_fields'
        && parsedCollectionCheckpoint.chatId === chat.id
        && parsedCollectionCheckpoint.autopilotConfigId === autopilotConfig.id
        && parsedCollectionCheckpoint.workflowId === String(autopilotConfig.active_workflow_id || '')
        && parsedCollectionCheckpoint.workflowVersion === String(autopilotConfig.active_workflow_version || '')
    ) ? parsedCollectionCheckpoint : null;
    const currentSourceIndex = sourceMessageId
        ? customerVisibleMessages.findIndex((message: any) => String(message.id || '') === sourceMessageId)
        : -1;
    const messagesBeforeCurrentSource = currentSourceIndex >= 0
        ? customerVisibleMessages.slice(0, currentSourceIndex)
        : sourceMessageId ? [] : customerVisibleMessages.slice(0, -1);
    const collectionStartedAtMs = activeCollectionCheckpoint
        ? new Date(activeCollectionCheckpoint.collectionStartedAt).getTime()
        : Number.POSITIVE_INFINITY;
    const currentSourceCreatedAtMs = currentSourceIndex >= 0
        ? new Date(customerVisibleMessages[currentSourceIndex]?.created_at).getTime()
        : Date.now();
    const collectionHistoryLowerBoundMs = Math.max(
        collectionStartedAtMs - 10_000,
        (Number.isFinite(currentSourceCreatedAtMs) ? currentSourceCreatedAtMs : Date.now()) - (30 * 60_000),
    );
    const currentCollectionMessages = messagesBeforeCurrentSource.filter((message: any) => {
        const createdAtMs = new Date(message.created_at).getTime();
        return Number.isFinite(createdAtMs) && createdAtMs >= collectionHistoryLowerBoundMs;
    });
    const recoveredCollectionHistoryFields = activeCollectionCheckpoint
        ? extractPendingCollectionHistoryFields({
            messages: currentCollectionMessages.map((message: any) => ({
                fromMe: Boolean(message.from_me),
                content: String(message.content || ''),
            })),
            pendingFields: activeCollectionCheckpoint.pendingFields,
            alreadyKnownFields: structuredKnownFields,
        })
        : {};
    Object.assign(structuredKnownFields, recoveredCollectionHistoryFields);
    const previousCollectionQuestion = activeCollectionCheckpoint
        ? findPendingCollectionQuestion({
            messages: currentCollectionMessages.map((message: any) => ({
                fromMe: Boolean(message.from_me),
                content: String(message.content || ''),
            })),
            pendingFields: activeCollectionCheckpoint.pendingFields,
        })
        : null;
    const pendingCollectionReplyFields = activeCollectionCheckpoint
        ? extractPendingCollectionReplyFields({
            customerMessage: enrichedLastMessageContent || '',
            pendingFields: activeCollectionCheckpoint.pendingFields,
            alreadyKnownFields: structuredKnownFields,
            previousQuestion: String(previousCollectionQuestion || ''),
        })
        : {};
    Object.assign(structuredKnownFields, pendingCollectionReplyFields);

    // The deterministic parser above only accepts "label: value", a single-field
    // answer, or a lone remaining field. A plain "Joao Silva, 11 99999-8888,
    // joao@x.com" loses every value and the agent re-asks. Read whatever it left
    // behind with the model; each value still goes through the same validators.
    const aiExtractedCollectionFields: Record<string, string> = {};
    const fieldsMissingAfterDeterministic = activeCollectionCheckpoint
        ? activeCollectionCheckpoint.pendingFields.filter(
            (field) => !hasKnownWorkflowField(field, structuredKnownFields),
        )
        : [];
    if (isAiFieldExtractionEnabled() && fieldsMissingAfterDeterministic.length > 0) {
        try {
            const extractionStage = await timeOrchestratorStage(
                orchestratorRun,
                'collection_field_extractor_ai',
                () => extractCollectionFieldsWithAi({
                    customerMessage: enrichedLastMessageContent || '',
                    pendingFields: fieldsMissingAfterDeterministic,
                    previousQuestion: previousCollectionQuestion,
                    chatHistory: chatHistoryForAI,
                    workspaceId,
                }),
                { pendingFields: fieldsMissingAfterDeterministic },
            );
            Object.assign(aiExtractedCollectionFields, extractionStage.value);
            Object.assign(structuredKnownFields, extractionStage.value);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'collection_field_extractor_ai',
                status: 'success',
                payload: {
                    requestedFields: fieldsMissingAfterDeterministic,
                    extractedFields: Object.keys(extractionStage.value),
                },
            });
        } catch (error) {
            // Collection must survive an extractor outage: the deterministic
            // fields already applied and the agent re-asks the rest.
            console.warn('[AI_FIELD_EXTRACTOR] Stage failed, keeping deterministic fields only:', error);
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'collection_field_extractor_ai',
                status: 'fallback',
                payload: {
                    requestedFields: fieldsMissingAfterDeterministic,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    const messageSlotDetails = currentSlotExtraction.details.filter((detail) => detail.source === 'message');
    const messageSlotsToPersist = Object.fromEntries(
        messageSlotDetails.map((detail) => [detail.name, detail.value]),
    );
    const collectionPersistenceReceipts: PersistedCollectionFieldReceipt[] = [];
    const discoveredConversationFields = sanitizeConversationKnownFields({
        ...focusedConversationFields,
        ...recoveredCollectionHistoryFields,
        ...pendingCollectionReplyFields,
        ...aiExtractedCollectionFields,
    });
    let conversationFieldsPersisted = true;
    if (Object.keys(discoveredConversationFields).length > 0) {
        const mergedConversationFields = sanitizeConversationKnownFields({
            ...discoveredConversationFields,
            ...rememberedConversationFields,
            ...discoveredConversationFields,
        });
        try {
            await saveAutopilotNativeState({
                chatId: chat.id,
                workspaceId,
                autopilotConfigId: autopilotConfig.id,
                state: {
                    [CONVERSATION_KNOWN_FIELDS_STATE_KEY]: {
                        autopilotConfigId: autopilotConfig.id,
                        workflowId: String(autopilotConfig.active_workflow_id || ''),
                        workflowVersion: String(autopilotConfig.active_workflow_version || ''),
                        fields: mergedConversationFields,
                        updatedAt: new Date().toISOString(),
                    },
                },
            });
            autopilotContactMemory.nativeState[CONVERSATION_KNOWN_FIELDS_STATE_KEY] = {
                autopilotConfigId: autopilotConfig.id,
                workflowId: String(autopilotConfig.active_workflow_id || ''),
                workflowVersion: String(autopilotConfig.active_workflow_version || ''),
                fields: mergedConversationFields,
                updatedAt: new Date().toISOString(),
            };
            const persistedAt = new Date().toISOString();
            for (const [field, value] of Object.entries(pendingCollectionReplyFields)) {
                collectionPersistenceReceipts.push(createPersistedCollectionFieldReceipt({
                    field,
                    value,
                    storage: 'slot_memory',
                    storageKey: `${CONVERSATION_KNOWN_FIELDS_STATE_KEY}.fields.${field}`,
                    sourceMessageId: sourceMessageId || '',
                    persistedAt,
                }));
            }
        } catch (error) {
            conversationFieldsPersisted = false;
            console.warn('[AUTOPILOT_CONTACT_MEMORY] Failed to persist conversation fields:', error);
        }
    }
    const configuredFallbackReply = autopilotConfig.default_fallback_reply?.trim() || '';
    const safeConfiguredFallbackReply = configuredFallbackReply && !isGenericInstabilityReply(configuredFallbackReply)
        ? chooseNonRepeatingCollectionFallback({
            configuredFallback: configuredFallbackReply,
            knownFields: structuredKnownFields,
            genericFallback: '',
        })
        : '';
    const contextualFallbackReply = (documents: KnowledgeBaseDocument[] = []) => buildContextualAutopilotFallback({
        intent: intentResolution.intent,
        customerMessage: enrichedLastMessageContent || lastMessageContent || '',
        knowledgeDocuments: documents,
        configuredFallback: safeConfiguredFallbackReply,
    });
    let slotMemoryPersisted = true;
    if (messageSlotDetails.length > 0) {
        try {
            await saveAutopilotSlotMemory({
                chatId: chat.id,
                workspaceId,
                autopilotConfigId: autopilotConfig.id,
                slots: messageSlotsToPersist,
            });
            const persistedAt = new Date().toISOString();
            for (const detail of messageSlotDetails) {
                collectionPersistenceReceipts.push(createPersistedCollectionFieldReceipt({
                    field: detail.name,
                    value: detail.value,
                    storage: 'slot_memory',
                    sourceMessageId: sourceMessageId || '',
                    persistedAt,
                }));
            }
        } catch (error) {
            slotMemoryPersisted = false;
            console.warn('[AUTOPILOT_CONTACT_MEMORY] Failed to persist structured slots:', error);
        }
    }
    let contactFactsPersisted = true;
    try {
        const persistence = await persistAutopilotContactFacts({
            workspaceId,
            contactId: contactIdForMemory,
            details: messageSlotDetails,
            customerMessage: enrichedLastMessageContent || '',
        });
        const hasCoreFacts = messageSlotDetails.some((detail) => ['name', 'email', 'address'].includes(detail.name));
        contactFactsPersisted = !hasCoreFacts || persistence.persisted;
        if (persistence.persisted) {
            const persistedAt = new Date().toISOString();
            for (const field of persistence.fields) {
                const detail = messageSlotDetails.find((item) => item.name === field);
                if (!detail) continue;
                collectionPersistenceReceipts.push(createPersistedCollectionFieldReceipt({
                    field,
                    value: detail.value,
                    storage: 'contact',
                    sourceMessageId: sourceMessageId || '',
                    persistedAt,
                }));
            }
        }
    } catch (error) {
        contactFactsPersisted = false;
        console.warn('[AUTOPILOT_CONTACT_FACTS] Failed to persist collected contact facts:', error);
    }

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
    const explicitConversationCloseRequest = isConversationCloseRequest(
        enrichedLastMessageContent || '',
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
        extractedSlots: currentSlotExtraction.slots,
    });
    const deterministicIntentResolution = intentResolution;

    if (!deterministicOperationalTurn && !explicitConversationCloseRequest && shouldUseAiIntentClassifier({
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
                        model: aiDecisionModels.intentClassifier.model,
                        apiKey: workspaceGeminiApiKey,
                        workspaceId,
                        timeoutMs: aiDecisionModels.intentClassifier.timeoutMs,
                    }),
                    aiDecisionModels.intentClassifier.timeoutMs + 500,
                    'intent classifier'
                ),
                {
                    deterministicIntent: deterministicIntentResolution.intent,
                    deterministicConfidence: deterministicIntentResolution.confidence,
                    model: aiDecisionModels.intentClassifier.model,
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
                    extractedSlots: currentSlotExtraction.slots,
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

    traceCopilotInsights({
        intent: intentResolution.intent,
        intentConfidence: intentResolution.confidence ?? null,
        workflowId: intentResolution.workflowId ?? null,
    });

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
    const compiledTurnPolicy = compileAutopilotTurnPolicy({
        config: autopilotConfig,
        documents: staticKnowledgeDocuments,
        intentScope: activeFlowIntentScope,
        persistedActiveNodeId: effectivePersistedActiveNodeId,
    });
    // A proposal must never change the customer's world before a human approves it.
    // In suggestion mode the agent may still read (contracts, invoices, panels) so the
    // draft is grounded in real data, but every write, handoff or lifecycle tool is off.
    const turnPolicy = isSuggestionOnlyRuntime
        ? {
            ...compiledTurnPolicy,
            allowedToolNames: filterNonMutatingToolNames(compiledTurnPolicy.allowedToolNames, runtimeToolCatalog),
            globallyEnabledToolNames: filterNonMutatingToolNames(
                compiledTurnPolicy.globallyEnabledToolNames,
                runtimeToolCatalog,
            ),
        }
        : compiledTurnPolicy;
    enabledToolNames = turnPolicy.allowedToolNames;
    const agentRuntimeContext = buildUniversalAgentRuntimeContext({
        domainPack: orchestratorRun.domainPack,
        task: orchestratorRun.taskExecution,
        fallbackAgentName: assignedSystemAgentName,
        enabledToolNames,
    });
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

    let crmCustomFieldsPersisted = true;
    if (
        currentCopilotMode === 'auto'
        && sourceMessageId
        && (messageSlotDetails.length > 0 || Object.keys(pendingCollectionReplyFields).length > 0)
    ) {
        const messageSlotExtraction: SlotExtractionResult = {
            slots: Object.fromEntries(messageSlotDetails.map((detail) => [detail.name, detail.value])),
            details: messageSlotDetails,
            invalidSlots: currentSlotExtraction.invalidSlots,
        };
        const crmProjection = await mapCrmContactCustomFields({
            workspaceId,
            customerMessage: enrichedLastMessageContent || '',
            chatHistory: chatHistoryForAI,
            contact: sanitizedContact,
            slotExtraction: messageSlotExtraction,
            fields: pendingCollectionReplyFields,
            reason: 'Persistência determinística dos dados informados pelo cliente neste turno.',
        }).catch((error) => {
            crmCustomFieldsPersisted = false;
            console.warn('[AUTOPILOT_CRM_PROJECTION] Failed to map collected fields:', error);
            return null;
        });
        if (crmProjection?.mappedAction) {
            const crmTurnPolicy: AutopilotTurnPolicy = {
                ...turnPolicy,
                globallyEnabledToolNames: Array.from(new Set([
                    ...turnPolicy.globallyEnabledToolNames,
                    'crm_update_contact_custom_fields',
                ])),
                allowedToolNames: Array.from(new Set([
                    ...turnPolicy.allowedToolNames,
                    'crm_update_contact_custom_fields',
                ])),
            };
            const crmResults = await runRequestedAgentToolsWithStatus({
                workspaceId,
                chat,
                contact: sanitizedContact,
                systemAgentId: assignedSystemAgentId,
                systemAgentName: assignedSystemAgentName,
                autopilotConfig,
                turnPolicy: crmTurnPolicy,
                customerMessage: enrichedLastMessageContent || '',
                actions: [crmProjection.mappedAction],
                chatHistory: chatHistoryForAI,
                slotExtraction: messageSlotExtraction,
                orchestratorRunId: orchestratorRun.id,
                sourceMessageId,
            });
            crmCustomFieldsPersisted = (
                crmProjection.rejected.length === 0
                && crmResults.every((result) => result.status === 'success')
            );
            const crmResult = crmResults.find((result) => result.toolName === 'crm_update_contact_custom_fields');
            const updatedFields = Array.isArray(crmResult?.output?.updated)
                ? crmResult.output.updated as Array<Record<string, unknown>>
                : [];
            const persistedAt = new Date().toISOString();
            for (const mapping of crmProjection.mappings) {
                const wasUpdated = updatedFields.some((field) => (
                    String(field.fieldId || '') === mapping.fieldId
                    && String(field.value || '') === mapping.value
                ));
                if (!wasUpdated) continue;
                collectionPersistenceReceipts.push(createPersistedCollectionFieldReceipt({
                    field: mapping.slot,
                    value: mapping.value,
                    storage: 'crm_custom_field',
                    storageKey: mapping.fieldId,
                    sourceMessageId: sourceMessageId || '',
                    persistedAt,
                }));
            }
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'crm_slot_projection',
                status: crmResults.every((result) => result.status === 'success') ? 'success' : 'fallback',
                payload: {
                    mappedFieldCount: crmProjection.mappings.length,
                    rejectedFieldCount: crmProjection.rejected.length,
                    toolStatuses: crmResults.map((result) => result.status),
                },
            });
        } else if (crmProjection && crmProjection.rejected.length > 0) {
            crmCustomFieldsPersisted = false;
        }
    }

    if (
        currentCopilotMode === 'auto'
        && sourceMessageId
        && explicitConversationCloseRequest
    ) {
        const closeAction: AgentToolAction = {
            type: 'close_chat',
            reason: 'Cliente pediu explicitamente para encerrar a conversa atual.',
            payload: {
                notes: 'Encerramento explícito solicitado pelo cliente e executado antes da confirmação ao cliente.',
                sendCloseMessage: false,
            },
        };
        const closeStage = await timeOrchestratorStage(
            orchestratorRun,
            'tool_execution',
            () => runRequestedAgentToolsWithStatus({
                workspaceId,
                chat,
                contact: sanitizedContact,
                systemAgentId: assignedSystemAgentId,
                systemAgentName: assignedSystemAgentName,
                autopilotConfig,
                turnPolicy: {
                    ...turnPolicy,
                    globallyEnabledToolNames: Array.from(new Set([...turnPolicy.globallyEnabledToolNames, 'close_chat'])),
                    allowedToolNames: Array.from(new Set([...turnPolicy.allowedToolNames, 'close_chat'])),
                },
                customerMessage: enrichedLastMessageContent || '',
                actions: [closeAction],
                orchestratorRunId: orchestratorRun.id,
                sourceMessageId,
            }),
            { explicitConversationClose: true },
        );
        orchestratorTimings.tool_ms = (orchestratorTimings.tool_ms || 0) + closeStage.durationMs;
        const closeResult = closeStage.value.find((result) => result.toolName === 'close_chat');
        const closeSucceeded = closeResult?.status === 'success';
        const closeResponse = closeSucceeded
            ? 'Atendimento encerrado. Obrigado pelo contato! Quando precisar, é só chamar novamente.'
            : 'Não consegui concluir o encerramento automático agora. Seu atendimento continua aberto para acompanhamento.';
        const delivery = await sendMultiBlockResponse(
            chat.id,
            closeResponse,
            assignedSystemAgentId,
            true,
            instanceName,
            null,
            { ...responseTrace, deliveryKey: 'explicit-close' },
        );
        await logIntelligentAttendantResponse({
            configId: autopilotConfig.id,
            chatId: chat.id,
            systemAgentId: assignedSystemAgentId,
            modelName: 'deterministic-explicit-close',
            customerMessage: enrichedLastMessageContent || '',
            response: closeResponse,
            status: delivery.success ? 'sent' : 'error',
            triggeredRule: null,
            metadata: {
                explicitConversationClose: true,
                closeToolStatus: closeResult?.status || 'missing',
            },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: closeSucceeded && delivery.success ? 'success' : 'fallback',
            timings: orchestratorTimings,
            intent: intentResolution.intent,
            confidenceLevel: 'deterministic',
            confidenceScore: intentResolution.confidence,
            metadata: {
                explicitConversationClose: true,
                closeSucceeded,
                responseSent: delivery.success,
            },
        });
        return;
    }

    if (
        currentCopilotMode === 'auto'
        && sourceMessageId
        && autopilotConfig.workflow_builder_mode === 'native_v2'
    ) {
        const verificationReceiptTtlDays = Math.max(
            1,
            Math.min(90, Number(process.env.AUTOPILOT_VERIFICATION_RECEIPT_TTL_DAYS || 30) || 30),
        );
        const contactVerificationReceipts = contactIdForMemory
            ? await loadRecentContactVerificationReceipts({
                workspaceId,
                contactId: contactIdForMemory,
                toolNames: runtimeToolCatalog.map((tool) => tool.name),
                maxAgeDays: verificationReceiptTtlDays,
            })
            : [];
        const responseTimeZone = await getWorkspaceTimezone(workspaceId);
        let collectionCloseSucceeded = false;
        const nativeStage = await timeOrchestratorStage(
            orchestratorRun,
            'workflow_runtime_v2_primary',
            () => runAutopilotWorkflowRuntimeV2Primary({
                config: autopilotConfig,
                customerMessage: enrichedLastMessageContent || '',
                chatId: chat.id,
                sourceMessageId,
                staticDocuments: staticKnowledgeDocuments,
                dependencies: {
                    database: db,
                    responseTimeZone,
                    toolContext: {
                        workspaceId,
                        chat,
                        contact: sanitizedContact,
                        systemAgentId: assignedSystemAgentId,
                        systemAgentName: assignedSystemAgentName,
                        autopilotConfig,
                        turnPolicy,
                        customerMessage: enrichedLastMessageContent || '',
                        recentCustomerVisibleMessages: customerVisibleMessages.map((message: any) => ({
                            fromMe: Boolean(message.from_me),
                            content: String(message.content || ''),
                        })),
                        allowRecentConversationalConfirmation: true,
                        orchestratorRunId: orchestratorRun.id,
                        sourceMessageId,
                    },
                    reportToolStatus: async (event) => {
                        await insertAgentToolStatusMessage({
                            workspaceId,
                            chatId: chat.id,
                            systemAgentId: assignedSystemAgentId,
                            content: event.status === 'running'
                                ? `Executando ferramenta: ${event.toolName}.`
                                : event.result
                                    ? summarizeAgentToolResult(event.result)
                                    : `Ferramenta ${event.toolName}: ${event.status}.`,
                            toolName: event.toolName,
                            status: event.status,
                            runId: event.runId,
                            toolResult: event.result,
                        });
                    },
                    recentMessages: customerVisibleMessages.map((message: any) => ({
                        fromMe: Boolean(message.from_me),
                        content: String(message.content || ''),
                    })),
                    structuredMemory: {
                        knownFields: structuredKnownFields,
                        knownFieldSources: Object.fromEntries(
                            [
                                ...Object.keys(crmCustomFields).map((key) => [key, 'crm'] as const),
                                ...['name', 'email', 'phone', 'address'].map((key) => [key, 'contact'] as const),
                                ...Object.keys(rememberedConversationFields).map((key) => [key, 'conversation_memory'] as const),
                                ...Object.keys(recoveredCollectionHistoryFields).map((key) => [key, 'conversation_history'] as const),
                                ...Object.keys(pendingCollectionReplyFields).map((key) => [key, 'current_reply'] as const),
                                ...currentSlotExtraction.details.map((detail) => [detail.name, detail.source] as const),
                            ],
                        ),
                        rememberedAcrossChats: Object.keys(autopilotContactMemory.slots).length > 0,
                        rememberedInConversation: Object.keys(rememberedConversationFields).length > 0,
                        rememberedAt: autopilotContactMemory.updatedAt,
                        previousVerificationReceipts: contactVerificationReceipts,
                        verificationPolicy: contactVerificationReceipts.length > 0
                            ? 'A identidade/contexto deste mesmo contato já foi verificada pelas ferramentas listadas e o comprovante ainda está válido. Não peça novamente dados estáveis já conhecidos. Reexecute a ferramenta somente se o cliente alterou a identidade ou pediu informação operacional atualizada.'
                            : 'Nenhum comprovante operacional anterior válido foi encontrado. Use os campos estáveis conhecidos, mas valide operações externas quando necessário.',
                        nativeState: autopilotContactMemory.nativeState,
                        systemOperations: {
                            slot_memory_persisted: slotMemoryPersisted,
                            contact_facts_persisted: contactFactsPersisted,
                            crm_custom_fields_persisted: crmCustomFieldsPersisted,
                            conversation_fields_persisted: conversationFieldsPersisted,
                        },
                        policy: 'Use os campos conhecidos; nunca solicite novamente um campo ja preenchido. Revalide apenas resultados operacionais que possam ter mudado.',
                    },
                    sendResponse: async (message, nodeInput, preparation) => {
                        await assertAutopilotSourceMessageCurrent({
                            chatId: chat.id,
                            sourceMessageId,
                        });
                        const directAgentToolFailure = directAgentRouteHasFailedToolCalls(nodeInput);
                        if (activeCollectionCheckpoint && directAgentToolFailure) {
                            try {
                                await clearAutopilotCollectionCompletion({
                                    chatId: chat.id,
                                    workspaceId,
                                    checkpointFingerprint: activeCollectionCheckpoint.checkpointFingerprint,
                                });
                            } catch (error) {
                                console.warn('[AUTOPILOT_COLLECTION_CLOSE] Failed to invalidate checkpoint after agent tool failure:', error);
                                throw error;
                            }
                            delete autopilotContactMemory.nativeState[COLLECTION_COMPLETION_STATE_KEY];
                        }
                        const collectionRoute = inspectCollectionResponseRoute(nodeInput, message);
                        let messageToSend = message;
                        if (collectionRoute?.kind === 'completed' && activeCollectionCheckpoint) {
                            const closeDecision = evaluateCompletedCollectionClose({
                                checkpoint: activeCollectionCheckpoint,
                                route: collectionRoute,
                                chatId: chat.id,
                                autopilotConfigId: autopilotConfig.id,
                                sourceMessageId,
                                knownFields: structuredKnownFields,
                                receipts: collectionPersistenceReceipts,
                                invalidFieldNames: currentSlotExtraction.invalidSlots.map((slot) => slot.name),
                            });
                            if (closeDecision.allowed && closeDecision.persistenceReceiptFingerprint) {
                                const claimed = await claimAutopilotCollectionCompletion({
                                    chatId: chat.id,
                                    workspaceId,
                                    checkpointFingerprint: activeCollectionCheckpoint.checkpointFingerprint,
                                    completionExecutionId: collectionRoute.executionId,
                                }).catch((error) => {
                                    console.warn('[AUTOPILOT_COLLECTION_CLOSE] Failed to claim collection checkpoint:', error);
                                    return false;
                                });
                                if (claimed) {
                                    try {
                                    const closeAction: AgentToolAction = {
                                        type: 'close_chat',
                                        reason: 'Coleta solicitada pelo agente concluída e persistida com sucesso.',
                                        payload: {
                                            notes: 'Encerramento sistêmico após ciclo comprovado de coleta de dados.',
                                            sendCloseMessage: false,
                                        },
                                    };
                                    const [closeResult] = await runRequestedAgentToolsWithStatus({
                                        workspaceId,
                                        chat,
                                        contact: sanitizedContact,
                                        systemAgentId: assignedSystemAgentId,
                                        systemAgentName: assignedSystemAgentName,
                                        autopilotConfig,
                                        turnPolicy: {
                                            ...turnPolicy,
                                            globallyEnabledToolNames: Array.from(new Set([...turnPolicy.globallyEnabledToolNames, 'close_chat'])),
                                            allowedToolNames: Array.from(new Set([...turnPolicy.allowedToolNames, 'close_chat'])),
                                        },
                                        customerMessage: enrichedLastMessageContent || '',
                                        actions: [closeAction],
                                        closeAuthorization: {
                                            source: 'conversation_collection_completed',
                                            chatId: chat.id,
                                            orchestratorRunId: orchestratorRun.id,
                                            sourceMessageId,
                                            workflowId: collectionRoute.workflowId,
                                            workflowVersion: collectionRoute.workflowVersion,
                                            needsInputExecutionId: activeCollectionCheckpoint.needsInputExecutionId,
                                            completionExecutionId: collectionRoute.executionId,
                                            agentNodeId: collectionRoute.agentNodeId,
                                            terminalNodeId: collectionRoute.respondNodeId,
                                            pendingFieldsFingerprint: activeCollectionCheckpoint.pendingFieldsFingerprint,
                                            persistenceReceiptFingerprint: closeDecision.persistenceReceiptFingerprint,
                                            checkpointFingerprint: activeCollectionCheckpoint.checkpointFingerprint,
                                            actionFingerprint: fingerprintToolAction(closeAction),
                                        },
                                        orchestratorRunId: orchestratorRun.id,
                                        sourceMessageId,
                                    });
                                    collectionCloseSucceeded = closeResult?.status === 'success';
                                    if (!collectionCloseSucceeded) {
                                        await clearAutopilotCollectionCompletion({
                                            chatId: chat.id,
                                            workspaceId,
                                            checkpointFingerprint: activeCollectionCheckpoint.checkpointFingerprint,
                                        }).catch(() => false);
                                        messageToSend = 'Recebi suas informações, mas não consegui concluir o encerramento automático agora. O atendimento continuará aberto para acompanhamento.';
                                    }
                                    } catch (error) {
                                        await clearAutopilotCollectionCompletion({
                                            chatId: chat.id,
                                            workspaceId,
                                            checkpointFingerprint: activeCollectionCheckpoint.checkpointFingerprint,
                                        }).catch(() => false);
                                        console.warn('[AUTOPILOT_COLLECTION_CLOSE] Close failed after checkpoint claim:', error);
                                        messageToSend = 'Recebi suas informações, mas não consegui concluir o encerramento automático agora. O atendimento continuará aberto para acompanhamento.';
                                    }
                                } else {
                                    const statusResult = await db.query(
                                        'SELECT status FROM chats WHERE id = $1 AND workspace_id = $2 LIMIT 1',
                                        [chat.id, workspaceId],
                                    ).catch(() => ({ rows: [] }));
                                    collectionCloseSucceeded = statusResult.rows[0]?.status === 'encerrados';
                                    if (!collectionCloseSucceeded) {
                                        messageToSend = 'Recebi suas informações. O atendimento continuará aberto enquanto confirmamos o encerramento com segurança.';
                                    }
                                }
                            } else {
                                await clearAutopilotCollectionCompletion({
                                    chatId: chat.id,
                                    workspaceId,
                                    checkpointFingerprint: activeCollectionCheckpoint.checkpointFingerprint,
                                }).catch(() => false);
                                if (closeDecision.reason !== 'response_not_terminal') {
                                    messageToSend = 'Recebi suas informações, mas mantive o atendimento aberto porque ainda não foi possível confirmar com segurança a gravação de todos os dados.';
                                }
                            }
                        }
                        const preservedPreparation = messageToSend === message ? preparation : undefined;
                        const formatted = preservedPreparation?.preserveFormatting
                            ? messageToSend : formatCustomerFacingAiResponse(messageToSend);
                        const delivery = await sendMultiBlockResponse(
                            chat.id,
                            formatted,
                            assignedSystemAgentId,
                            true,
                            instanceName,
                            preservedPreparation?.blocks || null,
                            { ...responseTrace, deliveryKey: `workflow:${nodeInput.node.id}` },
                            { preserveFormatting: preservedPreparation?.preserveFormatting },
                        );
                        if (delivery.success && collectionRoute?.kind === 'needs_input') {
                            const checkpoint = buildCollectionCompletionCheckpoint({
                                chatId: chat.id,
                                autopilotConfigId: autopilotConfig.id,
                                sourceMessageId,
                                route: collectionRoute,
                                previousCheckpoint: activeCollectionCheckpoint,
                                knownFields: structuredKnownFields,
                                receipts: collectionPersistenceReceipts,
                            });
                            if (checkpoint) {
                                autopilotContactMemory.nativeState[COLLECTION_COMPLETION_STATE_KEY] = checkpoint;
                                await saveAutopilotNativeState({
                                    chatId: chat.id,
                                    workspaceId,
                                    autopilotConfigId: autopilotConfig.id,
                                    state: { [COLLECTION_COMPLETION_STATE_KEY]: checkpoint },
                                }).catch((error) => {
                                    console.warn('[AUTOPILOT_COLLECTION_CLOSE] Failed to persist needs_input checkpoint:', error);
                                });
                            }
                        }
                        await logIntelligentAttendantResponse({
                            configId: autopilotConfig.id,
                            chatId: chat.id,
                            systemAgentId: assignedSystemAgentId,
                            modelName: resolvedAiModel.model,
                            customerMessage: enrichedLastMessageContent || '',
                            response: formatted,
                            status: delivery.success ? 'sent' : 'error',
                            triggeredRule: null,
                            metadata: {
                                runtime: 'workflow_v2_primary',
                                workflowNodeId: nodeInput.node.id,
                                executionId: nodeInput.execution.executionId,
                            },
                        });
                        return { success: delivery.success, apiResponse: delivery.apiResponse || null };
                    },
                    handoff: async (nodeInput) => {
                        await assertAutopilotSourceMessageCurrent({
                            chatId: chat.id,
                            sourceMessageId,
                        });
                        const customerHandoffMessage = String(
                            nodeInput.input.customerMessage
                            || 'Obrigado pelas informações. Seu atendimento foi encaminhado para nossa equipe continuar por aqui.',
                        ).replace(/\s+/g, ' ').trim().slice(0, 1000);
                        const handoffSummary = String(
                            nodeInput.input.summary
                            || nodeInput.node.config.summary
                            || nodeInput.input.reason
                            || nodeInput.node.config.reason
                            || '',
                        ).replace(/\s+/g, ' ').trim().slice(0, 500);
                        const nativeHandoffTurnPolicy: AutopilotTurnPolicy = {
                            ...turnPolicy,
                            globallyEnabledToolNames: Array.from(new Set([
                                ...turnPolicy.globallyEnabledToolNames,
                                'add_internal_note',
                                'transfer_chat',
                            ])),
                            allowedToolNames: Array.from(new Set([
                                ...turnPolicy.allowedToolNames,
                                'add_internal_note',
                                'transfer_chat',
                            ])),
                        };
                        const results = await runRequestedAgentToolsWithStatus({
                            workspaceId,
                            chat,
                            contact: sanitizedContact,
                            systemAgentId: assignedSystemAgentId,
                            systemAgentName: assignedSystemAgentName,
                            autopilotConfig,
                            turnPolicy: nativeHandoffTurnPolicy,
                            customerMessage: enrichedLastMessageContent || '',
                            actions: [
                                ...(handoffSummary ? [{
                                    type: 'add_internal_note' as const,
                                    reason: 'Resumo nativo para continuidade humana.',
                                    payload: { content: handoffSummary },
                                }] : []),
                                {
                                    type: 'transfer_chat' as const,
                                    reason: String(nodeInput.node.config.reason || 'Transferência solicitada pelo workflow.'),
                                    payload: { teamId: String(nodeInput.node.config.teamId || '') || null },
                                },
                            ],
                            orchestratorRunId: orchestratorRun.id,
                            sourceMessageId,
                        });
                        const result = [...results].reverse().find((item) => item.toolName === 'transfer_chat');
                        if (!result || result.status !== 'success') {
                            throw new Error(result?.error || 'Não foi possível transferir o atendimento.');
                        }
                        const transferOutput = result.output && typeof result.output === 'object'
                            ? result.output as Record<string, unknown>
                            : {};
                        let customerMessageSent = transferOutput.fallbackExecuted === true && transferOutput.notificationDelivered === true;
                        if (!customerMessageSent && (customerHandoffMessage || transferOutput.fallbackExecuted === true)) {
                            const formattedCustomerMessage = formatCustomerFacingAiResponse(transferOutput.fallbackExecuted === true
                                ? 'Seu atendimento foi colocado na fila para acompanhamento pela equipe.'
                                : customerHandoffMessage);
                            const delivery = await sendMultiBlockResponse(
                                chat.id,
                                formattedCustomerMessage,
                                assignedSystemAgentId,
                                true,
                                instanceName,
                                null,
                                { ...responseTrace, deliveryKey: `workflow:${nodeInput.node.id}:customer_message` },
                            );
                            customerMessageSent = delivery.success;
                            await logIntelligentAttendantResponse({
                                configId: autopilotConfig.id,
                                chatId: chat.id,
                                systemAgentId: assignedSystemAgentId,
                                modelName: resolvedAiModel.model,
                                customerMessage: enrichedLastMessageContent || '',
                                response: formattedCustomerMessage,
                                status: delivery.success ? 'sent' : 'error',
                                triggeredRule: null,
                                metadata: {
                                    runtime: 'workflow_v2_primary_handoff',
                                    workflowNodeId: nodeInput.node.id,
                                    executionId: nodeInput.execution.executionId,
                                },
                            });
                        }
                        return {
                            transferred: transferOutput.transferred === true,
                            queued: transferOutput.fallbackExecuted === true,
                            customerMessage: customerHandoffMessage,
                            customerMessageSent,
                            output: result.output || null,
                        };
                    },
                    closeConversation: async (nodeInput) => {
                        const action: AgentToolAction = {
                            type: 'close_chat',
                            reason: String(nodeInput.node.config.reason || 'Objetivo do atendimento concluído.'),
                            payload: {
                                reasonTagId: String(nodeInput.node.config.reasonTagId || '') || null,
                                notes: String(
                                    nodeInput.node.config.notes
                                    || nodeInput.node.config.reason
                                    || 'Encerramento pelo bloco nativo de conclusão.',
                                ).slice(0, 1000),
                                sendCloseMessage: nodeInput.node.config.sendCloseMessage === true,
                            },
                        };
                        const nativeCloseTurnPolicy: AutopilotTurnPolicy = {
                            ...turnPolicy,
                            globallyEnabledToolNames: Array.from(new Set([...turnPolicy.globallyEnabledToolNames, 'close_chat'])),
                            allowedToolNames: Array.from(new Set([...turnPolicy.allowedToolNames, 'close_chat'])),
                        };
                        const goalCompletionAuthorized = isValidWorkflowGoalCompletionEvidence(
                            nodeInput.input.goalCompletion,
                            nodeInput,
                        );
                        const [result] = await runRequestedAgentToolsWithStatus({
                            workspaceId,
                            chat,
                            contact: sanitizedContact,
                            systemAgentId: assignedSystemAgentId,
                            systemAgentName: assignedSystemAgentName,
                            autopilotConfig,
                            turnPolicy: nativeCloseTurnPolicy,
                            customerMessage: enrichedLastMessageContent || '',
                            actions: [action],
                            closeAuthorization: goalCompletionAuthorized
                                ? {
                                    source: 'workflow_goal_completed',
                                    chatId: chat.id,
                                    orchestratorRunId: orchestratorRun.id,
                                    workflowId: nodeInput.workflow.id,
                                    workflowVersion: nodeInput.workflow.version,
                                    executionId: nodeInput.execution.executionId,
                                    terminalNodeId: nodeInput.node.id,
                                    actionFingerprint: fingerprintToolAction(action),
                                }
                                : null,
                            orchestratorRunId: orchestratorRun.id,
                            sourceMessageId,
                        });
                        if (!result || result.status !== 'success') {
                            throw new Error(result?.error || 'Não foi possível encerrar o atendimento.');
                        }
                        return { closed: true, output: result.output || null };
                    },
                    loadState: async (nodeInput) => {
                        const keys = Array.isArray(nodeInput.node.config.keys)
                            ? nodeInput.node.config.keys.map(String)
                            : [];
                        const state = keys.length > 0
                            ? Object.fromEntries(keys.filter((key) => key in autopilotContactMemory.nativeState).map((key) => [key, autopilotContactMemory.nativeState[key]]))
                            : { ...autopilotContactMemory.nativeState };
                        return { state };
                    },
                    saveState: async (nodeInput) => {
                        const allowedFields = Array.isArray(nodeInput.node.config.allowedFields)
                            ? nodeInput.node.config.allowedFields.map(String).filter(Boolean)
                            : [];
                        const sourceState = nodeInput.input.state && typeof nodeInput.input.state === 'object' && !Array.isArray(nodeInput.input.state)
                            ? nodeInput.input.state as Record<string, unknown>
                            : nodeInput.input;
                        const patch = Object.fromEntries(
                            allowedFields
                                .filter((key) => Object.prototype.hasOwnProperty.call(sourceState, key))
                                .map((key) => [key, sourceState[key]]),
                        );
                        if (Object.keys(patch).length === 0) {
                            return { saved: false, state: { ...autopilotContactMemory.nativeState } };
                        }
                        Object.assign(autopilotContactMemory.nativeState, patch);
                        await saveAutopilotNativeState({
                            chatId: chat.id,
                            workspaceId,
                            autopilotConfigId: autopilotConfig.id,
                            state: patch,
                        });
                        return { saved: true, state: { ...autopilotContactMemory.nativeState } };
                    },
                },
                context: {
                    orchestratorRunId: orchestratorRun.id,
                    intent: intentResolution.intent,
                    confidence: intentResolution.confidence,
                },
            }),
            { workflowId: autopilotConfig.active_workflow_id || null },
        );
        const nativeResult = nativeStage.value;
        if (nativeResult.enabled && nativeResult.handled) {
            let nativeResponseSent = nativeResult.responseSent === true;
            const nativeConversationClosed = nativeResult.conversationClosed === true || collectionCloseSucceeded;
            let recoveryResponse: string | null = null;
            if (
                currentCopilotMode === 'auto'
                && !nativeResponseSent
                && (!nativeResult.handoffCompleted || Boolean(nativeResult.recoveryResponse?.trim()))
                && !nativeConversationClosed
                && nativeResult.status !== 'waiting'
            ) {
                recoveryResponse = formatCustomerFacingAiResponse(
                    nativeResult.recoveryResponse?.trim()
                    || contextualFallbackReply(scopedStaticKnowledgeDocuments)
                );
                const recoveryStage = await timeOrchestratorStage(
                    orchestratorRun,
                    'workflow_runtime_v2_recovery_send',
                    () => sendMultiBlockResponse(
                        chat.id,
                        recoveryResponse!,
                        assignedSystemAgentId,
                        true,
                        instanceName,
                        null,
                        { ...responseTrace, deliveryKey: 'workflow:recovery' },
                    ),
                    {
                        workflowExecutionId: nativeResult.executionId,
                        workflowStatus: nativeResult.status,
                        recoveredGeneratedResponse: Boolean(nativeResult.recoveryResponse?.trim()),
                    },
                );
                orchestratorTimings.workflow_runtime_v2_recovery_send_ms = recoveryStage.durationMs;
                nativeResponseSent = recoveryStage.value.success;
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'workflow_runtime_v2_missing_response_recovered',
                    status: nativeResponseSent ? 'success' : 'error',
                    durationMs: recoveryStage.durationMs,
                    payload: {
                        executionId: nativeResult.executionId,
                        workflowStatus: nativeResult.status,
                        recoveredGeneratedResponse: Boolean(nativeResult.recoveryResponse?.trim()),
                    },
                });
                await logIntelligentAttendantResponse({
                    configId: autopilotConfig.id,
                    chatId: chat.id,
                    systemAgentId: assignedSystemAgentId,
                    modelName: resolvedAiModel.model,
                    customerMessage: enrichedLastMessageContent || '',
                    response: recoveryResponse,
                    status: nativeResponseSent ? 'sent' : 'error',
                    triggeredRule: null,
                    metadata: {
                        runtime: 'workflow_v2_primary_recovery',
                        executionId: nativeResult.executionId,
                        workflowStatus: nativeResult.status,
                    },
                });
            }
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'workflow_runtime_v2_primary',
                status: nativeResult.status === 'failed' ? 'fallback' : 'success',
                durationMs: nativeStage.durationMs,
                payload: { ...nativeResult, conversationClosed: nativeConversationClosed, collectionCloseSucceeded },
            });
            await finishOrchestratorRun({
                run: orchestratorRun,
                status: nativeResult.status === 'failed'
                    ? (nativeResponseSent ? 'fallback' : 'error')
                    : 'success',
                timings: { ...orchestratorTimings, workflow_runtime_v2_primary_ms: nativeStage.durationMs },
                intent: intentResolution.intent,
                confidenceScore: intentResolution.confidence,
                error: nativeResult.error,
                metadata: {
                    responseSent: nativeResponseSent,
                    workflowRuntime: 'v2_primary',
                    workflowExecutionId: nativeResult.executionId,
                    workflowStatus: nativeResult.status,
                    workflowResponseRecovered: Boolean(recoveryResponse),
                    workflowHandoffCompleted: nativeResult.handoffCompleted === true,
                    workflowConversationClosed: nativeConversationClosed,
                    collectionCloseSucceeded,
                },
            });
            return;
        }
        // Native configurations never fall through to the retired planner. A
        // disabled/misconfigured V2 gate is an operational failure, not
        // permission to execute the same turn with a second runtime.
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'workflow_runtime_v2_primary',
            status: 'error',
            durationMs: nativeStage.durationMs,
            payload: { ...nativeResult, failClosed: true },
        });
        await finishOrchestratorRun({
            run: orchestratorRun,
            status: 'error',
            timings: { ...orchestratorTimings, workflow_runtime_v2_primary_ms: nativeStage.durationMs },
            intent: intentResolution.intent,
            confidenceScore: intentResolution.confidence,
            error: nativeResult.error || 'workflow_runtime_v2_not_available',
            metadata: {
                responseSent: false,
                workflowRuntime: 'v2_primary',
                failClosed: true,
            },
        });
        return;
    }
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
                        model: aiDecisionModels.toolIntentGate.model,
                        apiKey: workspaceGeminiApiKey,
                        workspaceId,
                        timeoutMs: aiDecisionModels.toolIntentGate.timeoutMs,
                    }),
                    aiDecisionModels.toolIntentGate.timeoutMs + 500,
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
            await publishSuggestion({
                response: finalResponse,
                stage: 'deterministic_routing',
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
        if (!explicitConversationCloseRequest && shouldRunAutopilotKnowledgeRetrieval({
            customerMessage: enrichedLastMessageContent,
            shouldRetrieveKnowledge: intentResolution.shouldRetrieveKnowledge,
            deterministicOperationalTurn,
        })) {
            console.log(`[AUTOPILOT_RAG] Searching hybrid context for: "${enrichedLastMessageContent.substring(0, 50)}..."`);
            const ragStage = await timeOrchestratorStage(
                orchestratorRun,
                'rag_retrieval',
                () => withTimeout(
                    retrieveHybridSupportContext({
                        workspaceId,
                        autopilotConfigId: autopilotConfig.id,
                        chatId: chat.id,
                        orchestratorRunId: orchestratorRun.id,
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
                    allowedKnowledgeDocuments: activeFlowIntentScope?.knowledgeDocumentIds || null,
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
                    provenance: retrieval.provenance,
                    internalKnowledgeSources: retrieval.diagnostics?.internalKnowledgeSources || [],
                    correctiveRetrieval: retrieval.diagnostics?.correctiveRetrieval || null,
                    discarded: retrieval.discarded.slice(0, 8),
                    intent: intentResolution.intent,
                    workflowId: intentResolution.workflowId,
                },
            });
        } else if (explicitConversationCloseRequest || deterministicOperationalTurn) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'rag_retrieval',
                status: 'skipped',
                payload: {
                    reason: explicitConversationCloseRequest
                        ? 'explicit_conversation_close'
                        : 'deterministic_operational_turn',
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
    traceCopilotInsights({
        ragStrategy,
        knowledgeCoverage,
        knowledgeSources: ragDocuments.slice(0, 6).map((document) => ({
            id: document.id,
            name: document.name,
            kind: 'document' as const,
        })),
    });

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
                        model: aiDecisionModels.toolIntentGate.model,
                        apiKey: workspaceGeminiApiKey,
                        workspaceId,
                        timeoutMs: aiDecisionModels.toolIntentGate.timeoutMs,
                    }),
                    aiDecisionModels.toolIntentGate.timeoutMs + 500,
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
        slotExtraction: currentSlotExtraction,
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
                        model: aiDecisionModels.workflowClassifier.model,
                        apiKey: workspaceGeminiApiKey,
                        workspaceId,
                        timeoutMs: aiDecisionModels.workflowClassifier.timeoutMs,
                    }),
                    aiDecisionModels.workflowClassifier.timeoutMs + 500,
                    'workflow classifier'
                ),
                {
                    intent: intentResolution.intent,
                    deterministicExecutionMode: workflowPlan.executionMode,
                    deterministicPlannedTools: workflowPlan.actions.map(resolveActionToolName),
                    model: aiDecisionModels.workflowClassifier.model,
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
                slotExtraction: currentSlotExtraction,
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
    try {
        const workflowRuntimeV2ShadowStage = await timeOrchestratorStage(
            orchestratorRun,
            'workflow_runtime_v2_shadow',
            () => withTimeout(
                runAutopilotWorkflowRuntimeV2Shadow({
                    config: autopilotConfig,
                    customerMessage: enrichedLastMessageContent || '',
                    chatId: chat.id,
                    sourceMessageId,
                    metadata: {
                        deterministicExecutionMode: workflowPlan.executionMode,
                        deterministicActions: workflowPlan.actions.map(resolveActionToolName),
                        intent: intentResolution.intent,
                        confidence: intentResolution.confidence,
                    },
                }),
                8_000,
                'workflow runtime v2 shadow'
            ),
            {
                workflowExecutionMode: workflowPlan.executionMode,
                intent: intentResolution.intent,
            }
        );
        if (workflowRuntimeV2ShadowStage.value.enabled) {
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'workflow_runtime_v2_shadow',
                status: workflowRuntimeV2ShadowStage.value.status === 'failed' ? 'fallback' : 'success',
                durationMs: workflowRuntimeV2ShadowStage.durationMs,
                payload: workflowRuntimeV2ShadowStage.value,
            });
        }
    } catch (error) {
        console.warn('[WORKFLOW_RUNTIME_V2_SHADOW] Failed, keeping current autopilot runtime:', error);
        await recordOrchestratorEvent({
            run: orchestratorRun,
            kind: 'workflow_runtime_v2_shadow',
            status: 'fallback',
            payload: {
                error: error instanceof Error ? error.message : String(error),
            },
        });
    }
    const toolCoverage = analyzeAutopilotToolCoverage({
        graph: autopilotConfig.flow_graph,
        enabledToolNames: turnPolicy.globallyEnabledToolNames,
        toolCatalog: runtimeToolCatalog,
    });
    // The deterministic planner must see every globally enabled capability.
    // The final authorization below still limits execution to the exact tools
    // required by the detected customer need and preserves explicit deny mode.
    const turnPlanEnabledToolNames = turnPolicy.toolMode === 'deny'
        ? []
        : turnPolicy.globallyEnabledToolNames;
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
    const canSendDeterministicFlowResponse = shouldSendDeterministicFlowResponse({
        workflowExecutionMode: workflowPlan.executionMode,
        workflowHandledByWorkflow: workflowPlan.handledByWorkflow,
        shouldPrioritizeTurnPlan,
    });
    // An entry message is a deterministic workflow response, never a blanket
    // replacement for the customer's first meaningful turn. Let RAG/LLM run
    // whenever the workflow resolved to continue_llm.
    const entryFlowMessageNode = canSendDeterministicFlowResponse
        ? resolveEntryDeterministicFlowMessage(autopilotConfig)
        : null;
    const shouldSendEntryFlowMessage = entryFlowMessageNode && !shouldPrioritizeTurnPlan
        ? !activePEC && !(await hasSentFlowNodeMessage({
            configId: autopilotConfig.id,
            chatId: chat.id,
            nodeId: entryFlowMessageNode.nodeId,
        }))
        : false;
    const deterministicFlowMessageNode = !canSendDeterministicFlowResponse
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
        intentResolution.intent === 'troubleshooting' && turnPlan.customerNeed === 'none'
            ? [
                'troubleshootingOpeningPolicy=acolha o relato e faca primeiro uma pergunta discriminante baseada no contexto ativo: alcance, sintoma observado, ultimo estado conhecido, momento de inicio ou tentativa ja realizada.',
                'Nao solicite identificadores sensiveis no primeiro relato generico e nao prometa consultar cadastro, status ou sistema sem uma action executavel no mesmo turno.',
            ].join('\n')
            : '',
        flowReferencesForPrompt,
        flowSwitchGuidanceForPrompt,
        flowFormGuidanceForPrompt,
    ].join('\n');

    if (deterministicFlowMessage) {
        if (currentCopilotMode === 'suggest') {
            await publishSuggestion({
                response: deterministicFlowMessage,
                stage: 'flow_message',
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
    const compiledProcedures = await compileRuntimeProcedures({
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
            fallbackReply: safeConfiguredFallbackReply,
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
            await publishSuggestion({
                response: finalResponse,
                stage: 'tool_memory',
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

        if (responseValidator.actions.some((action) => action.type === 'close_chat') && hasConversationCloseClaim(finalResponse)) {
            finalResponse = 'Vou encerrar o atendimento conforme solicitado.';
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
            await publishSuggestion({
                response: finalResponse,
                stage: 'workflow_response',
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
            fallbackReply: safeConfiguredFallbackReply,
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

        if (validatedWorkflowActions.some((action) => action.type === 'close_chat') && hasConversationCloseClaim(finalResponse)) {
            finalResponse = 'Vou encerrar o atendimento conforme solicitado.';
        }

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
                await publishSuggestion({
                    response: finalResponse,
                    stage: 'post_tool_response',
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
                fallbackReply: safeConfiguredFallbackReply,
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
            contextualFallbackReply(promptKnowledgeDocuments) ||
            'Nao consegui concluir a consulta automatica agora. Nossa equipe vai acompanhar por aqui.'
        );
        const responseValidator = validateAutopilotResponse({
            response: finalResponse,
            fallbackReply: safeConfiguredFallbackReply,
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

        if (responseValidator.actions.some((action) => action.type === 'close_chat') && hasConversationCloseClaim(finalResponse)) {
            finalResponse = 'Vou encerrar o atendimento conforme solicitado.';
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

        const workflowHadToolFailure = toolResults.some((result) => result.status !== 'success' || result.output?.disposition === 'queued');

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
                    fallbackReply: safeConfiguredFallbackReply,
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
            const startedAt = Date.now();
            await recordOrchestratorEvent({
                run: orchestratorRun,
                kind: 'procedure_llm_response_start',
                payload: {
                    procedureId: context.procedureId,
                    stepId: step.id,
                    model: resolvedAiModel.model,
                },
            });
            try {
                const compactToolResults = compactProcedureToolResults(toolResults);
                const response = await withTimeout(generateProcedureRuntimeOutput({
                    config: autopilotConfig,
                    chatId: chat.id,
                    mode: 'response',
                    customerMessage: enrichedLastMessageContent || '',
                    chatHistory: procedureSlimChatHistory,
                    persona: procedureSlimPersona,
                    fallbackReply: safeConfiguredFallbackReply,
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
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'procedure_llm_response',
                    status: response?.response ? 'success' : 'fallback',
                    durationMs: Date.now() - startedAt,
                    payload: {
                        procedureId: context.procedureId,
                        stepId: step.id,
                        model: resolvedAiModel.model,
                        hasResponse: Boolean(response?.response),
                    },
                });
                return response?.response || null;
            } catch (error) {
                console.warn('[PROCEDURE_RUNTIME] Response resolver failed, using template response:', error);
                await recordOrchestratorEvent({
                    run: orchestratorRun,
                    kind: 'procedure_llm_response',
                    status: 'fallback',
                    durationMs: Date.now() - startedAt,
                    payload: {
                        procedureId: context.procedureId,
                        stepId: step.id,
                        model: resolvedAiModel.model,
                        error: error instanceof Error ? error.message : String(error),
                    },
                });
                return null;
            }
        };

        const procedureKnowledgeResolver: ProcedureKnowledgeResolver = async ({ step, context, query, requiredCoverage }) => {
            const retrieval = await retrieveHybridSupportContext({
                workspaceId,
                autopilotConfigId: autopilotConfig.id,
                chatId: chat.id,
                orchestratorRunId: orchestratorRun.id,
                query: query || enrichedLastMessageContent || context.procedureName,
                excludeChatId: chat.id,
                staticDocuments: scopedStaticKnowledgeDocuments,
                intent: intentResolution,
                allowedDocumentIds: step.knowledgeDocumentIds?.length ? step.knowledgeDocumentIds : allowedDocumentIds,
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
                    provenance: retrieval.provenance,
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
                    fallbackReply: safeConfiguredFallbackReply,
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
                    await publishSuggestion({
                        response: finalResponse,
                        stage: 'procedure_runtime',
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

    const isConversationalLlmTurn = (
        ['greeting', 'thanks'].includes(intentResolution.intent)
        && turnPlan.customerNeed === 'none'
        && workflowPlan.executionMode === 'continue_llm'
    );
    const conversationalChatHistory = chatHistoryForAI
        .split('\n')
        .slice(-6)
        .join('\n')
        .slice(-1800);
    const conversationalPersona = scopedKnowledgeBase
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2400);

    try {
        const llmStage = await timeOrchestratorStage(
            orchestratorRun,
            'llm_response',
            () => withTimeout(generateAgentResponse({
            config: autopilotConfig,
            chatId: chat.id,
            customerMessage: enrichedLastMessageContent || '',
            chatHistory: isConversationalLlmTurn ? conversationalChatHistory : chatHistoryForAI,
            relevantHistory: isConversationalLlmTurn ? '' : relevantHistory,
            rules: isConversationalLlmTurn ? [] : activeRules,
            knowledgeBase: isConversationalLlmTurn ? conversationalPersona : scopedKnowledgeBase,
            knowledgeBaseDocuments: isConversationalLlmTurn ? [] : promptKnowledgeDocuments,
            workflowKnowledgeDocuments: isConversationalLlmTurn ? [] : promptWorkflowKnowledgeDocuments,
            resolvedCases: isConversationalLlmTurn ? [] : resolvedCases,
            fallbackReply: isConversationalLlmTurn ? '' : safeConfiguredFallbackReply,
            escalationPolicy: [
                isConversationalLlmTurn ? '' : autopilotConfig.escalation_policy || '',
                deterministicRouting.matchedReason
                    ? `Roteamento interno ja identificado pelo servidor: ${deterministicRouting.matchedReason} Responda ao cliente de forma natural informando que o atendimento sera encaminhado.`
                    : '',
            ].filter(Boolean).join('\n\n'),
            closingPolicy: isConversationalLlmTurn ? '' : autopilotConfig.closing_policy || '',
            model: resolvedAiModel.model,
            contact: sanitizedContact,
            workspaceGeminiApiKey,
            enabledAgentToolsDescription: isConversationalLlmTurn
                ? ''
                : buildEnabledAgentToolsDescription(enabledToolNames, runtimeToolCatalog, turnPolicy.toolInstructionsByName),
            enabledAgentToolNames: isConversationalLlmTurn ? [] : enabledToolNames,
            knowledgeToolProcedures: isConversationalLlmTurn ? '' : knowledgeToolProcedures,
            agentRuntimeContext,
            intentContext: isConversationalLlmTurn
                ? `intent=${intentResolution.intent}; responda somente ao turno atual`
                : intentContextForAI,
            responseMode: isConversationalLlmTurn ? 'conversational' : 'full',
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
        await recordGeneratedAgentTaskPlan({
            run: orchestratorRun,
            taskPlan: result?.taskPlan || null,
            source: 'initial_response',
        });

        if (result?.response) {
            let finalResponse = result.response;
            let aiMessageBlocks: string[] | null = null;
            if (Array.isArray((result as any).messageBlocks) && (result as any).messageBlocks.length > 0) {
                const rawBlocks = ((result as any).messageBlocks as string[])
                    .map((block) => formatCustomerFacingAiResponse(block))
                    .filter((block) => Boolean(block) && !/^[{}\[\],]+$/.test(block));
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
                    finalResponse = safeConfiguredFallbackReply || result.response;
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
                await publishSuggestion({
                    response: finalResponse,
                    blocks: aiMessageBlocks,
                    stage: 'model_response',
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
                    chatHistory: chatHistoryForAI,
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
                        allowSafetyCriticalHandoff: toolPlanner.metadata.safetyCriticalHandoff === true,
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
                                    fallbackReply: safeConfiguredFallbackReply,
                                    escalationPolicy: autopilotConfig.escalation_policy || '',
                                    closingPolicy: autopilotConfig.closing_policy || '',
                                    model: resolvedAiModel.model,
                                    contact: sanitizedContact,
                                    workspaceGeminiApiKey,
                                    enabledAgentToolsDescription: buildEnabledAgentToolsDescription(enabledToolNames, runtimeToolCatalog, turnPolicy.toolInstructionsByName),
                                    enabledAgentToolNames: enabledToolNames,
                                    allowNativeLmStudioToolCalls: false,
                                    knowledgeToolProcedures,
                                    agentRuntimeContext,
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
                            await recordGeneratedAgentTaskPlan({
                                run: orchestratorRun,
                                taskPlan: continuation?.taskPlan || null,
                                source: 'tool_continuation',
                            });
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
                                    agentRuntimeContext,
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
                            await recordGeneratedAgentTaskPlan({
                                run: orchestratorRun,
                                taskPlan: finalResponseStage.value?.taskPlan || null,
                                source: 'tool_final_response',
                            });
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
                    fallbackReply: safeConfiguredFallbackReply,
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
                    // Grounding evidence is the full retrieved set, not the
                    // prompt-truncated slice: a fact cut for budget is still a
                    // fact backed by the knowledge base, and flagging it as
                    // unsupported replaces a correct answer with the fallback.
                    knowledgeDocuments: factKnowledgeDocuments,
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

                if (finalPostResponseActions.some((action) => action.type === 'close_chat') && hasConversationCloseClaim(finalResponse)) {
                    finalResponse = 'Vou encerrar o atendimento conforme solicitado.';
                    aiMessageBlocks = null;
                }

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
                    status: toolResults.some((toolResult) => toolResult.status !== 'success' || toolResult.output?.disposition === 'queued') ? 'fallback' : 'success',
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
                chatHistory: chatHistoryForAI,
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
                allowSafetyCriticalHandoff: emptyResponseToolPlanner.metadata.safetyCriticalHandoff === true,
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
                    contextualFallbackReply(promptKnowledgeDocuments)
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
                contextualFallbackReply(promptKnowledgeDocuments)
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
