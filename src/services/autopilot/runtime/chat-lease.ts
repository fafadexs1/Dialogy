import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';

type LeaseDatabase = {
  query: (query: string, params?: unknown[]) => Promise<{
    rows: any[];
    rowCount?: number | null;
  }>;
};

export type AutopilotChatLease = {
  status: 'acquired' | 'superseded' | 'timeout';
  ownerToken: string | null;
  waitedMs: number;
  release: () => Promise<void>;
};

export class AutopilotChatLeaseTimeoutError extends Error {
  readonly code = 'AUTOPILOT_CHAT_LEASE_TIMEOUT';
  readonly retryable = true;

  constructor(chatId: string, waitedMs: number) {
    super(`Timed out after ${waitedMs}ms waiting for exclusive autopilot processing of chat ${chatId}.`);
    this.name = 'AutopilotChatLeaseTimeoutError';
  }
}

type AcquireAutopilotChatLeaseInput = {
  workspaceId: string;
  chatId: string;
  sourceMessageId?: string | null;
  leaseMs?: number;
  waitMs?: number;
  pollMs?: number;
  database?: LeaseDatabase;
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sourceMessageWasSuperseded(input: {
  database: LeaseDatabase;
  chatId: string;
  sourceMessageId?: string | null;
}): Promise<boolean> {
  if (!input.sourceMessageId) return false;
  const { rows } = await input.database.query(
    `WITH source_message AS (
       SELECT created_at
       FROM messages
       WHERE id = $1
         AND chat_id = $2
         AND from_me = false
       LIMIT 1
     )
     SELECT
       NOT EXISTS(SELECT 1 FROM source_message)
       OR EXISTS(
         SELECT 1
         FROM messages m
         JOIN source_message sm ON true
         WHERE m.chat_id = $2
           AND m.from_me = false
           AND m.id <> $1
           AND m.created_at >= sm.created_at
       ) AS superseded`,
    [input.sourceMessageId, input.chatId],
  );
  return Boolean(rows[0]?.superseded);
}

export async function hasCompletedAutopilotSourceMessage(input: {
  workspaceId: string;
  chatId: string;
  sourceMessageId?: string | null;
  database?: LeaseDatabase;
}): Promise<boolean> {
  if (!input.sourceMessageId) return false;
  const database = input.database || db;
  const { rows } = await database.query(
    `SELECT 1
     FROM orchestrator_runs run
     WHERE run.workspace_id = $1
       AND run.chat_id = $2
       AND run.source_message_id = $3
       AND run.status IN ('success', 'fallback', 'skipped')
       AND (
         COALESCE(run.metadata->>'workflowHandoffCompleted', 'false') = 'true'
         OR EXISTS (
           SELECT 1
           FROM messages response
           WHERE response.workspace_id = $1
             AND response.chat_id = $2
             AND response.from_me = true
             AND response.metadata->>'autopilotSourceMessageId' = $3::text
             AND COALESCE(upper(response.api_message_status), '') NOT IN ('FAILED', 'ERROR')
         )
       )
     LIMIT 1`,
    [input.workspaceId, input.chatId, input.sourceMessageId],
  );
  return rows.length > 0;
}

export async function acquireAutopilotChatLease(
  input: AcquireAutopilotChatLeaseInput,
): Promise<AutopilotChatLease> {
  const database = input.database || db;
  const ownerToken = randomUUID();
  const leaseMs = boundedInteger(
    input.leaseMs ?? process.env.AUTOPILOT_CHAT_LEASE_MS,
    10 * 60_000,
    30_000,
    30 * 60_000,
  );
  const waitMs = boundedInteger(
    input.waitMs ?? process.env.AUTOPILOT_CHAT_LEASE_WAIT_MS,
    90_000,
    0,
    10 * 60_000,
  );
  const pollMs = boundedInteger(
    input.pollMs ?? process.env.AUTOPILOT_CHAT_LEASE_POLL_MS,
    250,
    10,
    5_000,
  );
  const startedAt = Date.now();

  while (true) {
    const { rows } = await database.query(
      `INSERT INTO autopilot_chat_leases (
         chat_id,
         workspace_id,
         owner_token,
         source_message_id,
         acquired_at,
         heartbeat_at,
         expires_at
       ) VALUES (
         $1, $2, $3, $4, clock_timestamp(), clock_timestamp(),
         clock_timestamp() + ($5::int * interval '1 millisecond')
       )
       ON CONFLICT (chat_id) DO UPDATE
       SET workspace_id = EXCLUDED.workspace_id,
           owner_token = EXCLUDED.owner_token,
           source_message_id = EXCLUDED.source_message_id,
           acquired_at = clock_timestamp(),
           heartbeat_at = clock_timestamp(),
           expires_at = clock_timestamp() + ($5::int * interval '1 millisecond')
       WHERE autopilot_chat_leases.expires_at <= clock_timestamp()
          OR autopilot_chat_leases.owner_token = EXCLUDED.owner_token
       RETURNING owner_token`,
      [
        input.chatId,
        input.workspaceId,
        ownerToken,
        input.sourceMessageId || null,
        leaseMs,
      ],
    );

    if (rows[0]?.owner_token === ownerToken) {
      let released = false;
      let heartbeatRunning = false;
      const heartbeatMs = Math.max(10_000, Math.min(60_000, Math.floor(leaseMs / 3)));
      const heartbeat = setInterval(async () => {
        if (released || heartbeatRunning) return;
        heartbeatRunning = true;
        try {
          await database.query(
            `UPDATE autopilot_chat_leases
             SET heartbeat_at = clock_timestamp(),
                 expires_at = clock_timestamp() + ($3::int * interval '1 millisecond')
             WHERE chat_id = $1
               AND owner_token = $2`,
            [input.chatId, ownerToken, leaseMs],
          );
        } catch (error) {
          console.error('[AUTOPILOT_CHAT_LEASE] Heartbeat failed:', error);
        } finally {
          heartbeatRunning = false;
        }
      }, heartbeatMs);
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      return {
        status: 'acquired',
        ownerToken,
        waitedMs: Date.now() - startedAt,
        release: async () => {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          await database.query(
            `DELETE FROM autopilot_chat_leases
             WHERE chat_id = $1
               AND owner_token = $2`,
            [input.chatId, ownerToken],
          );
        },
      };
    }

    if (await sourceMessageWasSuperseded({
      database,
      chatId: input.chatId,
      sourceMessageId: input.sourceMessageId,
    })) {
      return {
        status: 'superseded',
        ownerToken: null,
        waitedMs: Date.now() - startedAt,
        release: async () => undefined,
      };
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= waitMs) {
      return {
        status: 'timeout',
        ownerToken: null,
        waitedMs: elapsed,
        release: async () => undefined,
      };
    }
    await sleep(Math.min(pollMs, waitMs - elapsed));
  }
}
