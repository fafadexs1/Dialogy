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

    return rowToContext(result.rows[0]);
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
    toolResults: typeof row.tool_results === 'string'
      ? JSON.parse(row.tool_results)
      : row.tool_results || {},
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
