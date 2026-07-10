import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';
import type { Pool } from 'pg';
import type { AgentToolRuntimeContext } from '@/services/agent-tools/types';
import { resolveAiProviderKeyCandidates } from '@/services/ai/provider-keys';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';
import { createAutopilotToolRegistry, type AutopilotToolBridgeDefinition } from './autopilot-tool-bridge';
import { RuntimeProviderModelAdapter } from './adapters/runtime-provider';
import { LmStudioModelAdapter } from './adapters/lm-studio';
import { WorkflowExecutor } from './executor';
import { ModelFallbackChain } from './model-adapter';
import { createDefaultNodeHandlerRegistry } from './node-handlers';
import { PostgresWorkflowPersistence } from './postgres-persistence';
import { ModelConfigurationSchema } from './schemas';
import type { NodeRuntimeInput, WorkflowDefinition, WorkflowNode } from './types';
import { hashValue, isRecord } from './utils';
import { validateWorkflowDefinition } from './validator';
import { isWorkflowRuntimeV2ModeEnabled } from './autopilot-rollout';

export type AutopilotPrimaryRuntimeDependencies = {
  database: Pick<Pool, 'query'>;
  toolContext: AgentToolRuntimeContext;
  recentMessages: Array<{ fromMe: boolean; content: string }>;
  sendResponse: (message: string, input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  handoff: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
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

function modelConfig(node: WorkflowNode) {
  return ModelConfigurationSchema.parse(node.config);
}

export async function modelChainForNode(input: {
  workspaceId: string;
  config: AutopilotConfig;
  modelNode: WorkflowNode;
}) {
  const config = modelConfig(input.modelNode);
  const provider = getAiModelRuntimeProvider(config.model);
  if (provider === 'lmstudio') {
    const baseUrl = config.baseUrl || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';
    return new ModelFallbackChain([{
      adapter: new LmStudioModelAdapter({
        baseUrl,
        apiKey: process.env.LM_STUDIO_API_KEY,
        capabilities: [{
          model: config.model,
          toolCalling: config.supportsTools ? 'supported' : 'unsupported',
          structuredOutput: config.supportsStructuredOutput,
          streaming: config.supportsStreaming,
          recommendedMaxTools: 20,
          recommendedContextSize: config.contextWindow || 32_768,
          lastEvaluatedAt: new Date().toISOString(),
        }],
      }),
      config,
    }]);
  }
  const keys = await resolveAiProviderKeyCandidates({
    config: { workspace_id: input.workspaceId, gemini_api_key: input.config.gemini_api_key },
  });
  const key = keys.find((candidate) => !candidate.provider || candidate.provider === provider)?.key;
  if (!key) throw new Error(`No API key is configured for workflow model provider ${provider}.`);
  return new ModelFallbackChain([{
    adapter: new RuntimeProviderModelAdapter({ model: config.model, apiKey: key, timeoutMs: config.timeoutMs }),
    config,
  }]);
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
    return [{
      name: name as AutopilotToolBridgeDefinition['name'],
      description: String(node.config.description || node.name),
      riskLevel: node.config.riskLevel === 'high' || node.config.riskLevel === 'medium' ? node.config.riskLevel : 'low',
      idempotent: node.config.idempotent === true,
      timeoutMs: Number(node.config.timeoutMs || 20_000),
      maxAttempts: Number(node.config.maxAttempts || 1),
      requiresHumanApproval: node.config.requiresConfirmation === true,
      inputSchema: isRecord(node.config.inputSchema) ? node.config.inputSchema : {},
      outputSchema: isRecord(node.config.outputSchema) ? node.config.outputSchema : {},
    }];
  });
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
    return { enabled: true, handled: true, started: false, status: 'failed', error: 'active_workflow_missing' };
  }

  const persistence = new PostgresWorkflowPersistence(input.dependencies.database);
  const workflow = await persistence.getWorkflowDefinition(
    input.config.active_workflow_id,
    input.config.active_workflow_version,
  );
  if (!workflow) return { enabled: true, handled: true, started: false, status: 'failed', error: 'workflow_definition_missing' };
  const validation = validateWorkflowDefinition(workflow);
  if (!validation.valid) {
    return {
      enabled: true,
      handled: true,
      started: false,
      status: 'failed',
      error: validation.errors.map((issue) => issue.message).join(' '),
    };
  }

  const executionId = `native_${hashValue({
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    sourceMessageId: input.sourceMessageId,
  })}`;
  const existing = await persistence.getExecution(executionId);
  if (existing && ['completed', 'failed', 'cancelled', 'waiting'].includes(existing.status)) {
    return {
      enabled: true,
      handled: true,
      started: true,
      executionId,
      status: existing.status,
      error: existing.failure?.message,
    };
  }

  const handlers = createDefaultNodeHandlerRegistry({
    resolveModelChain: async (context) => modelChainForNode({
      workspaceId: input.config.workspace_id,
      config: input.config,
      modelNode: context.modelNode,
    }),
    resolveToolRegistry: async (context) => {
      const definitions = toolDefinitions(context.toolNodes);
      return createAutopilotToolRegistry({
        context: input.dependencies.toolContext,
        toolNames: definitions.map((definition) => definition.name),
        definitions,
      });
    },
    loadMemory: async () => ({ recentMessages: input.dependencies.recentMessages.slice(-20) }),
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
    applyGuardrails: async (_phase, value) => assertGuardrailSafe(value),
    sendResponse: input.dependencies.sendResponse,
    handoff: input.dependencies.handoff,
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
    return {
      enabled: true,
      handled: true,
      started: true,
      executionId,
      status: execution.status,
      error: execution.failure?.message,
    };
  } catch (error) {
    return {
      enabled: true,
      handled: true,
      started: true,
      executionId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
