import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { getQueueProducerConnection } from './connection';
import {
  DIALOGY_AI_QUEUE_NAME,
  DIALOGY_QUEUE_NAME,
  DIALOGY_QUEUE_PREFIX,
  getQueueBackoffBaseMs,
  getQueueMaxAttempts,
  shouldEnqueueJobType,
} from './config';
import type {
  AiAutopilotProcessPayload,
  AiAutopilotLearningCyclePayload,
  AiCaseMemoryRefreshPayload,
  AiDocumentIngestPayload,
  AiTaskPayload,
  AnalyticsEventPayload,
  EvolutionWebhookProcessPayload,
  MarketingAutoClosePayload,
  NexusInternalEventPayload,
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
  // Sobrescreve o jobId deterministico de getJobId. O id deterministico existe
  // para deduplicar reenvios acidentais do mesmo envio; quem pede explicitamente
  // um novo disparo do mesmo messageId (retry manual) precisa de um id distinto,
  // senao o BullMQ devolve o job antigo e nao enfileira nada.
  jobId?: string;
};

const QUEUE_DISABLED_MESSAGE = 'Queue system disabled.';

declare global {
  // eslint-disable-next-line no-var
  var __dialogyBullQueues: Map<string, Queue> | undefined;
}

function isAiQueueJob(type: QueueJobType) {
  return type === 'ai_document_ingest'
    || type === 'ai_autopilot_process'
    || type === 'ai_autopilot_learning_cycle'
    || type === 'ai_case_memory_refresh';
}

function getQueueName(type: QueueJobType) {
  return isAiQueueJob(type) ? DIALOGY_AI_QUEUE_NAME : DIALOGY_QUEUE_NAME;
}

function getDialogyQueue(type: QueueJobType) {
  if (!globalThis.__dialogyBullQueues) {
    globalThis.__dialogyBullQueues = new Map();
  }

  const queueName = getQueueName(type);
  const existingQueue = globalThis.__dialogyBullQueues.get(queueName);
  if (existingQueue) {
    return existingQueue;
  }

  const queue = new Queue(queueName, {
      connection: getQueueProducerConnection(),
      prefix: DIALOGY_QUEUE_PREFIX,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

  globalThis.__dialogyBullQueues.set(queueName, queue);
  return queue;
}

function toSafeJobIdPart(value: unknown) {
  return String(value).replaceAll(':', '_');
}

function getJobId(type: QueueJobType, payload: QueueJobPayload) {
  switch (type) {
    case 'evolution_webhook_process':
      return `evolution_webhook_process__${toSafeJobIdPart(
        (payload as EvolutionWebhookProcessPayload).eventId
      )}`;
    case 'whatsapp_send':
      return `whatsapp_send__${toSafeJobIdPart((payload as WhatsappSendPayload).messageId)}`;
    case 'webhook_outbound':
      return `webhook_outbound__${toSafeJobIdPart((payload as WebhookOutboundPayload).messageId)}`;
    case 'queue_auto_close': {
      const typedPayload = payload as QueueAutoClosePayload;
      return `queue_auto_close__${toSafeJobIdPart(typedPayload.chatId)}__${toSafeJobIdPart(
        typedPayload.lastIncomingAt
      )}`;
    }
    case 'marketing_auto_close': {
      const typedPayload = payload as MarketingAutoClosePayload;
      return `marketing_auto_close__${toSafeJobIdPart(typedPayload.chatId)}__${toSafeJobIdPart(
        typedPayload.marketingSentAt
      )}`;
    }
    case 'ai_document_ingest': {
      const typedPayload = payload as AiDocumentIngestPayload;
      const revision = typedPayload.jobKey || createHash('sha256').update(typedPayload.content || '').digest('hex').slice(0, 16);
      return `ai_document_ingest__${toSafeJobIdPart(typedPayload.documentId)}__${toSafeJobIdPart(revision)}`;
    }
    case 'ai_autopilot_process': {
      const typedPayload = payload as AiAutopilotProcessPayload;
      return `ai_autopilot_process__${toSafeJobIdPart(typedPayload.messageId)}`;
    }
    case 'ai_autopilot_learning_cycle': {
      const typedPayload = payload as AiAutopilotLearningCyclePayload;
      const revision = typedPayload.jobKey || Date.now();
      return `ai_autopilot_learning_cycle__${toSafeJobIdPart(
        typedPayload.workspaceId || 'all'
      )}__${toSafeJobIdPart(typedPayload.sinceDays || 30)}__${toSafeJobIdPart(revision)}`;
    }
    case 'ai_case_memory_refresh': {
      const typedPayload = payload as AiCaseMemoryRefreshPayload;
      return `ai_case_memory_refresh__${toSafeJobIdPart(typedPayload.chatId)}__${toSafeJobIdPart(
        typedPayload.closedAt || 'pending'
      )}`;
    }
    case 'nexus_internal_event': {
      const typedPayload = payload as NexusInternalEventPayload;
      const eventKey = createHash('sha256')
        .update(`${typedPayload.workspaceId}:${typedPayload.eventName}:${typedPayload.eventId}`)
        .digest('hex')
        .slice(0, 32);
      return `nexus_internal_event__${eventKey}`;
    }
    case 'analytics_event': {
      const typedPayload = payload as AnalyticsEventPayload;
      return `analytics_event__${toSafeJobIdPart(typedPayload.workspaceId || 'global')}__${toSafeJobIdPart(
        typedPayload.name
      )}__${Date.now()}`;
    }
    case 'notification_send': {
      const typedPayload = payload as NotificationPayload;
      return `notification_send__${toSafeJobIdPart(typedPayload.userId || 'anon')}__${Date.now()}`;
    }
    case 'ai_task': {
      const typedPayload = payload as AiTaskPayload;
      return `ai_task__${toSafeJobIdPart(typedPayload.workspaceId || 'global')}__${toSafeJobIdPart(
        typedPayload.task
      )}__${Date.now()}`;
    }
    default:
      return undefined;
  }
}

export function shouldEnqueueJob(type: QueueJobType): boolean {
  return shouldEnqueueJobType(type);
}

function getDefaultMaxAttemptsForType(type: QueueJobType) {
  switch (type) {
    case 'evolution_webhook_process':
      return 5;
    case 'whatsapp_send':
      // A segunda tentativa nao reenvia direto: o handler reconcilia com a
      // Evolution antes e so segue se confirmar que a mensagem nao saiu.
      // Poucas tentativas de proposito -- cada uma custa uma consulta extra.
      return 2;
    case 'ai_document_ingest':
    case 'ai_autopilot_process':
    case 'ai_autopilot_learning_cycle':
    case 'ai_case_memory_refresh':
      return 3;
    default:
      return 5;
  }
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
  // whatsapp_send nao herda QUEUE_MAX_ATTEMPTS: cada tentativa extra custa uma
  // consulta de reconciliacao a Evolution, entao o teto e proprio e baixo.
  const attempts = type === 'whatsapp_send'
    ? (options?.maxAttempts ?? getDefaultMaxAttemptsForType(type))
    : getQueueMaxAttempts(options?.maxAttempts ?? getDefaultMaxAttemptsForType(type));

  const job = await getDialogyQueue(type).add(type, payload, {
    jobId: options?.jobId ?? getJobId(type, payload),
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

export async function enqueueEvolutionWebhookProcess(
  payload: EvolutionWebhookProcessPayload,
  options?: EnqueueOptions,
) {
  return enqueueJob('evolution_webhook_process', payload, options);
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

export async function enqueueAiDocumentIngest(payload: AiDocumentIngestPayload, options?: EnqueueOptions) {
  return enqueueJob('ai_document_ingest', payload, options);
}

export async function enqueueAiAutopilotProcess(
  payload: AiAutopilotProcessPayload,
  options?: EnqueueOptions
) {
  return enqueueJob('ai_autopilot_process', payload, options);
}

export async function enqueueAiAutopilotLearningCycle(
  payload: AiAutopilotLearningCyclePayload,
  options?: EnqueueOptions
) {
  return enqueueJob('ai_autopilot_learning_cycle', payload, options);
}

export async function enqueueAiCaseMemoryRefresh(
  payload: AiCaseMemoryRefreshPayload,
  options?: EnqueueOptions
) {
  return enqueueJob('ai_case_memory_refresh', payload, options);
}

export async function enqueueNexusInternalEvent(
  payload: NexusInternalEventPayload,
  options?: EnqueueOptions,
) {
  return enqueueJob('nexus_internal_event', payload, options);
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
    !shouldEnqueueJob('evolution_webhook_process') &&
    !shouldEnqueueJob('webhook_outbound') &&
    !shouldEnqueueJob('queue_auto_close') &&
    !shouldEnqueueJob('marketing_auto_close') &&
    !shouldEnqueueJob('nexus_internal_event')
  ) {
    return {
      processed: 0,
      released: 0,
      counts: null,
    };
  }

  const counts = await getDialogyQueue('whatsapp_send').getJobCounts(
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
