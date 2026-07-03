import 'dotenv/config';

import { db } from '@/lib/db';
import { classifyAutopilotIntentWithAi } from '@/ai/flows/intent-classifier';
import { classifyToolIntent } from '@/ai/flows/tool-intent-gate';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';

const chatId = String(process.argv[2] || '').trim();
const historicalOnly = process.argv.includes('--historical-only');
if (!chatId) {
  throw new Error(
    'Usage: npx tsx scripts/inspect-lm-studio-close-routing-live.ts <chat-id> [--historical-only]',
  );
}

type MessageRow = {
  id: string;
  content: string;
  from_me: boolean;
  created_at: Date;
};

function redact(value: string): string {
  return value
    .replace(/\b\d{11,14}\b/g, '[documento]')
    .replace(/\b\d{10,13}\b/g, '[telefone]');
}

function historyBefore(messages: MessageRow[], targetIndex: number): string {
  return messages
    .slice(Math.max(0, targetIndex - 20), targetIndex)
    .map((message) => `${message.from_me ? 'Atendente' : 'Cliente'}: ${message.content}`)
    .join('\n');
}

async function main() {
  const configResult = await db.query(
    `SELECT ac.name, ac.ai_model, ac.knowledge_base, ac.knowledge_base_documents,
            ac.enabled_tool_names, ac.closing_policy
       FROM chats c
       JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
       JOIN autopilot_configs ac ON ac.id = COALESCE(c.autopilot_config_id, sa.autopilot_config_id)
      WHERE c.id = $1
      LIMIT 1`,
    [chatId],
  );
  const config = configResult.rows[0];
  if (!config) throw new Error(`Chat ${chatId} or its agent configuration was not found.`);

  const messagesResult = await db.query<MessageRow>(
    `SELECT id, content, from_me, created_at
       FROM messages
      WHERE chat_id = $1
        AND COALESCE(api_message_status, '') <> 'internal'
      ORDER BY created_at ASC`,
    [chatId],
  );
  const messages = messagesResult.rows;
  const closeIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => (
      !message.from_me &&
      /\b(encerr|finaliz|close(?:_chat)?|fech(?:a|ar)?\b)/i.test(message.content)
    ))
    .slice(-8);

  const knowledgeDocuments = Array.isArray(config.knowledge_base_documents)
    ? config.knowledge_base_documents
    : [];
  const enabledToolNames = Array.isArray(config.enabled_tool_names)
    ? config.enabled_tool_names.map(String)
    : [];
  const closeMessageIds = closeIndexes.map(({ message }) => message.id);
  const historicalResult = closeMessageIds.length > 0
    ? await db.query(
      `SELECT m.content AS customer_message, r.id AS run_id, r.intent, r.confidence_score,
              e.kind, e.status, e.payload, e.created_at
         FROM orchestrator_runs r
         JOIN messages m ON m.id = r.source_message_id
         JOIN orchestrator_events e ON e.run_id = r.id
        WHERE r.chat_id = $1
          AND r.source_message_id = ANY($2::uuid[])
          AND e.kind IN (
            'intent_classifier_ai',
            'intent_resolution',
            'close_intent_gate',
            'workflow_classifier_ai',
            'turn_plan',
            'workflow_plan'
          )
        ORDER BY r.created_at ASC, e.created_at ASC`,
      [chatId, closeMessageIds],
    )
    : { rows: [] };
  const results = [];

  for (const { message, index } of historicalOnly ? [] : closeIndexes) {
    const chatHistory = historyBefore(messages, index);
    const deterministic = resolveAutopilotIntent({
      customerMessage: message.content,
      chatHistory,
      knowledgeDocuments,
    });
    const [intentClassifier, closeToolGate] = await Promise.all([
      classifyAutopilotIntentWithAi({
        customerMessage: message.content,
        chatHistory,
        deterministicIntent: deterministic.intent,
        deterministicConfidence: deterministic.confidence,
        deterministicReason: deterministic.reason,
        agentName: config.name,
        agentKnowledgeBase: config.knowledge_base || '',
        knowledgeDocuments,
        enabledToolNames,
        model: config.ai_model,
        timeoutMs: 15_000,
      }),
      classifyToolIntent({
        customerMessage: message.content,
        chatHistory,
        toolName: 'close_chat',
        candidateReason: 'Mensagem pode indicar pedido de encerramento do atendimento.',
        closingPolicy: config.closing_policy || '',
        model: config.ai_model,
        timeoutMs: 15_000,
      }),
    ]);

    results.push({
      message: redact(message.content),
      model: config.ai_model,
      deterministic: {
        intent: deterministic.intent,
        confidence: deterministic.confidence,
        reason: deterministic.reason,
      },
      lmStudioIntentClassifier: intentClassifier,
      lmStudioCloseToolGate: closeToolGate,
    });
  }

  process.stdout.write(`${JSON.stringify({
    mode: 'live_lm_studio_endpoint_no_mocks',
    chatId,
    enabledToolNames,
    historicalRoutingEvents: historicalResult.rows.map((row) => ({
      message: redact(String(row.customer_message || '')),
      runId: row.run_id,
      resolvedIntent: row.intent,
      resolvedConfidence: row.confidence_score,
      kind: row.kind,
      status: row.status,
      payload: row.payload,
      createdAt: row.created_at,
    })),
    testedMessages: results.length,
    results,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
