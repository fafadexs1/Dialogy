import 'dotenv/config';

import { Pool } from 'pg';

const chatIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
if (chatIds.length === 0) {
  throw new Error('Usage: npx tsx scripts/inspect-autopilot-tool-routing-live.ts <chat-id> [chat-id...]');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
});

function requestedToolName(input: any, fallback: unknown) {
  return input?.type === 'mcp_call_tool'
    ? String(input?.payload?.toolName || fallback || '')
    : String(input?.type || fallback || '');
}

function eventSummary(event: any) {
  const payload = event.payload || {};
  return {
    kind: event.kind,
    status: event.status,
    createdAt: event.created_at,
    customerNeed: payload.customerNeed ?? null,
    executionMode: payload.executionMode ?? null,
    plannedActions: payload.plannedActions ?? null,
    requestedActions: payload.requestedActions ?? null,
    acceptedActions: payload.acceptedActions ?? null,
    rejectedActions: payload.rejectedActions ?? null,
    decision: payload.decision ?? null,
    reasons: payload.reasons ?? null,
    responseSource: payload.source ?? null,
    validationDecision: payload.decision?.decision ?? payload.decision ?? null,
    fallbackReason: payload.fallbackReason ?? null,
    reason: payload.reason ?? null,
    workflowActions: payload.workflowActions ?? null,
    responseLength: payload.responseLength ?? null,
  };
}

async function inspect(chatId: string) {
  const chatResult = await pool.query(
    `SELECT c.id, c.workspace_id, c.status, c.is_autopilot_active,
            c.assigned_system_agent_id, ac.name, ac.ai_model, ac.tool_mode,
            ac.enabled_tool_names
       FROM chats c
       LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
       LEFT JOIN autopilot_configs ac
         ON ac.id = COALESCE(c.autopilot_config_id, sa.autopilot_config_id)
      WHERE c.id = $1
      LIMIT 1`,
    [chatId],
  );
  const chat = chatResult.rows[0];
  if (!chat) return { chatId, found: false };

  const messages = await pool.query(
    `SELECT id, content, from_me, api_message_status, metadata, created_at
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND COALESCE(api_message_status, '') <> 'internal'
      ORDER BY created_at DESC
      LIMIT 60`,
    [chat.workspace_id, chatId],
  );
  const executions = await pool.query(
    `SELECT tool_name, status, input, output, error, created_at
       FROM agent_tool_executions
      WHERE workspace_id = $1
        AND chat_id = $2
      ORDER BY created_at DESC
      LIMIT 60`,
    [chat.workspace_id, chatId],
  );
  const runs = await pool.query(
    `SELECT r.id, r.source_message_id, r.intent, r.confidence_score, r.status,
            r.metadata, r.created_at, m.content AS source_message
       FROM orchestrator_runs r
       LEFT JOIN messages m ON m.id = r.source_message_id
      WHERE r.workspace_id = $1
        AND r.chat_id = $2
      ORDER BY r.created_at DESC
      LIMIT 40`,
    [chat.workspace_id, chatId],
  );
  const runIds = runs.rows.map((run) => String(run.id));
  const events = runIds.length > 0
    ? await pool.query(
      `SELECT run_id, kind, status, payload, created_at
         FROM orchestrator_events
        WHERE run_id = ANY($1::uuid[])
          AND kind IN (
            'intent_classifier_ai',
            'intent_resolution',
            'close_intent_gate',
            'workflow_classifier_ai',
            'turn_plan',
            'workflow_plan',
            'tool_planner',
            'response_validator',
            'tool_execution',
            'required_tool_failure_terminal',
            'message_send'
          )
        ORDER BY created_at ASC`,
      [runIds],
    )
    : { rows: [] };
  const eventsByRun = new Map<string, any[]>();
  for (const event of events.rows) {
    const key = String(event.run_id);
    eventsByRun.set(key, [...(eventsByRun.get(key) || []), eventSummary(event)]);
  }

  return {
    chatId,
    found: true,
    chat: {
      status: chat.status,
      isAutopilotActive: chat.is_autopilot_active,
      assignedSystemAgentId: chat.assigned_system_agent_id,
      agentName: chat.name,
      model: chat.ai_model,
      toolMode: chat.tool_mode,
      enabledToolNames: chat.enabled_tool_names,
    },
    messages: messages.rows.reverse().map((message) => ({
      id: message.id,
      role: message.from_me ? 'agent' : 'customer',
      content: message.content,
      status: message.api_message_status,
      sentBy: message.metadata?.sentBy ?? null,
      createdAt: message.created_at,
    })),
    toolExecutions: executions.rows.reverse().map((execution) => ({
      toolName: requestedToolName(execution.input, execution.tool_name),
      status: execution.status,
      input: execution.input,
      output: execution.output,
      error: execution.error,
      createdAt: execution.created_at,
    })),
    runs: runs.rows.reverse().map((run) => ({
      id: run.id,
      sourceMessageId: run.source_message_id,
      sourceMessage: run.source_message,
      intent: run.intent,
      confidence: run.confidence_score,
      status: run.status,
      responseSent: run.metadata?.responseSent ?? null,
      workflowActions: run.metadata?.workflowActions ?? null,
      toolCount: run.metadata?.toolCount ?? null,
      createdAt: run.created_at,
      events: eventsByRun.get(String(run.id)) || [],
    })),
  };
}

Promise.all(chatIds.map(inspect))
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
