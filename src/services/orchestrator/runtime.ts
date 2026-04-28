import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { recordAutopilotRunMetrics, recordAutopilotStageMetrics } from '@/lib/observability/metrics';

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
  startedAt: number;
  budget: OrchestratorBudget;
};

export const DEFAULT_ORCHESTRATOR_BUDGET: OrchestratorBudget = {
  maxTotalMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOTAL_TIMEOUT_MS || '', 10) || 30000,
  maxLlmMs: Number.parseInt(process.env.AI_ORCHESTRATOR_LLM_TIMEOUT_MS || '', 10) || 20000,
  maxRagMs: Number.parseInt(process.env.AI_ORCHESTRATOR_RAG_TIMEOUT_MS || '', 10) || 3000,
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

  return run;
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
}

export async function finishOrchestratorRun(input: FinishRunInput) {
  if (!input.run) return;

  const totalMs = Date.now() - input.run.startedAt;
  const timings = {
    ...(input.timings || {}),
    total_ms: totalMs,
  };

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
      JSON.stringify(sanitizeJson(input.metadata)),
      input.error ?? null,
    ]
  );

  recordAutopilotRunMetrics({
    status: input.status,
    durationMs: totalMs,
    workspaceId: input.run.workspaceId,
    hasDeterministicRouting: Boolean(input.metadata?.deterministicRouting),
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
    await recordOrchestratorEvent({ run, kind, status: 'success', durationMs, payload });
    recordStageMetric(kind, 'success', durationMs, run?.workspaceId);
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

  let timeout: NodeJS.Timeout | undefined;
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
}
