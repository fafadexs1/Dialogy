import { randomUUID } from 'node:crypto';
import { getWorkflowNodeManifest } from './catalog';
import { WorkflowEventBus } from './events';
import {
  WorkflowExecutionLockError,
  type WorkflowPersistence,
} from './persistence';
import {
  NodeExecutionResultSchema,
  WorkflowDefinitionSchema,
  WorkflowExecutionSchema,
} from './schemas';
import type {
  ConnectionType,
  NodeExecutionResult,
  NodeHandler,
  NodeHandlerRegistry,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowExecution,
  WorkflowNode,
  WorkflowResumeInput,
  WorkflowRunOptions,
  WorkflowStartInput,
} from './types';
import {
  createId,
  delay,
  isRecord,
  mergeStatePatch,
  normalizeRuntimeError,
  withTimeout,
} from './utils';
import { validateWorkflowDefinition } from './validator';

export class InvalidWorkflowDefinitionError extends Error {
  readonly code = 'INVALID_WORKFLOW_DEFINITION';

  constructor(readonly validation: ReturnType<typeof validateWorkflowDefinition>) {
    super(validation.errors.map((issue) => issue.message).join(' '));
    this.name = 'InvalidWorkflowDefinitionError';
  }
}

export class WorkflowLimitReachedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'WorkflowLimitReachedError';
  }
}

export type WorkflowExecutorOptions = {
  defaultNodeTimeoutMs?: number;
  lockLeaseMs?: number;
  validateBeforeRun?: boolean;
};

const TERMINAL_EXECUTION_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
] as const);

const ATTACHMENT_CONNECTION_TYPES = new Set<ConnectionType>([
  'model',
  'tool',
  'agent_tool',
  'memory',
  'knowledge',
  'guardrail',
]);

const MODEL_CONSUMING_NODE_TYPES = new Set([
  'data.extract',
  'logic.ai_router',
  'memory.history_summarizer',
]);

const TOOL_CONSUMING_NODE_TYPES = new Set([
  'ai.agent',
  'ai.supervisor',
  'ai.plan_executor',
]);

function nodeMayConsumeModel(node: WorkflowNode): boolean {
  return node.type.startsWith('ai.') || MODEL_CONSUMING_NODE_TYPES.has(node.type);
}

function nodeMayConsumeTools(node: WorkflowNode): boolean {
  return TOOL_CONSUMING_NODE_TYPES.has(node.type);
}

function now() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function findTrigger(workflow: WorkflowDefinition): WorkflowNode {
  const trigger = workflow.nodes.find((node) => node.type.startsWith('trigger.'));
  if (!trigger) throw new Error('Workflow trigger not found.');
  return trigger;
}

function createExecution(input: WorkflowStartInput): WorkflowExecution {
  const timestamp = now();
  const trigger = findTrigger(input.workflow);
  return WorkflowExecutionSchema.parse({
    executionId: input.executionId || createId('exec'),
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.version,
    workspaceId: input.workflow.workspaceId,
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    status: 'queued',
    currentNodeId: trigger.id,
    previousNodeId: null,
    pendingNodeIds: [],
    input: clone(input.input),
    variables: clone(input.variables || {}),
    context: clone(input.context || {}),
    nodeResults: {},
    executionPath: [],
    startedAt: timestamp,
    updatedAt: timestamp,
    totalSteps: 0,
    totalModelCalls: 0,
    totalToolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    version: 0,
  });
}

function nodeById(workflow: WorkflowDefinition, nodeId: string): WorkflowNode {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Workflow node ${nodeId} not found.`);
  return node;
}

function nodeAttachments(
  workflow: WorkflowDefinition,
  nodeId: string,
): Partial<Record<Exclude<ConnectionType, 'main' | 'error' | 'event'>, WorkflowNode[]>> {
  const grouped: Partial<Record<Exclude<ConnectionType, 'main' | 'error' | 'event'>, WorkflowNode[]>> = {};
  for (const connection of workflow.connections) {
    if (
      connection.targetNodeId !== nodeId
      || !ATTACHMENT_CONNECTION_TYPES.has(connection.connectionType)
    ) {
      continue;
    }
    const type = connection.connectionType as Exclude<ConnectionType, 'main' | 'error' | 'event'>;
    const source = workflow.nodes.find((node) => node.id === connection.sourceNodeId);
    if (!source) continue;
    grouped[type] = [...(grouped[type] || []), source];
  }
  return grouped;
}

function mergeIsReady(
  workflow: WorkflowDefinition,
  execution: WorkflowExecution,
  node: WorkflowNode,
): boolean {
  if (node.type !== 'logic.merge') return true;
  const requiredSources = workflow.connections
    .filter((connection) => (
      connection.targetNodeId === node.id
      && connection.connectionType === 'main'
    ))
    .map((connection) => connection.sourceNodeId);
  return requiredSources.every((sourceNodeId) => Boolean(execution.nodeResults[sourceNodeId]));
}

function buildNodeInput(
  workflow: WorkflowDefinition,
  execution: WorkflowExecution,
  node: WorkflowNode,
): Record<string, unknown> {
  if (node.type.startsWith('trigger.')) return clone(execution.input);
  const incoming = workflow.connections.filter((connection) => (
    connection.targetNodeId === node.id
    && (
      connection.connectionType === 'main'
      || connection.connectionType === 'error'
      || connection.connectionType === 'event'
    )
  ));
  const completedInputs = incoming.flatMap((connection) => {
    const result = execution.nodeResults[connection.sourceNodeId];
    if (!result) return [];
    if (connection.connectionType === 'error') {
      return [{
        sourceNodeId: connection.sourceNodeId,
        portId: connection.targetPortId,
        value: {
          error: result.error,
          output: result.output,
        },
      }];
    }
    return [{
      sourceNodeId: connection.sourceNodeId,
      portId: connection.targetPortId,
      value: result.output || {},
    }];
  });
  const resumeInput = isRecord(execution.context.__resumeInput)
    ? execution.context.__resumeInput
    : undefined;
  if (completedInputs.length === 0) {
    return resumeInput ? { ...clone(execution.input), resume: clone(resumeInput) } : clone(execution.input);
  }
  if (completedInputs.length === 1) {
    const value = isRecord(completedInputs[0]?.value) ? completedInputs[0].value : {};
    return resumeInput ? { ...clone(value), resume: clone(resumeInput) } : clone(value);
  }
  return {
    branches: Object.fromEntries(
      completedInputs.map((item) => [item.sourceNodeId, clone(item.value)]),
    ),
    ...(resumeInput ? { resume: clone(resumeInput) } : {}),
  };
}

function selectedConnections(
  workflow: WorkflowDefinition,
  node: WorkflowNode,
  result: NodeExecutionResult,
): string[] {
  if (result.nextNodeId) {
    const connected = workflow.connections.some((connection) => (
      connection.sourceNodeId === node.id
      && connection.targetNodeId === result.nextNodeId
      && (
        connection.connectionType === 'main'
        || connection.connectionType === 'error'
        || connection.connectionType === 'event'
      )
    ));
    return connected ? [result.nextNodeId] : [];
  }

  if (result.selectedOutputs) {
    if (node.type !== 'logic.parallel') return [];
    return result.selectedOutputs.flatMap((outputId) => (
      workflow.connections
        .filter((connection) => (
          connection.sourceNodeId === node.id
          && connection.sourcePortId === outputId
          && connection.connectionType === 'main'
        ))
        .map((connection) => connection.targetNodeId)
    ));
  }

  const connectionType: ConnectionType = result.status === 'error' ? 'error' : 'main';
  const selectedOutput = result.selectedOutput
    || (result.status === 'error' ? 'error' : 'success');
  const exact = workflow.connections.filter((connection) => (
    connection.sourceNodeId === node.id
    && connection.connectionType === connectionType
    && connection.sourcePortId === selectedOutput
  ));
  if (exact.length > 0) return exact.map((connection) => connection.targetNodeId);

  const compatible = workflow.connections.filter((connection) => (
    connection.sourceNodeId === node.id
    && connection.connectionType === connectionType
  ));
  return compatible.length === 1
    ? [compatible[0]!.targetNodeId]
    : [];
}

function retryDelay(
  attempt: number,
  retryPolicy: NonNullable<WorkflowNode['retryPolicy']>,
  requestedDelay?: number,
) {
  if (requestedDelay !== undefined) return requestedDelay;
  return Math.min(
    retryPolicy.maxDelayMs,
    retryPolicy.initialDelayMs * (retryPolicy.backoffMultiplier ** Math.max(0, attempt - 1)),
  );
}

export class WorkflowExecutor {
  readonly events: WorkflowEventBus;
  private readonly defaultNodeTimeoutMs: number;
  private readonly lockLeaseMs: number;
  private readonly validateBeforeRun: boolean;

  constructor(
    private readonly persistence: WorkflowPersistence,
    private readonly handlers: NodeHandlerRegistry,
    options: WorkflowExecutorOptions = {},
  ) {
    this.events = new WorkflowEventBus(persistence);
    this.defaultNodeTimeoutMs = options.defaultNodeTimeoutMs || 30_000;
    this.lockLeaseMs = options.lockLeaseMs || 150_000;
    this.validateBeforeRun = options.validateBeforeRun ?? true;
  }

  async start(input: WorkflowStartInput, options: WorkflowRunOptions = {}): Promise<WorkflowExecution> {
    const workflow = WorkflowDefinitionSchema.parse(input.workflow);
    if (this.validateBeforeRun) {
      const validation = validateWorkflowDefinition(workflow);
      if (!validation.valid) throw new InvalidWorkflowDefinitionError(validation);
    }
    await this.persistence.saveWorkflowDefinition(workflow);
    const execution = await this.persistence.createExecution(createExecution({ ...input, workflow }));
    await this.events.initializeExecution(execution.executionId);
    await this.emit(execution, {
      type: 'execution.started',
      safeSummary: 'Execução iniciada',
    });
    return this.runExecution(execution.executionId, options);
  }

  async runExecution(
    executionId: string,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowExecution> {
    const workerId = options.workerId || `worker_${randomUUID()}`;
    let execution = await this.persistence.getExecution(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found.`);
    if (TERMINAL_EXECUTION_STATUSES.has(execution.status as 'completed' | 'failed' | 'cancelled')) {
      return execution;
    }
    const workflow = await this.persistence.getWorkflowDefinition(
      execution.workflowId,
      execution.workflowVersion,
    );
    if (!workflow) throw new Error(`Workflow ${execution.workflowId}@${execution.workflowVersion} not found.`);

    const leaseMs = Math.max(this.lockLeaseMs, workflow.settings.executionTimeoutMs + 30_000);
    const locked = await this.persistence.acquireExecutionLock(executionId, workerId, leaseMs);
    if (!locked) throw new WorkflowExecutionLockError(executionId);
    execution = locked;

    try {
      if (execution.status === 'queued') {
        execution.status = 'running';
        execution.updatedAt = now();
        execution = await this.persistence.saveExecution(execution, execution.version);
      }
      while (execution.status === 'running') {
        await this.persistence.renewExecutionLock(executionId, workerId, leaseMs);
        if (options.signal?.aborted) {
          execution = await this.markCancelled(execution, 'Execution aborted by caller.');
          break;
        }

        let currentNodeId = execution.currentNodeId;
        if (!currentNodeId) {
          currentNodeId = execution.pendingNodeIds.shift() || null;
          execution.currentNodeId = currentNodeId;
        }
        if (!currentNodeId) {
          execution = await this.completeExecution(execution);
          break;
        }
        const node = nodeById(workflow, currentNodeId);
        const limitFailure = this.checkGlobalLimits(execution, workflow, options, node);
        if (limitFailure) {
          execution = await this.failExecution(execution, limitFailure.code, limitFailure.message);
          break;
        }
        if (!mergeIsReady(workflow, execution, node) && execution.pendingNodeIds.length > 0) {
          const deferredMergeId = node.id;
          const nextPendingId = execution.pendingNodeIds.shift()!;
          execution.pendingNodeIds = execution.pendingNodeIds.filter((nodeId) => nodeId !== deferredMergeId);
          execution.pendingNodeIds.push(deferredMergeId);
          execution.currentNodeId = nextPendingId;
          execution.updatedAt = now();
          execution = await this.persistence.saveExecution(execution, execution.version);
          continue;
        }
        execution = await this.executeStep(workflow, execution, node, options.signal);
      }
      return execution;
    } finally {
      await this.persistence.releaseExecutionLock(executionId, workerId);
    }
  }

  async resume(input: WorkflowResumeInput): Promise<WorkflowExecution> {
    const waiting = await this.persistence.getExecutionByResumeToken(input.resumeToken);
    if (!waiting) throw new Error('Waiting execution not found for the supplied resume token.');
    const workerId = input.workerId || `worker_${randomUUID()}`;
    const locked = await this.persistence.acquireExecutionLock(waiting.executionId, workerId, this.lockLeaseMs);
    if (!locked) throw new WorkflowExecutionLockError(waiting.executionId);
    try {
      const workflow = await this.persistence.getWorkflowDefinition(locked.workflowId, locked.workflowVersion);
      if (!workflow) throw new Error(`Workflow ${locked.workflowId}@${locked.workflowVersion} not found.`);
      const waitingNode = locked.currentNodeId ? nodeById(workflow, locked.currentNodeId) : null;
      if (!waitingNode) throw new Error('Waiting node not found.');
      const waitingResult = locked.nodeResults[waitingNode.id];
      const nextNodeIds = waitingResult
        ? selectedConnections(workflow, waitingNode, {
            ...waitingResult,
            status: 'route',
            selectedOutput: waitingResult.selectedOutput || 'resumed',
          })
        : [];
      if (nextNodeIds.length === 0) {
        throw new Error(`Waiting node ${waitingNode.id} has no resume route.`);
      }
      locked.status = 'running';
      locked.previousNodeId = waitingNode.id;
      locked.currentNodeId = nextNodeIds[0]!;
      locked.pendingNodeIds.push(...nextNodeIds.slice(1));
      locked.waitingReason = undefined;
      locked.resumeToken = undefined;
      locked.context = mergeStatePatch(locked.context, {
        ...(input.contextPatch || {}),
        __resumeInput: input.input || {},
      });
      locked.updatedAt = now();
      const saved = await this.persistence.saveExecution(locked, locked.version);
      await this.emit(saved, {
        type: 'execution.resumed',
        safeSummary: 'Execução retomada',
      });
    } finally {
      await this.persistence.releaseExecutionLock(waiting.executionId, workerId);
    }
    return this.runExecution(waiting.executionId, { workerId });
  }

  async cancel(executionId: string, reason = 'Cancelled by request.'): Promise<WorkflowExecution> {
    const workerId = `cancel_${randomUUID()}`;
    const locked = await this.persistence.acquireExecutionLock(executionId, workerId, this.lockLeaseMs);
    if (!locked) throw new WorkflowExecutionLockError(executionId);
    try {
      if (TERMINAL_EXECUTION_STATUSES.has(locked.status as 'completed' | 'failed' | 'cancelled')) {
        return locked;
      }
      return await this.markCancelled(locked, reason);
    } finally {
      await this.persistence.releaseExecutionLock(executionId, workerId);
    }
  }

  private checkGlobalLimits(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    options: WorkflowRunOptions,
    nextNode: WorkflowNode,
  ): { code: string; message: string } | null {
    const maxSteps = Math.min(options.maxSteps || workflow.settings.maxSteps, workflow.settings.maxSteps);
    if (execution.totalSteps >= maxSteps) {
      return { code: 'MAX_STEPS_REACHED', message: `Execution reached ${maxSteps} steps.` };
    }
    if (Date.now() - new Date(execution.startedAt).getTime() >= workflow.settings.executionTimeoutMs) {
      return { code: 'EXECUTION_TIMEOUT', message: 'Execution exceeded its total timeout.' };
    }
    if (
      nodeMayConsumeModel(nextNode)
      && execution.totalModelCalls >= workflow.settings.maxModelCalls
    ) {
      return { code: 'MAX_MODEL_CALLS_REACHED', message: 'Execution reached the model call limit.' };
    }
    if (
      nodeMayConsumeTools(nextNode)
      && execution.totalToolCalls >= workflow.settings.maxToolCalls
    ) {
      return { code: 'MAX_TOOL_CALLS_REACHED', message: 'Execution reached the tool call limit.' };
    }
    if (
      nodeMayConsumeModel(nextNode)
      && execution.totalInputTokens >= workflow.settings.maxTotalInputTokens
    ) {
      return { code: 'MAX_INPUT_TOKENS_REACHED', message: 'Execution reached the input token limit.' };
    }
    if (
      nodeMayConsumeModel(nextNode)
      && execution.totalOutputTokens >= workflow.settings.maxTotalOutputTokens
    ) {
      return { code: 'MAX_OUTPUT_TOKENS_REACHED', message: 'Execution reached the output token limit.' };
    }
    return null;
  }

  private async executeStep(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution,
    node: WorkflowNode,
    signal?: AbortSignal,
  ): Promise<WorkflowExecution> {
    const input = buildNodeInput(workflow, execution, node);
    const stateBefore = clone(execution.variables);
    await this.emit(execution, {
      type: 'node.queued',
      nodeId: node.id,
      safeSummary: `${node.name} na fila`,
    });
    const startedAt = now();
    await this.emit(execution, {
      type: 'node.started',
      nodeId: node.id,
      safeSummary: `${node.name} iniciado`,
    });

    const result = await this.executeNodeSafely(
      workflow,
      execution,
      node,
      input,
      signal,
    );
    const stateAfter = result.statePatch
      ? mergeStatePatch(execution.variables, result.statePatch)
      : execution.variables;
    const finishedAt = now();
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    const finalResult = NodeExecutionResultSchema.parse({
      ...result,
      metrics: {
        durationMs,
        ...(result.metrics || {}),
      },
    });

    execution.nodeResults[node.id] = finalResult;
    execution.variables = stateAfter;
    execution.totalSteps += 1;
    execution.totalToolCalls += finalResult.toolCalls?.length || finalResult.metrics?.toolCalls || 0;
    execution.totalInputTokens += finalResult.metrics?.inputTokens || 0;
    execution.totalOutputTokens += finalResult.metrics?.outputTokens || 0;
    execution.totalTokens = execution.totalInputTokens + execution.totalOutputTokens;
    execution.totalModelCalls += finalResult.metrics?.modelCalls
      ?? (finalResult.metrics?.model ? 1 : 0);
    execution.executionPath.push({
      sequence: execution.executionPath.length,
      nodeId: node.id,
      nodeType: node.type,
      attempt: finalResult.metrics?.attempts || 1,
      status: finalResult.status,
      selectedOutput: finalResult.selectedOutput,
      startedAt,
      finishedAt,
      durationMs,
      input: clone(input),
      output: clone(finalResult.output || {}),
      stateBefore,
      statePatch: clone(finalResult.statePatch || {}),
      stateAfter: clone(stateAfter),
      error: finalResult.error
        ? {
            code: finalResult.error.code,
            message: finalResult.error.message,
            retryable: finalResult.error.retryable,
          }
        : undefined,
    });
    execution.updatedAt = finishedAt;

    if (finalResult.status === 'waiting') {
      execution.status = 'waiting';
      execution.waitingReason = finalResult.waitingReason;
      execution.resumeToken = finalResult.resumeToken;
      execution.currentNodeId = node.id;
      execution = await this.persistence.saveExecution(execution, execution.version);
      await this.emit(execution, {
        type: 'execution.waiting',
        nodeId: node.id,
        safeSummary: 'Execução aguardando retomada',
        data: { reason: finalResult.waitingReason },
      });
      return execution;
    }

    const manifest = getWorkflowNodeManifest(node.type);
    if (finalResult.status === 'completed' || manifest?.terminal) {
      execution.currentNodeId = null;
      execution.previousNodeId = node.id;
      execution = await this.persistence.saveExecution(execution, execution.version);
      await this.emit(execution, {
        type: 'node.completed',
        nodeId: node.id,
        safeSummary: `${node.name} concluído`,
        data: { durationMs, selectedOutput: finalResult.selectedOutput },
      });
      return this.completeExecution(execution);
    }

    const targets = selectedConnections(workflow, node, finalResult);
    if (targets.length === 0) {
      const failure = finalResult.error || {
        code: 'NO_ROUTE_SELECTED',
        message: `Node ${node.name} did not select a connected output.`,
        retryable: false,
      };
      execution.failure = {
        code: failure.code,
        message: failure.message,
        nodeId: node.id,
        details: failure.details,
      };
      execution.status = 'failed';
      execution.currentNodeId = null;
      execution.previousNodeId = node.id;
      execution.finishedAt = now();
      execution = await this.persistence.saveExecution(execution, execution.version);
      await this.emit(execution, {
        type: 'node.failed',
        nodeId: node.id,
        safeSummary: `${node.name} falhou`,
        data: { code: failure.code, durationMs },
      });
      await this.emit(execution, {
        type: 'execution.failed',
        nodeId: node.id,
        safeSummary: 'Execução falhou',
        data: { code: failure.code },
      });
      return execution;
    }

    execution.previousNodeId = node.id;
    execution.currentNodeId = targets[0]!;
    execution.pendingNodeIds = execution.pendingNodeIds.filter((nodeId) => nodeId !== execution.currentNodeId);
    if (targets.length > 1) {
      for (const target of targets.slice(1)) {
        if (target !== execution.currentNodeId && !execution.pendingNodeIds.includes(target)) {
          execution.pendingNodeIds.push(target);
        }
      }
    }
    execution.context = {
      ...execution.context,
      __resumeInput: undefined,
    };
    execution = await this.persistence.saveExecution(execution, execution.version);
    await this.emit(execution, {
      type: finalResult.status === 'error' ? 'node.failed' : 'node.completed',
      nodeId: node.id,
      safeSummary: finalResult.status === 'error'
        ? `${node.name} encaminhado para tratamento de erro`
        : `${node.name} concluído`,
      data: {
        durationMs,
        selectedOutput: finalResult.selectedOutput,
        nextNodeIds: targets,
      },
    });
    return execution;
  }

  private async executeNodeSafely(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution,
    node: WorkflowNode,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const handler = this.handlers.get(node.type);
    if (!handler) {
      return {
        status: 'error',
        error: {
          code: 'NODE_HANDLER_NOT_FOUND',
          message: `No runtime handler is registered for ${node.type}.`,
          retryable: false,
        },
      };
    }
    const configValidation = handler.configSchema?.safeParse(node.config);
    if (configValidation && !configValidation.success) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_NODE_CONFIG',
          message: configValidation.error.message,
          retryable: false,
        },
      };
    }
    const inputValidation = handler.inputSchema?.safeParse(input);
    if (inputValidation && !inputValidation.success) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_NODE_INPUT',
          message: inputValidation.error.message,
          retryable: false,
        },
      };
    }

    const retryPolicy = node.retryPolicy || {
      maxAttempts: 1,
      initialDelayMs: 0,
      backoffMultiplier: 2,
      maxDelayMs: 30_000,
      retryableErrorCodes: [],
    };
    let lastResult: NodeExecutionResult | null = null;
    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      try {
        const result = NodeExecutionResultSchema.parse(await withTimeout(
          (nodeSignal) => handler.execute({
            execution: clone(execution),
            workflow,
            node,
            input: clone(input),
            attachments: nodeAttachments(workflow, node.id),
            signal: nodeSignal,
            emit: (event) => this.events.publish(event).then(() => undefined),
          }),
          node.timeoutMs || this.defaultNodeTimeoutMs,
          signal,
          'NODE_TIMEOUT',
        ));
        lastResult = result;
        const retryable = result.status === 'retry'
          || (result.status === 'error' && (
            result.error?.retryable
            || retryPolicy.retryableErrorCodes.includes(result.error?.code || '')
          ));
        if (!retryable || attempt >= retryPolicy.maxAttempts) {
          return {
            ...result,
            metrics: {
              durationMs: result.metrics?.durationMs || 0,
              ...result.metrics,
              attempts: attempt,
            },
          };
        }
        await this.emit(execution, {
          type: 'node.retrying',
          nodeId: node.id,
          safeSummary: `Tentando ${node.name} novamente`,
          data: { attempt, code: result.error?.code },
        });
        await delay(retryDelay(attempt, retryPolicy, result.retryAfterMs), signal);
      } catch (error) {
        const normalized = normalizeRuntimeError(error, 'NODE_EXECUTION_FAILED');
        lastResult = {
          status: 'error',
          error: normalized,
        };
        const retryable = normalized.retryable
          || retryPolicy.retryableErrorCodes.includes(normalized.code);
        if (!retryable || attempt >= retryPolicy.maxAttempts) {
          return {
            ...lastResult,
            metrics: { durationMs: 0, attempts: attempt },
          };
        }
        await this.emit(execution, {
          type: 'node.retrying',
          nodeId: node.id,
          safeSummary: `Tentando ${node.name} novamente`,
          data: { attempt, code: normalized.code },
        });
        await delay(retryDelay(attempt, retryPolicy), signal);
      }
    }
    return lastResult || {
      status: 'error',
      error: {
        code: 'NODE_EXECUTION_FAILED',
        message: 'Node execution failed without a result.',
        retryable: false,
      },
    };
  }

  private async completeExecution(execution: WorkflowExecution): Promise<WorkflowExecution> {
    execution.status = 'completed';
    execution.currentNodeId = null;
    execution.finishedAt = now();
    execution.updatedAt = execution.finishedAt;
    const saved = await this.persistence.saveExecution(execution, execution.version);
    await this.emit(saved, {
      type: 'execution.completed',
      safeSummary: 'Execução concluída',
      data: {
        totalSteps: saved.totalSteps,
        totalModelCalls: saved.totalModelCalls,
        totalToolCalls: saved.totalToolCalls,
      },
    });
    return saved;
  }

  private async failExecution(
    execution: WorkflowExecution,
    code: string,
    message: string,
  ): Promise<WorkflowExecution> {
    execution.status = 'failed';
    execution.failure = { code, message, nodeId: execution.currentNodeId || undefined };
    execution.finishedAt = now();
    execution.updatedAt = execution.finishedAt;
    execution.currentNodeId = null;
    const saved = await this.persistence.saveExecution(execution, execution.version);
    await this.emit(saved, {
      type: 'execution.failed',
      safeSummary: 'Execução interrompida por limite ou falha',
      data: { code },
    });
    return saved;
  }

  private async markCancelled(
    execution: WorkflowExecution,
    reason: string,
  ): Promise<WorkflowExecution> {
    execution.status = 'cancelled';
    execution.failure = { code: 'EXECUTION_CANCELLED', message: reason };
    execution.finishedAt = now();
    execution.updatedAt = execution.finishedAt;
    execution.currentNodeId = null;
    const saved = await this.persistence.saveExecution(execution, execution.version);
    await this.emit(saved, {
      type: 'execution.cancelled',
      safeSummary: 'Execução cancelada',
      data: { reason },
    });
    return saved;
  }

  private emit(
    execution: WorkflowExecution,
    event: Omit<WorkflowEvent, 'id' | 'sequence' | 'createdAt' | 'executionId' | 'workflowId'>,
  ) {
    return this.events.publish({
      ...event,
      executionId: execution.executionId,
      workflowId: execution.workflowId,
    });
  }
}
