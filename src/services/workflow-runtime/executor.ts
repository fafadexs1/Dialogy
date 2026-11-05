import { markWorkflowSensitivePaths } from './sensitive-data';
import { effectiveWorkflowLimits } from './runtime-limits';
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
  readPath,
  statePatchAtPath,
  withTimeout,
} from './utils';
import { validateWorkflowDefinition } from './validator';
import { matchWorkflowOptionByHeuristics } from './option-matching';

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
  classifyInteractionOption?: (input: {
    workflow: WorkflowDefinition;
    execution: WorkflowExecution;
    node: WorkflowNode;
    message: string;
    options: Array<{ id: string; value: string; label: string }>;
  }) => Promise<{
    optionId: string | null;
    confidence?: number;
    model?: string;
    modelCalls?: number;
  }>;
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
  'media.analyze',
  'data.extract',
  'logic.ai_router',
  'memory.history_summarizer',
]);

const TOOL_CONSUMING_NODE_TYPES = new Set([
  'audio.elevenlabs', 'audio.transcribe', 'integration.connector',
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

function findTrigger(workflow: WorkflowDefinition, triggerNodeId?: string): WorkflowNode {
  const trigger = triggerNodeId
    ? workflow.nodes.find((node) => node.id === triggerNodeId && node.type.startsWith('trigger.'))
    : workflow.nodes.find((node) => node.type.startsWith('trigger.'));
  if (triggerNodeId && !trigger) throw new Error(`Workflow trigger ${triggerNodeId} not found.`);
  if (!trigger) throw new Error('Workflow trigger not found.');
  return trigger;
}

function createExecution(input: WorkflowStartInput): WorkflowExecution {
  const timestamp = now();
  const trigger = findTrigger(input.workflow, input.triggerNodeId);
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
  if (result.status === 'error' && node.config.customErrorRoute !== true) return [];
  if (result.nextNodeId) {
    if (node.type === 'logic.goto' && workflow.nodes.some((candidate) => candidate.id === result.nextNodeId)) {
      return [result.nextNodeId];
    }
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

function resumeValue(input: Record<string, unknown>): unknown {
  return input.value
    ?? input.text
    ?? input.message
    ?? input.answer
    ?? input.rating
    ?? input.file
    ?? input;
}

function validateInteractionValue(node: WorkflowNode, value: unknown): string | null {
  if (node.type === 'interaction.file') {
    if (!isRecord(value) || typeof value.url !== 'string' || !value.url.trim()) return 'Nenhum arquivo válido foi recebido.';
    const maximumBytes = Math.max(1, Number(node.config.maxFileSizeMb || 10)) * 1024 * 1024;
    if (Number(value.size || 0) > maximumBytes) return 'O arquivo excede o tamanho permitido.';
    const accept = String(node.config.accept || '*/*').trim();
    const mimeType = String(value.mimeType || value.type || '').trim();
    if (accept && accept !== '*/*' && mimeType) {
      const accepted = accept.split(',').map((item) => item.trim()).filter(Boolean).some((pattern) => (
        pattern.endsWith('/*') ? mimeType.startsWith(pattern.slice(0, -1)) : pattern === mimeType
      ));
      if (!accepted) return 'O tipo do arquivo não é permitido.';
    }
    return null;
  }
  const text = String(value ?? '').trim();
  if (!text) return 'A resposta está vazia.';
  if (node.type === 'interaction.rating') {
    const rating = Number(text);
    if (!Number.isFinite(rating) || rating < Number(node.config.minimum || 1) || rating > Number(node.config.maximum || 5)) {
      return 'A avaliação está fora do intervalo permitido.';
    }
    return null;
  }
  const validation = node.type === 'interaction.date' ? 'date' : String(node.config.validation || 'none');
  const digits = text.replace(/\D/g, '');
  if (validation === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'O e-mail informado é inválido.';
  if (validation === 'cpf' && digits.length !== 11) return 'O CPF informado é inválido.';
  if (validation === 'cnpj' && digits.length !== 14) return 'O CNPJ informado é inválido.';
  if (validation === 'phone' && (digits.length < 10 || digits.length > 15)) return 'O telefone informado é inválido.';
  if (validation === 'number' && !Number.isFinite(Number(text.replace(',', '.')))) return 'O valor informado não é um número.';
  if (validation === 'date' && !/^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/.test(text)) return 'A data informada é inválida.';
  if (validation === 'custom_regex') {
    try {
      if (!new RegExp(String(node.config.customRegex || '')).test(text)) return 'A resposta não corresponde ao formato esperado.';
    } catch {
      return 'A expressão regular configurada é inválida.';
    }
  }
  return null;
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

function continueAfterConfiguredError(node: WorkflowNode, result: NodeExecutionResult): NodeExecutionResult {
  if (result.status !== 'error' || node.config.continueOnError !== true) return result;
  const error = result.error || {
    code: 'NODE_EXECUTION_FAILED',
    message: 'A etapa falhou sem detalhes adicionais.',
    retryable: false,
  };
  const errorValue = { error: error.message, code: error.code };
  const outputKey = String(node.config.outputKey || '').trim();
  const statePatch = outputKey
    ? mergeStatePatch(result.statePatch || {}, statePatchAtPath(outputKey, errorValue))
    : result.statePatch;
  const selectedOutput = String(node.config.continueOutput || '').trim()
    || node.outputPorts.find((port) => port.connectionType === 'main')?.id
    || 'success';
  return {
    ...result,
    status: 'route',
    selectedOutput,
    output: {
      ...(result.output || {}),
      continuedAfterError: true,
      error: errorValue,
    },
    statePatch,
    error,
  };
}

export class WorkflowExecutor {
  readonly events: WorkflowEventBus;
  private readonly defaultNodeTimeoutMs: number;
  private readonly lockLeaseMs: number;
  private readonly validateBeforeRun: boolean;
  private readonly classifyInteractionOption?: WorkflowExecutorOptions['classifyInteractionOption'];
  private readonly timeWaitTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly persistence: WorkflowPersistence,
    private readonly handlers: NodeHandlerRegistry,
    options: WorkflowExecutorOptions = {},
  ) {
    this.events = new WorkflowEventBus(persistence);
    this.defaultNodeTimeoutMs = options.defaultNodeTimeoutMs || 30_000;
    this.lockLeaseMs = options.lockLeaseMs || 150_000;
    this.validateBeforeRun = options.validateBeforeRun ?? true;
    this.classifyInteractionOption = options.classifyInteractionOption;
  }

  async start(input: WorkflowStartInput, options: WorkflowRunOptions = {}): Promise<WorkflowExecution> {
    const workflow = WorkflowDefinitionSchema.parse(input.workflow);
    if (this.validateBeforeRun) {
      const validation = validateWorkflowDefinition(workflow);
      if (!validation.valid) throw new InvalidWorkflowDefinitionError(validation);
    }
    await this.persistence.saveWorkflowDefinition(workflow);
    const execution = await this.persistence.createExecution(createExecution({ ...input, workflow, context: { ...input.context, ...(options.limits ? { __workflowRuntimeCaps: effectiveWorkflowLimits(workflow.settings, options.limits) } : {}) } }));
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

    const managed = execution.context.automationManaged === true;
    const leaseMs = managed ? this.lockLeaseMs : Math.max(this.lockLeaseMs, workflow.settings.executionTimeoutMs + 30_000);
    const locked = await this.persistence.acquireExecutionLock(executionId, workerId, leaseMs);
    if (!locked) throw new WorkflowExecutionLockError(executionId);
    execution = locked;
    let leaseLost = false, renewing = false;
    const heartbeat = managed ? setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.persistence.renewExecutionLock(executionId, workerId, leaseMs).then(renewed => {
        if (!renewed) leaseLost = true;
        else if (execution) execution.lockExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      }).catch(() => { /* The next lock check or optimistic write fences a lost lease. */ }).finally(() => { renewing = false; });
    }, Math.max(1000, Math.min(30000, Math.floor(leaseMs / 3)))) : null;
    heartbeat?.unref?.();

    try {
      if (execution.status === 'waiting') {
        const expiresAt = this.waitExpiration(execution);
        if (expiresAt == null || expiresAt > Date.now()) {
          this.scheduleTimeWaitExpiration(execution);
          return execution;
        }
        execution = await this.routeWaitingExecution(
          execution,
          workflow,
          'expired',
          { resumeToken: execution.resumeToken || '', input: {} },
        );
      }
      if (execution.status === 'queued') {
        execution.status = 'running';
        execution.updatedAt = now();
        execution = await this.persistence.saveExecution(execution, execution.version);
      }
      while (execution.status === 'running') {
        if (leaseLost) throw new WorkflowExecutionLockError(executionId);
        const renewed = await this.persistence.renewExecutionLock(executionId, workerId, leaseMs);
        if (!renewed) throw new WorkflowExecutionLockError(executionId);
        if (managed) execution.lockExpiresAt = new Date(Date.now() + leaseMs).toISOString();
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
        try {
          execution = await this.executeStep(workflow, execution, node, options.signal);
        } catch (stepError) {
          const normalized = normalizeRuntimeError(stepError, 'STEP_EXECUTION_UNHANDLED');
          execution = await this.failExecution(execution, normalized.code, normalized.message);
          break;
        }
      }
      return execution;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await this.persistence.releaseExecutionLock(executionId, workerId);
    }
  }

  private waitExpiration(execution: WorkflowExecution): number | null {
    if (execution.status !== 'waiting' || !execution.currentNodeId) {
      return null;
    }
    const output = execution.nodeResults[execution.currentNodeId]?.output;
    if (execution.waitingReason !== 'time' && output?.expireWait !== true) return null;
    if (!isRecord(output) || typeof output.expiresAt !== 'string') return null;
    const expiresAt = new Date(output.expiresAt).getTime();
    return Number.isFinite(expiresAt) ? expiresAt : null;
  }

  private scheduleTimeWaitExpiration(execution: WorkflowExecution) {
    const resumeToken = execution.resumeToken;
    const expiresAt = this.waitExpiration(execution);
    if (!resumeToken || expiresAt == null || this.timeWaitTimers.has(resumeToken)) return;
    const maximumTimerDelay = 2_147_000_000;
    const delayMs = Math.min(Math.max(expiresAt - Date.now(), 0), maximumTimerDelay);
    const timer = setTimeout(() => {
      this.timeWaitTimers.delete(resumeToken);
      void this.expireTimeWait(resumeToken).catch((error) => {
        console.error('[WORKFLOW_TIME_WAIT] Failed to expire waiting execution:', error);
      });
    }, delayMs);
    const maybeTimer = timer as unknown as { unref?: () => void };
    if (typeof maybeTimer.unref === 'function') maybeTimer.unref();
    this.timeWaitTimers.set(resumeToken, timer);
  }

  private async routeWaitingExecution(
    locked: WorkflowExecution,
    workflow: WorkflowDefinition,
    selectedOutput: 'resumed' | 'expired',
    input: WorkflowResumeInput,
  ): Promise<WorkflowExecution> {
    const waitingNode = locked.currentNodeId ? nodeById(workflow, locked.currentNodeId) : null;
    if (!waitingNode) throw new Error('Waiting node not found.');
    const waitingResult = locked.nodeResults[waitingNode.id];
    let resolvedOutput: string = selectedOutput;
    let routeStatus: NodeExecutionResult['status'] = 'route';
    let interactionError: string | null = null;
    let retryInteraction = false;
    let interactionRetryReason: 'unrecognized' | 'invalid' | null = null;
    const waitingMetadata = isRecord(waitingResult?.output) ? waitingResult.output : {};
    if (waitingMetadata.pauseTimeoutWhileWaiting === true && typeof waitingMetadata.waitingSince === 'string') {
      const since = Date.parse(waitingMetadata.waitingSince);
      if (Number.isFinite(since)) locked.context.__automationPausedMs = Math.max(0, Number(locked.context.__automationPausedMs || 0)) + Math.max(0, Date.now() - since);
    }
    if (selectedOutput === 'expired') await this.stopNodeSession(locked, 'expired', workflow);
    if (
      selectedOutput === 'expired'
      && waitingNode.type === 'interaction.options'
      && waitingNode.config.customFallbackRoutes !== true
    ) {
      locked.previousNodeId = waitingNode.id;
      locked.currentNodeId = null;
      locked.waitingReason = undefined;
      locked.resumeToken = undefined;
      locked.context = mergeStatePatch(locked.context, {
        ...(input.contextPatch || {}),
        __waitOutcome: 'expired',
      });
      locked.updatedAt = now();
      return this.completeExecution(locked);
    }
    if (selectedOutput === 'expired' && typeof waitingMetadata.expirationOutput === 'string') {
      resolvedOutput = waitingMetadata.expirationOutput;
      const expirationPort = waitingNode.outputPorts.find((port) => port.id === resolvedOutput);
      routeStatus = resolvedOutput === 'error' || expirationPort?.connectionType === 'error' ? 'error' : 'route';
    }
    if (selectedOutput === 'resumed' && waitingMetadata.resumeMode === 'reexecute') {
      locked.status = 'running';
      locked.currentNodeId = waitingNode.id;
      locked.waitingReason = undefined;
      locked.resumeToken = undefined;
      // Each response replaces the previous payload, including omitted button IDs.
      locked.context = mergeStatePatch({ ...locked.context, __resumeInput: null }, {
        ...(input.contextPatch || {}),
        __resumeInput: input.input || {},
        __waitOutcome: selectedOutput,
      });
      locked.updatedAt = now();
      const saved = await this.persistence.saveExecution(locked, locked.version);
      await this.emit(saved, {
        type: 'execution.resumed',
        nodeId: waitingNode.id,
        safeSummary: 'Execução retomada no bloco aguardando resposta',
        data: { selectedOutput, resumeMode: 'reexecute' },
      });
      return saved;
    }
    if (selectedOutput === 'resumed' && waitingNode.type.startsWith('interaction.')) {
      const rawValue = resumeValue(input.input || {});
      const responsePath = String(waitingNode.config.legacyApiResponsePathForValue || '').trim();
      const extractedValue = responsePath ? readPath(rawValue, responsePath) : undefined;
      const value = extractedValue === undefined ? rawValue : extractedValue;
      interactionError = validateInteractionValue(waitingNode, value);
      if (interactionError) {
        if (waitingNode.config.customErrorRoute === true) {
          routeStatus = 'error';
          resolvedOutput = 'error';
        } else {
          retryInteraction = true;
          interactionRetryReason = 'invalid';
        }
      } else {
        const outputKey = String(waitingNode.config.outputKey || 'answer').trim();
        if (waitingNode.type === 'interaction.options') {
          const choices = Array.isArray(waitingNode.config.options)
            ? waitingNode.config.options.filter(isRecord)
            : [];
          const selectedOptionId = typeof input.input?.selectedOptionId === 'string'
            ? input.input.selectedOptionId.trim()
            : '';
          const selectedChoiceIndex = selectedOptionId
            ? choices.findIndex((choice, index) => String(choice.id || choice.value || `option_${index + 1}`) === selectedOptionId)
            : -1;
          const selectedChoice = selectedChoiceIndex >= 0 ? choices[selectedChoiceIndex] : null;
          let match = selectedChoice ? {
            index: selectedChoiceIndex,
            id: String(selectedChoice.id || selectedChoice.value || `option_${selectedChoiceIndex + 1}`),
            value: String(selectedChoice.value || selectedChoice.label || selectedChoice.id || ''),
            label: String(selectedChoice.label || selectedChoice.value || selectedChoice.id || ''),
            strategy: 'exact' as const,
          } : matchWorkflowOptionByHeuristics(choices, value);
          if (
            !match
            && waitingNode.config.intelligentMatching === true
            && input.input?.optionResolutionAttempted !== true
            && this.classifyInteractionOption
          ) {
            try {
              const classified = await this.classifyInteractionOption({
                workflow,
                execution: locked,
                node: waitingNode,
                message: String(value ?? ''),
                options: choices.map((choice, index) => ({
                  id: String(choice.id || choice.value || `option_${index + 1}`),
                  value: String(choice.value || choice.label || choice.id || ''),
                  label: String(choice.label || choice.value || choice.id || ''),
                })),
              });
              const classifiedOption = choices.find((choice, index) => (
                String(choice.id || choice.value || `option_${index + 1}`) === classified.optionId
              ));
              if (classifiedOption) {
                const index = choices.indexOf(classifiedOption);
                match = {
                  index,
                  id: String(classifiedOption.id || classifiedOption.value || `option_${index + 1}`),
                  value: String(classifiedOption.value || classifiedOption.label || classifiedOption.id || ''),
                  label: String(classifiedOption.label || classifiedOption.value || classifiedOption.id || ''),
                  strategy: 'exact',
                };
                locked.totalModelCalls += Math.max(1, Number(classified.modelCalls || 1));
                locked.context = mergeStatePatch(locked.context, {
                  __interactionClassification: {
                    nodeId: waitingNode.id,
                    optionId: match.id,
                    confidence: classified.confidence,
                    model: classified.model,
                  },
                });
              }
            } catch (error) {
              console.warn('[WORKFLOW_OPTION_CLASSIFIER] Intelligent option matching failed; using automatic retry.', error);
            }
          }
          if (!match && waitingNode.config.customFallbackRoutes !== true) {
            retryInteraction = true;
            interactionRetryReason = 'unrecognized';
          } else {
            const candidate = String(match?.id || 'default');
            resolvedOutput = waitingNode.outputPorts.some((port) => port.id === candidate) ? candidate : 'default';
            if (outputKey) locked.variables = mergeStatePatch(locked.variables, statePatchAtPath(outputKey, match?.value ?? value));
          }
        } else if (outputKey) {
          locked.variables = mergeStatePatch(locked.variables, statePatchAtPath(outputKey, value));
        }
      }
    }
    if (retryInteraction) {
      const previousRetry = isRecord(locked.context.__interactionRetry)
        ? locked.context.__interactionRetry
        : {};
      locked.status = 'running';
      locked.currentNodeId = waitingNode.id;
      locked.waitingReason = undefined;
      locked.resumeToken = undefined;
      locked.context = mergeStatePatch({ ...locked.context, __resumeInput: null }, {
        ...(input.contextPatch || {}),
        __resumeInput: input.input || {},
        __waitOutcome: interactionRetryReason,
        __interactionRetry: {
          nodeId: waitingNode.id,
          attempt: Number(previousRetry.attempt || 0) + 1,
          reason: interactionRetryReason,
          message: interactionError || undefined,
        },
      });
      locked.updatedAt = now();
      const saved = await this.persistence.saveExecution(locked, locked.version);
      await this.emit(saved, {
        type: 'execution.resumed',
        nodeId: waitingNode.id,
        safeSummary: interactionRetryReason === 'unrecognized'
          ? 'Opção não reconhecida; pergunta repetida automaticamente'
          : 'Resposta inválida; pergunta repetida automaticamente',
        data: { selectedOutput: 'automatic_retry', reason: interactionRetryReason },
      });
      return saved;
    }
    const resumedResult: NodeExecutionResult | undefined = waitingResult ? {
          ...waitingResult,
          status: routeStatus,
          selectedOutput: resolvedOutput,
          ...(selectedOutput === 'expired' && routeStatus === 'error' ? {
            error: { code: 'WAIT_EXPIRED', message: 'O prazo de resposta desta etapa terminou.', retryable: false },
          } : {}),
          ...(interactionError ? {
            error: { code: 'INVALID_INTERACTION_INPUT', message: interactionError, retryable: false },
          } : {}),
        } : undefined;
    const nextNodeIds = resumedResult ? selectedConnections(workflow, waitingNode, resumedResult) : [];
    if (resumedResult) locked.nodeResults[waitingNode.id] = resumedResult;
    if (nextNodeIds.length === 0) {
      if (selectedOutput === 'expired' && routeStatus === 'error') return this.failExecution(locked, 'WAIT_EXPIRED', 'O prazo de resposta desta etapa terminou.');
      throw new Error(`Waiting node ${waitingNode.id} has no ${selectedOutput} route.`);
    }
    locked.status = 'running';
    locked.previousNodeId = waitingNode.id;
    locked.currentNodeId = nextNodeIds[0]!;
    locked.pendingNodeIds.push(...nextNodeIds.slice(1));
    locked.waitingReason = undefined;
    locked.resumeToken = undefined;
    locked.context = mergeStatePatch({ ...locked.context, __resumeInput: null }, {
      ...(input.contextPatch || {}),
      __resumeInput: input.input || {},
      __waitOutcome: selectedOutput,
      __interactionRetry: null,
      ...(interactionError ? { __interactionError: interactionError } : {}),
    });
    locked.updatedAt = now();
    const saved = await this.persistence.saveExecution(locked, locked.version);
    await this.emit(saved, {
      type: 'execution.resumed',
      safeSummary: selectedOutput === 'expired'
        ? 'Execução retomada por expiração'
        : 'Execução retomada',
      data: { selectedOutput: resolvedOutput },
    });
    return saved;
  }

  private async continueWaitingExecution(
    input: WorkflowResumeInput,
    selectedOutput: 'resumed' | 'expired',
    missingIsNoop = false,
  ): Promise<WorkflowExecution | null> {
    const waiting = await this.persistence.getExecutionByResumeToken(input.resumeToken);
    if (!waiting) {
      if (missingIsNoop) return null;
      throw new Error('Waiting execution not found for the supplied resume token.');
    }
    const timer = this.timeWaitTimers.get(input.resumeToken);
    if (timer) clearTimeout(timer);
    this.timeWaitTimers.delete(input.resumeToken);
    const workerId = input.workerId || `worker_${randomUUID()}`;
    const locked = await this.persistence.acquireExecutionLock(waiting.executionId, workerId, this.lockLeaseMs);
    if (!locked) throw new WorkflowExecutionLockError(waiting.executionId);
    try {
      if (locked.status !== 'waiting' || locked.resumeToken !== input.resumeToken) {
        if (missingIsNoop) return locked;
        throw new Error('Waiting execution changed before it could be resumed.');
      }
      const workflow = await this.persistence.getWorkflowDefinition(locked.workflowId, locked.workflowVersion);
      if (!workflow) throw new Error(`Workflow ${locked.workflowId}@${locked.workflowVersion} not found.`);
      await this.routeWaitingExecution(locked, workflow, selectedOutput, input);
    } finally {
      await this.persistence.releaseExecutionLock(waiting.executionId, workerId);
    }
    return this.runExecution(waiting.executionId, { workerId });
  }

  private async expireTimeWait(resumeToken: string): Promise<WorkflowExecution | null> {
    const waiting = await this.persistence.getExecutionByResumeToken(resumeToken);
    if (!waiting) return null;
    const expiresAt = this.waitExpiration(waiting);
    if (expiresAt == null) return null;
    if (expiresAt > Date.now()) {
      this.scheduleTimeWaitExpiration(waiting);
      return waiting;
    }
    return this.continueWaitingExecution({ resumeToken, input: {} }, 'expired', true);
  }

  async resume(input: WorkflowResumeInput): Promise<WorkflowExecution> {
    const resumed = await this.continueWaitingExecution(input, 'resumed');
    if (!resumed) throw new Error('Waiting execution not found for the supplied resume token.');
    return resumed;
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
    workflow = { ...workflow, settings: effectiveWorkflowLimits(workflow.settings, execution.context.__workflowRuntimeCaps) };
    const maxSteps = Math.min(options.maxSteps || workflow.settings.maxSteps, workflow.settings.maxSteps);
    if (execution.totalSteps >= maxSteps) {
      return { code: 'MAX_STEPS_REACHED', message: `Execution reached ${maxSteps} steps.` };
    }
    const confirmedRecovery = isRecord(execution.context.__automationRecovery) && execution.context.__automationRecovery.nodeId === nextNode.id;
    if (Date.now() - new Date(execution.startedAt).getTime() - Math.max(0, Number(execution.context.__automationPausedMs || 0)) >= workflow.settings.executionTimeoutMs) {
      return { code: 'EXECUTION_TIMEOUT', message: 'Execution exceeded its total timeout.' };
    }
    if (
      nodeMayConsumeModel(nextNode)
      && !confirmedRecovery
      && execution.totalModelCalls >= workflow.settings.maxModelCalls
    ) {
      return { code: 'MAX_MODEL_CALLS_REACHED', message: 'Execution reached the model call limit.' };
    }
    if (
      (nodeMayConsumeTools(nextNode) || (execution.context.automationManaged === true && /^(integration\.|whatsapp\.|dialogy\.)/.test(nextNode.type)))
      && !confirmedRecovery
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

    const rawResult = await this.executeNodeSafely(
      workflow,
      execution,
      node,
      input,
      signal,
    );
    const result = continueAfterConfiguredError(node, rawResult);
    if (isRecord(execution.context.__automationRecovery) && execution.context.__automationRecovery.nodeId === node.id) {
      execution.context.__lastAutomationRecovery = execution.context.__automationRecovery;
      delete execution.context.__automationRecovery;
    }
    if (rawResult.status === 'error') await this.stopNodeSession(execution, 'failed', workflow);
    const stateAfter = result.statePatch
      ? mergeStatePatch(execution.variables, result.statePatch)
      : execution.variables;
    if (result.sensitiveData) {
      markWorkflowSensitivePaths(input, result.sensitiveData.inputPaths);
      markWorkflowSensitivePaths(execution.input, result.sensitiveData.initialInputPaths);
      markWorkflowSensitivePaths(stateBefore, result.sensitiveData.variablePaths);
      markWorkflowSensitivePaths(stateAfter, result.sensitiveData.variablePaths);
    }
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
      this.scheduleTimeWaitExpiration(execution);
      return execution;
    }

    const manifest = getWorkflowNodeManifest(node.type);
    if (finalResult.status === 'completed' || (manifest?.terminal && finalResult.status !== 'error')) {
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
    const continuedAfterError = finalResult.output?.continuedAfterError === true;
    await this.emit(execution, {
      type: finalResult.status === 'error' || continuedAfterError ? 'node.failed' : 'node.completed',
      nodeId: node.id,
      safeSummary: continuedAfterError
        ? `${node.name} falhou e o fluxo continuou pela configuração da etapa`
        : finalResult.status === 'error'
        ? `${node.name} encaminhado para tratamento de erro`
        : `${node.name} concluído`,
      data: {
        durationMs,
        selectedOutput: finalResult.selectedOutput,
        nextNodeIds: targets,
        continuedAfterError,
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
            workflow: { ...workflow, settings: effectiveWorkflowLimits(workflow.settings, execution.context.__workflowRuntimeCaps) },
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
    await this.stopNodeSession(execution, 'failed');
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
    await this.stopNodeSession(execution, 'cancelled');
    execution.status = 'cancelled';
    execution.resumeToken = undefined;
    execution.waitingReason = undefined;
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

  private async stopNodeSession(execution: WorkflowExecution, reason: 'cancelled' | 'expired' | 'failed', definition?: WorkflowDefinition) {
    if (!execution.currentNodeId) return;
    const workflow = definition || await this.persistence.getWorkflowDefinition(execution.workflowId, execution.workflowVersion);
    if (!workflow) throw new Error('Workflow definition not found while ending the active session.');
    const node = nodeById(workflow, execution.currentNodeId);
    await this.handlers.get(node.type)?.stop?.({ execution, workflow, node, reason });
    if (execution.resumeToken) {
      const timer = this.timeWaitTimers.get(execution.resumeToken);
      if (timer) clearTimeout(timer);
      this.timeWaitTimers.delete(execution.resumeToken);
    }
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
