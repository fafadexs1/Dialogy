import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';

type RouteContext = {
  params: Promise<{ executionId: string }>;
};

async function authorizedExecution(userId: string, executionId: string) {
  const result = await db.query(
    `SELECT we.*
     FROM workflow_executions we
     WHERE we.id = $1
       AND (
         we.workspace_id IS NULL
         OR EXISTS (
           SELECT 1
           FROM user_workspace_roles uwr
           WHERE uwr.workspace_id = we.workspace_id
             AND uwr.user_id = $2
         )
       )
     LIMIT 1`,
    [executionId, userId],
  );
  return result.rows[0] || null;
}

export async function GET(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { executionId } = await context.params;
  const execution = await authorizedExecution(user.id, executionId);
  if (!execution) {
    return NextResponse.json({ error: 'Execution not found.' }, { status: 404 });
  }

  const events = await db.query(
    `SELECT id, sequence, event_type, node_id, tool_name, safe_summary, payload, created_at
     FROM workflow_events
     WHERE execution_id = $1
     ORDER BY sequence ASC`,
    [executionId],
  );

  return NextResponse.json({
    execution: {
      id: execution.id,
      workflowId: execution.workflow_id,
      workflowVersion: execution.workflow_version,
      status: execution.status,
      currentNodeId: execution.current_node_id,
      previousNodeId: execution.previous_node_id,
      variables: execution.variables,
      context: execution.context,
      nodeResults: execution.node_results,
      executionPath: execution.execution_path,
      counters: execution.counters,
      waitingReason: execution.waiting_reason,
      failure: execution.failure,
      startedAt: execution.started_at,
      updatedAt: execution.updated_at,
      finishedAt: execution.finished_at,
    },
    events: events.rows.map((event) => ({
      id: event.id,
      sequence: Number(event.sequence),
      type: event.event_type,
      nodeId: event.node_id,
      toolName: event.tool_name,
      safeSummary: event.safe_summary,
      payload: event.payload,
      createdAt: event.created_at,
    })),
  }, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  });
}

