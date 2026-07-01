import { db } from '@/lib/db';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';

type FailureHandoffDatabase = {
  connect: () => Promise<{
    query: (query: string, params?: unknown[]) => Promise<{
      rows: any[];
      rowCount?: number | null;
    }>;
    release: () => void;
  }>;
};

export async function handoffAutopilotFailureToHuman(input: {
  workspaceId: string;
  chatId: string;
  systemAgentId: string;
  sourceMessageId?: string | null;
  failedToolNames: string[];
  reason:
    | 'required_tool_failure'
    | 'terminal_queue_failure'
    | 'uncertain_provider_delivery';
  database?: FailureHandoffDatabase;
  broadcastChat?: typeof broadcastHydratedChatUpdate;
}): Promise<boolean> {
  const database = input.database || db;
  const broadcastChat = input.broadcastChat || broadcastHydratedChatUpdate;
  const client = await database.connect();
  let transferred = false;

  try {
    await client.query('BEGIN');
    const update = await client.query(
      `UPDATE chats
       SET agent_id = NULL,
           assigned_system_agent_id = NULL,
           is_autopilot_active = false,
           copilot_mode = 'off',
           status = 'gerais',
           assigned_at = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1
         AND workspace_id = $2
         AND assigned_system_agent_id = $3
         AND is_autopilot_active = true
         AND agent_id IS NULL
         AND status <> 'encerrados'
       RETURNING id`,
      [input.chatId, input.workspaceId, input.systemAgentId],
    );
    transferred = (update.rowCount ?? update.rows.length) > 0;

    if (transferred) {
      const event = input.reason === 'required_tool_failure'
        ? 'autopilot_required_tool_failure_handoff'
        : input.reason === 'uncertain_provider_delivery'
          ? 'autopilot_provider_delivery_uncertain'
          : 'autopilot_dead_letter';
      const note = input.reason === 'uncertain_provider_delivery'
        ? 'O provedor nao confirmou se a ultima resposta foi entregue. O reenvio automatico foi bloqueado para evitar duplicidade e o atendimento voltou para a fila humana.'
        : 'A automacao nao conseguiu concluir uma ferramenta obrigatoria. O atendimento foi devolvido para a fila humana.';
      await client.query(
        `INSERT INTO messages (
           workspace_id,
           chat_id,
           type,
           content,
           from_me,
           api_message_status,
           metadata,
           is_read,
           sender_system_agent_id,
           created_at
         )
         SELECT $1, $2, 'text', $3, true, 'internal', $4::jsonb, true, $5, clock_timestamp()
         WHERE NOT EXISTS (
           SELECT 1
           FROM messages existing
           WHERE existing.workspace_id = $1
             AND existing.chat_id = $2
             AND existing.metadata->>'event' = $6
             AND COALESCE(existing.metadata->>'sourceMessageId', '') = COALESCE($7, '')
         )`,
        [
          input.workspaceId,
          input.chatId,
          note,
          JSON.stringify({
            isInternalNote: true,
            isAiAnalysis: true,
            analysisKind: 'routing_context',
            sentBy: 'system_agent',
            event,
            sourceMessageId: input.sourceMessageId || undefined,
            failedToolNames: input.failedToolNames,
          }),
          input.systemAgentId,
          event,
          input.sourceMessageId || null,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (transferred) {
    await broadcastChat(input.workspaceId, input.chatId);
  }
  return transferred;
}
