/**
 * Procedure Store
 *
 * Persistence layer for ProcedureExecutionContext — the live state of a
 * procedure running against a specific chat. Uses the `procedure_executions`
 * table and falls back gracefully when the table does not yet exist (the
 * migration may not have run).
 */

import { db } from '@/lib/db';
import type {
  ProcedureExecutionContext,
  ProcedureExecutionStatus,
  ProcedureGraph,
  StepExecutionRecord,
} from './procedure-types';
import { compactToolOutputForContinuation } from './runtime/tool-memory';

function redactProcedureExecutionValue(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => redactProcedureExecutionValue(item, key));
  if (!value || typeof value !== 'object') {
    if (/cpf|cnpj|document/i.test(key) && typeof value === 'string') {
      const digits = value.replace(/\D/g, '');
      return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([nestedKey]) => !/^(pixCode|barcode|digitableLine|paymentLink|ip|ipv6|login|addressLabel|customerName)$/i.test(nestedKey))
      .map(([nestedKey, nested]) => [nestedKey, redactProcedureExecutionValue(nested, nestedKey)]),
  );
}

function compactProcedureExecutionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactProcedureExecutionValue);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (
    typeof record.toolName === 'string' &&
    typeof record.status === 'string' &&
    record.input &&
    typeof record.input === 'object'
  ) {
    return redactProcedureExecutionValue({
      toolName: record.toolName,
      status: record.status,
      input: record.input,
      ...(record.error ? { error: record.error } : {}),
      ...(record.output
        ? { output: compactToolOutputForContinuation(record as any) }
        : {}),
    });
  }

  return redactProcedureExecutionValue(Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, compactProcedureExecutionValue(nested)]),
  ));
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function nullableUuid(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function inferProcedureGoal(graph: ProcedureGraph | null | undefined, fallback?: string | null) {
  if (fallback?.trim()) return fallback.trim();
  if (graph?.triggerIntents?.length) return graph.triggerIntents.join(',');
  if (graph?.triggerKeywords?.length) return graph.triggerKeywords.slice(0, 5).join(',');
  return null;
}

async function upsertAgentProcedureDefinition(input: {
  context: ProcedureExecutionContext;
  graph?: ProcedureGraph | null;
  goal?: string | null;
}): Promise<void> {
  const { context, graph } = input;

  try {
    await db.query(
      `INSERT INTO agent_procedure_definitions (
        workspace_id,
        id,
        agent_id,
        name,
        goal,
        definition_json,
        version,
        status,
        source,
        document_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      ON CONFLICT (workspace_id, id) DO UPDATE SET
        agent_id = COALESCE(EXCLUDED.agent_id, agent_procedure_definitions.agent_id),
        name = EXCLUDED.name,
        goal = EXCLUDED.goal,
        definition_json = EXCLUDED.definition_json,
        version = GREATEST(agent_procedure_definitions.version, EXCLUDED.version),
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        document_id = EXCLUDED.document_id,
        updated_at = NOW()`,
      [
        context.workspaceId,
        context.procedureId,
        nullableUuid(context.systemAgentId),
        context.procedureName,
        inferProcedureGoal(graph, input.goal),
        safeJson(graph || {
          id: context.procedureId,
          name: context.procedureName,
          currentStepId: context.currentStepId,
        }),
        graph?.version || 1,
        graph ? 'compiled_document' : 'runtime_session',
        graph?.documentId || null,
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('agent_procedure_definitions')) {
      console.error('[PROCEDURE_STORE] upsertAgentProcedureDefinition error:', error);
    }
  }
}

async function upsertAgentProcedureSession(context: ProcedureExecutionContext): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent_procedure_sessions (
        id,
        workspace_id,
        chat_id,
        agent_id,
        procedure_id,
        procedure_execution_id,
        current_step_id,
        slots_json,
        confirmations_json,
        tool_results_json,
        status
      ) VALUES ($1, $2, $3, $4, $5, $1, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        current_step_id = EXCLUDED.current_step_id,
        slots_json = EXCLUDED.slots_json,
        confirmations_json = EXCLUDED.confirmations_json,
        tool_results_json = EXCLUDED.tool_results_json,
        status = EXCLUDED.status,
        updated_at = NOW()`,
      [
        context.id,
        context.workspaceId,
        context.chatId,
        nullableUuid(context.systemAgentId),
        context.procedureId,
        context.currentStepId,
        safeJson(context.collectedSlots),
        safeJson(context.decisions),
        safeJson(compactProcedureExecutionValue(context.toolResults)),
        context.status,
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('agent_procedure_sessions')) {
      console.error('[PROCEDURE_STORE] upsertAgentProcedureSession error:', error);
    }
  }
}

async function updateAgentProcedureSessionStatus(
  id: string,
  status: 'completed' | 'failed' | 'aborted',
): Promise<void> {
  try {
    await db.query(
      `UPDATE agent_procedure_sessions SET
        status = $1,
        updated_at = NOW()
       WHERE id = $2 OR procedure_execution_id = $2`,
      [status, id],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('agent_procedure_sessions')) {
      console.error('[PROCEDURE_STORE] updateAgentProcedureSessionStatus error:', error);
    }
  }
}

async function abortAgentProcedureSessions(chatId: string): Promise<void> {
  try {
    await db.query(
      `UPDATE agent_procedure_sessions SET
        status = 'aborted',
        updated_at = NOW()
       WHERE chat_id = $1 AND status IN ('running', 'waiting_input', 'waiting_tool')`,
      [chatId],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('agent_procedure_sessions')) {
      console.error('[PROCEDURE_STORE] abortAgentProcedureSessions error:', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Schema guard — the table might not exist until migration runs
// ---------------------------------------------------------------------------

async function ensureTable(): Promise<boolean> {
  return true;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get the active (running, waiting_input, or waiting_tool) procedure execution for a chat.
 * Returns null if none exists.
 */
export async function getActiveProcedureExecution(
  chatId: string,
): Promise<ProcedureExecutionContext | null> {
  const ready = await ensureTable();
  if (!ready) return null;

  try {
    const result = await db.query(
      `SELECT * FROM procedure_executions
       WHERE chat_id = $1 AND status IN ('running', 'waiting_input', 'waiting_tool')
       ORDER BY created_at DESC
       LIMIT 1`,
      [chatId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return rowToContext(row);
  } catch (error) {
    console.error('[PROCEDURE_STORE] getActiveProcedureExecution error:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createProcedureExecution(
  input: Omit<ProcedureExecutionContext, 'id' | 'startedAt' | 'updatedAt' | 'stepHistory' | 'retryCount' | 'toolResults' | 'decisions' | 'collectedSlots'> & {
    collectedSlots?: Record<string, string>;
    graph?: ProcedureGraph | null;
    goal?: string | null;
  },
): Promise<ProcedureExecutionContext | null> {
  const ready = await ensureTable();
  if (!ready) return null;

  try {
    const result = await db.query(
      `INSERT INTO procedure_executions (
        workspace_id, chat_id, system_agent_id,
        procedure_id, procedure_name, current_step_id, status,
        collected_slots
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.workspaceId,
        input.chatId,
        input.systemAgentId || null,
        input.procedureId,
        input.procedureName,
        input.currentStepId,
        input.status,
        JSON.stringify(input.collectedSlots || {}),
      ],
    );

    const context = rowToContext(result.rows[0]);
    await upsertAgentProcedureDefinition({
      context,
      graph: input.graph || null,
      goal: input.goal || null,
    });
    await upsertAgentProcedureSession(context);
    return context;
  } catch (error) {
    console.error('[PROCEDURE_STORE] createProcedureExecution error:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function saveProcedureExecution(
  context: ProcedureExecutionContext,
): Promise<void> {
  const ready = await ensureTable();
  if (!ready) return;

  try {
    await db.query(
      `UPDATE procedure_executions SET
        current_step_id = $1,
        status = $2,
        collected_slots = $3,
        tool_results = $4,
        decisions = $5,
        retry_count = $6,
        step_history = $7,
        updated_at = NOW(),
        completed_at = $8
       WHERE id = $9`,
      [
        context.currentStepId,
        context.status,
        JSON.stringify(context.collectedSlots),
        JSON.stringify(compactProcedureExecutionValue(context.toolResults)),
        JSON.stringify(context.decisions),
        JSON.stringify(context.retryCount),
        JSON.stringify(compactProcedureExecutionValue(context.stepHistory)),
        context.completedAt || null,
        context.id,
      ],
    );
    await upsertAgentProcedureSession(context);
  } catch (error) {
    console.error('[PROCEDURE_STORE] saveProcedureExecution error:', error);
  }
}

export async function completeProcedureExecution(
  id: string,
  status: 'completed' | 'failed' | 'aborted',
): Promise<void> {
  const ready = await ensureTable();
  if (!ready) return;

  try {
    await db.query(
      `UPDATE procedure_executions SET
        status = $1, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [status, id],
    );
    await updateAgentProcedureSessionStatus(id, status);
  } catch (error) {
    console.error('[PROCEDURE_STORE] completeProcedureExecution error:', error);
  }
}

/**
 * Abort all active procedure executions for a chat (e.g. when the chat is
 * transferred or closed).
 */
export async function abortActiveProcedures(chatId: string): Promise<number> {
  const ready = await ensureTable();
  if (!ready) return 0;

  try {
    const result = await db.query(
      `UPDATE procedure_executions SET
        status = 'aborted', completed_at = NOW(), updated_at = NOW()
       WHERE chat_id = $1 AND status IN ('running', 'waiting_input', 'waiting_tool')`,
      [chatId],
    );
    await abortAgentProcedureSessions(chatId);
    return result.rowCount || 0;
  } catch (error) {
    console.error('[PROCEDURE_STORE] abortActiveProcedures error:', error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToContext(row: any): ProcedureExecutionContext {
  const toolResults = typeof row.tool_results === 'string'
    ? JSON.parse(row.tool_results)
    : row.tool_results || {};
  return {
    id: row.id,
    chatId: row.chat_id,
    workspaceId: row.workspace_id,
    systemAgentId: row.system_agent_id || '',
    procedureId: row.procedure_id,
    procedureName: row.procedure_name,
    currentStepId: row.current_step_id,
    status: row.status as ProcedureExecutionStatus,
    collectedSlots: typeof row.collected_slots === 'string'
      ? JSON.parse(row.collected_slots)
      : row.collected_slots || {},
    toolResults,
    knowledgeContext: toolResults.__knowledge_context || null,
    decisions: typeof row.decisions === 'string'
      ? JSON.parse(row.decisions)
      : row.decisions || {},
    retryCount: typeof row.retry_count === 'string'
      ? JSON.parse(row.retry_count)
      : row.retry_count || {},
    startedAt: row.started_at?.toISOString?.() || row.started_at || '',
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || '',
    completedAt: row.completed_at?.toISOString?.() || row.completed_at || undefined,
    stepHistory: typeof row.step_history === 'string'
      ? JSON.parse(row.step_history)
      : row.step_history || [],
  };
}
