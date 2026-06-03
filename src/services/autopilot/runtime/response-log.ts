import { db } from '@/lib/db';
import { redactSensitiveLogText, redactSensitiveLogValue } from '@/lib/observability/redaction';

async function loadInternalKnowledgeSources(input: {
  configId: string;
  customerMessage: string;
}) {
  if (!input.customerMessage.trim()) return [];
  try {
    const { rows } = await db.query(
      `SELECT diagnostics->'internalKnowledgeSources' AS sources
       FROM rag_retrieval_logs
       WHERE autopilot_config_id = $1
         AND query = $2
         AND created_at >= NOW() - interval '5 minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.configId, redactSensitiveLogText(input.customerMessage)],
    );
    return Array.isArray(rows[0]?.sources) ? rows[0].sources : [];
  } catch (error) {
    console.warn('[AUTOPILOT_RESPONSE_LOG] Failed to load RAG source trace:', error);
    return [];
  }
}

export async function logIntelligentAttendantResponse(input: {
  configId: string;
  chatId: string;
  systemAgentId: string;
  modelName: string;
  customerMessage: string;
  response?: string | null;
  status: 'sent' | 'suggested' | 'empty' | 'error';
  triggeredRule?: string | null;
  errorMessage?: string;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    const internalKnowledgeSources = await loadInternalKnowledgeSources({
      configId: input.configId,
      customerMessage: input.customerMessage,
    });
    await db.query(
      `INSERT INTO autopilot_usage_logs (
          config_id, flow_name, model_name, input_tokens, output_tokens, total_tokens, rule_name,
          chat_id, system_agent_id, input_message, output_message, status, metadata
       ) VALUES ($1, 'intelligent_attendant_response', $2, 0, 0, 0, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.configId,
        input.modelName,
        input.triggeredRule || null,
        input.chatId,
        input.systemAgentId,
        input.customerMessage ? redactSensitiveLogText(input.customerMessage) : null,
        input.response ? redactSensitiveLogText(input.response) : null,
        input.status,
        JSON.stringify(redactSensitiveLogValue({
          source: 'autopilot-service',
          error: input.errorMessage || null,
          internalKnowledgeSources,
          ...(input.metadata || {}),
        })),
      ],
    );
  } catch (error) {
    console.error('[AUTOPILOT_RESPONSE_LOG] Failed to log response:', error);
  }
}

export async function hasSentFlowNodeMessage(input: {
  configId: string;
  chatId: string;
  nodeId?: string | null;
}): Promise<boolean> {
  if (!input.nodeId) return false;

  try {
    const { rows } = await db.query(
      `SELECT 1
       FROM autopilot_usage_logs
       WHERE config_id = $1
         AND chat_id = $2
         AND status IN ('sent', 'suggested')
         AND metadata->>'deterministicFlowMessage' = 'true'
         AND metadata->>'flowNodeId' = $3
       LIMIT 1`,
      [input.configId, input.chatId, input.nodeId],
    );
    return rows.length > 0;
  } catch (error) {
    console.warn('[AUTOPILOT_FLOW_MESSAGE] Failed to check prior flow message log:', error);
    return false;
  }
}
