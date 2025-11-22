type Task<T> = () => Promise<T>;

export interface QueueStats {
  pending: number;
  active: number;
  concurrency: number;
}

/**
 * Simple in-memory async queue to throttle high throughput workloads,
 * ensuring we don't overwhelm the database with thousands of concurrent jobs.
 */
export class TaskQueue {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly concurrency: number) {}

  add<T>(task: Task<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const runTask = () => {
        this.active++;
        task()
          .then(resolve)
          .catch((error) => {
            console.error('[TASK_QUEUE] Task execution failed:', error);
            reject(error);
          })
          .finally(() => {
            this.active--;
            this.process();
          });
      };

      if (this.active < this.concurrency) {
        runTask();
      } else {
        this.queue.push(runTask);
      }
    });
  }

  private process() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      nextTask?.();
    }
  }

  get stats(): QueueStats {
    return {
      pending: this.queue.length,
      active: this.active,
      concurrency: this.concurrency,
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __evolutionWebhookQueue: TaskQueue | undefined;
}

const defaultConcurrency = Number(process.env.EVOLUTION_WEBHOOK_CONCURRENCY ?? 100);

const evolutionQueue =
  globalThis.__evolutionWebhookQueue ?? new TaskQueue(Math.max(defaultConcurrency, 1));

if (!globalThis.__evolutionWebhookQueue) {
  globalThis.__evolutionWebhookQueue = evolutionQueue;
}

export const evolutionWebhookQueue = evolutionQueue;
