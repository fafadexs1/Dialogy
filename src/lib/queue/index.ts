import 'server-only';

import type { QueueJobPayload, QueueJobType } from './types';

type EnqueueOptions = {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  client?: { query: (query: string, params?: any[]) => Promise<any> };
};

const QUEUE_DISABLED_MESSAGE = 'Queue system disabled.';

export function shouldEnqueueJob(_type: QueueJobType): boolean {
  return false;
}

export async function enqueueJob(
  _type: QueueJobType,
  _payload: QueueJobPayload,
  _options?: EnqueueOptions
): Promise<{ id: string }> {
  throw new Error(QUEUE_DISABLED_MESSAGE);
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

export async function processQueueOnce(options?: {
  batchSize?: number;
  concurrency?: number;
  workerId?: string;
}) {
  void options;
  return { processed: 0, released: 0 };
}
