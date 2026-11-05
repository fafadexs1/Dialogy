import { platformModel,platformApiKey } from '@/services/ai/platform-config';
import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';
import type { Pool } from 'pg';
import type { AgentToolRuntimeContext, AgentToolExecutionResult } from '@/services/agent-tools/types';
import { prepareCustomerResponse } from '@/services/autopilot/customer-response-preparation';
import { splitIntoMessageBlocks } from '@/lib/ai-response-format';
import type { AutopilotTurnPolicy } from '@/services/autopilot/turn-policy';
import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';
import {
  createAutopilotToolRegistry,
  type AutopilotToolBridgeDefinition,
  type NativeToolStatusEvent,
} from './autopilot-tool-bridge';
import { RuntimeProviderModelAdapter } from './adapters/runtime-provider';
import { WorkflowExecutor } from './executor';
import { ModelFallbackChain } from './model-adapter';
import { createDefaultNodeHandlerRegistry } from './node-handlers';
import { PostgresWorkflowPersistence } from './postgres-persistence';
import { ModelConfigurationSchema } from './schemas';
import type { NodeRuntimeInput, WorkflowDefinition, WorkflowNode } from './types';
import { hashValue, isRecord } from './utils';
import { validateWorkflowDefinition } from './validator';
import { isWorkflowRuntimeV2ModeEnabled } from './autopilot-rollout';
import { hasKnownWorkflowField } from './goal-completion';

export type AutopilotPrimaryRuntimeDependencies = {
  database: Pick<Pool, 'query'>;
  toolContext: AgentToolRuntimeContext;
  recentMessages: Array<{ fromMe: boolean; content: string }>;
  structuredMemory?: Record<string, unknown>;
  responseTimeZone?: string;
  sendResponse: (message: string, input: NodeRuntimeInput, preparation?: {
    preserveFormatting: boolean; blocks: string[];
  }) => Promise<Record<string, unknown>>;
  handoff: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  closeConversation: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  loadState?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  saveState?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  reportToolStatus?: (event: NativeToolStatusEvent) => Promise<void>;
};

export type RunAutopilotPrimaryInput = {
  config: AutopilotConfig;
  customerMessage: string;
  chatId: string;
  sourceMessageId: string;
  staticDocuments: KnowledgeBaseDocument[];
  dependencies: AutopilotPrimaryRuntimeDependencies;
  context?: Record<string, unknown>;
};

export type AutopilotPrimaryDeliveryOutcome = {
  responseSent: boolean;
  handoffCompleted: boolean;
  conversationClosed: boolean;
  recoveryResponse?: string;
};

export function authorizeNativeWorkflowConnectedTools(
  turnPolicy: AutopilotTurnPolicy,
  connectedToolNames: string[],
): AutopilotTurnPolicy {
  if (turnPolicy.toolMode === 'deny') return turnPolicy;
  const globallyEnabled = new Set(turnPolicy.globallyEnabledToolNames);
  const connectedAndEnabled = connectedToolNames
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName && globallyEnabled.has(toolName));
  if (connectedAndEnabled.length === 0) return turnPolicy;

  return {
    ...turnPolicy,
    attachedToolNames: Array.from(new Set([
      ...turnPolicy.attachedToolNames,
      ...connectedAndEnabled,
    ])),
    allowedToolNames: Array.from(new Set([
      ...turnPolicy.allowedToolNames,
      ...connectedAndEnabled,
    ])),
    reason: 'native_workflow_connected_tools_allowed',
  };
}

export function inspectAutopilotPrimaryDeliveryOutcome(
  execution: {
    executionPath?: Array<Record<string, unknown>>;
    failure?: { message?: string; details?: Record<string, unknown> };
  },
): AutopilotPrimaryDeliveryOutcome {
  const path = Array.isArray(execution.executionPath) ? execution.executionPath : [];
  let responseSent = false;
  let handoffCompleted = false;
  let conversationClosed = false;
  let recoveryResponse: string | undefined;

  for (const step of path) {
    const nodeType = String(step.nodeType || '');
    const status = String(step.status || '');
    const output = isRecord(step.output) ? step.output : {};
    const delivery = isRecord(output.delivery) ? output.delivery : {};

    if (nodeType === 'output.respond' && delivery.success === true) {
      responseSent = true;
    }
    if (nodeType === 'output.handoff' && (status === 'success' || status === 'completed')) {
      handoffCompleted = true;
      if (output.customerMessageSent === true) responseSent = true;
    }
    if (nodeType === 'output.close_conversation' && (status === 'success' || status === 'completed')) {
      conversationClosed = true;
    }

    if (nodeType === 'ai.agent' || nodeType === 'ai.prompt' || nodeType === 'output.respond' || nodeType === 'output.handoff') {
      const candidate = [output.response, output.question, output.message, output.customerMessage]
        .find((value) => typeof value === 'string' && value.trim().length > 0);
      if (typeof candidate === 'string') recoveryResponse = candidate.trim();
    }
  }

  if (!recoveryResponse) {
    recoveryResponse = buildAutopilotPrimaryFailureRecovery(execution.failure);
  }

  return { responseSent, handoffCompleted, conversationClosed, recoveryResponse };
}

export function buildAutopilotPrimaryFailureRecovery(
  failure?: { message?: string; details?: Record<string, unknown> },
): string | undefined {
  const detailsMessage = typeof failure?.details?.message === 'string'
    ? failure.details.message
    : '';
  const diagnostic = `${failure?.message || ''} ${detailsMessage}`;
  if (/SGP_INVOICE_LOOKUP_FAILED/i.test(diagnostic)) {
    return 'Não consegui confirmar os dados da fatura no SGP. Nenhum PIX foi gerado. Sua solicitação continua pendente.';
  }
  if (/\[tool_policy:confirmation_required\]|confirmacao explicita/i.test(diagnostic)) {
    return 'A acao ainda nao foi executada. Para eu prosseguir com seguranca, responda "confirmo" autorizando a acao solicitada.';
  }
  if (/\[tool_policy:confirmation_context_missing\]/i.test(diagnostic)) {
    return 'Nao consegui vincular sua confirmacao a uma acao especifica. Diga qual acao voce autoriza e responda "confirmo".';
  }
  if (/INVALID_TOOL_ARGUMENTS|JSON schema validation/i.test(diagnostic)) {
    return 'Nao consegui executar a acao porque um dos dados enviados para a ferramenta estava em formato invalido. Nenhuma alteracao foi aplicada. Vou corrigir os dados antes de tentar novamente.';
  }
  if (/TOOL_DEPENDENCY_MISSING|IP WAN atual|Informe o contrato antes/i.test(diagnostic)) {
    return 'Nao consegui executar a acao porque nao foi possivel confirmar o IP do roteador vinculado ao contrato selecionado. Nenhuma alteracao foi aplicada.';
  }
  if (/TOOL_DEPENDENCY_FAILED/i.test(diagnostic)) {
    return 'Nao consegui executar a acao porque a consulta necessaria para identificar o roteador falhou. Nenhuma alteracao foi aplicada.';
  }
  return diagnostic.trim()
    ? 'Não consegui concluir esta etapa do atendimento. Sua solicitação continua pendente; não tenho um resultado confirmado para informar.'
    : undefined;
}

function modelConfig(node: WorkflowNode) {
  return ModelConfigurationSchema.parse(node.config);
}

export async function modelChainForNode(input: {
  workspaceId: string;
  config: AutopilotConfig;
  modelNode: WorkflowNode;
}) {
  const selected=await platformModel();
  const config={...modelConfig(input.modelNode),model:selected.id};
  const key=await platformApiKey(selected.id);
  return new ModelFallbackChain([{adapter:new RuntimeProviderModelAdapter({workspaceId:input.workspaceId,model:selected.id,apiKey:key,timeoutMs:config.timeoutMs}),config}]);
}

function scopedDocuments(nodes: WorkflowNode[], documents: KnowledgeBaseDocument[]) {
  const documentIds = new Set(nodes.flatMap((node) => (
    Array.isArray(node.config.documentIds) ? node.config.documentIds.map(String) : []
  )));
  const collectionIds = new Set(nodes.flatMap((node) => {
    const filters = isRecord(node.config.filters) ? node.config.filters : {};
    return Array.isArray(filters.collectionIds) ? filters.collectionIds.map(String) : [];
  }));
  return documents.filter((document) => {
    if (documentIds.size > 0 && !documentIds.has(document.id)) return false;
    if (collectionIds.size === 0) return true;
    const memberships = document.collectionIds?.length ? document.collectionIds : ['general'];
    return memberships.some((collectionId) => collectionIds.has(collectionId));
  });
}

function toolDefinitions(nodes: WorkflowNode[]): AutopilotToolBridgeDefinition[] {
  return nodes.flatMap((node) => {
    const name = String(node.config.name || node.config.action || '').trim();
    if (!name) return [];
    const inputSchema = isRecord(node.config.inputSchema) ? node.config.inputSchema : {};
    const requiredInputs = Array.isArray(inputSchema.required)
      ? inputSchema.required.map(String)
      : [];
    const inputProperties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
    const configuredRequiredSlots = Array.isArray(node.config.requiredSlots)
      ? node.config.requiredSlots.map(String).map((slot) => slot.trim()).filter(Boolean)
      : [];
    const requiredSlots = requiredInputs.includes('client_ip') || 'client_ip' in inputProperties
      ? Array.from(new Set([...configuredRequiredSlots, 'customer_identifier']))
      : configuredRequiredSlots;
    return [{
      name: name as AutopilotToolBridgeDefinition['name'],
      description: String(node.config.description || node.name),
      class: typeof node.config.class === 'string'
        ? node.config.class as AutopilotToolBridgeDefinition['class']
        : undefined,
      riskLevel: node.config.riskLevel === 'high' || node.config.riskLevel === 'medium' ? node.config.riskLevel : 'low',
      idempotent: node.config.idempotent === true,
      timeoutMs: Number(node.config.timeoutMs || 20_000),
      maxAttempts: Number(node.config.maxAttempts || 1),
      requiresHumanApproval: node.config.requiresConfirmation === true,
      requiredSlots,
      inputSchema,
      outputSchema: isRecord(node.config.outputSchema) ? node.config.outputSchema : {},
    }];
  });
}

export function filterNativeToolsByKnownFields(
  definitions: AutopilotToolBridgeDefinition[],
  knownFields: Record<string, unknown>,
): AutopilotToolBridgeDefinition[] {
  return definitions.filter((definition) => (
    (definition.requiredSlots || []).every((slot) => hasKnownWorkflowField(slot, knownFields))
  ));
}

function assertGuardrailSafe(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  if (/\b(chain[- ]of[- ]thought|reasoning_content|api[_-]?key\s*[:=])\b/i.test(serialized)) {
    const error = new Error('Workflow guardrail blocked sensitive internal content.') as Error & { code?: string; retryable?: boolean };
    error.code = 'GUARDRAIL_VIOLATION';
    error.retryable = false;
    throw error;
  }
  return value;
}

export async function runAutopilotWorkflowRuntimeV2Primary(input: RunAutopilotPrimaryInput): Promise<{
  enabled: boolean;
  handled: boolean;
  started: boolean;
  executionId?: string;
  status?: string;
  error?: string;
  responseSent?: boolean;
  handoffCompleted?: boolean;
  conversationClosed?: boolean;
  recoveryResponse?: string;
}> {
  const configEnabled = input.config.workflow_builder_mode === 'native_v2'
    && input.config.workflow_runtime_v2_mode === 'primary';
  const rolloutContext = {
    workspaceId: input.config.workspace_id,
    requestId: input.sourceMessageId,
  };
  const flagEnabled = input.config.workflow_builder_mode === 'native_v2' && (
    await isWorkflowRuntimeV2ModeEnabled('primary_execution', rolloutContext, input.dependencies.database)
    || await isWorkflowRuntimeV2ModeEnabled('canary_execution', rolloutContext, input.dependencies.database)
  );
  if (!configEnabled && !flagEnabled) return { enabled: false, handled: false, started: false };
  if (!input.config.active_workflow_id || !input.config.active_workflow_version) {
    // Once V2 owns the turn, failures must be fail-closed. Returning handled=false
    // would let process-chat continue into the legacy runtime and could duplicate
    // a response or a tool side effect after a partial native attempt.
    return { enabled: true, handled: true, started: false, status: 'failed', error: 'active_workflow_missing', recoveryResponse: buildAutopilotPrimaryFailureRecovery({ message: 'active_workflow_missing' }) };
  }

  const persistence = new PostgresWorkflowPersistence(input.dependencies.database);
  const workflow = await persistence.getWorkflowDefinition(
    input.config.active_workflow_id,
    input.config.active_workflow_version,
  );
  if (!workflow) return { enabled: true, handled: true, started: false, status: 'failed', error: 'workflow_definition_missing', recoveryResponse: buildAutopilotPrimaryFailureRecovery({ message: 'workflow_definition_missing' }) };
  const validation = validateWorkflowDefinition(workflow);
  if (!validation.valid) {
    return {
      enabled: true,
      handled: true,
      started: false,
      status: 'failed',
      error: validation.errors.map((issue) => issue.message).join(' '),
      recoveryResponse: buildAutopilotPrimaryFailureRecovery({ message: 'workflow_definition_invalid' }),
    };
  }

  const executionId = `native_${hashValue({
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    sourceMessageId: input.sourceMessageId,
  })}`;
  const existing = await persistence.getExecution(executionId);
  if (existing && ['completed', 'failed', 'cancelled', 'waiting'].includes(existing.status)) {
    const deliveryOutcome = inspectAutopilotPrimaryDeliveryOutcome(existing);
    return {
      enabled: true,
      handled: true,
      started: true,
      executionId,
      status: existing.status,
      error: existing.failure?.message,
      ...deliveryOutcome,
    };
  }

  let responseSentDuringRun = false;
  let handoffCompletedDuringRun = false;
  let conversationClosedDuringRun = false;
  const currentTurnToolResults: AgentToolExecutionResult[] = [];
  const preparationTime = new Date();
  const prepareResponse = (draft: string) => prepareCustomerResponse({
    draft, customerMessage: input.customerMessage, toolResults: currentTurnToolResults,
    intent: input.dependencies.toolContext.intent,
    timeZone: input.dependencies.responseTimeZone, now: preparationTime,
  });

  const handlers = createDefaultNodeHandlerRegistry({
    resolveModelChain: async (context) => modelChainForNode({
      workspaceId: input.config.workspace_id,
      config: input.config,
      modelNode: context.modelNode,
    }),
    resolveToolRegistry: async (context) => {
      const knownFields = isRecord(input.dependencies.structuredMemory?.knownFields)
        ? input.dependencies.structuredMemory.knownFields
        : {};
      const definitions = filterNativeToolsByKnownFields(
        toolDefinitions(context.toolNodes),
        knownFields,
      );
      const nativeToolContext: AgentToolRuntimeContext = {
        ...input.dependencies.toolContext,
        // The native workflow definition is the authority for tools connected
        // to this AI node. Keep the global agent allowlist as the second gate,
        // so a stale legacy flow_graph cannot reject a valid native connection.
        turnPolicy: authorizeNativeWorkflowConnectedTools(
          input.dependencies.toolContext.turnPolicy,
          definitions.map((definition) => definition.name),
        ),
      };
      return createAutopilotToolRegistry({
        context: nativeToolContext,
        toolNames: definitions.map((definition) => definition.name),
        definitions,
        knownFields,
        responseTimeZone: input.dependencies.responseTimeZone,
        reportToolStatus: async (event) => {
          if (event.result) currentTurnToolResults.push(event.result);
          await input.dependencies.reportToolStatus?.(event);
        },
      });
    },
    loadMemory: async () => ({
      recentMessages: input.dependencies.recentMessages.slice(-20),
      ...(input.dependencies.structuredMemory || {}),
    }),
    retrieveKnowledge: async (context) => {
      const documents = scopedDocuments(context.knowledgeNodes, input.staticDocuments);
      if (documents.length === 0) return [];
      const retrieval = await retrieveHybridSupportContext({
        workspaceId: input.config.workspace_id,
        autopilotConfigId: input.config.id,
        chatId: input.chatId,
        query: input.customerMessage,
        staticDocuments: documents,
        allowedDocumentIds: documents.map((document) => document.id),
      });
      return retrieval.knowledgeBaseDocuments.map((document) => ({ ...document }));
    },
    applyGuardrails: async (phase, value) => {
      if (phase !== 'output' || typeof value.response !== 'string') return assertGuardrailSafe(value);
      const prepared = prepareResponse(value.response);
      // Persist the prepared answer with the agent result. Resumed executions
      // must not fall back to the discarded model draft after a delivery error.
      return assertGuardrailSafe({ ...value, response: prepared.response,
        ...(prepared.mode === 'verified_invoice' && ['invoice_ambiguous', 'invoice_not_found', 'sgp_lookup_unavailable'].includes(prepared.reason)
          ? { completionStatus: 'partial' } : {}),
        responsePreparation: { mode: prepared.mode, reason: prepared.reason } });
    },
    sendResponse: async (message, nodeInput) => {
      const prepared = prepareResponse(message);
      const persistedPreparation = isRecord(nodeInput.input.responsePreparation) ? nodeInput.input.responsePreparation : {};
      const preserveFormatting = prepared.mode === 'verified_invoice' || persistedPreparation.mode === 'verified_invoice';
      const result = await input.dependencies.sendResponse(prepared.response, nodeInput,
        preserveFormatting
          ? { preserveFormatting: true, blocks: splitIntoMessageBlocks(prepared.response) }
          : undefined);
      if (result.success === true) responseSentDuringRun = true;
      return { ...result, preparation: prepared.mode === 'draft' && persistedPreparation.mode === 'verified_invoice'
        ? persistedPreparation : { mode: prepared.mode, reason: prepared.reason } };
    },
    handoff: async (nodeInput) => {
      const result = await input.dependencies.handoff(nodeInput);
      handoffCompletedDuringRun = true;
      if (result.customerMessageSent === true) responseSentDuringRun = true;
      return result;
    },
    closeConversation: async (nodeInput) => {
      const result = await input.dependencies.closeConversation(nodeInput);
      conversationClosedDuringRun = true;
      return result;
    },
    loadState: input.dependencies.loadState,
    saveState: input.dependencies.saveState,
  });
  const executor = new WorkflowExecutor(persistence, handlers);
  try {
    const execution = existing
      ? await executor.runExecution(executionId, { workerId: `autopilot_native_${input.chatId}` })
      : await executor.start({
          workflow: workflow as WorkflowDefinition,
          input: {
            customerMessage: input.customerMessage,
            message: input.customerMessage,
            text: input.customerMessage,
            knownFields: isRecord(input.dependencies.structuredMemory?.knownFields)
              ? input.dependencies.structuredMemory?.knownFields
              : {},
            systemOperations: isRecord(input.dependencies.structuredMemory?.systemOperations)
              ? input.dependencies.structuredMemory?.systemOperations
              : {},
          },
          context: {
            source: 'autopilot_native_v2',
            sourceMessageId: input.sourceMessageId,
            ...(input.context || {}),
          },
          sessionId: input.chatId,
          conversationId: input.chatId,
          executionId,
        }, { workerId: `autopilot_native_${input.chatId}` });
    const deliveryOutcome = inspectAutopilotPrimaryDeliveryOutcome(execution);
    return {
      enabled: true,
      handled: true,
      started: true,
      executionId,
      status: execution.status,
      error: execution.failure?.message,
      responseSent: responseSentDuringRun || deliveryOutcome.responseSent,
      handoffCompleted: handoffCompletedDuringRun || deliveryOutcome.handoffCompleted,
      conversationClosed: conversationClosedDuringRun || deliveryOutcome.conversationClosed,
      recoveryResponse: deliveryOutcome.recoveryResponse,
    };
  } catch (error) {
    return {
      enabled: true,
      handled: true,
      started: true,
      executionId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      responseSent: responseSentDuringRun,
      handoffCompleted: handoffCompletedDuringRun,
      conversationClosed: conversationClosedDuringRun,
    };
  }
}
