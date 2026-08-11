import { db } from '@/lib/db';
import { logAction } from '@/lib/observability/logger';
import { executeMarketingAutoClose, executeQueueAutoClose } from '@/services/chat/auto-close';
import { dispatchMessageToWebhooksById } from '@/services/webhook-dispatcher';
import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { reconcileOutboundMessage } from '@/services/whatsapp/reconcile-outbound';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { getSupabaseAdmin } from '@/lib/supabase';
import type {
  MarketingAutoClosePayload,
  QueueJobRecord,
  QueueJobType,
  QueueAutoClosePayload,
  WhatsappSendPayload,
  WebhookOutboundPayload,
  AnalyticsEventPayload,
  NotificationPayload,
  AiTaskPayload,
  EvolutionWebhookProcessPayload,
} from './types';

type QueueHandler = (job: QueueJobRecord) => Promise<void>;

const FINAL_MESSAGE_STATUSES = new Set(['SENT', 'DELIVERY_ACK', 'READ', 'PLAYED', 'DELETED']);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function handleAiTask(payload: AiTaskPayload) {
  if (payload.task === 'temp_media_delete') {
    const bucket = cleanString(payload.payload?.bucket);
    const path = cleanString(payload.payload?.path);
    if (!bucket || !path) {
      throw new Error('Invalid temp_media_delete payload.');
    }

    const { error } = await getSupabaseAdmin().storage.from(bucket).remove([path]);
    if (error) {
      throw new Error(`Failed to delete temp media ${bucket}/${path}: ${error.message}`);
    }

    await logAction({
      action: 'temp_media_delete',
      workspaceId: payload.workspaceId,
      payload: { bucket, path },
    });
    return;
  }

  await logAction({
    action: 'ai_task',
    workspaceId: payload.workspaceId,
    payload: {
      task: payload.task,
      ...payload.payload,
    },
  });
}

const HANDLERS: Record<QueueJobType, QueueHandler | undefined> = {
  evolution_webhook_process: async (job) => {
    const payload = job.payload as EvolutionWebhookProcessPayload;
    if (!payload?.eventId) {
      throw new Error('Invalid evolution_webhook_process payload.');
    }
    const { processPersistedEvolutionWebhookEvent } = await import(
      '@/services/whatsapp/evolution-webhook-handler'
    );
    await processPersistedEvolutionWebhookEvent(payload.eventId, job.locked_by || job.id);
  },
  whatsapp_send: async (job) => {
    const payload = job.payload as WhatsappSendPayload;
    if (!payload?.messageId || !payload.instanceName || !payload.number) {
      throw new Error('Invalid whatsapp_send payload.');
    }

    if (job.attempts > 0) {
      const messageRes = await db.query(
        `SELECT api_message_status, message_id_from_api, created_at
         FROM messages
         WHERE id = $1
         LIMIT 1`,
        [payload.messageId]
      );

      if ((messageRes.rowCount ?? 0) === 0) {
        console.warn(`[QUEUE] Mensagem ${payload.messageId} nao encontrada para reconciliar.`);
        return;
      }

      const row = messageRes.rows[0];
      const currentStatus = String(row.api_message_status || '').toUpperCase();

      if (row.message_id_from_api || FINAL_MESSAGE_STATUSES.has(currentStatus)) {
        return;
      }

      // Retry cego duplicaria a mensagem quando a falha foi ambigua (timeout,
      // queda de rede). Antes de decidir, perguntamos a Evolution o que ela
      // realmente enviou. So reenviamos com a confirmacao de que nao saiu.
      const markFailed = async (motivo: string) => {
        await db.query(
          `UPDATE messages SET api_message_status = 'FAILED' WHERE id = $1`,
          [payload.messageId]
        );
        console.warn(`[QUEUE] whatsapp_send ${payload.messageId} mantido como FAILED. ${motivo}`);
      };

      const reconcileConfig = await getEvolutionApiConfig(payload.instanceName, {
        workspaceId: payload.workspaceId,
      });

      if (!reconcileConfig) {
        await markFailed('Configuracao da Evolution indisponivel para verificar.');
        return;
      }

      const reconciliation = await reconcileOutboundMessage({
        apiConfig: reconcileConfig,
        instanceName: payload.instanceName,
        number: payload.number,
        content: payload.apiContent || payload.content,
        sentAfter: new Date(row.created_at),
      });

      if (reconciliation.status === 'sent') {
        await db.query(
          `UPDATE messages
           SET api_message_status = 'SENT',
               message_id_from_api = COALESCE(message_id_from_api, $1)
           WHERE id = $2`,
          [reconciliation.keyId, payload.messageId]
        );
        console.log(
          `[QUEUE] whatsapp_send ${payload.messageId} ja havia sido entregue (keyId=${reconciliation.keyId ?? 'desconhecido'}). Retry cancelado.`
        );
        return;
      }

      if (reconciliation.status === 'unknown') {
        await markFailed(`Nao foi possivel verificar se saiu: ${reconciliation.reason}`);
        return;
      }

      console.log(
        `[QUEUE] whatsapp_send ${payload.messageId} confirmado como nao enviado. Reenviando com seguranca.`
      );
    }

    const lockRes = await db.query(
      `UPDATE messages
       SET api_message_status = 'SENDING'
       WHERE id = $1
         AND message_id_from_api IS NULL
         AND COALESCE(api_message_status, 'PENDING') IN ('PENDING', 'FAILED')
       RETURNING id`,
      [payload.messageId]
    );

    if ((lockRes.rowCount ?? 0) === 0) {
      const messageRes = await db.query(
        `SELECT api_message_status, message_id_from_api
         FROM messages
         WHERE id = $1
         LIMIT 1`,
        [payload.messageId]
      );

      if ((messageRes.rowCount ?? 0) === 0) {
        throw new Error(`Message ${payload.messageId} not found.`);
      }

      const row = messageRes.rows[0];
      const currentStatus = String(row.api_message_status || '').toUpperCase();
      const currentApiMessageId = row.message_id_from_api;

      if (currentApiMessageId || FINAL_MESSAGE_STATUSES.has(currentStatus) || currentStatus === 'SENDING') {
        console.log(
          `[QUEUE] Skipping whatsapp_send for ${payload.messageId}. status=${currentStatus || 'NULL'} apiMessageId=${currentApiMessageId || 'NULL'}`
        );
        return;
      }

      throw new Error(
        `Message ${payload.messageId} is not eligible for whatsapp_send. status=${currentStatus || 'NULL'}`
      );
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
           instance_name = COALESCE(instance_name, $3)
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
  queue_auto_close: async (job) => {
    const payload = job.payload as QueueAutoClosePayload;
    if (!payload?.chatId || !payload?.workspaceId || !payload?.lastIncomingAt) {
      throw new Error('Invalid queue_auto_close payload.');
    }

    await executeQueueAutoClose({
      chatId: payload.chatId,
      workspaceId: payload.workspaceId,
      lastIncomingAt: new Date(payload.lastIncomingAt),
      autoCloseMs: payload.autoCloseMs,
    });
  },
  marketing_auto_close: async (job) => {
    const payload = job.payload as MarketingAutoClosePayload;
    if (!payload?.chatId || !payload?.workspaceId || !payload?.marketingSentAt) {
      throw new Error('Invalid marketing_auto_close payload.');
    }

    await executeMarketingAutoClose({
      chatId: payload.chatId,
      workspaceId: payload.workspaceId,
      marketingSentAt: new Date(payload.marketingSentAt),
      autoCloseMs: payload.autoCloseMs,
    });
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
    await handleAiTask(payload);
  },
  ai_document_ingest: undefined,
  ai_autopilot_process: undefined,
  ai_autopilot_learning_cycle: undefined,
  ai_case_memory_refresh: undefined,
};

export async function handleQueueJob(job: QueueJobRecord): Promise<void> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    throw new Error(`No handler registered for job type ${job.type}`);
  }
  await handler(job);
}

export async function handleQueueJobFailure(job: QueueJobRecord, error: unknown): Promise<void> {
  if (job.type !== 'whatsapp_send') {
    return;
  }

  const payload = job.payload as WhatsappSendPayload;
  if (!payload?.messageId) {
    return;
  }

  const messageRes = await db.query(
    `SELECT api_message_status, message_id_from_api
     FROM messages
     WHERE id = $1
     LIMIT 1`,
    [payload.messageId]
  );

  if ((messageRes.rowCount ?? 0) === 0) {
    return;
  }

  const row = messageRes.rows[0];
  const currentStatus = String(row.api_message_status || '').toUpperCase();
  const currentApiMessageId = row.message_id_from_api;

  if (currentApiMessageId || FINAL_MESSAGE_STATUSES.has(currentStatus)) {
    console.warn(
      `[QUEUE] Not marking whatsapp_send as FAILED for ${payload.messageId}. status=${currentStatus || 'NULL'} apiMessageId=${currentApiMessageId || 'NULL'}`
    );
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  await db.query(
    `UPDATE messages
     SET api_message_status = $1,
         metadata = jsonb_set(
           jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{send_error}',
             to_jsonb($2::text),
             true
           ),
           '{send_error_details}',
           $3::jsonb,
           true
         )
     WHERE id = $4`,
    [
      'FAILED',
      errorMessage,
      JSON.stringify({
        source: 'dialogy_whatsapp_queue',
        status: 'FAILED',
        reason: errorMessage,
        captured_at: new Date().toISOString(),
      }),
      payload.messageId,
    ]
  );

  console.error(
    `[QUEUE] whatsapp_send failed for message ${payload.messageId}:`,
    error instanceof Error ? error.message : error
  );
}
