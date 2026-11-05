import { createHash } from 'crypto';

import { db } from '@/lib/db';

export type EvolutionWebhookEventStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'dead_letter';

export type EvolutionWebhookInboxEvent = {
  id: string;
  workspaceId: string;
  instanceName: string;
  eventName: string;
  dedupKey: string;
  payload: Record<string, unknown>;
  status: EvolutionWebhookEventStatus;
  attemptCount: number;
  maxAttempts: number;
};

type Queryable = {
  query: (query: string, params?: unknown[]) => Promise<{
    rows: any[];
    rowCount?: number | null;
  }>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      if (!key.startsWith('__')) {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
      }
      return result;
    }, {});
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function deriveEvolutionWebhookDedupKey(input: {
  eventName: string;
  payload: Record<string, any>;
}): string {
  const eventName = input.eventName.trim().toLowerCase();
  const payload = input.payload;
  const data = payload?.data;
  const externalId = firstNonEmpty(
    data?.key?.id,
    data?.id,
    data?.keyId,
    data?.messageId,
  );

  if (externalId && eventName === 'messages.upsert') {
    return `message:${externalId}`;
  }
  if (externalId && eventName === 'messages.update') {
    const status = firstNonEmpty(data?.status, data?.update?.status) || 'unknown';
    return `message:${externalId}:status:${status.toUpperCase()}`;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
  return `sha256:${digest}`;
}

function mapRow(row: any): EvolutionWebhookInboxEvent {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    instanceName: String(row.instance_name),
    eventName: String(row.event_name),
    dedupKey: String(row.dedup_key),
    payload: (row.payload || {}) as Record<string, unknown>,
    status: row.status as EvolutionWebhookEventStatus,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 5),
  };
}

export async function persistEvolutionWebhookEvent(input: {
  workspaceId: string;
  instanceName: string;
  eventName: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  database?: Queryable;
}): Promise<EvolutionWebhookInboxEvent> {
  const database = input.database || db;
  const dedupKey = deriveEvolutionWebhookDedupKey({
    eventName: input.eventName,
    payload: input.payload,
  });
  const maxAttempts = Number.isInteger(input.maxAttempts) && Number(input.maxAttempts) > 0
    ? Number(input.maxAttempts)
    : 5;
  const result = await database.query(
    `INSERT INTO evolution_webhook_events (
       workspace_id,
       instance_name,
       event_name,
       dedup_key,
       payload,
       max_attempts
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (instance_name, event_name, dedup_key) DO UPDATE
     SET payload = CASE
           WHEN evolution_webhook_events.status IN ('pending', 'failed')
             THEN EXCLUDED.payload
           ELSE evolution_webhook_events.payload
         END,
         available_at = CASE
           WHEN evolution_webhook_events.status = 'failed'
             THEN clock_timestamp()
           ELSE evolution_webhook_events.available_at
         END,
         updated_at = clock_timestamp()
     RETURNING *`,
    [
      input.workspaceId,
      input.instanceName,
      input.eventName,
      dedupKey,
      JSON.stringify(input.payload),
      maxAttempts,
    ],
  );
  const row = result.rows[0];
  if (!row?.id) throw new Error('Falha ao persistir evento Evolution no inbox duravel.');
  return mapRow(row);
}

export async function claimEvolutionWebhookEvent(input: {
  eventId: string;
  workerId: string;
  leaseMs?: number;
  database?: Queryable;
}): Promise<EvolutionWebhookInboxEvent | null> {
  const database = input.database || db;
  const leaseMs = Number.isFinite(input.leaseMs) && Number(input.leaseMs) > 0
    ? Number(input.leaseMs)
    : 5 * 60_000;
  const result = await database.query(
    `UPDATE evolution_webhook_events
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         locked_at = clock_timestamp(),
         locked_by = $2,
         last_error = NULL,
         updated_at = clock_timestamp()
     WHERE id = $1
       AND attempt_count < max_attempts
       AND available_at <= clock_timestamp()
       AND (
         status IN ('pending', 'failed')
         OR (
           status = 'processing'
           AND locked_at < clock_timestamp() - ($3::bigint * interval '1 millisecond')
         )
       )
     RETURNING *`,
    [input.eventId, input.workerId, leaseMs],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function markEvolutionWebhookEventProcessed(input: {
  eventId: string;
  workerId: string;
  database?: Queryable;
}): Promise<void> {
  const database = input.database || db;
  await database.query(
    `UPDATE evolution_webhook_events
     SET status = 'processed',
         processed_at = COALESCE(processed_at, clock_timestamp()),
         locked_at = NULL,
         locked_by = NULL,
         last_error = NULL,
         updated_at = clock_timestamp()
     WHERE id = $1
       AND status = 'processing'
       AND locked_by = $2`,
    [input.eventId, input.workerId],
  );
}

/**
 * Apaga eventos ja processados mais antigos que a janela de retencao.
 *
 * Trabalha em lotes curtos de proposito: um `DELETE` unico sobre centenas de
 * milhares de linhas seguraria lock e inflaria o WAL enquanto o worker ainda
 * precisa reivindicar eventos novos na mesma tabela. `SKIP LOCKED` garante que a
 * poda nunca dispute linha com quem esta processando.
 *
 * So remove `processed`. `dead_letter` fica para investigacao — sao poucos e sao
 * justamente os que interessa olhar depois.
 */
export async function pruneProcessedEvolutionWebhookEvents(input?: {
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
  database?: Queryable;
}): Promise<{ deleted: number; batches: number; reachedLimit: boolean }> {
  const database = input?.database || db;
  const retentionDays = Number.isFinite(input?.retentionDays) && Number(input?.retentionDays) > 0
    ? Number(input?.retentionDays)
    : 7;
  const batchSize = Number.isFinite(input?.batchSize) && Number(input?.batchSize) > 0
    ? Math.min(Number(input?.batchSize), 20_000)
    : 5_000;
  const maxBatches = Number.isFinite(input?.maxBatches) && Number(input?.maxBatches) > 0
    ? Number(input?.maxBatches)
    : 20;

  let deleted = 0;
  let batches = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await database.query(
      `WITH doomed AS (
         SELECT id
         FROM evolution_webhook_events
         WHERE status = 'processed'
           AND created_at < clock_timestamp() - ($1::int * interval '1 day')
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM evolution_webhook_events target
       USING doomed
       WHERE target.id = doomed.id`,
      [retentionDays, batchSize],
    );

    const removed = result.rowCount ?? 0;
    deleted += removed;
    batches += 1;

    if (removed < batchSize) {
      return { deleted, batches, reachedLimit: false };
    }
  }

  // Saiu pelo teto de lotes: ainda ha backlog, o proximo ciclo continua daqui.
  return { deleted, batches, reachedLimit: true };
}

export async function markEvolutionWebhookEventFailed(input: {
  eventId: string;
  workerId: string;
  error: unknown;
  database?: Queryable;
}): Promise<EvolutionWebhookEventStatus | null> {
  const database = input.database || db;
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const result = await database.query(
    `UPDATE evolution_webhook_events
     SET status = CASE
           WHEN attempt_count >= max_attempts THEN 'dead_letter'
           ELSE 'failed'
         END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = LEFT($3, 4000),
         updated_at = clock_timestamp()
     WHERE id = $1
       AND status = 'processing'
       AND locked_by = $2
     RETURNING status`,
    [input.eventId, input.workerId, message],
  );
  return (result.rows[0]?.status as EvolutionWebhookEventStatus | undefined) || null;
}
