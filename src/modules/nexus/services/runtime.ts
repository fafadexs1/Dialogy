import { z } from 'zod';

import { db } from '@/lib/db';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import type { AutopilotConfig } from '@/lib/types';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import {
  WorkflowDefinitionSchema,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
  createWorkflowNode,
  hashValue,
  matchWorkflowOptionByHeuristics,
  modelChainForNode,
  type NodeExecutionResult,
  type NodeRuntimeInput,
  type WorkflowDefinition,
  type WorkflowExecution,
  type WorkflowExecutorOptions,
  type WorkflowHandlerDependencies,
  type WorkflowNode,
  type WorkflowResumeInput,
} from '@/services/workflow-runtime';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { isRecord, readPath, renderTemplate, stableStringify, statePatchAtPath } from '@/services/workflow-runtime/utils';

import { executeNexusHttpRequest } from './http-executor';
import { executeNexusIntegration } from './integration-executors';
import {
  executeNexusPlatformAction,
  type NexusPlatformChoice,
  type NexusTemplateDelivery,
} from './platform-actions';
import { createNexusToolRegistry } from './tool-registry';
import { loadWorkspaceDialogyKnowledge, retrieveNexusDialogyKnowledge } from './dialogy-knowledge';
import { loadNexusDialogyMemory } from './dialogy-memory';

type Queryable = Pick<typeof db, 'query'>;

export type NexusRuntimeDelivery = {
  kind: 'text' | 'media' | 'handoff' | 'close';
  nodeId: string;
  payload: Record<string, unknown>;
};

export type NexusRuntimeAdapters = Pick<
  WorkflowHandlerDependencies,
  'executeLinkedAgent' | 'sendResponse' | 'sendMedia' | 'sendTyping' | 'handoff' | 'closeConversation' | 'loadState' | 'saveState' | 'executeSubflow'
> & {
  sendOptions?: (
    options: { title: string; choices: NexusPlatformChoice[]; invalid?: boolean },
    input: NodeRuntimeInput,
  ) => Promise<Record<string, unknown>>;
  sendTemplate?: (template: NexusTemplateDelivery, input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
};

export type PublishedNexusWorkflow = {
  nexusWorkflowId: string;
  workspaceId: string;
  workflow: WorkflowDefinition;
  webhookTokenHash: string | null;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function promptSource(input: NodeRuntimeInput) {
  return {
    ...input.execution.variables,
    input: input.execution.input,
    current: input.input,
    variables: input.execution.variables,
    context: input.execution.context,
    nodeResults: input.execution.nodeResults,
    sessionId: input.execution.sessionId,
    conversationId: input.execution.conversationId,
  };
}

async function aiRuntimeContext(workspaceId: string) {
  const resolved = await resolveWorkspaceAiExecutionContext(workspaceId);
  return {
    config: (resolved.autopilotConfig || {
      workspace_id: workspaceId,
      gemini_api_key: resolved.workspaceGeminiApiKey || null,
    }) as AutopilotConfig,
    model: resolved.model,
  };
}

async function classifyNexusInteractionOption(input: {
  workspaceId: string;
  ai: Awaited<ReturnType<typeof aiRuntimeContext>>;
  node: WorkflowNode;
  message: string;
  options: Array<{ id: string; value: string; label: string }>;
}) {
  const configuredModel = typeof input.node.config.intelligentModel === 'string'
    ? input.node.config.intelligentModel.trim()
    : '';
  const model = configuredModel || input.ai.model;
  const modelNode = createWorkflowNode('ai.model', {
    id: `nexus_option_model_${input.node.id}`,
    name: 'Modelo nativo para opções',
    position: { x: 0, y: 0 },
    config: {
      provider: getAiModelRuntimeProvider(model),
      model,
      temperature: 0,
      maxOutputTokens: 256,
      supportsTools: false,
      supportsStructuredOutput: true,
      supportsStreaming: false,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
  });
  const chain = await modelChainForNode({ workspaceId: input.workspaceId, config: input.ai.config, modelNode });
  const generated = await chain.generateStructured({
    messages: [
      {
        role: 'system',
        content: [
          'Classifique a mensagem em exatamente uma das opções fornecidas.',
          'Retorne optionId nulo quando a intenção estiver ambígua ou não corresponder claramente.',
          `Opções permitidas: ${stableStringify(input.options)}`,
        ].join('\n'),
      },
      { role: 'user', content: input.message },
    ],
    schema: z.object({ optionId: z.string().nullable(), confidence: z.number().min(0).max(1) }),
    schemaName: `nexus_option_${input.node.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    timeoutMs: 30_000,
  });
  const minimumConfidence = Math.min(1, Math.max(0, Number(input.node.config.intelligentMinimumConfidence ?? 0.65)));
  const allowed = new Set(input.options.map((option) => option.id));
  const optionId = generated.output.confidence >= minimumConfidence
    && generated.output.optionId
    && allowed.has(generated.output.optionId)
    ? generated.output.optionId
    : null;
  return {
    optionId,
    confidence: generated.output.confidence,
    model: generated.selected.config.model,
    modelCalls: 1,
  };
}

export async function resolveNexusInteractionOption(input: {
  workspaceId: string;
  node: WorkflowNode;
  message: string;
}) {
  const deterministic = matchWorkflowOptionByHeuristics(input.node.config.options, input.message);
  if (deterministic || input.node.config.intelligentMatching !== true) return deterministic;
  const options = Array.isArray(input.node.config.options)
    ? input.node.config.options.filter(isRecord).map((option, index) => ({
      id: String(option.id || option.value || `option_${index + 1}`),
      value: String(option.value || option.label || option.id || ''),
      label: String(option.label || option.value || option.id || ''),
    }))
    : [];
  if (options.length === 0) return null;
  const classified = await classifyNexusInteractionOption({
    workspaceId: input.workspaceId,
    ai: await aiRuntimeContext(input.workspaceId),
    node: input.node,
    message: input.message,
    options,
  });
  const index = options.findIndex((option) => option.id === classified.optionId);
  return index >= 0 ? { ...options[index]!, index, strategy: 'exact' as const } : null;
}

async function createNexusRuntimeEnvironment(input: {
  workspaceId: string;
  adapters?: NexusRuntimeAdapters;
  deliveries?: NexusRuntimeDelivery[];
  database?: Queryable;
}) {
  const deliveries = input.deliveries || [];
  const [ai, knowledgeLibrary] = await Promise.all([
    aiRuntimeContext(input.workspaceId),
    loadWorkspaceDialogyKnowledge(input.workspaceId),
  ]);
  const defaultSendResponse: NonNullable<WorkflowHandlerDependencies['sendResponse']> = async (message, runtimeInput) => {
    deliveries.push({ kind: 'text', nodeId: runtimeInput.node.id, payload: { message } });
    return { success: true, captured: true, message };
  };
  const defaultSendMedia: NonNullable<WorkflowHandlerDependencies['sendMedia']> = async (media, runtimeInput) => {
    deliveries.push({ kind: 'media', nodeId: runtimeInput.node.id, payload: { ...media } });
    return { success: true, captured: true, ...media };
  };

  const sendResponse = input.adapters?.sendResponse || defaultSendResponse;
  const dependencies: WorkflowHandlerDependencies = {
    executeLinkedAgent: input.adapters?.executeLinkedAgent,
    resolveModelChain: async (context) => {
      const requestedTemperature = Number(context.node.config.temperature);
      const modelNode = Number.isFinite(requestedTemperature)
        ? {
            ...context.modelNode,
            config: {
              ...context.modelNode.config,
              temperature: Math.min(2, Math.max(0, requestedTemperature)),
            },
          }
        : context.modelNode;
      return modelChainForNode({
        workspaceId: input.workspaceId,
        config: ai.config,
        modelNode,
      });
    },
    resolveToolRegistry: async (context) => createNexusToolRegistry({
      workspaceId: input.workspaceId,
      toolNodes: context.toolNodes,
    }),
    loadMemory: async (context) => loadNexusDialogyMemory({
      workspaceId: input.workspaceId,
      execution: context.execution,
      memoryNode: context.memoryNode,
    }),
    retrieveKnowledge: async (context) => retrieveNexusDialogyKnowledge({
      workspaceId: input.workspaceId,
      execution: context.execution,
      knowledgeNodes: context.knowledgeNodes,
      library: knowledgeLibrary,
    }),
    applyGuardrails: async (_phase, value) => value,
    executePrompt: async (runtimeInput): Promise<NodeExecutionResult> => {
      const modelNode = runtimeInput.attachments.model?.[0];
      if (!modelNode) {
        return { status: 'error', error: { code: 'PROMPT_MODEL_MISSING', message: 'Conecte um modelo ao bloco de escrita por IA.', retryable: false } };
      }
      const chain = await modelChainForNode({ workspaceId: input.workspaceId, config: ai.config, modelNode });
      const prompt = renderTemplate(String(runtimeInput.node.config.prompt || runtimeInput.node.config.instructions || ''), promptSource(runtimeInput));
      const generated = await chain.generateStructured({
        messages: [
          { role: 'system', content: `${prompt}\nResponda no campo text, sem comentários sobre o formato.` },
          { role: 'user', content: stableStringify(runtimeInput.input) },
        ],
        schema: z.object({ text: z.string() }),
        schemaName: `nexus_prompt_${runtimeInput.node.id}`,
        timeoutMs: Number(modelNode.config.timeoutMs || 60_000),
        signal: runtimeInput.signal,
      });
      const outputKey = String(runtimeInput.node.config.outputKey || 'generatedText').trim();
      return {
        status: 'success',
        selectedOutput: 'success',
        output: { text: generated.output.text },
        statePatch: outputKey ? statePatchAtPath(outputKey, generated.output.text) : undefined,
        metrics: {
          durationMs: 0,
          model: generated.selected.config.model,
          modelCalls: 1,
        },
      };
    },
    sendResponse,
    sendMedia: input.adapters?.sendMedia || defaultSendMedia,
    sendTyping: input.adapters?.sendTyping,
    handoff: input.adapters?.handoff,
    closeConversation: input.adapters?.closeConversation,
    loadState: input.adapters?.loadState,
    saveState: input.adapters?.saveState,
    executeSubflow: input.adapters?.executeSubflow || ((runtimeInput) => executeNexusSubflow({
      workspaceId: input.workspaceId,
      runtimeInput,
      adapters: input.adapters,
      database: input.database,
    })),
    executeHttp: executeNexusHttpRequest,
    executeIntegration: executeNexusIntegration,
    executePlatformAction: (runtimeInput) => executeNexusPlatformAction(runtimeInput, {
      sendResponse,
      sendOptions: input.adapters?.sendOptions,
      sendTemplate: input.adapters?.sendTemplate,
    }),
  };
  const handlers = createDefaultNodeHandlerRegistry(dependencies);
  const classifyInteractionOption: NonNullable<WorkflowExecutorOptions['classifyInteractionOption']> = async (request) => (
    classifyNexusInteractionOption({
      workspaceId: input.workspaceId,
      ai,
      node: request.node,
      message: request.message,
      options: request.options,
    })
  );
  return { handlers, executorOptions: { classifyInteractionOption } satisfies WorkflowExecutorOptions };
}

export async function createNexusRuntimeHandlers(input: {
  workspaceId: string;
  adapters?: NexusRuntimeAdapters;
  deliveries?: NexusRuntimeDelivery[];
}) {
  return (await createNexusRuntimeEnvironment(input)).handlers;
}

export async function loadPublishedNexusWorkflow(input: {
  nexusWorkflowId: string;
  workspaceId?: string;
  database?: Queryable;
}): Promise<PublishedNexusWorkflow | null> {
  const database = input.database || db;
  const result = await database.query(
    `SELECT nw.id, nw.workspace_id, nw.webhook_token_hash, wd.definition
     FROM public.nexus_workflows nw
     JOIN public.workflow_definitions wd
       ON wd.workflow_id = nw.published_workflow_id
      AND wd.workflow_version = nw.published_workflow_version
     WHERE nw.id = $1
       AND nw.status = 'published'
       AND ($2::uuid IS NULL OR nw.workspace_id = $2::uuid)
     LIMIT 1`,
    [input.nexusWorkflowId, input.workspaceId || null],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const workflow = WorkflowDefinitionSchema.parse(parseJson(row.definition));
  return {
    nexusWorkflowId: String(row.id),
    workspaceId: String(row.workspace_id),
    workflow,
    webhookTokenHash: row.webhook_token_hash ? String(row.webhook_token_hash) : null,
  };
}

function setMappedVariable(target: Record<string, unknown>, pathValue: unknown, value: unknown) {
  const segments = String(pathValue || '')
    .replace(/^\$\./, '')
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment && !['__proto__', 'prototype', 'constructor'].includes(segment));
  if (segments.length === 0 || segments.length > 20) return;
  let current = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = structuredClone(value);
      return;
    }
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  });
}

export function materializeNexusTriggerVariables(
  triggerConfig: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const mappings = Array.isArray(triggerConfig.variableMappings)
    ? triggerConfig.variableMappings.filter(isRecord)
    : [];
  const body = isRecord(payload.body) ? payload.body : payload;
  const variables: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const jsonPath = String(mapping.jsonPath || '').trim();
    const flowVariable = String(mapping.flowVariable || '').trim();
    if (!jsonPath || !flowVariable) continue;
    const value = readPath(body, jsonPath) ?? readPath(payload, jsonPath);
    if (value !== undefined) setMappedVariable(variables, flowVariable, value);
  }
  return variables;
}

export const MAX_NEXUS_SUBFLOW_DEPTH = 8;

function normalizedNexusWorkflowId(value: unknown) {
  return String(value || '').trim().replace(/^nexus:/, '');
}

function mappedSubflowValue(value: unknown, source: Record<string, unknown>) {
  if (typeof value !== 'string') return structuredClone(value);
  const exactPath = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/)?.[1];
  if (exactPath) {
    const resolved = readPath(source, exactPath);
    return resolved === undefined ? null : structuredClone(resolved);
  }
  return renderTemplate(value, source);
}

export function materializeNexusSubflowInput(runtimeInput: NodeRuntimeInput) {
  const mappings = isRecord(runtimeInput.node.config.inputMapping)
    ? runtimeInput.node.config.inputMapping
    : {};
  if (Object.keys(mappings).length === 0) return structuredClone(runtimeInput.input);
  const source = promptSource(runtimeInput);
  const payload: Record<string, unknown> = {};
  for (const [targetPath, value] of Object.entries(mappings)) {
    setMappedVariable(payload, targetPath, mappedSubflowValue(value, source));
  }
  return payload;
}

async function executeNexusSubflow(input: {
  workspaceId: string;
  runtimeInput: NodeRuntimeInput;
  adapters?: NexusRuntimeAdapters;
  database?: Queryable;
}): Promise<Record<string, unknown>> {
  const targetWorkflowId = normalizedNexusWorkflowId(input.runtimeInput.node.config.workflowId);
  if (!targetWorkflowId) throw new Error('Selecione o fluxo que deve ser executado.');

  const currentWorkflowId = normalizedNexusWorkflowId(input.runtimeInput.workflow.id);
  const configuredStack = Array.isArray(input.runtimeInput.execution.context.nexusSubflowStack)
    ? input.runtimeInput.execution.context.nexusSubflowStack.map(normalizedNexusWorkflowId).filter(Boolean)
    : [];
  const stack = configuredStack.length > 0
    ? configuredStack
    : currentWorkflowId ? [currentWorkflowId] : [];
  if (stack.includes(targetWorkflowId)) {
    throw new Error(`O subfluxo ${targetWorkflowId} criaria uma chamada circular.`);
  }
  if (stack.length >= MAX_NEXUS_SUBFLOW_DEPTH) {
    throw new Error(`O limite de ${MAX_NEXUS_SUBFLOW_DEPTH} níveis de subfluxo foi atingido.`);
  }

  const published = await loadPublishedNexusWorkflow({
    nexusWorkflowId: targetWorkflowId,
    workspaceId: input.workspaceId,
    database: input.database,
  });
  if (!published) throw new Error('O subfluxo selecionado não está publicado neste workspace.');
  if (!published.workflow.nodes.some((node) => node.type === 'trigger.manual')) {
    throw new Error('O subfluxo publicado precisa começar com o gatilho Execução manual.');
  }

  const parent = input.runtimeInput.execution;
  const result = await startPublishedNexusWorkflow({
    published,
    triggerType: 'trigger.manual',
    payload: materializeNexusSubflowInput(input.runtimeInput),
    context: {
      source: 'nexus_subflow',
      parentExecutionId: parent.executionId,
      parentWorkflowId: input.runtimeInput.workflow.id,
      parentNodeId: input.runtimeInput.node.id,
      nexusSubflowStack: [...stack, targetWorkflowId],
      nexusInternalEventChain: parent.context.nexusInternalEventChain,
      nexusInternalEventDepth: parent.context.nexusInternalEventDepth,
    },
    sessionId: parent.sessionId,
    conversationId: parent.conversationId,
    executionId: `nexus_subflow_${hashValue({
      parentExecutionId: parent.executionId,
      parentNodeId: input.runtimeInput.node.id,
      targetWorkflowId,
      parentStep: parent.totalSteps,
    })}`,
    workerId: `nexus_subflow_${targetWorkflowId}`,
    adapters: input.adapters,
    database: input.database,
  });
  if (result.execution.status === 'waiting') {
    throw new Error('O subfluxo entrou em espera. Subfluxos síncronos não podem conter perguntas ou esperas por evento.');
  }
  if (result.execution.status !== 'completed') {
    throw new Error(result.execution.failure?.message || `O subfluxo terminou com status ${result.execution.status}.`);
  }
  return {
    workflowId: targetWorkflowId,
    executionId: result.execution.executionId,
    status: result.execution.status,
    output: terminalNexusOutput(result.execution),
    deliveries: result.deliveries,
  };
}

export async function startPublishedNexusWorkflow(input: {
  published: PublishedNexusWorkflow;
  triggerType: string;
  triggerOutput?: string;
  payload: Record<string, unknown>;
  context?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  sessionId?: string;
  conversationId?: string;
  executionId?: string;
  workerId?: string;
  adapters?: NexusRuntimeAdapters;
  database?: Queryable;
}): Promise<{ execution: WorkflowExecution; deliveries: NexusRuntimeDelivery[] }> {
  const trigger = input.published.workflow.nodes.find((node) => node.type === input.triggerType);
  if (!trigger) {
    throw new Error(`O fluxo publicado não usa o gatilho ${input.triggerType}.`);
  }
  const deliveries: NexusRuntimeDelivery[] = [];
  const database = input.database || db;
  const environment = await createNexusRuntimeEnvironment({
    workspaceId: input.published.workspaceId,
    adapters: input.adapters,
    deliveries,
    database,
  });
  const persistence = new PostgresWorkflowPersistence(database as typeof db);
  const executor = new WorkflowExecutor(persistence, environment.handlers, environment.executorOptions);
  if (input.executionId) {
    const existing = await persistence.getExecution(input.executionId);
    if (existing) return { execution: existing, deliveries };
  }
  const execution = await executor.start({
    workflow: input.published.workflow,
    triggerNodeId: trigger.id,
    input: input.payload,
    variables: {
      ...materializeNexusTriggerVariables(trigger.config, input.payload),
      ...(input.variables || {}),
    },
    context: {
      source: input.triggerType,
      startedAt: new Date().toISOString(),
      sessionId: input.sessionId || null,
      conversationId: input.conversationId || null,
      triggerOutput: input.triggerOutput || trigger.config.defaultOutput || null,
      ...(input.context || {}),
    },
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    executionId: input.executionId,
  }, { workerId: input.workerId || `nexus_${input.triggerType.replace(/[^a-z0-9]+/gi, '_')}` });
  return { execution, deliveries };
}

export async function resumePublishedNexusWorkflow(input: {
  resume: WorkflowResumeInput;
  workspaceId: string;
  adapters?: NexusRuntimeAdapters;
  database?: Queryable;
}): Promise<{ execution: WorkflowExecution; deliveries: NexusRuntimeDelivery[] }> {
  const deliveries: NexusRuntimeDelivery[] = [];
  const database = input.database || db;
  const environment = await createNexusRuntimeEnvironment({ workspaceId: input.workspaceId, adapters: input.adapters, deliveries, database });
  const persistence = new PostgresWorkflowPersistence(database as typeof db);
  const waiting = await persistence.getExecutionByResumeToken(input.resume.resumeToken);
  if (!waiting || waiting.workspaceId !== input.workspaceId || !waiting.workflowId.startsWith('nexus:')) {
    throw new Error('Execução Nexus aguardando resposta não encontrada neste workspace.');
  }
  const execution = await new WorkflowExecutor(persistence, environment.handlers, environment.executorOptions).resume(input.resume);
  return { execution, deliveries };
}

export async function cancelPublishedNexusWorkflowExecution(input: {
  workspaceId: string;
  executionId: string;
  reason: string;
  database?: Queryable;
}) {
  const persistence = new PostgresWorkflowPersistence((input.database || db) as typeof db);
  const execution = await persistence.getExecution(input.executionId);
  if (!execution || execution.workspaceId !== input.workspaceId || !execution.workflowId.startsWith('nexus:')) {
    throw new Error('Execução Nexus ativa não encontrada neste workspace.');
  }
  return new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry()).cancel(input.executionId, input.reason);
}

export function terminalNexusOutput(execution: WorkflowExecution): Record<string, unknown> {
  const terminal = [...execution.executionPath].reverse().find((step) => (
    step.nodeType === 'output.end' || step.nodeType === 'output.redirect'
  ));
  if (terminal && isRecord(terminal.output)) return terminal.output;
  return {};
}
