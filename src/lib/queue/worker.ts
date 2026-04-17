import { DIALOGY_QUEUE_NAME, getQueueWorkerConcurrency } from './config';
import { handleQueueJob, handleQueueJobFailure } from './handlers';
import { createQueueWorkerRuntime } from './worker-runtime';

export function createQueueWorker() {
  const workerId =
    process.env.WORKER_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `default-worker-${process.pid}`;

  return createQueueWorkerRuntime({
    queueName: DIALOGY_QUEUE_NAME,
    concurrency: getQueueWorkerConcurrency(),
    workerId,
    processor: handleQueueJob,
    onFailure: handleQueueJobFailure,
  });
}
