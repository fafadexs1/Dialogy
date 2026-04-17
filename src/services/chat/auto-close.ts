import { db } from '@/lib/db';
import { enqueueAiCaseMemoryRefresh, shouldEnqueueJob } from '@/lib/queue';

const DEFAULT_QUEUE_AUTO_CLOSE_MS = 0;
const DEFAULT_MARKETING_AUTO_CLOSE_MS = 5 * 60 * 1000;

async function enqueueCaseMemoryRefreshAfterClose(params: {
  workspaceId: string;
  chatId: string;
  closedAt: string | null;
  logPrefix: string;
}) {
  const { workspaceId, chatId, closedAt, logPrefix } = params;

  if (!shouldEnqueueJob('ai_case_memory_refresh')) {
    console.warn(`${logPrefix} Refresh de memoria de caso ignorado: fila ai_case_memory_refresh desabilitada.`);
    return;
  }

  await enqueueAiCaseMemoryRefresh({
    workspaceId,
    chatId,
    closedAt,
  });
}

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

    const closeRes = await client.query(
      `UPDATE chats
       SET status = 'encerrados', closed_at = NOW()
       WHERE id = $1
         AND status = 'gerais'
         AND agent_id IS NULL
       RETURNING closed_at`,
      [chatId]
    );

    if ((closeRes.rowCount ?? 0) === 0) {
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
        `Atendimento encerrado automaticamente apos ${seconds} segundos na fila sem atendimento.`,
        {
          event: 'queue_auto_close',
          autoClosedAfterMs: autoCloseMs,
          lastIncomingAt: anchor.toISOString(),
        },
      ]
    );

    await client.query('COMMIT');

    const closedAt = closeRes.rows[0]?.closed_at
      ? new Date(closeRes.rows[0].closed_at).toISOString()
      : null;

    try {
      await enqueueCaseMemoryRefreshAfterClose({
        workspaceId,
        chatId,
        closedAt,
        logPrefix: '[QUEUE_AUTO_CLOSE]',
      });
    } catch (caseMemoryError) {
      console.error('[QUEUE_AUTO_CLOSE] Falha ao atualizar memoria de caso:', caseMemoryError);
    }
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

export async function executeMarketingAutoClose(params: {
  chatId: string;
  workspaceId: string;
  marketingSentAt: Date;
  autoCloseMs: number;
}) {
  const { chatId, workspaceId, marketingSentAt, autoCloseMs } = params;

  if (!autoCloseMs || autoCloseMs <= 0) return;

  const anchor = Number.isFinite(marketingSentAt.getTime()) ? marketingSentAt : new Date();
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
    if (status === 'encerrados' || agent_id) {
      await client.query('ROLLBACK');
      return;
    }

    const hasReply = await client.query(
      `SELECT 1
       FROM messages
       WHERE chat_id = $1
         AND from_me = FALSE
         AND created_at > $2
       LIMIT 1`,
      [chatId, anchor.toISOString()]
    );

    if ((hasReply.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return;
    }

    const closeRes = await client.query(
      `UPDATE chats
       SET status = 'encerrados', closed_at = NOW()
       WHERE id = $1
       RETURNING closed_at`,
      [chatId]
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
          autoClosedAfterMs: autoCloseMs,
          marketingSentAt: anchor.toISOString(),
        },
      ]
    );

    await client.query('COMMIT');

    const closedAt = closeRes.rows[0]?.closed_at
      ? new Date(closeRes.rows[0].closed_at).toISOString()
      : null;

    try {
      await enqueueCaseMemoryRefreshAfterClose({
        workspaceId,
        chatId,
        closedAt,
        logPrefix: '[MARKETING_AUTO_CLOSE]',
      });
    } catch (caseMemoryError) {
      console.error('[MARKETING_AUTO_CLOSE] Falha ao atualizar memoria de caso:', caseMemoryError);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MARKETING_AUTO_CLOSE] Falha ao encerrar automaticamente:', error);
  } finally {
    client.release();
  }
}
