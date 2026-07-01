import { db } from '@/lib/db';

type StaleSourceDatabase = {
  query: (query: string, params?: unknown[]) => Promise<{
    rows: any[];
    rowCount?: number | null;
  }>;
};

export class AutopilotSourceSupersededError extends Error {
  readonly code = 'AUTOPILOT_SOURCE_SUPERSEDED';
  readonly retryable = false;

  constructor(chatId: string, sourceMessageId: string) {
    super(
      `Source message ${sourceMessageId} is no longer the current customer message for chat ${chatId}.`,
    );
    this.name = 'AutopilotSourceSupersededError';
  }
}

export async function isAutopilotSourceMessageStillCurrent(input: {
  chatId: string;
  sourceMessageId?: string | null;
  database?: StaleSourceDatabase;
}): Promise<boolean> {
  if (!input.sourceMessageId) return true;
  const database = input.database || db;

  try {
    const { rows } = await database.query(
      `WITH source_message AS (
         SELECT id, created_at
         FROM messages
         WHERE id = $1
           AND chat_id = $2
           AND from_me = false
         LIMIT 1
       ),
       newer_customer_message AS (
         SELECT 1
         FROM messages m
         JOIN source_message source ON true
         WHERE m.chat_id = $2
           AND m.from_me = false
           AND m.created_at >= source.created_at
           AND m.id <> source.id
         LIMIT 1
       )
       SELECT
         EXISTS(SELECT 1 FROM source_message) AS source_exists,
         EXISTS(SELECT 1 FROM newer_customer_message) AS has_newer_customer_message`,
      [input.sourceMessageId, input.chatId],
    );
    const row = rows[0];
    return Boolean(row?.source_exists) && !Boolean(row?.has_newer_customer_message);
  } catch (error) {
    console.error('[AUTOPILOT_STALE_GUARD] Failed to verify source message:', error);
    return false;
  }
}

export async function assertAutopilotSourceMessageCurrent(input: {
  chatId: string;
  sourceMessageId?: string | null;
  database?: StaleSourceDatabase;
}): Promise<void> {
  if (!input.sourceMessageId) return;
  const current = await isAutopilotSourceMessageStillCurrent(input);
  if (!current) {
    throw new AutopilotSourceSupersededError(input.chatId, input.sourceMessageId);
  }
}
