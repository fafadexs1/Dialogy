import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { resilientFetch } from '@/lib/http/resilient-fetch';
import type { Chat, Contact, Message, MessageMetadata } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';
import { enqueueAiAutopilotProcess, enqueueWebhookOutbound, shouldEnqueueJob } from '@/lib/queue';
import { buildChatProtocol } from '@/lib/utils';

export type MetaChannelType = 'instagram' | 'messenger';

export type MetaChannelRecord = {
  id: string;
  workspace_id: string;
  type: MetaChannelType;
  external_page_id: string | null;
  ig_business_id: string | null;
  access_token: string;
  app_secret: string | null;
  verify_token: string;
  name: string | null;
  status: string | null;
  settings?: Record<string, any> | null;
};

type MetaChannelSettings = {
  fb_user_id?: string;
  fb_user_access_token?: string;
  fb_user_token_expires_at?: string;
};

export type MetaContactRecord = {
  id: string;
  channel_id: string;
  contact_id: string;
  external_id: string;
  username: string | null;
  name: string | null;
  profile_pic: string | null;
};

export type MetaConversationRecord = {
  id: string;
  channel_id: string;
  meta_contact_id: string;
  chat_id: string;
  external_thread_id: string;
  platform: MetaChannelType;
};

type ContactRow = Pick<
  Contact,
  'id' | 'workspace_id' | 'name' | 'avatar_url' | 'email' | 'phone' | 'phone_number_jid' | 'address'
>;

type ChatRow = Pick<Chat, 'id' | 'workspace_id' | 'status' | 'agent' | 'protocol'> & {
  contact_id: string;
  agent_id?: string | null;
  assigned_system_agent_id?: string | null;
  is_autopilot_active?: boolean | null;
  autopilot_config_id?: string | null;
  copilot_mode?: 'auto' | 'suggest' | 'off' | null;
};

export async function findChannelByVerifyToken(
  type: MetaChannelType,
  verifyToken: string
): Promise<MetaChannelRecord | null> {
  const { rows } = await db.query(
    `SELECT * FROM meta_channels WHERE type = $1 AND verify_token = $2 LIMIT 1`,
    [type, verifyToken]
  );
  return rows[0] || null;
}

export async function findChannelByExternalId(
  type: MetaChannelType,
  externalId: string
): Promise<MetaChannelRecord | null> {
  const { rows } = await db.query(
    `
      SELECT * FROM meta_channels 
      WHERE type = $1 
        AND (
          external_page_id = $2 
          OR ig_business_id = $2
        )
      LIMIT 1
    `,
    [type, externalId]
  );
  return rows[0] || null;
}

export async function getChannelById(channelId: string): Promise<MetaChannelRecord | null> {
  const { rows } = await db.query(`SELECT * FROM meta_channels WHERE id = $1 LIMIT 1`, [channelId]);
  return rows[0] || null;
}

const TOKEN_EXPIRY_LEEWAY_MS = 60 * 1000;

function normalizeSettings(settings: any): Record<string, any> {
  if (!settings || typeof settings !== 'object') return {};
  return { ...settings };
}

function parseExpiresAt(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export async function exchangeFacebookUserToken(
  userToken: string
): Promise<{ accessToken: string; expiresAt?: string } | null> {
  const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return null;
  }

  const url = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(
    appId
  )}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(userToken)}`;

  try {
    const res = await resilientFetch(url);
    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.access_token) {
      console.error('[META_TOKEN_EXCHANGE] Failed to exchange user token', JSON.stringify(json));
      return null;
    }

    const expiresInRaw = json.expires_in;
    const expiresIn =
      typeof expiresInRaw === 'number'
        ? expiresInRaw
        : Number.parseInt(String(expiresInRaw), 10);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined;

    return { accessToken: json.access_token, expiresAt };
  } catch (error) {
    console.error('[META_TOKEN_EXCHANGE] Request failed', error);
    return null;
  }
}

export async function refreshMetaChannelAccessToken(
  channel: MetaChannelRecord
): Promise<MetaChannelRecord | null> {
  try {
    const channelRecord = channel.settings ? channel : await getChannelById(channel.id);
    if (!channelRecord) return null;

    const settings = normalizeSettings(channelRecord.settings);
    const metaSettings = settings as MetaChannelSettings;

    let userAccessToken = metaSettings.fb_user_access_token;
    if (!userAccessToken) {
      console.error('[META_TOKEN_REFRESH] CRITICAL: Missing user access token for channel', channelRecord.id);
      return null;
    }

    const expiresAtMs = parseExpiresAt(metaSettings.fb_user_token_expires_at);

    // We check expiry but DO NOT BLOCK the refresh attempt.
    // Sometimes the local date is skewed or FB allows grace periods.
    if (expiresAtMs && expiresAtMs <= Date.now() + TOKEN_EXPIRY_LEEWAY_MS) {
      console.warn('[META_TOKEN_REFRESH] User token expired locally. Attempting refresh anyway...', {
        id: channelRecord.id,
        expiresAt: new Date(expiresAtMs).toISOString()
      });
    }

    const exchanged = await exchangeFacebookUserToken(userAccessToken);

    if (exchanged?.accessToken) {
      userAccessToken = exchanged.accessToken;
      metaSettings.fb_user_access_token = exchanged.accessToken;
      if (exchanged.expiresAt) {
        metaSettings.fb_user_token_expires_at = exchanged.expiresAt;
      }
    }

    if (!channelRecord.external_page_id) {
      console.warn('[META_TOKEN_REFRESH] Missing page id for channel', channelRecord.id);
      return null;
    }

    const pageUrl = `https://graph.facebook.com/v20.0/${channelRecord.external_page_id}?fields=access_token&access_token=${encodeURIComponent(
      userAccessToken
    )}`;

    const pageRes = await resilientFetch(pageUrl);
    const pageJson = await pageRes.json().catch(() => ({}));

    if (!pageRes.ok || !pageJson.access_token) {
      console.warn('[META_TOKEN_REFRESH] Failed to fetch page access token', pageJson);
      return null;
    }

    const updated = await db.query(
      `UPDATE meta_channels SET access_token = $1, settings = $2, updated_at = timezone('utc', now()) WHERE id = $3 RETURNING *`,
      [pageJson.access_token, settings, channelRecord.id]
    );

    return updated.rows[0] || null;
  } catch (error) {
    console.error('[META_TOKEN_REFRESH] EXCEPTION during refresh:', error);
    return null;
  }
}

export async function logWebhookEvent(params: {
  channelId?: string | null;
  source: string;
  direction?: 'incoming' | 'outgoing';
  event?: string;
  statusCode?: number | null;
  payload?: any;
  headers?: Record<string, any>;
  responseBody?: any;
}) {
  const {
    channelId,
    source,
    direction = 'incoming',
    event,
    statusCode,
    payload,
    headers,
    responseBody,
  } = params;

  await db.query(
    `
      INSERT INTO webhook_logs (id, channel_id, source, direction, event, status_code, payload, headers, response_body)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      randomUUID(),
      channelId ?? null,
      source,
      direction,
      event ?? null,
      statusCode ?? null,
      payload ?? null,
      headers ?? null,
      responseBody ?? null,
    ]
  );
}

async function ensureContact(
  channel: MetaChannelRecord,
  externalId: string,
  profile?: { name?: string; username?: string; avatarUrl?: string }
): Promise<{ contact: ContactRow; metaContact: MetaContactRecord }> {
  const { rows } = await db.query(
    `
      SELECT
        mc.id AS meta_contact_id,
        mc.channel_id,
        mc.contact_id,
        mc.external_id,
        mc.username,
        mc.name AS meta_name,
        mc.profile_pic,
        c.id AS contact_row_id,
        c.workspace_id,
        c.name AS contact_name,
        c.avatar_url,
        c.email,
        c.phone,
        c.phone_number_jid,
        c.address
      FROM meta_contacts mc 
      JOIN contacts c ON c.id = mc.contact_id
      WHERE mc.channel_id = $1 AND mc.external_id = $2
      LIMIT 1
    `,
    [channel.id, externalId]
  );

  if (rows[0]) {
    const metaContact: MetaContactRecord = {
      id: rows[0].meta_contact_id,
      channel_id: rows[0].channel_id,
      contact_id: rows[0].contact_id,
      external_id: rows[0].external_id,
      username: rows[0].username,
      name: rows[0].meta_name,
      profile_pic: rows[0].profile_pic,
    };

    const contact: ContactRow = {
      id: rows[0].contact_row_id,
      workspace_id: rows[0].workspace_id,
      name: rows[0].contact_name || rows[0].meta_name || profile?.name || 'Contato Meta',
      avatar_url: rows[0].avatar_url,
      email: rows[0].email,
      phone: rows[0].phone,
      phone_number_jid: rows[0].phone_number_jid,
      address: rows[0].address,
    };

    return { contact, metaContact };
  }

  const displayName =
    profile?.name ||
    profile?.username ||
    `Meta User ${externalId.slice(-6)}`;

  // Cria contato (sem phone_number_jid para evitar conflito com índice único)
  const contactInsert = await db.query(
    `
      INSERT INTO contacts (id, workspace_id, name, avatar_url, phone_number_jid)
      VALUES ($1, $2, $3, $4, NULL)
      RETURNING *
    `,
    [randomUUID(), channel.workspace_id, displayName, profile?.avatarUrl ?? null]
  );
  const insertedContactRow = contactInsert.rows[0] as ContactRow | undefined;
  if (!insertedContactRow) throw new Error("Failed to resolve contact");
  let contactRow: ContactRow = insertedContactRow;

  const metaInsert = await db.query(
    `
      INSERT INTO meta_contacts (id, channel_id, contact_id, external_id, username, name, profile_pic)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (channel_id, external_id) DO UPDATE
      SET username = COALESCE(EXCLUDED.username, meta_contacts.username),
          name = COALESCE(EXCLUDED.name, meta_contacts.name),
          profile_pic = COALESCE(EXCLUDED.profile_pic, meta_contacts.profile_pic),
          updated_at = timezone('utc', now())
      RETURNING *
    `,
    [
      randomUUID(),
      channel.id,
      contactRow.id,
      externalId,
      profile?.username ?? null,
      displayName,
      profile?.avatarUrl ?? null,
    ]
  );

  const metaContact: MetaContactRecord = metaInsert.rows[0];

  if (metaContact.contact_id !== contactRow.id) {
    const existingContact = await db.query(
      `SELECT * FROM contacts WHERE id = $1 LIMIT 1`,
      [metaContact.contact_id]
    );
    contactRow = existingContact.rows[0] || contactRow;
  }

  // Update the contact to reference the meta_contact for easier debugging and queries
  await db.query(
    `UPDATE contacts SET meta_contact_id = $1 WHERE id = $2`,
    [metaContact.id, contactRow.id]
  );

  return { contact: contactRow, metaContact };
}

async function ensureConversation(
  channel: MetaChannelRecord,
  metaContact: MetaContactRecord,
  threadKey: string,
  platform: MetaChannelType
): Promise<{ chat: ChatRow; conversation: MetaConversationRecord }> {
  const existing = await db.query(
    `
      SELECT 
        mc.id AS conversation_id,
        mc.channel_id,
        mc.meta_contact_id,
        mc.chat_id AS conversation_chat_id,
        mc.external_thread_id,
        mc.platform AS conversation_platform,
        mc.status AS conversation_status,
        ch.id AS chat_id,
        ch.workspace_id,
        ch.status AS chat_status,
        ch.contact_id,
        ch.agent_id,
        ch.assigned_system_agent_id,
        ch.is_autopilot_active,
        ch.autopilot_config_id,
        ch.copilot_mode,
        ch.protocol AS chat_protocol
      FROM meta_conversations mc
      JOIN chats ch ON ch.id = mc.chat_id
      WHERE mc.channel_id = $1 AND mc.external_thread_id = $2
      LIMIT 1
    `,
    [channel.id, threadKey]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];

    // Se a conversa anterior foi encerrada, criamos um novo chat e
    // reusamos o mesmo meta_conversation para que um novo atendimento seja aberto.
    if (row.chat_status === 'encerrados' || row.conversation_status === 'closed') {
      const newChatId = randomUUID();
      const protocol = buildChatProtocol(newChatId);
      const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
      const chatLimitStatus = await getMonthlyChatLimitStatus(row.workspace_id);
      if (!chatLimitStatus.allowed) {
        throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
      }
      const newChatInsert = await db.query(
        `
          INSERT INTO chats (id, workspace_id, contact_id, status, protocol)
          VALUES ($1, $2, $3, 'gerais', $4)
          RETURNING *
        `,
        [newChatId, channel.workspace_id, metaContact.contact_id, protocol]
      );

      const newChatRow = newChatInsert.rows[0];

      await db.query(
        `
          UPDATE meta_conversations
          SET chat_id = $1, status = 'open', updated_at = timezone('utc', now())
          WHERE id = $2
        `,
        [newChatRow.id, row.conversation_id]
      );

      const conversation: MetaConversationRecord = {
        id: row.conversation_id,
        channel_id: row.channel_id,
        meta_contact_id: row.meta_contact_id,
        chat_id: newChatRow.id,
        external_thread_id: row.external_thread_id,
        platform: row.conversation_platform,
      };

      const chat: ChatRow = {
        id: newChatRow.id,
        workspace_id: newChatRow.workspace_id,
        status: newChatRow.status,
        contact_id: newChatRow.contact_id,
        agent_id: newChatRow.agent_id,
        assigned_system_agent_id: newChatRow.assigned_system_agent_id,
        is_autopilot_active: newChatRow.is_autopilot_active,
        autopilot_config_id: newChatRow.autopilot_config_id,
        copilot_mode: newChatRow.copilot_mode,
        agent: undefined,
        protocol: newChatRow.protocol,
      };

      return { chat, conversation };
    }

    const chat: ChatRow = {
      id: row.chat_id,
      workspace_id: row.workspace_id,
      status: row.chat_status,
      contact_id: row.contact_id,
      agent_id: row.agent_id,
      assigned_system_agent_id: row.assigned_system_agent_id,
      is_autopilot_active: row.is_autopilot_active,
      autopilot_config_id: row.autopilot_config_id,
      copilot_mode: row.copilot_mode,
      agent: undefined,
      protocol: row.chat_protocol || buildChatProtocol(row.chat_id),
    };

    const conversation: MetaConversationRecord = {
      id: row.conversation_id,
      channel_id: row.channel_id,
      meta_contact_id: row.meta_contact_id,
      chat_id: row.chat_id,
      external_thread_id: row.external_thread_id,
      platform: row.conversation_platform,
    };

    return { chat, conversation };
  }

  const newChatId = randomUUID();
  const protocol = buildChatProtocol(newChatId);
  const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
  const chatLimitStatus = await getMonthlyChatLimitStatus(channel.workspace_id);
  if (!chatLimitStatus.allowed) {
    throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
  }
  const chatInsert = await db.query(
    `
      INSERT INTO chats (id, workspace_id, contact_id, status, protocol)
      VALUES ($1, $2, $3, 'gerais', $4)
      RETURNING *
    `,
    [newChatId, channel.workspace_id, metaContact.contact_id, protocol]
  );

  const chatRow: ChatRow = chatInsert.rows[0];

  const conversationInsert = await db.query(
    `
      INSERT INTO meta_conversations (id, channel_id, meta_contact_id, chat_id, external_thread_id, platform)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [randomUUID(), channel.id, metaContact.id, chatRow.id, threadKey, platform]
  );

  return { chat: chatRow, conversation: conversationInsert.rows[0] };
}

export async function resolveMetaContext(params: {
  channel: MetaChannelRecord;
  externalUserId: string;
  platform: MetaChannelType;
  profile?: { name?: string; username?: string; avatarUrl?: string };
  threadKey?: string;
}) {
  const { channel, externalUserId, profile, platform } = params;
  const threadKey = params.threadKey || externalUserId;

  const { contact, metaContact } = await ensureContact(channel, externalUserId, profile);
  const { chat, conversation } = await ensureConversation(channel, metaContact, threadKey, platform);

  await db.query(
    `UPDATE meta_conversations SET last_message_at = timezone('utc', now()) WHERE id = $1`,
    [conversation.id]
  );

  return { contact, metaContact, chat, conversation };
}

export async function persistNormalizedMessage(params: {
  channel: MetaChannelRecord;
  chat: ChatRow;
  contact: ContactRow;
  message: {
    type: Message['type'];
    content: string | null;
    metadata?: MessageMetadata;
    mediaUrl?: string | null;
  };
  platform: MetaChannelType;
  direction: 'incoming' | 'outgoing';
  externalMessageId?: string | null;
  externalSenderId?: string | null;
  externalChannelId?: string | null;
  rawPayload?: any;
  fromMe?: boolean;
  senderUserId?: string | null;
  senderSystemAgentId?: string | null;
  id?: string;
}) {
  const {
    channel,
    chat,
    contact,
    message,
    platform,
    direction,
    externalMessageId,
    externalSenderId,
    externalChannelId,
    rawPayload,
    fromMe = direction === 'outgoing',
    senderUserId,
    senderSystemAgentId,
    id: providedId,
  } = params;

  const id = providedId || randomUUID();

  const result = await db.query(
    `
      INSERT INTO messages (
        id,
        workspace_id,
        chat_id,
        sender_user_id,
        sender_system_agent_id,
        type,
        content,
        from_me,
        is_read,
        message_id_from_api,
        api_message_status,
        instance_name,
        sender_from_api,
        source_from_api,
        raw_payload,
        metadata,
        transcription,
        sent_by_tab,
        platform,
        external_message_id,
        external_sender_id,
        external_channel_id,
        direction,
        media_url
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10, $11, $12, $13, $14, $15, NULL, NULL, $16, $17, $18, $19, $20, $21
      )
      RETURNING *
    `,
    [
      id,
      channel.workspace_id,
      chat.id,
      senderUserId ?? null,
      senderSystemAgentId ?? null,
      message.type,
      message.content,
      fromMe,
      externalMessageId ?? null,
      direction === 'outgoing' ? 'sent' : 'received',
      channel.name ?? null,
      externalSenderId ?? null,
      platform,
      rawPayload ?? null,
      {
        ...(message.metadata || {}),
        mediaUrl: message.mediaUrl ?? undefined,
      },
      platform,
      externalMessageId ?? null,
      externalSenderId ?? null,
      externalChannelId ?? null,
      direction,
      message.mediaUrl ?? null,
    ]
  );

  const row = result.rows[0];

  const persistedMessage: Message = {
    id: row.id,
    chat_id: row.chat_id,
    workspace_id: row.workspace_id,
    content: row.content || '',
    type: row.type,
    status: 'default',
    metadata: row.metadata || {},
    transcription: row.transcription,
    timestamp: new Date(row.created_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    formattedDate: new Date(row.created_at).toISOString(),
    sender: undefined,
    instance_name: row.instance_name || undefined,
    source_from_api: row.source_from_api || undefined,
    api_message_status: row.api_message_status || undefined,
    message_id_from_api: row.message_id_from_api || undefined,
    from_me: row.from_me,
    is_read: row.is_read,
    direction: row.direction || direction,
    platform: row.platform || platform,
    externalMessageId: row.external_message_id || externalMessageId || undefined,
    externalSenderId: row.external_sender_id || externalSenderId || undefined,
    externalChannelId: row.external_channel_id || externalChannelId || undefined,
    mediaUrl: row.media_url || message.mediaUrl || undefined,
    updatedAt: row.created_at,
  };

  const chatForDispatch: Chat = {
    id: chat.id,
    workspace_id: chat.workspace_id,
    status: chat.status as Chat['status'],
    contact: contact as any,
    messages: [],
    assigned_system_agent_id: chat.assigned_system_agent_id,
    is_autopilot_active: Boolean(chat.is_autopilot_active),
    autopilot_config_id: chat.autopilot_config_id,
    copilot_mode: chat.copilot_mode || undefined,
  };

  if (direction === 'incoming') {
    const instanceName = channel.name || platform;
    const webhookDispatch = shouldEnqueueJob('webhook_outbound')
      ? enqueueWebhookOutbound({
        chatId: chatForDispatch.id,
        messageId: persistedMessage.id,
        instanceName,
      })
      : dispatchMessageToWebhooks(chatForDispatch, persistedMessage, instanceName);

    webhookDispatch.catch((error) => {
      console.error('[META_WEBHOOK_DISPATCH] Failed to dispatch incoming message', error);
    });

    const shouldProcessAi =
      Boolean(chat.assigned_system_agent_id) &&
      Boolean(chat.is_autopilot_active) &&
      Boolean(message.content?.trim());

    if (shouldProcessAi) {
      const autopilotProcess = shouldEnqueueJob('ai_autopilot_process')
        ? enqueueAiAutopilotProcess({
          workspaceId: channel.workspace_id,
          chatId: chat.id,
          messageId: persistedMessage.id,
          lastMessageContent: message.content!.trim(),
          instanceName,
        })
        : import('@/services/autopilot-service').then(({ processAutopilotForChat }) =>
          processAutopilotForChat(channel.workspace_id, chatForDispatch, message.content!.trim(), instanceName, persistedMessage.id)
        );

      autopilotProcess.catch((error) => {
        console.error('[META_AUTOPILOT] Failed to process incoming message', error);
      });
    }
  }

  return persistedMessage;
}
