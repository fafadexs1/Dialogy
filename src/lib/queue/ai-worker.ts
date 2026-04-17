import { DIALOGY_AI_QUEUE_NAME, getAiQueueWorkerConcurrency } from './config';
import { handleAiQueueJob } from './ai-handlers';
import { createQueueWorkerRuntime } from './worker-runtime';

export function createAiQueueWorker() {
  const workerId =
    process.env.AI_WORKER_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `ai-worker-${process.pid}`;

  return createQueueWorkerRuntime({
    queueName: DIALOGY_AI_QUEUE_NAME,
    concurrency: getAiQueueWorkerConcurrency(),
    workerId,
    processor: handleAiQueueJob,
  });
}
