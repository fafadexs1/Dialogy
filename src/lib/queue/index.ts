import { Queue } from 'bullmq';
import { getQueueProducerConnection } from './connection';
import {
  DIALOGY_QUEUE_NAME,
  DIALOGY_QUEUE_PREFIX,
  getQueueBackoffBaseMs,
  getQueueMaxAttempts,
  shouldEnqueueJobType,
} from './config';
import type {
  AiTaskPayload,
  AnalyticsEventPayload,
  MarketingAutoClosePayload,
  NotificationPayload,
  QueueAutoClosePayload,
  QueueJobPayload,
  QueueJobType,
  WebhookOutboundPayload,
  WhatsappSendPayload,
} from './types';

export type EnqueueOptions = {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  client?: { query: (query: string, params?: any[]) => Promise<any> };
};

const QUEUE_DISABLED_MESSAGE = 'Queue system disabled.';

declare global {
  // eslint-disable-next-line no-var
  var __dialogyBullQueue: Queue | undefined;
}

function getDialogyQueue() {
  if (!globalThis.__dialogyBullQueue) {
    globalThis.__dialogyBullQueue = new Queue(DIALOGY_QUEUE_NAME, {
      connection: getQueueProducerConnection(),
      prefix: DIALOGY_QUEUE_PREFIX,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }

  return globalThis.__dialogyBullQueue;
}

function getJobId(type: QueueJobType, payload: QueueJobPayload) {
  switch (type) {
    case 'whatsapp_send':
      return `whatsapp_send:${(payload as WhatsappSendPayload).messageId}`;
    case 'webhook_outbound':
      return `webhook_outbound:${(payload as WebhookOutboundPayload).messageId}`;
    case 'queue_auto_close': {
      const typedPayload = payload as QueueAutoClosePayload;
      return `queue_auto_close:${typedPayload.chatId}:${typedPayload.lastIncomingAt}`;
    }
    case 'marketing_auto_close': {
      const typedPayload = payload as MarketingAutoClosePayload;
      return `marketing_auto_close:${typedPayload.chatId}:${typedPayload.marketingSentAt}`;
    }
    case 'analytics_event': {
      const typedPayload = payload as AnalyticsEventPayload;
      return `analytics_event:${typedPayload.workspaceId || 'global'}:${typedPayload.name}:${Date.now()}`;
    }
    case 'notification_send': {
      const typedPayload = payload as NotificationPayload;
      return `notification_send:${typedPayload.userId || 'anon'}:${Date.now()}`;
    }
    case 'ai_task': {
      const typedPayload = payload as AiTaskPayload;
      return `ai_task:${typedPayload.workspaceId || 'global'}:${typedPayload.task}:${Date.now()}`;
    }
    default:
      return undefined;
  }
}

export function shouldEnqueueJob(type: QueueJobType): boolean {
  return shouldEnqueueJobType(type);
}

export async function enqueueJob(
  type: QueueJobType,
  payload: QueueJobPayload,
  options?: EnqueueOptions
): Promise<{ id: string }> {
  if (!shouldEnqueueJob(type)) {
    throw new Error(QUEUE_DISABLED_MESSAGE);
  }

  const runAt = options?.runAt;
  const delay = runAt ? Math.max(runAt.getTime() - Date.now(), 0) : 0;
  const attempts = getQueueMaxAttempts(options?.maxAttempts);

  const job = await getDialogyQueue().add(type, payload, {
    jobId: getJobId(type, payload),
    delay,
    priority: options?.priority,
    attempts,
    backoff: {
      type: 'exponential',
      delay: getQueueBackoffBaseMs(),
    },
  });

  return { id: String(job.id) };
}

export async function enqueueWhatsappSend(payload: WhatsappSendPayload, options?: EnqueueOptions) {
  return enqueueJob('whatsapp_send', payload, options);
}

export async function enqueueWebhookOutbound(payload: WebhookOutboundPayload, options?: EnqueueOptions) {
  return enqueueJob('webhook_outbound', payload, options);
}

export async function enqueueQueueAutoClose(payload: QueueAutoClosePayload, options?: EnqueueOptions) {
  return enqueueJob('queue_auto_close', payload, options);
}

export async function enqueueMarketingAutoClose(payload: MarketingAutoClosePayload, options?: EnqueueOptions) {
  return enqueueJob('marketing_auto_close', payload, options);
}

export async function enqueueAnalyticsEvent(payload: AnalyticsEventPayload, options?: EnqueueOptions) {
  return enqueueJob('analytics_event', payload, options);
}

export async function enqueueNotification(payload: NotificationPayload, options?: EnqueueOptions) {
  return enqueueJob('notification_send', payload, options);
}

export async function enqueueAiTask(payload: AiTaskPayload, options?: EnqueueOptions) {
  return enqueueJob('ai_task', payload, options);
}

export async function processQueueOnce() {
  if (
    !shouldEnqueueJob('whatsapp_send') &&
    !shouldEnqueueJob('webhook_outbound') &&
    !shouldEnqueueJob('queue_auto_close') &&
    !shouldEnqueueJob('marketing_auto_close')
  ) {
    return {
      processed: 0,
      released: 0,
      counts: null,
    };
  }

  const counts = await getDialogyQueue().getJobCounts(
    'wait',
    'active',
    'completed',
    'failed',
    'delayed'
  );

  return {
    processed: 0,
    released: 0,
    counts,
  };
}
