import { db } from '@/lib/db';
import type { PoolClient } from 'pg';
import {
  assertValidAgentTaskTransition,
  isTerminalAgentTaskStatus,
  type AgentTaskCheckpoint,
  type AgentTaskExecution,
  type AgentTaskInterruption,
  type AgentTaskStatePatch,
  type AgentTaskStatus,
  type AgentTraceEvent,
  type JsonObject,
} from './types';

const MAX_CHECKPOINT_PAYLOAD_BYTES = 48_000;

type TaskRow = {
  id: string;
  workspace_id: string;
  chat_id: string | null;
  orchestrator_run_id: string | null;
  system_agent_id: string | null;
  autopilot_config_id: string | null;
  domain_pack_id: string | null;
  goal: string | null;
  goal_key: string | null;
  procedure_id: string | null;
  procedure_version: number | null;
  current_step_id: string | null;
  status: AgentTaskStatus;
  state: JsonObject | null;
  slots: JsonObject | null;
  confirmations: JsonObject | null;
  decisions: JsonObject | null;
  tool_results: JsonObject | null;
  next_action: JsonObject | null;
  active_interruption_id: string | null;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

type CheckpointRow = {
  id: string;
  task_execution_id: string;
  orchestrator_run_id: string | null;
  sequence: string | number;
  event_type: string;
  status: AgentTaskStatus;
  state: JsonObject | null;
  metadata: JsonObject | null;
  created_at: string | Date;
};

type InterruptionRow = {
  id: string;
  task_execution_id: string;
  parent_interruption_id: string | null;
  kind: string;
  prompt: string;
  status: AgentTaskInterruption['status'];
  stack_order: number;
  context: JsonObject | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
};

function timestamp(value: string | Date | null | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function mergeObjects(base: unknown, patch: unknown): JsonObject {
  return {
    ...objectValue(base),
    ...objectValue(patch),
  };
}

function normalizeGoalKey(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  return normalized || null;
}

function sanitizeCheckpointValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 5) return '[depth_limit]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/password|token|secret|api[-_]?key|authorization|cookie|pixcode|barcode|paymentlink/i.test(key)) {
      return '[redacted]';
    }
    return value.length > 4_000 ? `${value.slice(0, 4_000)}...[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeCheckpointValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([childKey, childValue]) => [
          childKey,
          sanitizeCheckpointValue(childValue, childKey, depth + 1),
        ]),
    );
  }
  return String(value);
}

function checkpointObject(value: unknown): JsonObject {
  const sanitized = objectValue(sanitizeCheckpointValue(value));
  let serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_CHECKPOINT_PAYLOAD_BYTES) return sanitized;

  const compact = {
    summary: 'checkpoint_compacted',
    keys: Object.keys(sanitized).slice(0, 100),
    state: Object.fromEntries(
      Object.entries(sanitized).slice(0, 30).map(([key, item]) => [
        key,
        typeof item === 'string' ? item.slice(0, 500) : item,
      ]),
    ),
  };
  serialized = JSON.stringify(compact);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_CHECKPOINT_PAYLOAD_BYTES) return compact;
  return { summary: 'checkpoint_payload_omitted' };
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /agent_task_(executions|interruptions|checkpoints)|agent_domain_packs/.test(message)
    && /does not exist|undefined table|relation .* does not exist/i.test(message);
}

function logStoreError(scope: string, error: unknown) {
  if (missingTable(error)) return;
  console.error(`[AGENT_RUNTIME:${scope}]`, error);
}

function mapTask(row: TaskRow): AgentTaskExecution {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    chatId: row.chat_id,
    orchestratorRunId: row.orchestrator_run_id,
    systemAgentId: row.system_agent_id,
    autopilotConfigId: row.autopilot_config_id,
    domainPackId: row.domain_pack_id,
    goal: row.goal,
    goalKey: row.goal_key,
    procedureId: row.procedure_id,
    procedureVersion: row.procedure_version,
    currentStepId: row.current_step_id,
    status: row.status,
    state: objectValue(row.state),
    slots: objectValue(row.slots),
    confirmations: objectValue(row.confirmations),
    decisions: objectValue(row.decisions),
    toolResults: objectValue(row.tool_results),
    nextAction: row.next_action ? objectValue(row.next_action) : null,
    activeInterruptionId: row.active_interruption_id,
    version: Number(row.version || 0),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    completedAt: row.completed_at ? timestamp(row.completed_at) : null,
  };
}

function mapCheckpoint(row: CheckpointRow): AgentTaskCheckpoint {
  return {
    id: row.id,
    taskExecutionId: row.task_execution_id,
    orchestratorRunId: row.orchestrator_run_id,
    sequence: Number(row.sequence || 0),
    eventType: row.event_type,
    status: row.status,
    state: objectValue(row.state),
    metadata: objectValue(row.metadata),
    createdAt: timestamp(row.created_at),
  };
}

function mapInterruption(row: InterruptionRow): AgentTaskInterruption {
  return {
    id: row.id,
    taskExecutionId: row.task_execution_id,
    parentInterruptionId: row.parent_interruption_id,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    stackOrder: Number(row.stack_order || 0),
    context: objectValue(row.context),
    createdAt: timestamp(row.created_at),
    resolvedAt: row.resolved_at ? timestamp(row.resolved_at) : null,
  };
}

async function releaseRollback(client: PoolClient, error: unknown): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    logStoreError('rollback', rollbackError);
  }
  logStoreError('transaction', error);
}

export async function getAgentTaskExecution(input: {
  workspaceId: string;
  taskId?: string | null;
  chatId?: string | null;
}): Promise<AgentTaskExecution | null> {
  if (!input.workspaceId || (!input.taskId && !input.chatId)) return null;
  try {
    const result = await db.query<TaskRow>(
      `SELECT *
         FROM public.agent_task_executions
        WHERE workspace_id = $1
          AND ($2::uuid IS NULL OR id = $2::uuid)
          AND ($3::uuid IS NULL OR chat_id = $3::uuid)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [input.workspaceId, input.taskId ?? null, input.chatId ?? null],
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  } catch (error) {
    logStoreError('get_task', error);
    return null;
  }
}

export async function listAgentTaskExecutions(input: {
  workspaceId: string;
  chatId?: string | null;
  status?: AgentTaskStatus | null;
  limit?: number;
}): Promise<AgentTaskExecution[]> {
  if (!input.workspaceId) return [];
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 30)));
  try {
    const result = await db.query<TaskRow>(
      `SELECT *
         FROM public.agent_task_executions
        WHERE workspace_id = $1
          AND ($2::uuid IS NULL OR chat_id = $2::uuid)
          AND ($3::text IS NULL OR status = $3::text)
        ORDER BY updated_at DESC
        LIMIT $4`,
      [input.workspaceId, input.chatId ?? null, input.status ?? null, limit],
    );
    return result.rows.map(mapTask);
  } catch (error) {
    logStoreError('list_tasks', error);
    return [];
  }
}

export async function createOrReuseAgentTask(input: {
  workspaceId: string;
  chatId?: string | null;
  orchestratorRunId?: string | null;
  systemAgentId?: string | null;
  autopilotConfigId?: string | null;
  domainPackId?: string | null;
  goal?: string | null;
  goalKey?: string | null;
  procedureId?: string | null;
  procedureVersion?: number | null;
  currentStepId?: string | null;
  metadata?: JsonObject;
}): Promise<AgentTaskExecution | null> {
  if (!input.workspaceId) return null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const inserted = await client.query<TaskRow>(
      `INSERT INTO public.agent_task_executions (
        workspace_id,
        chat_id,
        orchestrator_run_id,
        system_agent_id,
        autopilot_config_id,
        domain_pack_id,
        goal,
        goal_key,
        procedure_id,
        procedure_version,
        current_step_id,
        status,
        state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [
        input.workspaceId,
        input.chatId ?? null,
        input.orchestratorRunId ?? null,
        input.systemAgentId ?? null,
        input.autopilotConfigId ?? null,
        input.domainPackId ?? null,
        input.goal?.trim() || null,
        normalizeGoalKey(input.goalKey || input.goal),
        input.procedureId?.trim() || null,
        input.procedureVersion ?? null,
        input.currentStepId?.trim() || null,
        json({
          createdBy: 'universal_agent_runtime',
          ...(input.metadata || {}),
        }),
      ],
    );

    let row = inserted.rows[0];
    if (!row && input.chatId) {
      const existing = await client.query<TaskRow>(
        `SELECT *
           FROM public.agent_task_executions
          WHERE workspace_id = $1
            AND chat_id = $2
            AND status IN ('active', 'waiting_input', 'waiting_confirmation', 'waiting_tool')
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE`,
        [input.workspaceId, input.chatId],
      );
      row = existing.rows[0];
    }

    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    if (input.orchestratorRunId || input.goal || input.procedureId || input.currentStepId) {
      const updated = await client.query<TaskRow>(
        `UPDATE public.agent_task_executions
            SET orchestrator_run_id = COALESCE($2, orchestrator_run_id),
                system_agent_id = COALESCE($3, system_agent_id),
                autopilot_config_id = COALESCE($4, autopilot_config_id),
                domain_pack_id = COALESCE($5, domain_pack_id),
                goal = COALESCE(NULLIF($6, ''), goal),
                goal_key = COALESCE(NULLIF($7, ''), goal_key),
                procedure_id = COALESCE(NULLIF($8, ''), procedure_id),
                procedure_version = COALESCE($9, procedure_version),
                current_step_id = COALESCE(NULLIF($10, ''), current_step_id),
                updated_at = timezone('utc', now())
          WHERE id = $1
          RETURNING *`,
        [
          row.id,
          input.orchestratorRunId ?? null,
          input.systemAgentId ?? null,
          input.autopilotConfigId ?? null,
          input.domainPackId ?? null,
          input.goal?.trim() || '',
          normalizeGoalKey(input.goalKey || input.goal) || '',
          input.procedureId?.trim() || '',
          input.procedureVersion ?? null,
          input.currentStepId?.trim() || '',
        ],
      );
      row = updated.rows[0] || row;
    }

    await client.query('COMMIT');
    return mapTask(row);
  } catch (error) {
    await releaseRollback(client, error);
    return null;
  } finally {
    client.release();
  }
}

function inferTaskStatus(event: AgentTraceEvent, current: AgentTaskStatus): AgentTaskStatus {
  const payload = event.payload || {};
  const explicit = event.taskStatus;
  if (explicit) return explicit;

  if (event.eventType === 'procedure_runtime') {
    if (payload.status === 'waiting_input') return 'waiting_input';
    if (payload.status === 'completed') return 'completed';
    if (payload.status === 'failed') return 'failed';
  }
  if (event.eventType === 'workflow_plan') {
    if (Array.isArray(payload.missingSlots) && payload.missingSlots.length > 0) return 'waiting_input';
  }
  if (event.eventType === 'agent_task_plan') {
    if (payload.status === 'waiting_input' || (Array.isArray(payload.missingInputs) && payload.missingInputs.length > 0)) {
      return 'waiting_input';
    }
    if (payload.status === 'waiting_confirmation' || payload.requiresConfirmation === true) {
      return 'waiting_confirmation';
    }
    // A model-authored plan may resume a waiting task, but it cannot declare a
    // terminal outcome. Completion remains tied to deterministic evidence.
    if (payload.status === 'active' && !isTerminalAgentTaskStatus(current)) return 'active';
  }
  if (event.eventType === 'tool_planner') {
    const rejected = Array.isArray(payload.rejectedActions) ? payload.rejectedActions : [];
    if (rejected.some((item) => typeof item === 'object' && item && /confirmation_required|confirmation_context_missing/i.test(JSON.stringify(item)))) {
      return 'waiting_confirmation';
    }
    if (rejected.some((item) => typeof item === 'object' && item && Array.isArray((item as Record<string, unknown>).missingSlots) && ((item as Record<string, unknown>).missingSlots as unknown[]).length > 0)) {
      return 'waiting_input';
    }
  }
  if (/handoff|transfer/i.test(event.eventType)) return 'handoff';
  if (/close|completed/i.test(event.eventType) && event.status === 'success') return 'completed';
  if (event.status === 'error' && !/^tool_execution$/.test(event.eventType)) return 'failed';
  return current;
}

export async function recordAgentTaskCheckpoint(input: {
  taskExecutionId: string;
  workspaceId: string;
  orchestratorRunId?: string | null;
  eventType: string;
  status?: AgentTaskStatus;
  patch?: AgentTaskStatePatch;
  metadata?: JsonObject;
}): Promise<AgentTaskCheckpoint | null> {
  if (!input.taskExecutionId || !input.workspaceId || !input.eventType) return null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query<TaskRow>(
      `SELECT *
         FROM public.agent_task_executions
        WHERE id = $1
          AND workspace_id = $2
        FOR UPDATE`,
      [input.taskExecutionId, input.workspaceId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return null;
    }

    const patch = input.patch || {};
    const nextStatus = input.status || current.status;
    assertValidAgentTaskTransition(current.status, nextStatus);
    const state = mergeObjects(current.state, patch.state);
    const slots = mergeObjects(current.slots, patch.slots);
    const confirmations = mergeObjects(current.confirmations, patch.confirmations);
    const decisions = mergeObjects(current.decisions, patch.decisions);
    const toolResults = mergeObjects(current.tool_results, patch.toolResults);
    const completedAt = isTerminalAgentTaskStatus(nextStatus)
      ? current.completed_at || new Date()
      : null;

    const updatedResult = await client.query<TaskRow>(
      `UPDATE public.agent_task_executions
          SET goal = COALESCE($3, goal),
              goal_key = COALESCE($4, goal_key),
              procedure_id = COALESCE($5, procedure_id),
              procedure_version = COALESCE($6, procedure_version),
              current_step_id = COALESCE($7, current_step_id),
              status = $8,
              state = $9::jsonb,
              slots = $10::jsonb,
              confirmations = $11::jsonb,
              decisions = $12::jsonb,
              tool_results = $13::jsonb,
              next_action = $14::jsonb,
              version = version + 1,
              updated_at = timezone('utc', now()),
              completed_at = $15
        WHERE id = $1
          AND workspace_id = $2
        RETURNING *`,
      [
        input.taskExecutionId,
        input.workspaceId,
        patch.goal === undefined ? null : patch.goal?.trim() || null,
        patch.goalKey === undefined ? null : normalizeGoalKey(patch.goalKey),
        patch.procedureId === undefined ? null : patch.procedureId?.trim() || null,
        patch.procedureVersion ?? null,
        patch.currentStepId === undefined ? null : patch.currentStepId?.trim() || null,
        nextStatus,
        json(state),
        json(slots),
        json(confirmations),
        json(decisions),
        json(toolResults),
        patch.nextAction === undefined ? null : json(patch.nextAction),
        completedAt,
      ],
    );
    const updated = updatedResult.rows[0];
    if (!updated) {
      await client.query('ROLLBACK');
      return null;
    }

    const sequenceResult = await client.query<{ next_sequence: string }>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM public.agent_task_checkpoints
        WHERE task_execution_id = $1`,
      [input.taskExecutionId],
    );
    const sequence = Number(sequenceResult.rows[0]?.next_sequence || 1);
    const checkpointState = checkpointObject({
      status: nextStatus,
      goal: updated.goal,
      procedureId: updated.procedure_id,
      currentStepId: updated.current_step_id,
      slots,
      confirmations,
      decisions,
      toolResults,
      nextAction: updated.next_action,
      state,
    });
    const checkpointResult = await client.query<CheckpointRow>(
      `INSERT INTO public.agent_task_checkpoints (
        task_execution_id,
        orchestrator_run_id,
        sequence,
        event_type,
        status,
        state,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      RETURNING *`,
      [
        input.taskExecutionId,
        input.orchestratorRunId ?? null,
        sequence,
        input.eventType.slice(0, 120),
        nextStatus,
        json(checkpointState),
        json(checkpointObject(input.metadata || {})),
      ],
    );

    await client.query('COMMIT');
    return checkpointResult.rows[0] ? mapCheckpoint(checkpointResult.rows[0]) : null;
  } catch (error) {
    await releaseRollback(client, error);
    return null;
  } finally {
    client.release();
  }
}

export async function recordAgentTaskEvent(
  taskExecutionId: string | null | undefined,
  event: AgentTraceEvent,
  context?: {
    workspaceId?: string | null;
    orchestratorRunId?: string | null;
  },
): Promise<AgentTaskCheckpoint | null> {
  if (!taskExecutionId) return null;
  const workspaceId = context?.workspaceId || '';
  const current = await getAgentTaskExecution({
    workspaceId,
    taskId: taskExecutionId,
  });
  const goal = typeof event.goal === 'string'
    ? event.goal
    : typeof event.payload?.goal === 'string'
      ? event.payload.goal
      : typeof event.payload?.intent === 'string'
        ? event.payload.intent
        : undefined;
  const step = typeof event.payload?.currentStepId === 'string'
    ? event.payload.currentStepId
    : typeof event.payload?.stepId === 'string'
      ? event.payload.stepId
      : undefined;
  const status = inferTaskStatus(event, current?.status || 'active');
  const toolName = typeof event.payload?.toolName === 'string' ? event.payload.toolName : null;
  const toolResults = toolName
    ? {
        [toolName]: {
          status: event.status || null,
          output: event.payload?.output || null,
          error: event.payload?.error || null,
          recordedAt: new Date().toISOString(),
        },
      }
    : undefined;
  const taskPlan = event.eventType === 'agent_task_plan'
    ? checkpointObject(event.payload)
    : null;
  const nextStep = taskPlan && Array.isArray(taskPlan.nextSteps)
    ? taskPlan.nextSteps.find((item) => item && typeof item === 'object' && !Array.isArray(item))
    : null;
  const checkpoint = await recordAgentTaskCheckpoint({
    taskExecutionId,
    workspaceId: current?.workspaceId || workspaceId,
    orchestratorRunId: context?.orchestratorRunId || null,
    eventType: event.eventType,
    status,
    patch: {
      goal: goal ?? undefined,
      goalKey: goal ?? undefined,
      currentStepId: step,
      state: {
        lastEventType: event.eventType,
        lastEventStatus: event.status || null,
        lastEventAt: new Date().toISOString(),
        ...(taskPlan ? { taskPlan } : {}),
      },
      nextAction: nextStep ? checkpointObject(nextStep) : undefined,
      toolResults,
    },
    metadata: event.payload,
  });

  if (checkpoint && status === 'waiting_input' && !current?.activeInterruptionId) {
    const missingSlots = Array.isArray(event.payload?.missingSlots)
      ? event.payload.missingSlots.map(String).filter(Boolean).slice(0, 12)
      : [];
    const prompt = [
      typeof event.payload?.question === 'string' ? event.payload.question : '',
      typeof event.payload?.prompt === 'string' ? event.payload.prompt : '',
      typeof event.payload?.response === 'string' ? event.payload.response : '',
      missingSlots.length > 0 ? `Preciso destas informacoes: ${missingSlots.join(', ')}.` : '',
    ].find((value) => value.trim()) || '';
    if (prompt) {
      await pushAgentTaskInterruption({
        taskExecutionId,
        workspaceId: current?.workspaceId || workspaceId,
        kind: 'missing_input',
        prompt,
        context: {
          eventType: event.eventType,
          missingSlots,
        },
      });
    }
  }

  return checkpoint;
}

export async function finishAgentTask(input: {
  taskExecutionId: string | null | undefined;
  workspaceId: string;
  status: Extract<AgentTaskStatus, 'handoff' | 'completed' | 'failed' | 'cancelled'>;
  orchestratorRunId?: string | null;
  metadata?: JsonObject;
}): Promise<AgentTaskCheckpoint | null> {
  if (!input.taskExecutionId) return null;
  const current = await getAgentTaskExecution({
    workspaceId: input.workspaceId,
    taskId: input.taskExecutionId,
  });
  if (!current || isTerminalAgentTaskStatus(current.status)) return null;
  return recordAgentTaskCheckpoint({
    taskExecutionId: input.taskExecutionId,
    workspaceId: input.workspaceId,
    orchestratorRunId: input.orchestratorRunId,
    eventType: `task_${input.status}`,
    status: input.status,
    metadata: input.metadata,
  });
}

export async function pushAgentTaskInterruption(input: {
  taskExecutionId: string;
  workspaceId: string;
  kind: string;
  prompt: string;
  context?: JsonObject;
  parentInterruptionId?: string | null;
}): Promise<AgentTaskInterruption | null> {
  if (!input.taskExecutionId || !input.workspaceId || !input.prompt.trim()) return null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query<TaskRow>(
      `SELECT *
         FROM public.agent_task_executions
        WHERE id = $1 AND workspace_id = $2
        FOR UPDATE`,
      [input.taskExecutionId, input.workspaceId],
    );
    if (!task.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const order = await client.query<{ next_order: number }>(
      `SELECT COALESCE(MAX(stack_order), -1) + 1 AS next_order
         FROM public.agent_task_interruptions
        WHERE task_execution_id = $1 AND status = 'pending'`,
      [input.taskExecutionId],
    );
    const interruption = await client.query<InterruptionRow>(
      `INSERT INTO public.agent_task_interruptions (
        task_execution_id,
        parent_interruption_id,
        kind,
        prompt,
        status,
        stack_order,
        context
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb)
      RETURNING *`,
      [
        input.taskExecutionId,
        input.parentInterruptionId ?? null,
        input.kind.trim().slice(0, 120),
        input.prompt.trim().slice(0, 4_000),
        Number(order.rows[0]?.next_order || 0),
        json(checkpointObject(input.context || {})),
      ],
    );
    if (!interruption.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE public.agent_task_executions
          SET active_interruption_id = $2,
              version = version + 1,
              updated_at = timezone('utc', now())
        WHERE id = $1 AND workspace_id = $3`,
      [input.taskExecutionId, interruption.rows[0].id, input.workspaceId],
    );
    await client.query('COMMIT');
    return mapInterruption(interruption.rows[0]);
  } catch (error) {
    await releaseRollback(client, error);
    return null;
  } finally {
    client.release();
  }
}

export async function resolveAgentTaskInterruption(input: {
  taskExecutionId: string;
  workspaceId: string;
  interruptionId: string;
  status?: Extract<AgentTaskInterruption['status'], 'resolved' | 'cancelled'>;
}): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<InterruptionRow>(
      `UPDATE public.agent_task_interruptions interruption
          SET status = $4,
              resolved_at = timezone('utc', now())
        WHERE interruption.id = $1
          AND interruption.task_execution_id = $2
          AND EXISTS (
            SELECT 1
            FROM public.agent_task_executions task
            WHERE task.id = interruption.task_execution_id
              AND task.workspace_id = $3
          )
        RETURNING interruption.*`,
      [input.interruptionId, input.taskExecutionId, input.workspaceId, input.status || 'resolved'],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const next = await client.query<{ id: string | null }>(
      `SELECT id
         FROM public.agent_task_interruptions
        WHERE task_execution_id = $1 AND status = 'pending'
        ORDER BY stack_order DESC, created_at DESC
        LIMIT 1`,
      [input.taskExecutionId],
    );
    const taskState = await client.query<{ status: AgentTaskStatus }>(
      `SELECT status
         FROM public.agent_task_executions
        WHERE id = $1 AND workspace_id = $2`,
      [input.taskExecutionId, input.workspaceId],
    );
    const resumeStatus = taskState.rows[0] && isTerminalAgentTaskStatus(taskState.rows[0].status)
      ? taskState.rows[0].status
      : 'active';
    await client.query(
      `UPDATE public.agent_task_executions
          SET active_interruption_id = $2,
              version = version + 1,
              updated_at = timezone('utc', now())
        WHERE id = $1 AND workspace_id = $3`,
      [input.taskExecutionId, next.rows[0]?.id || null, input.workspaceId],
    );
    await client.query('COMMIT');
    await recordAgentTaskCheckpoint({
      taskExecutionId: input.taskExecutionId,
      workspaceId: input.workspaceId,
      eventType: 'interruption_resolved',
      status: resumeStatus,
      metadata: {
        interruptionId: input.interruptionId,
        status: input.status || 'resolved',
      },
    });
    return true;
  } catch (error) {
    await releaseRollback(client, error);
    return false;
  } finally {
    client.release();
  }
}

export async function listAgentTaskInterruptions(input: {
  taskExecutionId: string;
  workspaceId: string;
  status?: AgentTaskInterruption['status'] | null;
}): Promise<AgentTaskInterruption[]> {
  try {
    const result = await db.query<InterruptionRow>(
      `SELECT interruption.*
         FROM public.agent_task_interruptions interruption
         JOIN public.agent_task_executions task ON task.id = interruption.task_execution_id
        WHERE interruption.task_execution_id = $1
          AND task.workspace_id = $2
          AND ($3::text IS NULL OR interruption.status = $3::text)
        ORDER BY interruption.stack_order DESC, interruption.created_at DESC`,
      [input.taskExecutionId, input.workspaceId, input.status ?? null],
    );
    return result.rows.map(mapInterruption);
  } catch (error) {
    logStoreError('list_interruptions', error);
    return [];
  }
}

export async function listAgentTaskCheckpoints(input: {
  taskExecutionId: string;
  workspaceId: string;
  limit?: number;
}): Promise<AgentTaskCheckpoint[]> {
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit || 50)));
  try {
    const result = await db.query<CheckpointRow>(
      `SELECT checkpoint.*
         FROM public.agent_task_checkpoints checkpoint
         JOIN public.agent_task_executions task ON task.id = checkpoint.task_execution_id
        WHERE checkpoint.task_execution_id = $1
          AND task.workspace_id = $2
        ORDER BY checkpoint.sequence DESC
        LIMIT $3`,
      [input.taskExecutionId, input.workspaceId, limit],
    );
    return result.rows.map(mapCheckpoint);
  } catch (error) {
    logStoreError('list_checkpoints', error);
    return [];
  }
}
