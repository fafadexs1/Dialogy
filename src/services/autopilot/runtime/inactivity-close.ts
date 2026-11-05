import { db } from '@/lib/db';
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

type PersistedInactivitySchedule = Required<Omit<ScheduleAutopilotInactivityCloseInput, 'timeoutSeconds'>> & {
  timeoutSeconds: number;
};

const INACTIVITY_SCHEDULE_CLAIM_MS = 120_000;
const INACTIVITY_SCHEDULE_POLL_MS = 5_000;
let inactivitySchedulePoller: ReturnType<typeof setInterval> | null = null;

function normalizeTimeoutSeconds(value?: number | null): number {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 0;
  return Math.min(2_592_000, Math.max(1, Math.round(Number(value))));
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

    const queueRes = await client.query(
        `UPDATE chats
         SET status = 'gerais',
             closed_at = NULL,
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
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[AUTOPILOT_INACTIVITY_CLOSE] Falha ao encerrar chat por inatividade:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function persistInactivitySchedule(input: PersistedInactivitySchedule) {
  const dueAt = new Date(input.anchorAt.getTime() + (input.timeoutSeconds * 1000));
  await db.query(
    `INSERT INTO autopilot_inactivity_schedules (
       chat_id, workspace_id, autopilot_config_id, system_agent_id,
       timeout_seconds, anchor_at, due_at, source_message_id, orchestrator_run_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (chat_id) DO UPDATE
     SET workspace_id = EXCLUDED.workspace_id,
         autopilot_config_id = EXCLUDED.autopilot_config_id,
         system_agent_id = EXCLUDED.system_agent_id,
         timeout_seconds = EXCLUDED.timeout_seconds,
         anchor_at = EXCLUDED.anchor_at,
         due_at = EXCLUDED.due_at,
         source_message_id = EXCLUDED.source_message_id,
         orchestrator_run_id = EXCLUDED.orchestrator_run_id,
         locked_until = NULL,
         attempts = 0,
         last_error = NULL,
         updated_at = clock_timestamp()`,
    [
      input.chatId,
      input.workspaceId,
      input.autopilotConfigId,
      input.systemAgentId,
      input.timeoutSeconds,
      input.anchorAt.toISOString(),
      dueAt.toISOString(),
      input.sourceMessageId,
      input.orchestratorRunId,
    ],
  );
}

async function finalizeInactivitySchedule(input: PersistedInactivitySchedule) {
  await db.query(
    `DELETE FROM autopilot_inactivity_schedules
     WHERE chat_id = $1 AND anchor_at = $2`,
    [input.chatId, input.anchorAt.toISOString()],
  );
}

async function executePersistedInactivitySchedule(input: PersistedInactivitySchedule) {
  try {
    await executeAutopilotInactivityClose(input);
    await finalizeInactivitySchedule(input);
  } catch (error) {
    await db.query(
      `UPDATE autopilot_inactivity_schedules
       SET locked_until = NULL,
           last_error = LEFT($3, 2000),
           updated_at = clock_timestamp()
       WHERE chat_id = $1 AND anchor_at = $2`,
      [
        input.chatId,
        input.anchorAt.toISOString(),
        error instanceof Error ? error.message : String(error),
      ],
    ).catch(() => undefined);
  }
}

export async function runDueAutopilotInactivityCloses(limit = 25): Promise<number> {
  const claimed = await db.query(
    `WITH due AS (
       SELECT chat_id
       FROM autopilot_inactivity_schedules
       WHERE due_at <= clock_timestamp()
         AND (locked_until IS NULL OR locked_until <= clock_timestamp())
       ORDER BY due_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE autopilot_inactivity_schedules schedules
     SET locked_until = clock_timestamp() + ($2::text || ' milliseconds')::interval,
         attempts = schedules.attempts + 1,
         updated_at = clock_timestamp()
     FROM due
     WHERE schedules.chat_id = due.chat_id
     RETURNING schedules.*`,
    [Math.max(1, Math.min(100, Math.floor(limit))), INACTIVITY_SCHEDULE_CLAIM_MS],
  );

  await Promise.all(claimed.rows.map((row) => executePersistedInactivitySchedule({
    workspaceId: String(row.workspace_id),
    chatId: String(row.chat_id),
    autopilotConfigId: String(row.autopilot_config_id),
    systemAgentId: String(row.system_agent_id),
    timeoutSeconds: Number(row.timeout_seconds),
    anchorAt: new Date(row.anchor_at),
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    orchestratorRunId: row.orchestrator_run_id ? String(row.orchestrator_run_id) : null,
  })));
  return claimed.rows.length;
}

function ensureInactivitySchedulePoller() {
  if (inactivitySchedulePoller || process.env.NODE_ENV === 'test') return;
  inactivitySchedulePoller = setInterval(() => {
    void runDueAutopilotInactivityCloses().catch((error) => {
      console.error('[AUTOPILOT_INACTIVITY_CLOSE] Falha ao recuperar agendas vencidas:', error);
    });
  }, INACTIVITY_SCHEDULE_POLL_MS);
  const maybePoller = inactivitySchedulePoller as unknown as { unref?: () => void };
  if (typeof maybePoller.unref === 'function') maybePoller.unref();
}

export async function scheduleAutopilotInactivityClose(input: ScheduleAutopilotInactivityCloseInput) {
  const timeoutSeconds = normalizeTimeoutSeconds(input.timeoutSeconds);
  if (timeoutSeconds <= 0) return;
  const anchorAt = input.anchorAt || new Date();
  const persistedInput: PersistedInactivitySchedule = {
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    autopilotConfigId: input.autopilotConfigId,
    systemAgentId: input.systemAgentId,
    timeoutSeconds,
    anchorAt,
    sourceMessageId: input.sourceMessageId || null,
    orchestratorRunId: input.orchestratorRunId || null,
  };
  try {
    await persistInactivitySchedule(persistedInput);
  } catch (error) {
    console.error('[AUTOPILOT_INACTIVITY_CLOSE] Falha ao persistir agenda; usando fallback local:', error);
    const fallbackDelay = Math.min(timeoutSeconds * 1000, 2_147_000_000);
    const fallback = setTimeout(() => {
      void executeAutopilotInactivityClose(persistedInput).catch(() => undefined);
    }, fallbackDelay);
    const maybeFallback = fallback as unknown as { unref?: () => void };
    if (typeof maybeFallback.unref === 'function') maybeFallback.unref();
    return;
  }
  ensureInactivitySchedulePoller();
}

ensureInactivitySchedulePoller();
