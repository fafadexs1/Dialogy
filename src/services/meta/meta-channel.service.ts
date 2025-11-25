import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import type { Chat, Contact, Message, MessageMetadata } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';

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

type ChatRow = Pick<Chat, 'id' | 'workspace_id' | 'status' | 'contact_id' | 'agent'> & {
  contact_id: string;
  agent_id?: string | null;
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
      SELECT mc.*, c.*
      FROM meta_contacts mc 
      JOIN contacts c ON c.id = mc.contact_id
      WHERE mc.channel_id = $1 AND mc.external_id = $2
      LIMIT 1
    `,
    [channel.id, externalId]
  );

  if (rows[0]) {
    const metaContact: MetaContactRecord = {
      id: rows[0].id,
      channel_id: rows[0].channel_id,
      contact_id: rows[0].contact_id,
      external_id: rows[0].external_id,
      username: rows[0].username,
      name: rows[0].name,
      profile_pic: rows[0].profile_pic,
    };

    const contact: ContactRow = {
      id: rows[0].contact_id,
      workspace_id: rows[0].workspace_id,
      name: rows[0].name || profile?.name || 'Contato Meta',
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
  let contactRow: ContactRow | null = null;
  try {
    const contactInsert = await db.query(
      `
        INSERT INTO contacts (id, workspace_id, name, avatar_url, phone_number_jid)
        VALUES ($1, $2, $3, $4, NULL)
        RETURNING *
      `,
      [randomUUID(), channel.workspace_id, displayName, profile?.avatarUrl ?? null]
    );
    contactRow = contactInsert.rows[0];
  } catch (error: any) {
    // Se já existe um contato com phone_number_jid vazio/null, reutiliza para não quebrar o fluxo
    const fallback = await db.query(
      `
        SELECT * FROM contacts
        WHERE workspace_id = $1 AND (phone_number_jid IS NULL OR phone_number_jid = '')
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [channel.workspace_id]
    );
    if (fallback.rows[0]) {
      contactRow = fallback.rows[0];
    } else {
      throw error;
    }
  }

  const metaInsert = await db.query(
    `
      INSERT INTO meta_contacts (id, channel_id, contact_id, external_id, username, name, profile_pic)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
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

  return { contact: contactRow, metaContact: metaInsert.rows[0] };
}

async function ensureConversation(
  channel: MetaChannelRecord,
  metaContact: MetaContactRecord,
  threadKey: string,
  platform: MetaChannelType
): Promise<{ chat: ChatRow; conversation: MetaConversationRecord }> {
  const existing = await db.query(
    `
      SELECT mc.*, ch.*
      FROM meta_conversations mc
      JOIN chats ch ON ch.id = mc.chat_id
      WHERE mc.channel_id = $1 AND mc.external_thread_id = $2
      LIMIT 1
    `,
    [channel.id, threadKey]
  );

  if (existing.rows[0]) {
    const chat: ChatRow = {
      id: existing.rows[0].chat_id,
      workspace_id: existing.rows[0].workspace_id,
      status: existing.rows[0].status,
      contact_id: existing.rows[0].contact_id,
      agent_id: existing.rows[0].agent_id,
      agent: undefined,
    };

    const conversation: MetaConversationRecord = {
      id: existing.rows[0].id,
      channel_id: existing.rows[0].channel_id,
      meta_contact_id: existing.rows[0].meta_contact_id,
      chat_id: existing.rows[0].chat_id,
      external_thread_id: existing.rows[0].external_thread_id,
      platform: existing.rows[0].platform,
    };

    return { chat, conversation };
  }

  const chatInsert = await db.query(
    `
      INSERT INTO chats (id, workspace_id, contact_id, status)
      VALUES ($1, $2, $3, 'gerais')
      RETURNING *
    `,
    [randomUUID(), channel.workspace_id, metaContact.contact_id]
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
}) {
  const id = randomUUID();
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
  } = params;

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
    contact,
    messages: [],
  };

  if (direction === 'incoming') {
    dispatchMessageToWebhooks(chatForDispatch, persistedMessage, channel.name || platform).catch((error) => {
      console.error('[META_WEBHOOK_DISPATCH] Failed to dispatch incoming message', error);
    });
  }

  return persistedMessage;
}
