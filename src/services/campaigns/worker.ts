import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { CampaignChannel, CampaignMediaAttachment, CampaignScheduleConfig, CampaignTemplate, EvolutionApiConfig } from '@/lib/types';
import { buildChatProtocol } from '@/lib/utils';
import { getMonthlyChatLimitStatus } from '@/lib/billing-logic';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { sendAudioMessage } from '@/services/whatsapp/send-audio-message';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { sendTelegramTextMessage } from '@/services/telegram/bot-api';
import { InstagramMessagingService } from '@/services/meta/instagram-messaging-service';
import { MessengerMessagingService } from '@/services/meta/messenger-messaging-service';
import type { MetaChannelRecord } from '@/services/meta/meta-channel.service';
import {
  buildCampaignTemplateSendComponents,
  renderCampaignMessage,
} from '@/lib/campaigns/personalization';

const FINAL_MESSAGE_STATUSES = new Set(['SENT', 'DELIVERY_ACK', 'READ', 'PLAYED']);
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_LOCK_MS = 10 * 60 * 1_000;

type ClaimedRecipient = {
  id: string;
  campaign_id: string;
  contact_id: string;
  message_id: string;
  attempt_count: number;
  max_attempts: number;
};

type RecipientDeliveryContext = ClaimedRecipient & {
  contact_name: string;
  phone_number_jid: string | null;
  marketing_opt_out_at: string | null;
  workspace_id: string;
  created_by_id: string;
  message: string;
  instance_name: string;
  delivery_channel: CampaignChannel;
  destination_id: string | null;
  template_payload: CampaignTemplate | null;
  media_payload: CampaignMediaAttachment | null;
  schedule_config: CampaignScheduleConfig;
  scheduled_end_at: string | null;
  campaign_status: string;
};

function envPositiveInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Falha desconhecida.');
}

function normalizeCampaignMediaPayload(payload: CampaignMediaAttachment | null | undefined): CampaignMediaAttachment | null {
  if (!payload) return null;
  const type = payload.type === 'audio' ? 'audio' : payload.type === 'image' ? 'image' : null;
  const url = String(payload.url || '').trim();
  const mimetype = String(payload.mimetype || '').trim();
  const filename = String(payload.filename || '').trim();
  if (!type || !url || !mimetype || !filename) return null;
  if (type === 'image' && !mimetype.startsWith('image/')) return null;
  if (type === 'audio' && !mimetype.startsWith('audio/')) return null;
  return { ...payload, type, url, mimetype, filename };
}

function providerMessageId(response: any): string | null {
  return response?.key?.id || response?.message_id || response?.id || null;
}

async function sendCampaignImageUrl(
  apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
  instanceName: string,
  payload: {
    number: string;
    mediaUrl: string;
    mimetype: string;
    filename: string;
    caption: string;
  }
) {
  return fetchEvolutionAPI(
    `/message/sendMedia/${instanceName}`,
    apiConfig,
    {
      method: 'POST',
      body: JSON.stringify({
        number: payload.number,
        mediatype: 'image',
        mimetype: payload.mimetype,
        media: payload.mediaUrl,
        caption: payload.caption,
        fileName: payload.filename,
      }),
    }
  );
}

async function recoverStaleClaims(lockMs: number): Promise<void> {
  const recovered = await db.query(
    `UPDATE campaign_recipients cr
     SET status = CASE
           WHEN EXISTS (
             SELECT 1 FROM messages m
             WHERE m.id = cr.message_id
               AND UPPER(COALESCE(m.api_message_status, '')) = 'SENDING'
           ) THEN 'failed'
           ELSE 'scheduled'
         END,
         error_message = CASE
           WHEN EXISTS (
             SELECT 1 FROM messages m
             WHERE m.id = cr.message_id
               AND UPPER(COALESCE(m.api_message_status, '')) = 'SENDING'
           )
             THEN 'Entrega incerta apos interrupcao; reenvio automatico bloqueado para evitar duplicidade.'
           ELSE cr.error_message
         END,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     FROM campaigns c
     WHERE cr.campaign_id = c.id
       AND cr.status = 'processing'
       AND cr.locked_at < NOW() - ($1::text || ' milliseconds')::interval
       AND c.status IN ('scheduled', 'sending')
     RETURNING cr.campaign_id`,
    [lockMs]
  );
  for (const campaignId of new Set(recovered.rows.map(row => String(row.campaign_id)))) {
    await updateCampaignCompletion(campaignId);
  }
}

async function claimDueRecipient(workerId: string): Promise<ClaimedRecipient | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH candidate AS (
         SELECT cr.id
         FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
         WHERE cr.status IN ('waiting', 'scheduled')
           AND cr.scheduled_at <= NOW()
           AND c.status IN ('scheduled', 'sending')
           AND c.cancelled_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM campaign_recipients active
             WHERE active.campaign_id = cr.campaign_id
               AND active.status = 'processing'
           )
         ORDER BY cr.scheduled_at ASC, cr.id ASC
         FOR UPDATE OF cr SKIP LOCKED
         LIMIT 1
       )
       UPDATE campaign_recipients cr
       SET status = 'processing',
           attempt_count = cr.attempt_count + 1,
           last_attempt_at = NOW(),
           locked_at = NOW(),
           locked_by = $1,
           updated_at = NOW()
       FROM candidate
       WHERE cr.id = candidate.id
       RETURNING cr.id, cr.campaign_id, cr.contact_id, cr.message_id,
                 cr.attempt_count, cr.max_attempts`,
      [workerId]
    );

    const claimed = result.rows[0] as ClaimedRecipient | undefined;
    if (claimed) {
      await client.query(
        `UPDATE campaigns
         SET status = 'sending',
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW()
         WHERE id = $1 AND status = 'scheduled'`,
        [claimed.campaign_id]
      );
    }
    await client.query('COMMIT');
    return claimed || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadDeliveryContext(recipientId: string): Promise<RecipientDeliveryContext> {
  const result = await db.query(
    `SELECT
       cr.id,
       cr.campaign_id,
       cr.contact_id,
       cr.message_id,
       cr.attempt_count,
       cr.max_attempts,
       ct.name AS contact_name,
       ct.phone_number_jid,
       ct.marketing_opt_out_at,
       c.workspace_id,
       c.created_by_id,
       c.message,
       c.instance_name,
       COALESCE(NULLIF(c.delivery_channel, ''), 'whatsapp_baileys') AS delivery_channel,
       c.destination_id,
       c.template_payload,
       c.media_payload,
       c.schedule_config,
       c.scheduled_end_at,
       c.status AS campaign_status
     FROM campaign_recipients cr
     JOIN campaigns c ON c.id = cr.campaign_id
     JOIN contacts ct ON ct.id = cr.contact_id
     WHERE cr.id = $1
     LIMIT 1`,
    [recipientId]
  );

  const context = result.rows[0] as RecipientDeliveryContext | undefined;
  if (!context) {
    throw new Error(`Destinatario de campanha ${recipientId} nao encontrado.`);
  }
  return context;
}

async function resolveChat(context: RecipientDeliveryContext): Promise<{
  chatId: string;
  metaExternalUserId?: string;
  metaChannel?: MetaChannelRecord;
}> {
  if (context.delivery_channel === 'messenger' || context.delivery_channel === 'instagram') {
    const result = await db.query(
      `SELECT
         mc.chat_id,
         mct.external_id,
         ch.id,
         ch.workspace_id,
         ch.type,
         ch.external_page_id,
         ch.ig_business_id,
         ch.access_token,
         ch.app_secret,
         ch.verify_token,
         ch.name,
         ch.status,
         ch.settings
       FROM meta_conversations mc
       JOIN meta_contacts mct ON mct.id = mc.meta_contact_id
       JOIN meta_channels ch ON ch.id = mc.channel_id
       WHERE mc.channel_id = $1
         AND mct.contact_id = $2
         AND mc.platform = $3
         AND ch.status = 'active'
       ORDER BY mc.last_message_at DESC
       LIMIT 1`,
      [context.destination_id, context.contact_id, context.delivery_channel]
    );
    const row = result.rows[0];
    if (!row?.chat_id || !row?.external_id) {
      throw new Error('Contato sem conversa ativa no canal Meta selecionado.');
    }

    return {
      chatId: row.chat_id,
      metaExternalUserId: row.external_id,
      metaChannel: {
        id: row.id,
        workspace_id: row.workspace_id,
        type: row.type,
        external_page_id: row.external_page_id,
        ig_business_id: row.ig_business_id,
        access_token: row.access_token,
        app_secret: row.app_secret,
        verify_token: row.verify_token,
        name: row.name,
        status: row.status,
        settings: row.settings,
      },
    };
  }

  const existing = await db.query(
    `SELECT c.id
     FROM chats c
     WHERE c.contact_id = $1
       AND c.workspace_id = $2
       AND c.status IN ('gerais', 'atendimentos')
       AND NOT EXISTS (SELECT 1 FROM meta_conversations mc WHERE mc.chat_id = c.id)
     ORDER BY c.created_at DESC
     LIMIT 1`,
    [context.contact_id, context.workspace_id]
  );
  if (existing.rows[0]?.id) {
    return { chatId: existing.rows[0].id };
  }

  const limitStatus = await getMonthlyChatLimitStatus(context.workspace_id);
  if (!limitStatus.allowed) {
    throw new Error(`Limite mensal de chats do plano ${limitStatus.plan.toUpperCase()} atingido.`);
  }

  const chatId = randomUUID();
  await db.query(
    `INSERT INTO chats (id, workspace_id, contact_id, status, protocol)
     VALUES ($1, $2, $3, 'gerais'::chat_status_enum, $4)`,
    [chatId, context.workspace_id, context.contact_id, buildChatProtocol(chatId)]
  );
  return { chatId };
}

async function prepareIdempotentMessage(
  context: RecipientDeliveryContext,
  chatId: string,
  content: string,
): Promise<'send' | 'already_sent' | 'uncertain'> {
  const media = normalizeCampaignMediaPayload(context.media_payload);
  const messageType = media?.type || 'text';
  const messageMetadata = {
    campaignId: context.campaign_id,
    campaignRecipientId: context.id,
    consentConfirmed: true,
    ...(media
      ? {
          mediaUrl: media.url,
          mimetype: media.mimetype,
          fileName: media.filename,
          campaignMediaType: media.type,
        }
      : {}),
  };
  const existing = await db.query(
    `SELECT api_message_status, message_id_from_api
     FROM messages
     WHERE id = $1
     LIMIT 1`,
    [context.message_id]
  );
  const existingRow = existing.rows[0];
  const existingStatus = String(existingRow?.api_message_status || '').toUpperCase();
  if (existingRow?.message_id_from_api || FINAL_MESSAGE_STATUSES.has(existingStatus)) {
    return 'already_sent';
  }
  if (existingStatus === 'SENDING') {
    return 'uncertain';
  }

  await db.query(
    `INSERT INTO messages (
       id, workspace_id, chat_id, type, content, from_me, is_read,
       api_message_status, instance_name, source_from_api, metadata,
       sender_user_id, direction, platform, media_url
     )
     VALUES (
       $1, $2, $3, $4, $5, TRUE, TRUE,
       'PENDING', $6, $7, $8::jsonb,
       $9, 'outgoing', $10, $11
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      context.message_id,
      context.workspace_id,
      chatId,
      messageType,
      content,
      context.delivery_channel === 'messenger' || context.delivery_channel === 'instagram'
        ? context.destination_id
        : context.destination_id || context.instance_name,
      context.delivery_channel,
      JSON.stringify(messageMetadata),
      context.created_by_id,
      context.delivery_channel === 'messenger' || context.delivery_channel === 'instagram'
        ? context.delivery_channel
        : null,
      media?.url || null,
    ]
  );

  const lock = await db.query(
    `UPDATE messages
     SET api_message_status = 'SENDING'
     WHERE id = $1
       AND UPPER(COALESCE(api_message_status, 'PENDING')) IN ('PENDING', 'FAILED')
     RETURNING id`,
    [context.message_id]
  );
  return (lock.rowCount ?? 0) > 0 ? 'send' : 'uncertain';
}

async function deliverToProvider(
  context: RecipientDeliveryContext,
  meta: Awaited<ReturnType<typeof resolveChat>>,
  content: string,
  personalizationNow: Date,
): Promise<string | null> {
  const media = normalizeCampaignMediaPayload(context.media_payload);
  if (context.delivery_channel === 'messenger' || context.delivery_channel === 'instagram') {
    if (!meta.metaChannel || !meta.metaExternalUserId) {
      throw new Error('Contexto Meta incompleto para a campanha.');
    }
    const service = context.delivery_channel === 'instagram'
      ? new InstagramMessagingService(meta.metaChannel)
      : new MessengerMessagingService(meta.metaChannel);
    const response = await service.sendMessage({
      recipientId: meta.metaExternalUserId,
      type: media ? media.type : 'text',
      text: content,
      mediaUrl: media?.url,
    });
    return response?.message_id || response?.id || null;
  }

  const instanceName = context.destination_id || context.instance_name;
  if (context.delivery_channel === 'telegram') {
    if (media) {
      throw new Error('Anexos de campanha ainda nao estao disponiveis para Telegram.');
    }
    if (!context.phone_number_jid?.startsWith('telegram:')) {
      throw new Error('Contato sem identificador Telegram valido.');
    }
    const credentials = await db.query(
      `SELECT bot_token
       FROM telegram_bot_instances
       WHERE workspace_id = $1 AND instance_name = $2
       LIMIT 1`,
      [context.workspace_id, instanceName]
    );
    const botToken = credentials.rows[0]?.bot_token;
    if (!botToken) {
      throw new Error('Credenciais do bot Telegram nao encontradas.');
    }
    const response = await sendTelegramTextMessage(botToken, context.phone_number_jid, content);
    return response?.message_id ? `telegram:${response.message_id}` : null;
  }

  if (!context.phone_number_jid) {
    throw new Error('Contato sem telefone WhatsApp valido.');
  }
  const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId: context.workspace_id });
  if (!apiConfig) {
    throw new Error(`Configuracao da API nao encontrada para ${instanceName}.`);
  }

  if (media) {
    if (context.delivery_channel !== 'whatsapp_baileys') {
      throw new Error('Anexos de campanha estao disponiveis apenas para WhatsApp conectado.');
    }

    if (media.type === 'image') {
      const response = await sendCampaignImageUrl(apiConfig, instanceName, {
        number: context.phone_number_jid,
        mediaUrl: media.url,
        mimetype: media.mimetype,
        filename: media.filename,
        caption: content,
      });
      return providerMessageId(response);
    }

    const response = await sendAudioMessage(apiConfig, instanceName, {
      number: context.phone_number_jid,
      audio: media.url,
      mimetype: media.mimetype,
      fileName: media.filename,
    });
    return providerMessageId(response);
  }

  if (context.delivery_channel === 'whatsapp_cloud' && context.template_payload) {
    const response = await sendTemplateMessage(apiConfig, instanceName, {
      number: context.phone_number_jid,
      name: context.template_payload.name,
      language: context.template_payload.language,
      components: buildCampaignTemplateSendComponents(context.template_payload, {
        contactName: context.contact_name,
        campaignMessage: context.message,
        now: personalizationNow,
        timeZone: context.schedule_config?.timeZone,
      }),
    });
    return providerMessageId(response);
  }

  const response = await sendTextMessage(
    apiConfig,
    instanceName,
    context.phone_number_jid,
    content
  );
  return providerMessageId(response);
}

async function updateCampaignCompletion(campaignId: string): Promise<void> {
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       COUNT(*) FILTER (WHERE status IN ('waiting', 'scheduled', 'processing', 'paused'))::int AS active
     FROM campaign_recipients
     WHERE campaign_id = $1`,
    [campaignId]
  );
  const totals = result.rows[0];
  if (!totals || Number(totals.active) > 0) {
    return;
  }

  const finalStatus = Number(totals.total) > 0
    && Number(totals.failed) === 0
    && Number(totals.sent) + Number(totals.cancelled) === Number(totals.total)
    ? 'completed'
    : 'failed';
  await db.query(
    `UPDATE campaigns
     SET status = $1,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $2
       AND status NOT IN ('cancelled', 'paused')`,
    [finalStatus, campaignId]
  );
}

async function maybeAutoPauseCampaign(context: RecipientDeliveryContext): Promise<void> {
  const config = context.schedule_config || ({} as CampaignScheduleConfig);
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('sent', 'failed'))::int AS attempted,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM campaign_recipients
     WHERE campaign_id = $1`,
    [context.campaign_id]
  );
  const attempted = Number(result.rows[0]?.attempted || 0);
  const failed = Number(result.rows[0]?.failed || 0);
  const minAttempts = Number(config.autoPauseMinAttempts || 20);
  const threshold = Number(config.autoPauseFailureRate || 20);
  if (attempted < minAttempts || failed / attempted * 100 < threshold) {
    return;
  }

  const reason = `Pausa automatica: ${failed} falhas em ${attempted} tentativas (${Math.round(failed / attempted * 100)}%).`;
  const pause = await db.query(
    `UPDATE campaigns
     SET status = 'paused',
         paused_at = NOW(),
         pause_reason = $1,
         updated_at = NOW()
     WHERE id = $2
       AND status IN ('scheduled', 'sending')
     RETURNING id`,
    [reason, context.campaign_id]
  );
  if ((pause.rowCount ?? 0) > 0) {
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'paused',
           locked_at = NULL,
           locked_by = NULL,
           updated_at = NOW()
       WHERE campaign_id = $1
         AND status IN ('waiting', 'scheduled')`,
      [context.campaign_id]
    );
  }
}

async function markRecipientFailure(context: RecipientDeliveryContext, error: unknown): Promise<void> {
  const message = errorMessage(error).slice(0, 2_000);
  await db.query(
    `UPDATE messages
     SET api_message_status = 'FAILED',
         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{send_error}', to_jsonb($1::text), true)
     WHERE id = $2
       AND message_id_from_api IS NULL`,
    [message, context.message_id]
  );

  const endAt = context.scheduled_end_at ? new Date(context.scheduled_end_at) : null;
  const canRetry = context.attempt_count < context.max_attempts
    && (!endAt || Date.now() + 60_000 < endAt.getTime())
    && !/entrega incerta/i.test(message);
  const retryDelaySeconds = Math.min(15 * 60, 30 * 2 ** Math.max(0, context.attempt_count - 1));
  await db.query(
    `UPDATE campaign_recipients
     SET status = $1,
         scheduled_at = CASE WHEN $1 = 'scheduled' THEN NOW() + ($2::text || ' seconds')::interval ELSE scheduled_at END,
         error_message = $3,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     WHERE id = $4`,
    [canRetry ? 'scheduled' : 'failed', retryDelaySeconds, message, context.id]
  );

  if (!canRetry) {
    await maybeAutoPauseCampaign(context);
    await updateCampaignCompletion(context.campaign_id);
  }
}

async function processClaimedRecipient(claimed: ClaimedRecipient): Promise<void> {
  const context = await loadDeliveryContext(claimed.id);
  if (context.campaign_status === 'cancelled' || context.campaign_status === 'paused') {
    await db.query(
      `UPDATE campaign_recipients
       SET status = $1, locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $2`,
      [context.campaign_status, context.id]
    );
    return;
  }
  if (context.marketing_opt_out_at) {
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'cancelled',
           cancelled_at = NOW(),
           error_message = 'Contato marcou opt-out antes do envio.',
           locked_at = NULL,
           locked_by = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [context.id]
    );
    await updateCampaignCompletion(context.campaign_id);
    return;
  }

  const now = new Date();
  const content = renderCampaignMessage(context.message, {
    contactName: context.contact_name,
    now,
    timeZone: context.schedule_config?.timeZone,
  });
  try {
    const resolvedChat = await resolveChat(context);
    const messageState = await prepareIdempotentMessage(context, resolvedChat.chatId, content);
    if (messageState === 'uncertain') {
      throw new Error('Entrega incerta; reenvio automatico bloqueado para evitar duplicidade.');
    }

    if (messageState === 'send') {
      const externalId = await deliverToProvider(context, resolvedChat, content, now);
      await db.query(
        `UPDATE messages
         SET api_message_status = 'SENT',
             message_id_from_api = $1
         WHERE id = $2`,
        [externalId, context.message_id]
      );
    }

    await db.query(
      `UPDATE campaign_recipients
       SET status = 'sent',
           sent_at = COALESCE(sent_at, NOW()),
           error_message = NULL,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [context.id]
    );
    await updateCampaignCompletion(context.campaign_id);
  } catch (error) {
    await markRecipientFailure(context, error);
  }
}

export function startCampaignWorker(options?: {
  workerId?: string;
  pollMs?: number;
  concurrency?: number;
  lockMs?: number;
}) {
  const workerId = options?.workerId || process.env.CAMPAIGN_WORKER_ID || `campaign-worker-${process.pid}`;
  const pollMs = options?.pollMs || envPositiveInt('CAMPAIGN_WORKER_POLL_MS', DEFAULT_POLL_MS);
  const concurrency = options?.concurrency || envPositiveInt('CAMPAIGN_WORKER_CONCURRENCY', 2);
  const lockMs = options?.lockMs || envPositiveInt('CAMPAIGN_WORKER_LOCK_MS', DEFAULT_LOCK_MS);
  let stopping = false;

  const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
  const processOne = async (): Promise<boolean> => {
    const claimed = await claimDueRecipient(workerId);
    if (!claimed) {
      return false;
    }
    await processClaimedRecipient(claimed);
    return true;
  };

  const loop = (async () => {
    await recoverStaleClaims(lockMs);
    console.log(`[CAMPAIGN_WORKER] Ready. workerId=${workerId} concurrency=${concurrency}`);
    while (!stopping) {
      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, () => processOne())
      );
      const processed = results.some(result => result.status === 'fulfilled' && result.value);
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[CAMPAIGN_WORKER] Processing failure:', result.reason);
        }
      }
      if (!processed) {
        await delay(pollMs);
      }
    }
  })();

  return {
    workerId,
    async close() {
      stopping = true;
      await loop;
    },
  };
}
