import { Worker } from 'bullmq';
import { createQueueWorkerConnection } from './connection';
import {
  DIALOGY_QUEUE_NAME,
  DIALOGY_QUEUE_PREFIX,
  getQueueMaxAttempts,
  getQueueWorkerConcurrency,
} from './config';
import { handleQueueJob, handleQueueJobFailure } from './handlers';
import type { QueueJobPayload, QueueJobRecord, QueueJobType } from './types';

function toQueueJobRecord(
  workerId: string,
  job: {
    id?: string | number;
    name: string;
    data: QueueJobPayload;
    attemptsMade: number;
    opts: { attempts?: number };
    timestamp: number;
    processedOn?: number;
  }
): QueueJobRecord {
  return {
    id: String(job.id),
    type: job.name as QueueJobType,
    status: 'active',
    payload: job.data,
    attempts: job.attemptsMade,
    max_attempts: job.opts.attempts ?? getQueueMaxAttempts(),
    run_at: new Date(job.timestamp).toISOString(),
    locked_at: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    locked_by: workerId,
  };
}

export function createQueueWorker() {
  const workerId =
    process.env.WORKER_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `worker-${process.pid}`;
  const connection = createQueueWorkerConnection();

  const worker = new Worker<QueueJobPayload, void, QueueJobType>(
    DIALOGY_QUEUE_NAME,
    async (job) => {
      const queueJob = toQueueJobRecord(workerId, job);
      await handleQueueJob(queueJob);
    },
    {
      connection,
      concurrency: getQueueWorkerConcurrency(),
      prefix: DIALOGY_QUEUE_PREFIX,
    }
  );

  worker.on('ready', () => {
    console.log(
      `[QUEUE_WORKER] Ready. queue=${DIALOGY_QUEUE_NAME} concurrency=${getQueueWorkerConcurrency()} workerId=${workerId}`
    );
  });

  worker.on('completed', (job) => {
    console.log(`[QUEUE_WORKER] Completed job ${job?.name}#${job?.id ?? 'unknown'}`);
  });

  worker.on('failed', async (job, error) => {
    console.error(
      `[QUEUE_WORKER] Failed job ${job?.name}#${job?.id ?? 'unknown'}:`,
      error instanceof Error ? error.message : error
    );

    if (!job) {
      return;
    }

    try {
      await handleQueueJobFailure(toQueueJobRecord(workerId, job), error);
    } catch (failureHandlerError) {
      console.error('[QUEUE_WORKER] Failed to run job failure handler:', failureHandlerError);
    }
  });

  worker.on('error', (error) => {
    console.error('[QUEUE_WORKER] Worker error:', error);
  });

  return { worker, connection };
}
