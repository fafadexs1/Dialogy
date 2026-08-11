import { db } from '@/lib/db';

type ResponseDeliveryDatabase = {
  query: (query: string, params?: unknown[]) => Promise<{
    rows: any[];
    rowCount?: number | null;
  }>;
};

export type AutopilotResponseTrace = {
  workspaceId: string;
  sourceMessageId?: string | null;
  orchestratorRunId?: string | null;
  deliveryKey?: string;
};

export type PreparedAutopilotResponseDelivery = {
  id: string;
  blocks: string[];
  deliveredBlockIndexes: Set<number>;
  uncertainBlockIndexes: Set<number>;
  status: 'pending' | 'sending' | 'sent' | 'error';
};

function normalizeDeliveryKey(value: unknown): string {
  const normalized = String(value || 'primary')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'primary';
}

function parseBlocks(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((block): block is string => typeof block === 'string')
    .map((block) => block.trim())
    .filter(Boolean);
}

export async function prepareAutopilotResponseDelivery(input: {
  trace: AutopilotResponseTrace;
  chatId: string;
  blocks: string[];
  database?: ResponseDeliveryDatabase;
}): Promise<PreparedAutopilotResponseDelivery | null> {
  if (!input.trace.sourceMessageId || input.blocks.length === 0) return null;
  const database = input.database || db;
  const deliveryKey = normalizeDeliveryKey(input.trace.deliveryKey);
  const { rows } = await database.query(
    `INSERT INTO autopilot_response_deliveries (
       workspace_id,
       chat_id,
       source_message_id,
       orchestrator_run_id,
       delivery_key,
       blocks,
       status
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
     ON CONFLICT (source_message_id, delivery_key) DO UPDATE
     SET orchestrator_run_id = COALESCE(
           autopilot_response_deliveries.orchestrator_run_id,
           EXCLUDED.orchestrator_run_id
         ),
         updated_at = clock_timestamp()
     RETURNING id, blocks, status`,
    [
      input.trace.workspaceId,
      input.chatId,
      input.trace.sourceMessageId,
      input.trace.orchestratorRunId || null,
      deliveryKey,
      JSON.stringify(input.blocks),
    ],
  );
  const row = rows[0];
  if (!row?.id) {
    throw new Error(
      `Could not prepare durable autopilot response for source message ${input.trace.sourceMessageId}.`,
    );
  }

  const storedBlocks = parseBlocks(row.blocks);
  if (storedBlocks.length === 0) {
    throw new Error(`Durable autopilot response ${row.id} has no valid message blocks.`);
  }

  const attempts = await database.query(
    `SELECT metadata->>'autopilotResponseBlockIndex' AS block_index,
            upper(COALESCE(api_message_status, '')) AS message_status
     FROM messages
     WHERE chat_id = $1
       AND from_me = true
       AND metadata->>'autopilotResponseDeliveryId' = $2`,
    [input.chatId, row.id],
  );
  const deliveredBlockIndexes = new Set<number>();
  const uncertainBlockIndexes = new Set<number>();
  const acceptedStatuses = new Set(['SENT', 'DELIVERY_ACK', 'DELIVERED', 'READ', 'PLAYED']);
  const rejectedStatuses = new Set(['FAILED', 'ERROR']);
  for (const attempt of attempts.rows) {
    const blockIndex = Number(attempt.block_index);
    if (Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < storedBlocks.length) {
      const status = String(attempt.message_status || '').trim().toUpperCase();
      if (acceptedStatuses.has(status)) {
        deliveredBlockIndexes.add(blockIndex);
        uncertainBlockIndexes.delete(blockIndex);
      } else if (!rejectedStatuses.has(status) && !deliveredBlockIndexes.has(blockIndex)) {
        // A persisted attempt without a definitive receipt may already have
        // reached the provider before the worker crashed. Never resend it
        // automatically until a receipt or explicit rejection resolves it.
        uncertainBlockIndexes.add(blockIndex);
      }
    }
  }

  if (deliveredBlockIndexes.size === storedBlocks.length && row.status !== 'sent') {
    await database.query(
      `UPDATE autopilot_response_deliveries
       SET status = 'sent',
           next_block_index = $2,
           last_error = NULL,
           completed_at = COALESCE(completed_at, clock_timestamp()),
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [row.id, storedBlocks.length],
    );
  }

  return {
    id: String(row.id),
    blocks: storedBlocks,
    deliveredBlockIndexes,
    uncertainBlockIndexes,
    status: deliveredBlockIndexes.size === storedBlocks.length
      ? 'sent'
      : row.status,
  };
}

export async function markAutopilotResponseBlockSending(input: {
  deliveryId: string;
  blockIndex: number;
  database?: ResponseDeliveryDatabase;
}): Promise<void> {
  const database = input.database || db;
  await database.query(
    `UPDATE autopilot_response_deliveries
     SET status = 'sending',
         next_block_index = GREATEST(next_block_index, $2),
         last_error = NULL,
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [input.deliveryId, input.blockIndex],
  );
}

export async function markAutopilotResponseBlockDelivered(input: {
  deliveryId: string;
  blockIndex: number;
  blockCount: number;
  database?: ResponseDeliveryDatabase;
}): Promise<void> {
  const database = input.database || db;
  const nextBlockIndex = input.blockIndex + 1;
  const completed = nextBlockIndex >= input.blockCount;
  await database.query(
    `UPDATE autopilot_response_deliveries
     SET status = CASE WHEN $3 THEN 'sent' ELSE 'sending' END,
         next_block_index = GREATEST(next_block_index, $2),
         last_error = NULL,
         completed_at = CASE
           WHEN $3 THEN COALESCE(completed_at, clock_timestamp())
           ELSE completed_at
         END,
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [input.deliveryId, nextBlockIndex, completed],
  );
}

export async function markAutopilotResponseDeliveryError(input: {
  deliveryId: string;
  error: unknown;
  database?: ResponseDeliveryDatabase;
}): Promise<void> {
  const database = input.database || db;
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await database.query(
    `UPDATE autopilot_response_deliveries
     SET status = 'error',
         last_error = LEFT($2, 2000),
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [input.deliveryId, message],
  );
}
