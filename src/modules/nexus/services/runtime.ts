import { createStudioFlowNodeExecutor } from '@/services/agent-studio/flow-runtime';
import { cancelStudioFlowInvocations } from '@/services/agent-studio/flow-store';
import { z } from 'zod';

import { db } from '@/lib/db';
import { executeToolboxMedia } from './toolbox-media';
import { workflowFileDownload } from './workflow-files';
import { executeAutomationBatch } from './automation-batches';
import { executeApprovalNode, requestAutomationApproval } from './automation-approvals';
import { assertAutomationToolboxEnabled, usesAutomationToolbox } from './toolbox-policy';
import { toolboxSource } from './runtime-source';
import { executeConnectorStep } from './connectors';
import { executeDurableEffect, nodeInvocationKey } from './durable-effects';
import { stopPublishedStudioNode } from '@/services/agent-studio/workflow-adapter';
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
import { isRecord, materializeValue, readPath, renderTemplate, stableStringify, statePatchAtPath } from '@/services/workflow-runtime/utils';

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
  'executeLinkedAgent' | 'executePublishedAgent' | 'sendResponse' | 'sendMedia' | 'sendTyping' | 'handoff' | 'queueHandoff' | 'closeConversation' | 'loadState' | 'saveState' | 'executeSubflow'
> & {
  sendOptions?: (
    options: { title: string; choices: NexusPlatformChoice[]; invalid?: boolean; invalidMessage?: string },
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
    executeToolbox: async runtimeInput => {
      assertAutomationToolboxEnabled(input.workspaceId);
      if (['logic.map_subflow', 'logic.fork_subflows', 'logic.async_subflow'].includes(runtimeInput.node.type)) return executeAutomationBatch(runtimeInput);
      const config = materializeValue(runtimeInput.node.config, toolboxSource(runtimeInput)) as Record<string, unknown>;
      if (runtimeInput.node.type === 'logic.approval') return executeApprovalNode(runtimeInput, isRecord(config.arguments) ? config.arguments : { value: config.arguments }, String(config.title || 'Revisar operação'));
      if (runtimeInput.node.type === 'output.webhook_response') return { status: 'success', selectedOutput: 'success', output: { response: config } };
      if (runtimeInput.node.type === 'integration.connector') return executeConnectorStep(runtimeInput);
      if (['audio.elevenlabs', 'audio.transcribe', 'media.analyze'].includes(runtimeInput.node.type)) return executeDurableEffect(input.workspaceId, nodeInvocationKey(runtimeInput), { config, type: runtimeInput.node.type }, () => executeToolboxMedia(runtimeInput)) as Promise<NodeExecutionResult>;
      return executeToolboxMedia(runtimeInput);
    },
    executeStudioFlow: createStudioFlowNodeExecutor({ config: ai.config, sendResponse,
      retrieveKnowledge: (runtimeInput, nodes) => retrieveNexusDialogyKnowledge({ workspaceId: input.workspaceId, execution: runtimeInput.execution, knowledgeNodes: nodes, library: knowledgeLibrary }),
      loadMemory: (runtimeInput, node) => loadNexusDialogyMemory({ workspaceId: input.workspaceId, execution: runtimeInput.execution, memoryNode: node }),
      executeSubflow: (runtimeInput) => executeNexusSubflow({ workspaceId: input.workspaceId, runtimeInput, adapters: input.adapters, database: input.database }),
    }),
    stopStudioFlow: async ({ workflow, execution }) => { if (workflow.workspaceId) await cancelStudioFlowInvocations(workflow.workspaceId, execution.executionId); },
    executeLinkedAgent: input.adapters?.executeLinkedAgent,
    executePublishedAgent: input.adapters?.executePublishedAgent,
    stopPublishedAgent: stopPublishedStudioNode,
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
    sendMedia: async (media, runtimeInput) => {
      if (media.file) {
        const resolved = await workflowFileDownload(input.workspaceId, media.file);
        const delivery = await (input.adapters?.sendMedia || defaultSendMedia)({ ...media, file: undefined, url: resolved.url, fileName: resolved.file.name, mimeType: resolved.file.mimeType }, runtimeInput);
        return JSON.parse(JSON.stringify(delivery).split(resolved.url).join('[PRIVATE_FILE_URL]')) as Record<string, unknown>;
      }
      return (input.adapters?.sendMedia || defaultSendMedia)(media, runtimeInput);
    },
    sendTyping: input.adapters?.sendTyping,
    handoff: input.adapters?.handoff,
    queueHandoff: input.adapters?.queueHandoff,
    closeConversation: input.adapters?.closeConversation,
    loadState: input.adapters?.loadState,
    saveState: input.adapters?.saveState,
    executeSubflow: input.adapters?.executeSubflow || ((runtimeInput) => executeNexusSubflow({
      workspaceId: input.workspaceId,
      runtimeInput,
      adapters: input.adapters,
      database: input.database,
    })),
    executeHttp: runtimeInput => runtimeInput.execution.context.automationManaged === true && !['GET', 'HEAD'].includes(String(runtimeInput.node.config.method || 'GET'))
      ? executeDurableEffect(input.workspaceId, nodeInvocationKey(runtimeInput), { type: runtimeInput.node.type, config: runtimeInput.node.config, input: runtimeInput.input }, () => executeNexusHttpRequest(runtimeInput)) : executeNexusHttpRequest(runtimeInput),
    executeIntegration: runtimeInput => runtimeInput.execution.context.automationManaged === true
      ? executeDurableEffect(input.workspaceId, nodeInvocationKey(runtimeInput), { type: runtimeInput.node.type, config: runtimeInput.node.config, input: runtimeInput.input }, () => executeNexusIntegration(runtimeInput)) : executeNexusIntegration(runtimeInput),
    executePlatformAction: (runtimeInput) => executeNexusPlatformAction(runtimeInput, {
      sendResponse,
      sendOptions: input.adapters?.sendOptions,
      sendTemplate: input.adapters?.sendTemplate,
    }),
  };
  const handlers = createDefaultNodeHandlerRegistry(dependencies);
  handlers.wrapExecutions(async (handler, runtimeInput) => {
    const recovery = runtimeInput.execution.context.__automationRecovery;
    if (isRecord(recovery) && recovery.nodeId === runtimeInput.node.id && isRecord(recovery.result)) return recovery.result as NodeExecutionResult;
    if (handler.type === 'integration.http_request' && (runtimeInput.node.config.approvalPolicy === 'required' || (runtimeInput.execution.context.automationManaged === true && runtimeInput.node.config.requiresConfirmation === true))) {
      assertAutomationToolboxEnabled(input.workspaceId);
      const args = materializeValue(runtimeInput.node.config, toolboxSource(runtimeInput));
      const approval = await requestAutomationApproval(runtimeInput, isRecord(args) ? args : {}, runtimeInput.node.name);
      if (approval) return approval.status === 'waiting' ? approval : { status: 'error', error: { code: 'HTTP_APPROVAL_DENIED', message: 'A chamada foi recusada ou a aprovação expirou.', retryable: false }, output: approval.output };
    }
    const managed = runtimeInput.execution.context.automationManaged === true;
    const effectful = /^(ai\.(?!model)|interaction\.|integration\.|whatsapp\.|dialogy\.)/.test(handler.type) || ['data.extract', 'logic.ai_router', 'output.respond', 'output.media', 'output.handoff', 'output.close_conversation'].includes(handler.type);
    const readHttp = handler.type === 'integration.http_request' && ['GET', 'HEAD'].includes(String(runtimeInput.node.config.method || 'GET'));
    if (!managed || !effectful || readHttp || handler.type === 'integration.connector') return handler.execute(runtimeInput);
    return executeDurableEffect(input.workspaceId, `step_${nodeInvocationKey(runtimeInput)}`, { type: handler.type, config: runtimeInput.node.config, input: runtimeInput.input }, () => handler.execute(runtimeInput));
  });
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
  const remaining = isRecord(parent.context.studioBudgetRemaining) ? parent.context.studioBudgetRemaining : parent.context.automationManaged === true ? {
    modelCalls: Math.max(0, input.runtimeInput.workflow.settings.maxModelCalls - parent.totalModelCalls),
    toolCalls: Math.max(0, input.runtimeInput.workflow.settings.maxToolCalls - parent.totalToolCalls),
    timeoutMs: Math.max(1, input.runtimeInput.workflow.settings.executionTimeoutMs - (Date.now() - Date.parse(parent.startedAt) - Number(parent.context.__automationPausedMs || 0))),
  } : undefined;
  const result = await startPublishedNexusWorkflow({
    published,
    signal: input.runtimeInput.signal,
    ...(remaining ? { limits: { maxModelCalls: Number(remaining.modelCalls), maxToolCalls: Number(remaining.toolCalls), executionTimeoutMs: Number(remaining.timeoutMs) } } : {}),
    triggerType: 'trigger.manual',
    payload: materializeNexusSubflowInput(input.runtimeInput),
    context: {
      source: 'nexus_subflow',
      ...(parent.context.automationManaged === true ? { automationManaged: true } : {}),
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
      studioCallId: parent.context.studioSubflowCallId,
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
    metrics: { modelCalls: result.execution.totalModelCalls, toolCalls: result.execution.totalToolCalls },
    deliveries: result.deliveries,
  };
}

export async function startPublishedNexusWorkflow(input: {
  signal?: AbortSignal;
  limits?: import('@/services/workflow-runtime/runtime-limits').WorkflowRuntimeCaps;
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
      ...(usesAutomationToolbox(input.published.workflow) ? { automationManaged: true } : {}),
    },
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    executionId: input.executionId,
  }, { workerId: input.workerId || `nexus_${input.triggerType.replace(/[^a-z0-9]+/gi, '_')}`, signal: input.signal, limits: input.limits });
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
  const persistence = new PostgresWorkflowPersistence(database as typeof db);
  const waiting = await persistence.getExecutionByResumeToken(input.resume.resumeToken);
  if (!waiting || waiting.workspaceId !== input.workspaceId || !waiting.workflowId.startsWith('nexus:')) {
    throw new Error('Execução Nexus aguardando resposta não encontrada neste workspace.');
  }
  const adapters = input.adapters || (waiting.conversationId ? await (await import('./chat-adapters')).createNexusChatAdapters({ workspaceId: input.workspaceId, chatId: waiting.conversationId }) : undefined);
  const environment = await createNexusRuntimeEnvironment({ workspaceId: input.workspaceId, adapters, deliveries, database });
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
  return new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry({ stopPublishedAgent: stopPublishedStudioNode, stopStudioFlow: async ({ workflow, execution }) => { if (workflow.workspaceId) await cancelStudioFlowInvocations(workflow.workspaceId, execution.executionId); } })).cancel(input.executionId, input.reason);
}

export function terminalNexusOutput(execution: WorkflowExecution): Record<string, unknown> {
  const terminal = [...execution.executionPath].reverse().find((step) => (
    step.nodeType === 'output.end' || step.nodeType === 'output.redirect'
  ));
  if (terminal && isRecord(terminal.output)) return terminal.output;
  return {};
}

/** Worker entry point: reuses the persisted immutable version and execution lock. */
export async function runPersistedNexusExecution(input: {
  workspaceId: string; executionId: string; workflowId?: string; version?: string; input?: Record<string, unknown>;
  context?: Record<string, unknown>; sessionId?: string; conversationId?: string;
  limits?: { maxModelCalls: number; maxToolCalls: number; executionTimeoutMs: number };
}): Promise<WorkflowExecution> {
  const persistence = new PostgresWorkflowPersistence(db);
  const existing = await persistence.getExecution(input.executionId);
  if (existing && (existing.workspaceId !== input.workspaceId || !existing.workflowId.startsWith('nexus:'))) throw new Error('Execução indisponível neste workspace.');
  if (existing && ['completed', 'failed', 'cancelled'].includes(existing.status)) return existing;
  const workflow = await persistence.getWorkflowDefinition(existing?.workflowId || input.workflowId || '', existing?.workflowVersion || input.version || '');
  if (!workflow || workflow.workspaceId !== input.workspaceId) throw new Error('Versão publicada indisponível neste workspace.');
  const active = await loadPublishedNexusWorkflow({ workspaceId: input.workspaceId, nexusWorkflowId: workflow.id.replace(/^nexus:/, '') });
  if (!active) throw new Error('O fluxo foi despublicado ou desativado.');
  const conversationId = existing?.conversationId || input.conversationId;
  const adapters = conversationId ? await (await import('./chat-adapters')).createNexusChatAdapters({ workspaceId: input.workspaceId, chatId: conversationId }) : undefined;
  const environment = await createNexusRuntimeEnvironment({ workspaceId: input.workspaceId, adapters });
  const executor = new WorkflowExecutor(persistence, environment.handlers, environment.executorOptions);
  if (existing) return executor.runExecution(existing.executionId);
  const trigger = workflow.nodes.find(node => node.type === (input.context?.source === 'webhook' ? 'trigger.webhook' : 'trigger.manual'));
  if (!trigger) throw new Error('O subfluxo não possui o gatilho esperado.');
  return executor.start({ workflow, executionId: input.executionId, triggerNodeId: trigger.id, input: input.input || {}, variables: materializeNexusTriggerVariables(trigger.config, input.input || {}), context: { startedAt: new Date().toISOString(), sessionId: input.sessionId || null, conversationId: conversationId || null, ...input.context, automationManaged: true }, sessionId: input.sessionId, conversationId }, { limits: input.limits });
}
