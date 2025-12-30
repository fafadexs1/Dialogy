import 'server-only';

import { db } from '@/lib/db';
import { logAction } from '@/lib/observability/logger';
import { handleQueueJob } from './handlers';
import type { QueueJobPayload, QueueJobRecord, QueueJobType } from './types';

type EnqueueOptions = {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  client?: { query: (query: string, params?: any[]) => Promise<any> };
};

const QUEUE_MODE = (process.env.QUEUE_MODE || 'inline').toLowerCase();
const ENABLED_JOB_TYPES = new Set(
  (process.env.QUEUE_ENABLED_JOBS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);

const DEFAULT_MAX_ATTEMPTS = Number(process.env.QUEUE_MAX_ATTEMPTS || '5');
const DEFAULT_PRIORITY = Number(process.env.QUEUE_DEFAULT_PRIORITY || '0');
const DEFAULT_BATCH_SIZE = Number(process.env.QUEUE_BATCH_SIZE || '20');
const DEFAULT_CONCURRENCY = Number(process.env.QUEUE_WORKER_CONCURRENCY || '5');
const LOCK_TIMEOUT_MS = Number(process.env.QUEUE_LOCK_TIMEOUT_MS || '300000');
const BACKOFF_BASE_MS = Number(process.env.QUEUE_BACKOFF_BASE_MS || '500');
const BACKOFF_MAX_MS = Number(process.env.QUEUE_BACKOFF_MAX_MS || '30000');

const JOB_DOMAINS: Record<QueueJobType, string> = {
  whatsapp_send: 'inbox',
  webhook_outbound: 'automations',
  analytics_event: 'analytics',
  notification_send: 'automations',
  ai_task: 'automations',
};

export function shouldEnqueueJob(type: QueueJobType): boolean {
  if (QUEUE_MODE !== 'enqueue') return false;
  if (ENABLED_JOB_TYPES.size === 0) return true;
  return ENABLED_JOB_TYPES.has(type);
}

export async function enqueueJob(
  type: QueueJobType,
  payload: QueueJobPayload,
  options?: EnqueueOptions
): Promise<{ id: string }> {
  const executor = options?.client ?? db;
  const runAt = options?.runAt ?? new Date();
  const priority = options?.priority ?? DEFAULT_PRIORITY;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const res = await executor.query(
    `INSERT INTO queue_jobs (type, status, payload, priority, max_attempts, run_at)
     VALUES ($1, 'queued', $2, $3, $4, $5)
     RETURNING id`,
    [type, JSON.stringify(payload), priority, maxAttempts, runAt]
  );
  return { id: res.rows[0]?.id };
}

export async function enqueueWhatsappSend(payload: QueueJobPayload, options?: EnqueueOptions) {
  return enqueueJob('whatsapp_send', payload, options);
}

export async function enqueueWebhookOutbound(payload: QueueJobPayload, options?: EnqueueOptions) {
  return enqueueJob('webhook_outbound', payload, options);
}

export async function enqueueAnalyticsEvent(payload: QueueJobPayload, options?: EnqueueOptions) {
  return enqueueJob('analytics_event', payload, options);
}

export async function enqueueNotification(payload: QueueJobPayload, options?: EnqueueOptions) {
  return enqueueJob('notification_send', payload, options);
}

export async function enqueueAiTask(payload: QueueJobPayload, options?: EnqueueOptions) {
  return enqueueJob('ai_task', payload, options);
}

async function releaseStaleJobs(): Promise<number> {
  const res = await db.query(
    `UPDATE queue_jobs
     SET status = 'queued',
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     WHERE status = 'processing'
       AND locked_at IS NOT NULL
       AND locked_at < NOW() - ($1::int * INTERVAL '1 millisecond')`,
    [LOCK_TIMEOUT_MS]
  );
  return res.rowCount ?? 0;
}

async function claimJobs(limit: number, workerId: string): Promise<QueueJobRecord[]> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE queue_jobs
       SET status = 'processing',
           locked_at = NOW(),
           locked_by = $1,
           attempts = attempts + 1,
           updated_at = NOW()
       WHERE id IN (
         SELECT id
         FROM queue_jobs
         WHERE status = 'queued'
           AND run_at <= NOW()
         ORDER BY priority DESC, run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       RETURNING *`,
      [workerId, limit]
    );
    await client.query('COMMIT');
    return res.rows.map((row: any) => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    }));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[QUEUE] Failed to claim jobs', error);
    return [];
  } finally {
    client.release();
  }
}

async function markJobCompleted(jobId: string) {
  await db.query(
    `UPDATE queue_jobs
     SET status = 'completed',
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId]
  );
}

async function markJobFailed(job: QueueJobRecord, error: Error) {
  const attempts = job.attempts || 1;
  const maxAttempts = job.max_attempts || DEFAULT_MAX_ATTEMPTS;
  const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)));
  const jitter = Math.round(backoff * 0.2 * Math.random());
  const delayMs = backoff + jitter;
  const nextRunAt = new Date(Date.now() + delayMs);

  if (attempts >= maxAttempts) {
    if (job.type === 'whatsapp_send') {
      const payload: any = job.payload as any;
      if (payload?.messageId) {
        await db.query(
          `UPDATE messages
           SET api_message_status = $2,
               metadata = COALESCE(metadata, '{}'::jsonb) || $3,
               updated_at = NOW()
           WHERE id = $1`,
          [
            payload.messageId,
            'FAILED',
            JSON.stringify({ send_error: error.message }),
          ]
        );
      }
    }

    await db.query(
      `UPDATE queue_jobs
       SET status = 'dead',
           locked_at = NULL,
           locked_by = NULL,
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [job.id, error.message]
    );
    return;
  }

  await db.query(
    `UPDATE queue_jobs
     SET status = 'queued',
         locked_at = NULL,
         locked_by = NULL,
         run_at = $2,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [job.id, nextRunAt, error.message]
  );
}

async function processJob(job: QueueJobRecord) {
  try {
    await handleQueueJob(job);
    await markJobCompleted(job.id);
    await logAction({
      action: 'queue_job_success',
      payload: {
        job_id: job.id,
        job_type: job.type,
        attempts: job.attempts,
        domain: JOB_DOMAINS[job.type],
      },
    });
  } catch (error: any) {
    await markJobFailed(job, error instanceof Error ? error : new Error('unknown_error'));
    await logAction({
      action: 'queue_job_failed',
      payload: {
        job_id: job.id,
        job_type: job.type,
        attempts: job.attempts,
        domain: JOB_DOMAINS[job.type],
        error: error?.message || 'unknown_error',
      },
    });
  }
}

async function processWithConcurrency(jobs: QueueJobRecord[], concurrency: number) {
  const executing = new Set<Promise<void>>();
  for (const job of jobs) {
    const task = processJob(job);
    executing.add(task);
    task.finally(() => executing.delete(task));
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.allSettled(executing);
}

export async function processQueueOnce(options?: {
  batchSize?: number;
  concurrency?: number;
  workerId?: string;
}) {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const workerId = options?.workerId ?? `worker-${process.pid}`;

  const released = await releaseStaleJobs();
  const jobs = await claimJobs(batchSize, workerId);

  if (jobs.length === 0) {
    return { processed: 0, released };
  }

  await processWithConcurrency(jobs, concurrency);
  return { processed: jobs.length, released };
}
