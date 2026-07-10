import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { redactWorkflowValue } from '@/services/workflow-runtime/events';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ executionId: string }>;
};

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function canReadExecution(userId: string, executionId: string) {
  const result = await db.query(
    `SELECT 1
     FROM workflow_executions we
     WHERE we.id = $1
       AND we.workspace_id IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM user_workspace_roles uwr
           WHERE uwr.workspace_id = we.workspace_id
             AND uwr.user_id = $2
     LIMIT 1`,
    [executionId, userId],
  );
  return (result.rowCount || 0) > 0;
}

export async function GET(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { executionId } = await context.params;
  if (!await canReadExecution(user.id, executionId)) {
    return new Response('Execution not found.', { status: 404 });
  }

  const url = new URL(request.url);
  const requestedSequence = Number(url.searchParams.get('after') || '-1');
  let lastSequence = Number.isFinite(requestedSequence) ? requestedSequence : -1;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      controller.enqueue(sse('connected', { executionId, after: lastSequence }));
      while (!request.signal.aborted && Date.now() - startedAt < 55_000) {
        const result = await db.query(
          `SELECT id, sequence, event_type, node_id, tool_name, safe_summary, payload, created_at
           FROM workflow_events
           WHERE execution_id = $1
             AND sequence > $2
           ORDER BY sequence ASC
           LIMIT 200`,
          [executionId, lastSequence],
        );
        for (const row of result.rows) {
          lastSequence = Number(row.sequence);
          controller.enqueue(sse('workflow', {
            id: row.id,
            sequence: lastSequence,
            type: row.event_type,
            executionId,
            nodeId: row.node_id || undefined,
            toolName: row.tool_name || undefined,
            safeSummary: row.safe_summary || undefined,
            payload: redactWorkflowValue(row.payload),
            createdAt: row.created_at,
          }));
        }
        if (result.rows.length === 0) {
          controller.enqueue(sse('heartbeat', { sequence: lastSequence }));
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
