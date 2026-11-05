import { db } from '@/lib/db';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';

const DEFAULT_QUEUE_AUTO_CLOSE_MS = 0;
const DEFAULT_MARKETING_AUTO_CLOSE_MS = 5 * 60 * 1000;

export async function getQueueAutoCloseMs(workspaceId: string): Promise<number> {
  try {
    const res = await db.query(
      'SELECT queue_auto_close_seconds FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if ((res.rowCount ?? 0) === 0) return DEFAULT_QUEUE_AUTO_CLOSE_MS;

    const raw = res.rows[0].queue_auto_close_seconds;
    if (raw === null || raw === undefined) return DEFAULT_QUEUE_AUTO_CLOSE_MS;

    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;

    return seconds * 1000;
  } catch (error) {
    console.error('[QUEUE_AUTO_CLOSE] Falha ao buscar configuracao:', error);
    return DEFAULT_QUEUE_AUTO_CLOSE_MS;
  }
}

export async function executeQueueAutoClose(params: {
  chatId: string;
  workspaceId: string;
  lastIncomingAt: Date;
  autoCloseMs: number;
}) {
  const { chatId, workspaceId, lastIncomingAt, autoCloseMs } = params;

  if (!autoCloseMs || autoCloseMs <= 0) return;

  const anchor = Number.isFinite(lastIncomingAt.getTime()) ? lastIncomingAt : new Date();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const chatRes = await client.query(
      `SELECT status, agent_id FROM chats WHERE id = $1 FOR UPDATE`,
      [chatId]
    );
    if ((chatRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const { status, agent_id } = chatRes.rows[0];
    if (status !== 'gerais' || agent_id) {
      await client.query('ROLLBACK');
      return;
    }

    const hasNewInbound = await client.query(
      `SELECT 1
       FROM messages
       WHERE chat_id = $1
         AND from_me = FALSE
         AND created_at > $2
       LIMIT 1`,
      [chatId, anchor.toISOString()]
    );

    if ((hasNewInbound.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return;
    }

    const queueRes = await client.query(
      `UPDATE chats
       SET status = 'gerais',
           closed_at = NULL,
           assigned_system_agent_id = NULL,
           assigned_at = NULL,
           is_autopilot_active = FALSE,
           copilot_mode = 'off',
           updated_at = clock_timestamp()
       WHERE id = $1
         AND status = 'gerais'
         AND agent_id IS NULL
       RETURNING id`,
      [chatId]
    );

    if ((queueRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const seconds = Math.max(1, Math.round(autoCloseMs / 1000));
    await client.query(
      `INSERT INTO messages (
          workspace_id, chat_id, type, content, from_me, is_read, metadata
       ) VALUES ($1, $2, 'system', $3, true, true, $4)`,
      [
        workspaceId,
        chatId,
        `Atendimento mantido na fila apos ${seconds} segundos sem atendimento.`,
        {
          event: 'queue_timeout_kept_in_queue',
          queueTimeoutMs: autoCloseMs,
          lastIncomingAt: anchor.toISOString(),
        },
      ]
    );

    await client.query('COMMIT');

    await broadcastHydratedChatUpdate(workspaceId, chatId);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[QUEUE_AUTO_CLOSE] Falha ao encerrar chat da fila:', error);
  } finally {
    client.release();
  }
}

export async function getMarketingAutoCloseMs(workspaceId: string): Promise<number> {
  try {
    const res = await db.query(
      'SELECT marketing_auto_close_seconds FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if ((res.rowCount ?? 0) === 0) return DEFAULT_MARKETING_AUTO_CLOSE_MS;

    const raw = res.rows[0].marketing_auto_close_seconds;
    if (raw === null || raw === undefined) return DEFAULT_MARKETING_AUTO_CLOSE_MS;

    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;

    return seconds * 1000;
  } catch (error) {
    console.error('[MARKETING_AUTO_CLOSE] Falha ao buscar configuracao, usando padrao:', error);
    return DEFAULT_MARKETING_AUTO_CLOSE_MS;
  }
}

// Recover schedules after restarts, including campaigns sent before isMarketing
// was persisted. The latest customer-facing message must still be marketing.
export async function runDueMarketingAutoCloses(limit = 25): Promise<number> {
  const due = await db.query(
    `SELECT c.id AS chat_id, c.workspace_id, latest.id AS marketing_message_id,
            COALESCE(recipient.sent_at, latest.created_at) AS marketing_sent_at,
            COALESCE(w.marketing_auto_close_seconds, 300) * 1000::bigint AS auto_close_ms
     FROM chats c
     JOIN workspaces w ON w.id = c.workspace_id
     CROSS JOIN LATERAL (
       SELECT m.id, m.from_me, m.created_at, m.metadata, m.api_message_status
       FROM messages m
       WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id
         AND m.type <> 'system'
         AND LOWER(COALESCE(m.api_message_status, '')) <> 'internal'
         AND COALESCE(m.metadata->>'isInternalNote', 'false') <> 'true'
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
     ) latest
     LEFT JOIN campaign_recipients recipient ON recipient.message_id = latest.id AND recipient.status = 'sent'
     WHERE c.status <> 'encerrados' AND c.agent_id IS NULL
       AND latest.from_me = TRUE
       AND (latest.metadata->>'isMarketing' = 'true' OR NULLIF(latest.metadata->>'campaignId', '') IS NOT NULL)
       AND UPPER(COALESCE(latest.api_message_status, '')) IN ('SENT', 'DELIVERED', 'DELIVERY_ACK', 'READ', 'PLAYED')
       AND COALESCE(w.marketing_auto_close_seconds, 300) > 0
       AND COALESCE(recipient.sent_at, latest.created_at) + COALESCE(w.marketing_auto_close_seconds, 300) * interval '1 second' <= clock_timestamp()
     ORDER BY COALESCE(recipient.sent_at, latest.created_at) ASC, c.id
     LIMIT $1`,
    [Math.max(1, Math.min(100, Math.floor(limit)))],
  );
  for (const row of due.rows) {
    await executeMarketingAutoClose({
      chatId: row.chat_id,
      workspaceId: row.workspace_id,
      marketingSentAt: new Date(row.marketing_sent_at),
      marketingMessageId: row.marketing_message_id,
      autoCloseMs: Number(row.auto_close_ms),
    });
  }
  return due.rows.length;
}

export async function executeMarketingAutoClose(params: {
  chatId: string;
  workspaceId: string;
  marketingSentAt: Date;
  marketingMessageId?: string;
  autoCloseMs: number;
}) {
  const { chatId, workspaceId, marketingSentAt, autoCloseMs } = params;

  if (!autoCloseMs || autoCloseMs <= 0) return;

  const anchor = Number.isFinite(marketingSentAt.getTime()) ? marketingSentAt : new Date();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const chatRes = await client.query(
      `SELECT status, agent_id FROM chats WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [chatId, workspaceId]
    );
    if ((chatRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const { status, agent_id } = chatRes.rows[0];
    if (status === 'encerrados' || agent_id) {
      await client.query('ROLLBACK');
      return;
    }

    // A reply or a newer customer-facing send invalidates this schedule. This
    // also prevents an older campaign timer from closing a new conversation.
    // Resolve the source timestamp in SQL to preserve PostgreSQL microseconds.
    const hasReply = await client.query(
      `SELECT 1
       FROM messages
       WHERE chat_id = $1
         AND created_at > COALESCE((
           SELECT source.created_at FROM messages source
           WHERE source.id = $3 AND source.chat_id = $1
         ), $2::timestamptz)
         AND (from_me = FALSE OR (
           type <> 'system'
           AND LOWER(COALESCE(api_message_status, '')) <> 'internal'
           AND COALESCE(metadata->>'isInternalNote', 'false') <> 'true'
         ))
       LIMIT 1`,
      [chatId, anchor.toISOString(), params.marketingMessageId || null]
    );

    if ((hasReply.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return;
    }

    const queueRes = await client.query(
      `UPDATE chats
       SET status = 'encerrados',
           closed_at = clock_timestamp(),
           assigned_system_agent_id = NULL,
           assigned_at = NULL,
           is_autopilot_active = FALSE,
           copilot_mode = 'off',
           updated_at = clock_timestamp()
       WHERE id = $1
         AND status <> 'encerrados'
         AND agent_id IS NULL
         AND clock_timestamp() >= $2::timestamptz + ($3::double precision * interval '1 millisecond')
       RETURNING id`,
      [chatId, anchor.toISOString(), autoCloseMs]
    );

    if ((queueRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return;
    }

    await client.query(
      `UPDATE meta_conversations SET status = 'closed', updated_at = clock_timestamp() WHERE chat_id = $1`,
      [chatId]
    );
    await client.query(
      `UPDATE workflow_executions SET status = 'cancelled', updated_at = clock_timestamp()
       WHERE workspace_id = $1 AND (conversation_id = $2 OR session_id = $2)
         AND status IN ('waiting', 'queued')`,
      [workspaceId, chatId]
    );

    const seconds = Math.max(1, Math.round(autoCloseMs / 1000));
    const humanDelay = seconds >= 60
      ? `${Math.round(seconds / 60)} minutos`
      : `${seconds} segundos`;

    await client.query(
      `INSERT INTO messages (
          workspace_id, chat_id, type, content, from_me, is_read, metadata
       ) VALUES ($1, $2, 'system', $3, true, true, $4)`,
      [
        workspaceId,
        chatId,
        `Atendimento encerrado automaticamente apos ${humanDelay} sem resposta a mensagem de marketing.`,
        {
          event: 'marketing_auto_close',
          isMarketing: true,
          autoCloseMs,
          marketingSentAt: anchor.toISOString(),
        },
      ]
    );

    await client.query('COMMIT');

    await broadcastHydratedChatUpdate(workspaceId, chatId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[MARKETING_AUTO_CLOSE] Falha ao encerrar automaticamente:', error);
    throw error;
  } finally {
    client.release();
  }
}
