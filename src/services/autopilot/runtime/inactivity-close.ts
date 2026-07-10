import { db } from '@/lib/db';
import { enqueueAiCaseMemoryRefresh, shouldEnqueueJob } from '@/lib/queue';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';

type ScheduleAutopilotInactivityCloseInput = {
  workspaceId: string;
  chatId: string;
  autopilotConfigId: string;
  systemAgentId: string;
  timeoutSeconds?: number | null;
  anchorAt?: Date;
  sourceMessageId?: string | null;
  orchestratorRunId?: string | null;
};

function normalizeTimeoutSeconds(value?: number | null): number {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 0;
  return Math.min(2_592_000, Math.max(1, Math.round(Number(value))));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type RecentVisibleMessage = {
  from_me: boolean;
  sender_system_agent_id?: string | null;
  content?: string | null;
};

function messageClearlyEndsConversation(content: string): boolean {
  const text = normalizeText(content);
  return (
    /\b(vou|iremos|vamos)\s+encerrar\b/.test(text) ||
    /\b(atendimento|conversa|chat)\s+(?:foi\s+)?encerrad[oa]\b/.test(text) ||
    /\bobrigad[oa]\s+pelo\s+contato\b/.test(text) ||
    /\bfinaliz(?:o|amos|ado|ada)\s+(?:o\s+)?atendimento\b/.test(text)
  );
}

function messageAwaitsCustomerReturn(content: string): boolean {
  const text = normalizeText(content);
  if (!text) return false;
  if (messageClearlyEndsConversation(content)) return false;

  return (
    /[?]/.test(content) ||
    /\b(me\s+informe|informe|envie|manda|me\s+manda|me\s+passe|passe|responda|confirme|confirmar|aguardo|fico\s+no\s+aguardo)\b/.test(text) ||
    /\b(qual|quais|quando|onde|como|pode\s+me\s+dizer|preciso\s+(?:do|da|de|que)|vou\s+precisar\s+(?:do|da|de))\b/.test(text) ||
    /\b(cpf|cnpj|documento|endereco|endereco|bairro|cidade|numero|referencia|nome\s+completo|telefone|whatsapp|plano|data|horario)\b/.test(text)
  );
}

function shouldReturnToQueueForInactivity(input: {
  recentMessages: RecentVisibleMessage[];
  systemAgentId: string;
}): boolean {
  const lastVisible = input.recentMessages.find((message) => String(message.content || '').trim());
  if (!lastVisible) return true;
  if (!lastVisible.from_me) return true;
  if (lastVisible.sender_system_agent_id && lastVisible.sender_system_agent_id !== input.systemAgentId) {
    return false;
  }

  const content = String(lastVisible.content || '');
  if (messageAwaitsCustomerReturn(content)) return true;
  return !messageClearlyEndsConversation(content);
}

async function enqueueCaseMemoryRefresh(input: {
  workspaceId: string;
  chatId: string;
  closedAt: string | null;
}) {
  if (!shouldEnqueueJob('ai_case_memory_refresh')) return;
  await enqueueAiCaseMemoryRefresh({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    closedAt: input.closedAt,
  });
}

export async function executeAutopilotInactivityClose(input: Required<Omit<ScheduleAutopilotInactivityCloseInput, 'timeoutSeconds'>> & {
  timeoutSeconds: number;
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const chatRes = await client.query(
      `SELECT status, agent_id, assigned_system_agent_id, autopilot_config_id, is_autopilot_active, closed_at
       FROM chats
       WHERE id = $1
       FOR UPDATE`,
      [input.chatId],
    );
    if ((chatRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const chat = chatRes.rows[0];
    if (
      chat.closed_at ||
      chat.status === 'encerrados' ||
      chat.agent_id ||
      chat.assigned_system_agent_id !== input.systemAgentId ||
      chat.autopilot_config_id !== input.autopilotConfigId ||
      chat.is_autopilot_active !== true
    ) {
      await client.query('ROLLBACK');
      return;
    }

    const anchorIso = input.anchorAt.toISOString();
    const newerActivity = await client.query(
      `SELECT 1
       FROM messages
       WHERE chat_id = $1
         AND created_at > $2
         AND (
           from_me = false
           OR (
             from_me = true
             AND sender_system_agent_id = $3
             AND type <> 'system'
             AND COALESCE(api_message_status, '') <> 'internal'
           )
         )
       LIMIT 1`,
      [input.chatId, anchorIso, input.systemAgentId],
    );
    if ((newerActivity.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return;
    }

    const recentMessagesRes = await client.query(
      `SELECT from_me, sender_system_agent_id, content
       FROM messages
       WHERE chat_id = $1
         AND type <> 'system'
         AND COALESCE(api_message_status, '') <> 'internal'
       ORDER BY created_at DESC
       LIMIT 12`,
      [input.chatId],
    );
    const shouldQueue = shouldReturnToQueueForInactivity({
      recentMessages: recentMessagesRes.rows,
      systemAgentId: input.systemAgentId,
    });

    if (shouldQueue) {
      const queueRes = await client.query(
        `UPDATE chats
         SET status = 'gerais',
             assigned_system_agent_id = NULL,
             is_autopilot_active = false,
             copilot_mode = 'off',
             assigned_at = NULL,
             updated_at = clock_timestamp()
         WHERE id = $1
           AND status <> 'encerrados'
           AND agent_id IS NULL
           AND assigned_system_agent_id = $2
           AND autopilot_config_id = $3
         RETURNING id`,
        [input.chatId, input.systemAgentId, input.autopilotConfigId],
      );
      if ((queueRes.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return;
      }

      await client.query(
        `INSERT INTO messages (
           workspace_id, chat_id, sender_system_agent_id, type, content, from_me, is_read, api_message_status, metadata
         ) VALUES ($1, $2, $3, 'system', $4, true, true, 'internal', $5)`,
        [
          input.workspaceId,
          input.chatId,
          input.systemAgentId,
          `Atendimento devolvido automaticamente para a fila apos ${input.timeoutSeconds} segundos de inatividade enquanto a IA aguardava retorno do cliente.`,
          {
            event: 'autopilot_inactivity_queue_handoff',
            timeoutSeconds: input.timeoutSeconds,
            anchorAt: anchorIso,
            sourceMessageId: input.sourceMessageId,
            orchestratorRunId: input.orchestratorRunId,
          },
        ],
      );

      await client.query('COMMIT');
      await broadcastHydratedChatUpdate(input.workspaceId, input.chatId).catch((error) => {
        console.error('[AUTOPILOT_INACTIVITY_CLOSE] Falha ao transmitir retorno para fila:', error);
      });
      return;
    }

    const closeRes = await client.query(
      `UPDATE chats
       SET status = 'encerrados',
           closed_at = NOW(),
           is_autopilot_active = false
       WHERE id = $1
         AND status <> 'encerrados'
         AND agent_id IS NULL
         AND assigned_system_agent_id = $2
         AND autopilot_config_id = $3
       RETURNING closed_at`,
      [input.chatId, input.systemAgentId, input.autopilotConfigId],
    );
    if ((closeRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return;
    }

    await client.query(
      `INSERT INTO messages (
         workspace_id, chat_id, sender_system_agent_id, type, content, from_me, is_read, api_message_status, metadata
       ) VALUES ($1, $2, $3, 'system', $4, true, true, 'internal', $5)`,
      [
        input.workspaceId,
        input.chatId,
        input.systemAgentId,
        `Atendimento encerrado automaticamente apos ${input.timeoutSeconds} segundos de inatividade.`,
        {
          event: 'autopilot_inactivity_close',
          timeoutSeconds: input.timeoutSeconds,
          anchorAt: anchorIso,
          sourceMessageId: input.sourceMessageId,
          orchestratorRunId: input.orchestratorRunId,
        },
      ],
    );

    await client.query('COMMIT');

    const closedAt = closeRes.rows[0]?.closed_at
      ? new Date(closeRes.rows[0].closed_at).toISOString()
      : null;
    await enqueueCaseMemoryRefresh({
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      closedAt,
    }).catch((error) => {
      console.error('[AUTOPILOT_INACTIVITY_CLOSE] Falha ao enfileirar memoria de caso:', error);
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[AUTOPILOT_INACTIVITY_CLOSE] Falha ao encerrar chat por inatividade:', error);
  } finally {
    client.release();
  }
}

export function scheduleAutopilotInactivityClose(input: ScheduleAutopilotInactivityCloseInput) {
  const timeoutSeconds = normalizeTimeoutSeconds(input.timeoutSeconds);
  if (timeoutSeconds <= 0) return;
  const anchorAt = input.anchorAt || new Date();
  const handle = setTimeout(() => {
    void executeAutopilotInactivityClose({
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      autopilotConfigId: input.autopilotConfigId,
      systemAgentId: input.systemAgentId,
      timeoutSeconds,
      anchorAt,
      sourceMessageId: input.sourceMessageId || null,
      orchestratorRunId: input.orchestratorRunId || null,
    });
  }, timeoutSeconds * 1000);

  const maybeHandle = handle as unknown as { unref?: () => void };
  if (typeof maybeHandle.unref === 'function') maybeHandle.unref();
}
