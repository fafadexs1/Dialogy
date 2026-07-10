import { Worker } from 'bullmq';
import { createQueueWorkerConnection } from './connection';
import { DIALOGY_QUEUE_PREFIX, getQueueMaxAttempts } from './config';
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

export function createQueueWorkerRuntime(params: {
  queueName: string;
  concurrency: number;
  workerId: string;
  processor: (job: QueueJobRecord) => Promise<void>;
  onFailure?: (job: QueueJobRecord, error: unknown) => Promise<void>;
}) {
  const { queueName, concurrency, workerId, processor, onFailure } = params;
  const connection = createQueueWorkerConnection();

  const worker = new Worker<QueueJobPayload, void, QueueJobType>(
    queueName,
    async (job) => {
      const queueJob = toQueueJobRecord(workerId, job);
      await processor(queueJob);
    },
    {
      connection,
      concurrency,
      prefix: DIALOGY_QUEUE_PREFIX,
    }
  );

  worker.on('ready', () => {
    console.log(
      `[QUEUE_WORKER] Ready. queue=${queueName} concurrency=${concurrency} workerId=${workerId}`
    );
  });

  worker.on('completed', (job) => {
    console.log(`[QUEUE_WORKER] Completed job ${job?.name}#${job?.id ?? 'unknown'}`);
  });

  worker.on('failed', async (job, error) => {
    const failure = error instanceof Error
      ? (error.stack || error.message)
      : error;
    console.error(
      `[QUEUE_WORKER] Failed job ${job?.name}#${job?.id ?? 'unknown'}:`,
      failure
    );

    if (!job || !onFailure) {
      return;
    }

    try {
      await onFailure(toQueueJobRecord(workerId, job), error);
    } catch (failureHandlerError) {
      console.error('[QUEUE_WORKER] Failed to run job failure handler:', failureHandlerError);
    }
  });

  worker.on('error', (error) => {
    console.error('[QUEUE_WORKER] Worker error:', error);
  });

  return { worker, connection };
}
