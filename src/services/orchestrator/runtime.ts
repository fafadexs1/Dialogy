import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import {
  recordAutopilotDecisionMetrics,
  recordAutopilotRunMetrics,
  recordAutopilotStageMetrics,
} from '@/lib/observability/metrics';
import {
  createOrReuseAgentTask,
  finishAgentTask,
  getAgentTaskExecution,
  recordAgentTaskEvent,
  resolveAgentTaskInterruption,
} from '@/services/agent-runtime/task-store';
import { getAgentDomainPack } from '@/services/agent-runtime/domain-packs';
import type {
  AgentDomainPack,
  AgentTaskExecution,
  AgentTaskStatus,
} from '@/services/agent-runtime/types';

export type OrchestratorBudget = {
  maxTotalMs: number;
  maxLlmMs: number;
  maxRagMs: number;
  maxToolMs: number;
  maxToolCalls: number;
};

export type OrchestratorRunHandle = {
  id: string;
  workspaceId: string;
  chatId?: string | null;
  taskExecutionId?: string | null;
  domainPack?: AgentDomainPack | null;
  taskExecution?: AgentTaskExecution | null;
  startedAt: number;
  budget: OrchestratorBudget;
};

export const DEFAULT_ORCHESTRATOR_BUDGET: OrchestratorBudget = {
  maxTotalMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOTAL_TIMEOUT_MS || '', 10) || 30000,
  maxLlmMs: Number.parseInt(process.env.AI_ORCHESTRATOR_LLM_TIMEOUT_MS || '', 10) || 20000,
  maxRagMs: Number.parseInt(process.env.AI_ORCHESTRATOR_RAG_TIMEOUT_MS || '', 10) || 7000,
  maxToolMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOOL_TIMEOUT_MS || '', 10) || 8000,
  maxToolCalls: Number.parseInt(process.env.AI_ORCHESTRATOR_MAX_TOOL_CALLS || '', 10) || 2,
};

type StartRunInput = {
  workspaceId: string;
  chatId?: string | null;
  sourceMessageId?: string | null;
  systemAgentId?: string | null;
  autopilotConfigId?: string | null;
  budget?: Partial<OrchestratorBudget>;
  metadata?: Record<string, unknown> | null;
};

type RecordEventInput = {
  run: OrchestratorRunHandle | null | undefined;
  kind: string;
  status?: string | null;
  durationMs?: number | null;
  payload?: Record<string, unknown> | null;
};

type FinishRunInput = {
  run: OrchestratorRunHandle | null | undefined;
  status: 'success' | 'fallback' | 'error' | 'skipped';
  timings?: Record<string, number> | null;
  intent?: string | null;
  confidenceLevel?: string | null;
  confidenceScore?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
};

function sanitizeJson(value: Record<string, unknown> | null | undefined) {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value));
}

function asMetricString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function firstMetricString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
    return typeof first === 'string' ? first : null;
  }
  return asMetricString(value);
}

function asMetricCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  return null;
}

function extractNestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractRunMetricDimensions(metadata: Record<string, unknown>) {
  const responseValidator = extractNestedRecord(metadata.responseValidator);
  const toolPlanner = extractNestedRecord(metadata.toolPlanner);
  const promiseValidation = extractNestedRecord(toolPlanner?.promiseValidation);
  const rejectedActions = toolPlanner?.rejectedActions;

  return {
    workflowId: asMetricString(metadata.workflowId),
    ragStrategy: asMetricString(metadata.ragStrategy),
    knowledgeCoverage: asMetricString(metadata.knowledgeCoverage),
    fallbackReason: asMetricString(metadata.fallbackReason) ||
      firstMetricString(responseValidator?.reasons) ||
      asMetricString(promiseValidation?.repairReason),
    validatorAction: asMetricString(metadata.validatorAction) ||
      asMetricString(responseValidator?.decision),
    toolPlannerRejectedCount: asMetricCount(rejectedActions),
  };
}

function recordDecisionMetric(input: RecordEventInput) {
  const payload = sanitizeJson(input.payload);
  const status = input.status === 'error'
    ? 'error'
    : input.status === 'fallback'
      ? 'fallback'
      : input.status === 'skipped'
        ? 'skipped'
        : 'success';

  if (input.kind === 'intent_resolution') {
    recordAutopilotDecisionMetrics({
      kind: 'intent',
      status,
      durationMs: input.durationMs,
      workspaceId: input.run?.workspaceId,
      intent: asMetricString(payload.intent),
      workflowId: asMetricString(payload.workflowId),
      decision: asMetricString(payload.confidenceLevel),
      reason: asMetricString(payload.reason),
    });
    return;
  }

  if (input.kind === 'rag_selection' || input.kind === 'rag_fallback_static_documents' || input.kind === 'rag_retrieval') {
    recordAutopilotDecisionMetrics({
      kind: 'rag',
      status,
      durationMs: input.durationMs,
      workspaceId: input.run?.workspaceId,
      intent: asMetricString(payload.intent),
      workflowId: asMetricString(payload.workflowId),
      ragStrategy: asMetricString(payload.strategy),
      knowledgeCoverage: asMetricString(payload.knowledgeCoverage),
      reason: asMetricString(payload.fallbackReason),
      count: asMetricCount(payload.selectedDocuments),
    });
    return;
  }

  if (input.kind === 'workflow_plan') {
    recordAutopilotDecisionMetrics({
      kind: 'workflow',
      status,
      durationMs: input.durationMs,
      workspaceId: input.run?.workspaceId,
      intent: asMetricString(payload.intent),
      workflowId: asMetricString(payload.workflowId),
      decision: asMetricString(payload.executionMode),
      reason: asMetricString(payload.reason),
      count: asMetricCount(payload.missingSlots),
    });
    return;
  }

  if (input.kind === 'tool_planner') {
    recordAutopilotDecisionMetrics({
      kind: 'tool_planner',
      status,
      durationMs: input.durationMs,
      workspaceId: input.run?.workspaceId,
      intent: asMetricString(payload.intent),
      workflowId: asMetricString(payload.workflowId),
      decision: asMetricString(extractNestedRecord(payload.promiseValidation)?.repairReason) ||
        (asMetricCount(payload.rejectedActions) ? 'rejected_actions' : 'accepted'),
      count: asMetricCount(payload.rejectedActions),
    });
    return;
  }

  if (input.kind === 'response_validator') {
    recordAutopilotDecisionMetrics({
      kind: 'response_validator',
      status,
      durationMs: input.durationMs,
      workspaceId: input.run?.workspaceId,
      intent: asMetricString(payload.intent),
      workflowId: asMetricString(payload.workflowId),
      decision: asMetricString(payload.decision),
      reason: Array.isArray(payload.reasons) ? payload.reasons.join(',') : asMetricString(payload.reasons),
    });
  }
}

function shouldSuppressDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('orchestrator_runs') ||
    message.includes('orchestrator_events') ||
    message.includes('orchestrator_tool_calls') ||
    message.includes('agent_tools_catalog')
  );
}

async function safeQuery(query: string, params: any[]) {
  try {
    await db.query(query, params);
  } catch (error) {
    if (!shouldSuppressDbError(error)) {
      console.error('[ORCHESTRATOR_RUNTIME] Failed to persist trace:', error);
    }
  }
}

export async function startOrchestratorRun(input: StartRunInput): Promise<OrchestratorRunHandle> {
  const id = randomUUID();
  const budget = { ...DEFAULT_ORCHESTRATOR_BUDGET, ...(input.budget || {}) };
  const run: OrchestratorRunHandle = {
    id,
    workspaceId: input.workspaceId,
    chatId: input.chatId ?? null,
    startedAt: Date.now(),
    budget,
  };

  await safeQuery(
    `INSERT INTO orchestrator_runs (
      id,
      workspace_id,
      chat_id,
      source_message_id,
      system_agent_id,
      autopilot_config_id,
      status,
      budget,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, 'running', $7, $8)`,
    [
      id,
      input.workspaceId,
      input.chatId ?? null,
      input.sourceMessageId ?? null,
      input.systemAgentId ?? null,
      input.autopilotConfigId ?? null,
      JSON.stringify(budget),
      JSON.stringify(sanitizeJson(input.metadata)),
    ]
  );

  const requestedDomainPackId = typeof input.metadata?.domainPackId === 'string'
    ? input.metadata.domainPackId
    : null;
  const publishedDomainPack = requestedDomainPackId
    ? await getAgentDomainPack({
        workspaceId: input.workspaceId,
        id: requestedDomainPackId,
        publishedOnly: true,
      })
    : null;
  const task = await createOrReuseAgentTask({
    workspaceId: input.workspaceId,
    chatId: input.chatId ?? null,
    orchestratorRunId: id,
    systemAgentId: input.systemAgentId ?? null,
    autopilotConfigId: input.autopilotConfigId ?? null,
    domainPackId: publishedDomainPack?.id || null,
    goal: typeof input.metadata?.goal === 'string' ? input.metadata.goal : null,
    metadata: {
      ...(input.metadata || {}),
      domainPackId: publishedDomainPack?.id || null,
      domainPackVersion: publishedDomainPack?.version || null,
    },
  });
  run.taskExecutionId = task?.id ?? null;
  run.domainPack = publishedDomainPack;
  run.taskExecution = task;
  if (task?.activeInterruptionId) {
    await resolveAgentTaskInterruption({
      taskExecutionId: task.id,
      workspaceId: task.workspaceId,
      interruptionId: task.activeInterruptionId,
    });
    run.taskExecution = await getAgentTaskExecution({
      workspaceId: task.workspaceId,
      taskId: task.id,
    });
  }

  return run;
}

function shouldCheckpointAgentTask(kind: string): boolean {
  return new Set([
    'intent_resolution',
    'agent_task_plan',
    'workflow_plan',
    'procedure_runtime',
    'tool_planner',
    'response_validator',
    'workflow_runtime',
    'handoff',
    'transfer_chat',
    'close_chat',
  ]).has(kind);
}

export async function recordOrchestratorEvent(input: RecordEventInput) {
  if (!input.run) return;

  await safeQuery(
    `INSERT INTO orchestrator_events (
      run_id,
      workspace_id,
      chat_id,
      kind,
      status,
      duration_ms,
      payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.run.id,
      input.run.workspaceId,
      input.run.chatId ?? null,
      input.kind,
      input.status ?? null,
      input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
      JSON.stringify(sanitizeJson(input.payload)),
    ]
  );

  try {
    recordDecisionMetric(input);
  } catch (error) {
    console.error('[ORCHESTRATOR_RUNTIME] Failed to record decision metric:', error);
  }

  if (shouldCheckpointAgentTask(input.kind)) {
    await recordAgentTaskEvent(
      input.run.taskExecutionId,
      {
        eventType: input.kind,
        status: input.status,
        payload: input.payload || {},
      },
      {
        workspaceId: input.run.workspaceId,
        orchestratorRunId: input.run.id,
      },
    );
  }
}

export async function finishOrchestratorRun(input: FinishRunInput) {
  if (!input.run) return;

  const totalMs = Date.now() - input.run.startedAt;
  const metadata = sanitizeJson(input.metadata);
  const timings = {
    ...(input.timings || {}),
    total_ms: totalMs,
  };
  const metricDimensions = extractRunMetricDimensions(metadata);

  await safeQuery(
    `UPDATE orchestrator_runs
     SET status = $2,
         intent = $3,
         confidence_level = $4,
         confidence_score = $5,
         timings = $6,
         metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
         error = $8,
         completed_at = clock_timestamp(),
         updated_at = timezone('utc', now())
     WHERE id = $1`,
    [
      input.run.id,
      input.status,
      input.intent ?? null,
      input.confidenceLevel ?? null,
      input.confidenceScore ?? null,
      JSON.stringify(timings),
      JSON.stringify(metadata),
      input.error ?? null,
    ]
  );

  if (input.status === 'error' && input.run.taskExecutionId) {
    await finishAgentTask({
      taskExecutionId: input.run.taskExecutionId,
      workspaceId: input.run.workspaceId,
      orchestratorRunId: input.run.id,
      status: 'failed',
      metadata: {
        source: 'orchestrator_run_finish',
        error: input.error || null,
      },
    });
  }

  recordAutopilotRunMetrics({
    status: input.status,
    durationMs: totalMs,
    workspaceId: input.run.workspaceId,
    hasDeterministicRouting: Boolean(metadata.deterministicRouting),
    intent: input.intent ?? null,
    ...metricDimensions,
  });
}

export async function timeOrchestratorStage<T>(
  run: OrchestratorRunHandle | null | undefined,
  kind: string,
  task: () => Promise<T>,
  payload?: Record<string, unknown> | null
): Promise<{ value: T; durationMs: number }> {
  const startedAt = Date.now();
  await recordOrchestratorEvent({ run, kind: `${kind}_start`, payload });
  try {
    const value = await task();
    const durationMs = Date.now() - startedAt;
    const stageStatus = kind === 'tool_execution' && Array.isArray(value)
      && value.some((item) => item && typeof item === 'object'
        && (('status' in item && (item.status === 'error' || item.status === 'rejected'))
          || ('output' in item && item.output && typeof item.output === 'object'
            && 'disposition' in item.output && item.output.disposition === 'queued')))
      ? 'fallback' : 'success';
    await recordOrchestratorEvent({ run, kind, status: stageStatus, durationMs, payload });
    recordStageMetric(kind, stageStatus, durationMs, run?.workspaceId);
    return { value, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    await recordOrchestratorEvent({
      run,
      kind,
      status: 'error',
      durationMs,
      payload: {
        ...(payload || {}),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    recordStageMetric(kind, 'error', durationMs, run?.workspaceId);
    throw error;
  }
}

function recordStageMetric(
  kind: string,
  status: 'success' | 'fallback' | 'error',
  durationMs: number,
  workspaceId?: string | null
) {
  const stage = kind.startsWith('rag')
    ? 'rag'
    : kind.startsWith('llm')
      ? 'llm'
      : kind.startsWith('tool')
        ? 'tool'
        : kind.startsWith('message_send')
          ? 'send'
          : null;
  if (!stage) return;
  recordAutopilotStageMetrics({ stage, status, durationMs, workspaceId });
}

export function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([task, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  }) as Promise<T>;
}

export async function recordOrchestratorToolCall(input: {
  run: OrchestratorRunHandle | null | undefined;
  workspaceId: string;
  chatId?: string | null;
  systemAgentId?: string | null;
  autopilotConfigId?: string | null;
  toolName: string;
  toolVersion?: string | null;
  class?: string | null;
  riskLevel?: string | null;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number | null;
  requiresHumanApproval?: boolean;
}) {
  await safeQuery(
    `INSERT INTO orchestrator_tool_calls (
      run_id,
      workspace_id,
      chat_id,
      system_agent_id,
      autopilot_config_id,
      tool_name,
      tool_version,
      class,
      risk_level,
      status,
      input,
      output,
      error,
      duration_ms,
      requires_human_approval
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.run?.id ?? null,
      input.workspaceId,
      input.chatId ?? null,
      input.systemAgentId ?? null,
      input.autopilotConfigId ?? null,
      input.toolName,
      input.toolVersion ?? null,
      input.class ?? null,
      input.riskLevel ?? null,
      input.status,
      input.input ? JSON.stringify(sanitizeJson(input.input)) : null,
      input.output ? JSON.stringify(sanitizeJson(input.output)) : null,
      input.error ?? null,
      input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
      Boolean(input.requiresHumanApproval),
    ]
  );

  const taskExecutionId = input.run?.taskExecutionId || (
    input.chatId
      ? (await getAgentTaskExecution({
          workspaceId: input.workspaceId,
          chatId: input.chatId,
        }))?.id || null
      : null
  );
  if (taskExecutionId) {
    const terminalTaskStatus: AgentTaskStatus | undefined = input.toolName === 'transfer_chat' && input.status === 'success'
      ? 'handoff'
      : input.toolName === 'close_chat' && input.status === 'success'
        ? 'completed'
        : undefined;
    // Every tool result becomes a task checkpoint. Terminal tools additionally
    // close the objective through the same deterministic state transition.
    await recordAgentTaskEvent(
      taskExecutionId,
      {
        eventType: 'tool_execution',
        status: input.status,
        taskStatus: terminalTaskStatus,
        payload: {
          toolName: input.toolName,
          toolVersion: input.toolVersion || null,
          riskLevel: input.riskLevel || null,
          output: input.output || null,
          error: input.error || null,
          durationMs: input.durationMs ?? null,
        },
      },
      {
        workspaceId: input.workspaceId,
        orchestratorRunId: input.run?.id || null,
      },
    );
  }
}
