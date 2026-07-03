import type { Pool } from 'pg';
import {
  WorkflowDefinitionSchema,
  WorkflowExecutionSchema,
} from './schemas';
import {
  WorkflowOptimisticLockError,
  type WorkflowPersistence,
} from './persistence';
import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowExecution,
} from './types';

type Queryable = Pick<Pool, 'query'>;

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function rowToExecution(row: Record<string, unknown>): WorkflowExecution {
  const counters = parseJson(row.counters) as Record<string, unknown> | null;
  const failure = parseJson(row.failure);
  return WorkflowExecutionSchema.parse({
    executionId: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    workspaceId: row.workspace_id || undefined,
    sessionId: row.session_id || undefined,
    conversationId: row.conversation_id || undefined,
    status: row.status,
    currentNodeId: row.current_node_id ?? null,
    previousNodeId: row.previous_node_id ?? null,
    pendingNodeIds: parseJson(row.pending_node_ids) || [],
    input: parseJson(row.input) || {},
    variables: parseJson(row.variables) || {},
    context: parseJson(row.context) || {},
    nodeResults: parseJson(row.node_results) || {},
    executionPath: parseJson(row.execution_path) || [],
    startedAt: new Date(String(row.started_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : undefined,
    waitingReason: row.waiting_reason || undefined,
    resumeToken: row.resume_token || undefined,
    failure: failure || undefined,
    totalSteps: Number(counters?.totalSteps || 0),
    totalModelCalls: Number(counters?.totalModelCalls || 0),
    totalToolCalls: Number(counters?.totalToolCalls || 0),
    totalInputTokens: Number(counters?.totalInputTokens || 0),
    totalOutputTokens: Number(counters?.totalOutputTokens || 0),
    totalTokens: counters?.totalTokens == null ? undefined : Number(counters.totalTokens),
    version: Number(row.version || 0),
    lockedBy: row.locked_by || undefined,
    lockExpiresAt: row.lock_expires_at
      ? new Date(String(row.lock_expires_at)).toISOString()
      : undefined,
  });
}

function executionCounters(execution: WorkflowExecution) {
  return {
    totalSteps: execution.totalSteps,
    totalModelCalls: execution.totalModelCalls,
    totalToolCalls: execution.totalToolCalls,
    totalInputTokens: execution.totalInputTokens,
    totalOutputTokens: execution.totalOutputTokens,
    totalTokens: execution.totalTokens,
  };
}

export class PostgresWorkflowPersistence implements WorkflowPersistence {
  constructor(private readonly database: Queryable) {}

  private async persistExecutionDetails(execution: WorkflowExecution): Promise<void> {
    const lastSequenceByNode = new Map<string, number>();
    for (const step of execution.executionPath) {
      lastSequenceByNode.set(step.nodeId, step.sequence);
    }

    for (const step of execution.executionPath) {
      const result = execution.nodeResults[step.nodeId];
      const nodeRun = await this.database.query(
        `INSERT INTO workflow_node_runs (
           execution_id, node_id, node_type, sequence, attempt, status,
           input, output, state_before, state_patch, state_after, error,
           metrics, selected_output, started_at, finished_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
           $13::jsonb, $14, $15, $16
         )
         ON CONFLICT (execution_id, sequence, attempt) DO UPDATE
         SET status = EXCLUDED.status,
             input = EXCLUDED.input,
             output = EXCLUDED.output,
             state_before = EXCLUDED.state_before,
             state_patch = EXCLUDED.state_patch,
             state_after = EXCLUDED.state_after,
             error = EXCLUDED.error,
             metrics = EXCLUDED.metrics,
             selected_output = EXCLUDED.selected_output,
             finished_at = EXCLUDED.finished_at
         RETURNING id`,
        [
          execution.executionId,
          step.nodeId,
          step.nodeType,
          step.sequence,
          step.attempt,
          step.status,
          JSON.stringify(step.input || null),
          JSON.stringify(step.output || null),
          JSON.stringify(step.stateBefore || null),
          JSON.stringify(step.statePatch || null),
          JSON.stringify(step.stateAfter || null),
          JSON.stringify(step.error || null),
          JSON.stringify(result?.metrics || null),
          step.selectedOutput || null,
          step.startedAt,
          step.finishedAt,
        ],
      );

      if (lastSequenceByNode.get(step.nodeId) !== step.sequence) continue;
      const nodeRunId = nodeRun.rows[0]?.id || null;
      for (const toolCall of result?.toolCalls || []) {
        await this.database.query(
          `INSERT INTO workflow_tool_calls (
             id, execution_id, node_run_id, node_id, tool_name, purpose_summary,
             arguments, output, error, status, attempt, idempotency_key,
             started_at, finished_at, duration_ms
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12,
             $13, $14, $15
           )
           ON CONFLICT (id) DO UPDATE
           SET node_run_id = EXCLUDED.node_run_id,
               purpose_summary = EXCLUDED.purpose_summary,
               arguments = EXCLUDED.arguments,
               output = EXCLUDED.output,
               error = EXCLUDED.error,
               status = EXCLUDED.status,
               attempt = EXCLUDED.attempt,
               idempotency_key = EXCLUDED.idempotency_key,
               started_at = EXCLUDED.started_at,
               finished_at = EXCLUDED.finished_at,
               duration_ms = EXCLUDED.duration_ms`,
          [
            toolCall.id,
            execution.executionId,
            nodeRunId,
            step.nodeId,
            toolCall.toolName,
            toolCall.purposeSummary || null,
            JSON.stringify(toolCall.arguments),
            JSON.stringify(toolCall.output || null),
            JSON.stringify(toolCall.error || null),
            toolCall.status,
            toolCall.attempt || 1,
            toolCall.idempotencyKey || null,
            toolCall.startedAt || null,
            toolCall.finishedAt || null,
            toolCall.durationMs ?? null,
          ],
        );
      }
    }
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    const parsed = WorkflowDefinitionSchema.parse(definition);
    await this.database.query(
      `INSERT INTO workflow_definitions (
         workflow_id, workflow_version, workspace_id, name, status, definition,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (workflow_id, workflow_version) DO UPDATE
       SET workspace_id = EXCLUDED.workspace_id,
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           definition = EXCLUDED.definition,
           updated_at = EXCLUDED.updated_at`,
      [
        parsed.id,
        parsed.version,
        parsed.workspaceId || null,
        parsed.name,
        parsed.status,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async getWorkflowDefinition(workflowId: string, version: string): Promise<WorkflowDefinition | null> {
    const result = await this.database.query(
      `SELECT definition
       FROM workflow_definitions
       WHERE workflow_id = $1 AND workflow_version = $2
       LIMIT 1`,
      [workflowId, version],
    );
    if (!result.rows[0]) return null;
    return WorkflowDefinitionSchema.parse(parseJson(result.rows[0].definition));
  }

  async createExecution(execution: WorkflowExecution): Promise<WorkflowExecution> {
    const parsed = WorkflowExecutionSchema.parse({ ...execution, version: 0 });
    const result = await this.database.query(
      `INSERT INTO workflow_executions (
         id, workflow_id, workflow_version, workspace_id, session_id, conversation_id,
         status, current_node_id, previous_node_id, pending_node_ids, input, variables,
         context, node_results, execution_path, waiting_reason, resume_token, failure,
         counters, version, locked_by, lock_expires_at, started_at, updated_at, finished_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb,
         $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18::jsonb,
         $19::jsonb, 0, $20, $21, $22, $23, $24
       )
       RETURNING *`,
      [
        parsed.executionId,
        parsed.workflowId,
        parsed.workflowVersion,
        parsed.workspaceId || null,
        parsed.sessionId || null,
        parsed.conversationId || null,
        parsed.status,
        parsed.currentNodeId,
        parsed.previousNodeId,
        JSON.stringify(parsed.pendingNodeIds),
        JSON.stringify(parsed.input),
        JSON.stringify(parsed.variables),
        JSON.stringify(parsed.context),
        JSON.stringify(parsed.nodeResults),
        JSON.stringify(parsed.executionPath),
        parsed.waitingReason || null,
        parsed.resumeToken || null,
        JSON.stringify(parsed.failure || null),
        JSON.stringify(executionCounters(parsed)),
        parsed.lockedBy || null,
        parsed.lockExpiresAt || null,
        parsed.startedAt,
        parsed.updatedAt,
        parsed.finishedAt || null,
      ],
    );
    return rowToExecution(result.rows[0]);
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const result = await this.database.query(
      'SELECT * FROM workflow_executions WHERE id = $1 LIMIT 1',
      [executionId],
    );
    return result.rows[0] ? rowToExecution(result.rows[0]) : null;
  }

  async getExecutionByResumeToken(resumeToken: string): Promise<WorkflowExecution | null> {
    const result = await this.database.query(
      `SELECT *
       FROM workflow_executions
       WHERE resume_token = $1 AND status = 'waiting'
       LIMIT 1`,
      [resumeToken],
    );
    return result.rows[0] ? rowToExecution(result.rows[0]) : null;
  }

  async saveExecution(
    execution: WorkflowExecution,
    expectedVersion: number,
  ): Promise<WorkflowExecution> {
    const parsed = WorkflowExecutionSchema.parse(execution);
    const result = await this.database.query(
      `UPDATE workflow_executions
       SET status = $3,
           current_node_id = $4,
           previous_node_id = $5,
           pending_node_ids = $6::jsonb,
           input = $7::jsonb,
           variables = $8::jsonb,
           context = $9::jsonb,
           node_results = $10::jsonb,
           execution_path = $11::jsonb,
           waiting_reason = $12,
           resume_token = $13,
           failure = $14::jsonb,
           counters = $15::jsonb,
           locked_by = $16,
           lock_expires_at = $17,
           updated_at = $18,
           finished_at = $19,
           version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [
        parsed.executionId,
        expectedVersion,
        parsed.status,
        parsed.currentNodeId,
        parsed.previousNodeId,
        JSON.stringify(parsed.pendingNodeIds),
        JSON.stringify(parsed.input),
        JSON.stringify(parsed.variables),
        JSON.stringify(parsed.context),
        JSON.stringify(parsed.nodeResults),
        JSON.stringify(parsed.executionPath),
        parsed.waitingReason || null,
        parsed.resumeToken || null,
        JSON.stringify(parsed.failure || null),
        JSON.stringify(executionCounters(parsed)),
        parsed.lockedBy || null,
        parsed.lockExpiresAt || null,
        parsed.updatedAt,
        parsed.finishedAt || null,
      ],
    );
    if (!result.rows[0]) {
      throw new WorkflowOptimisticLockError(parsed.executionId, expectedVersion);
    }
    const saved = rowToExecution(result.rows[0]);
    await this.persistExecutionDetails(saved);
    return saved;
  }

  async acquireExecutionLock(
    executionId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<WorkflowExecution | null> {
    const result = await this.database.query(
      `UPDATE workflow_executions
       SET locked_by = $2,
           lock_expires_at = clock_timestamp() + ($3::int * interval '1 millisecond'),
           updated_at = clock_timestamp(),
           version = version + 1
       WHERE id = $1
         AND (
           locked_by IS NULL
           OR locked_by = $2
           OR lock_expires_at <= clock_timestamp()
         )
       RETURNING *`,
      [executionId, workerId, leaseMs],
    );
    return result.rows[0] ? rowToExecution(result.rows[0]) : null;
  }

  async renewExecutionLock(executionId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE workflow_executions
       SET lock_expires_at = clock_timestamp() + ($3::int * interval '1 millisecond'),
           updated_at = clock_timestamp()
       WHERE id = $1 AND locked_by = $2`,
      [executionId, workerId, leaseMs],
    );
    return Number(result.rowCount || 0) > 0;
  }

  async releaseExecutionLock(executionId: string, workerId: string): Promise<void> {
    await this.database.query(
      `UPDATE workflow_executions
       SET locked_by = NULL,
           lock_expires_at = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1 AND locked_by = $2`,
      [executionId, workerId],
    );
  }

  async appendEvent(event: WorkflowEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO workflow_events (
         id, execution_id, workflow_id, sequence, event_type, node_id,
         tool_name, safe_summary, payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (execution_id, sequence) DO NOTHING`,
      [
        event.id,
        event.executionId,
        event.workflowId,
        event.sequence,
        event.type,
        event.nodeId || null,
        event.toolName || null,
        event.safeSummary || null,
        JSON.stringify({
          text: event.text,
          data: event.data,
        }),
        event.createdAt,
      ],
    );
  }

  async listEvents(executionId: string, afterSequence = -1): Promise<WorkflowEvent[]> {
    const result = await this.database.query(
      `SELECT *
       FROM workflow_events
       WHERE execution_id = $1 AND sequence > $2
       ORDER BY sequence ASC`,
      [executionId, afterSequence],
    );
    return result.rows.map((row) => {
      const payload = parseJson(row.payload) as Record<string, unknown> | null;
      return {
        id: String(row.id),
        sequence: Number(row.sequence),
        type: row.event_type,
        executionId: String(row.execution_id),
        workflowId: String(row.workflow_id),
        nodeId: row.node_id || undefined,
        toolName: row.tool_name || undefined,
        safeSummary: row.safe_summary || undefined,
        text: typeof payload?.text === 'string' ? payload.text : undefined,
        data: isRecord(payload?.data) ? payload.data : undefined,
        createdAt: new Date(String(row.created_at)).toISOString(),
      } as WorkflowEvent;
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
