import 'server-only';

import { db } from '@/lib/db';
import { logAction } from '@/lib/observability/logger';
import { dispatchMessageToWebhooksById } from '@/services/webhook-dispatcher';
import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import type {
  QueueJobRecord,
  QueueJobType,
  WhatsappSendPayload,
  WebhookOutboundPayload,
  AnalyticsEventPayload,
  NotificationPayload,
  AiTaskPayload,
} from './types';

type QueueHandler = (job: QueueJobRecord) => Promise<void>;

const HANDLERS: Record<QueueJobType, QueueHandler> = {
  whatsapp_send: async (job) => {
    const payload = job.payload as WhatsappSendPayload;
    if (!payload?.messageId || !payload.instanceName || !payload.number) {
      throw new Error('Invalid whatsapp_send payload.');
    }

    const apiConfig = await getEvolutionApiConfig(payload.instanceName, { workspaceId: payload.workspaceId });
    if (!apiConfig) {
      throw new Error(`Evolution API config missing for ${payload.instanceName}`);
    }

    let apiResponse: any;
    if (payload.template) {
      apiResponse = await sendTemplateMessage(apiConfig, payload.instanceName, {
        number: payload.number,
        name: payload.template.name,
        language: payload.template.language,
        components: payload.template.components,
      });
    } else {
      apiResponse = await sendTextMessage(
        apiConfig,
        payload.instanceName,
        payload.number,
        payload.apiContent || payload.content
      );
    }

    const messageIdFromApi =
      apiResponse?.key?.id ?? apiResponse?.message_id ?? apiResponse?.id ?? null;

    await db.query(
      `UPDATE messages
       SET message_id_from_api = $1,
           api_message_status = $2,
           instance_name = COALESCE(instance_name, $3),
           updated_at = NOW()
       WHERE id = $4`,
      [messageIdFromApi, 'SENT', payload.instanceName, payload.messageId]
    );
  },
  webhook_outbound: async (job) => {
    const payload = job.payload as WebhookOutboundPayload;
    if (!payload?.chatId || !payload?.messageId) {
      throw new Error('Invalid webhook_outbound payload.');
    }
    await dispatchMessageToWebhooksById(payload.chatId, payload.messageId, payload.instanceName);
  },
  analytics_event: async (job) => {
    const payload = job.payload as AnalyticsEventPayload;
    await logAction({
      action: 'analytics_event',
      workspaceId: payload.workspaceId,
      payload: {
        name: payload.name,
        ...payload.payload,
      },
    });
  },
  notification_send: async (job) => {
    const payload = job.payload as NotificationPayload;
    await logAction({
      action: 'notification_send',
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      payload: {
        channel: payload.channel,
        ...payload.payload,
      },
    });
  },
  ai_task: async (job) => {
    const payload = job.payload as AiTaskPayload;
    await logAction({
      action: 'ai_task',
      workspaceId: payload.workspaceId,
      payload: {
        task: payload.task,
        ...payload.payload,
      },
    });
  },
};

export async function handleQueueJob(job: QueueJobRecord): Promise<void> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    throw new Error(`No handler registered for job type ${job.type}`);
  }
  await handler(job);
}
