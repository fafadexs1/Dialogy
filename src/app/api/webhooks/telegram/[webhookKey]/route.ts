import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import type { Chat, Contact, Message, MessageMetadata } from '@/lib/types';
import { buildChatProtocol } from '@/lib/utils';
import { processAutopilotForChat } from '@/services/autopilot-service';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';
import { getTelegramInstanceByWebhookKey } from '@/services/telegram/instance-store';

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChatPayload = {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessagePayload = {
  message_id: number;
  date?: number;
  from?: TelegramUser;
  chat: TelegramChatPayload;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id?: string }>;
  document?: { file_id?: string; file_name?: string; mime_type?: string };
  video?: { file_id?: string; mime_type?: string };
  voice?: { file_id?: string; mime_type?: string };
  audio?: { file_id?: string; mime_type?: string };
  sticker?: { file_id?: string };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessagePayload;
  edited_message?: TelegramMessagePayload;
};

function pickTelegramMessage(update: TelegramUpdate): TelegramMessagePayload | null {
  return update.message || update.edited_message || null;
}

function resolveTelegramEventType(update: TelegramUpdate): 'message' | 'edited_message' {
  return update.edited_message ? 'edited_message' : 'message';
}

function resolveTelegramDisplayName(message: TelegramMessagePayload): string {
  const from = message.from;
  const chat = message.chat;
  const senderName = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();

  return (
    senderName ||
    from?.username ||
    chat.title ||
    chat.username ||
    [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() ||
    `Telegram ${chat.id}`
  );
}

function normalizeTelegramMessage(message: TelegramMessagePayload): {
  type: Message['type'];
  content: string;
  metadata?: MessageMetadata;
} {
  const baseTelegramMetadata: NonNullable<MessageMetadata['telegram']> = {
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    chatTitle: message.chat.title,
    username: message.from?.username || message.chat.username,
    fromId: message.from?.id ? String(message.from.id) : undefined,
  };

  if (message.text?.trim()) {
    return {
      type: 'text',
      content: message.text.trim(),
      metadata: { telegram: baseTelegramMetadata },
    };
  }

  if (message.caption?.trim() && message.photo) {
    return {
      type: 'image',
      content: message.caption.trim(),
      metadata: { telegram: baseTelegramMetadata },
    };
  }

  if (message.photo) {
    return {
      type: 'image',
      content: '[Imagem recebida no Telegram]',
      metadata: { telegram: baseTelegramMetadata },
    };
  }

  if (message.video) {
    return {
      type: 'video',
      content: message.caption?.trim() || '[Video recebido no Telegram]',
      metadata: {
        telegram: baseTelegramMetadata,
        mimetype: message.video.mime_type,
      },
    };
  }

  if (message.voice || message.audio) {
    return {
      type: 'audio',
      content: message.caption?.trim() || '[Audio recebido no Telegram]',
      metadata: {
        telegram: baseTelegramMetadata,
        mimetype: message.voice?.mime_type || message.audio?.mime_type,
      },
    };
  }

  if (message.document) {
    return {
      type: 'document',
      content: message.caption?.trim() || `[Documento recebido no Telegram] ${message.document.file_name || ''}`.trim(),
      metadata: {
        telegram: baseTelegramMetadata,
        mimetype: message.document.mime_type,
        fileName: message.document.file_name,
      },
    };
  }

  if (message.sticker) {
    return {
      type: 'text',
      content: '[Sticker recebido no Telegram]',
      metadata: { telegram: baseTelegramMetadata },
    };
  }

  return {
    type: 'text',
    content: '[Mensagem recebida no Telegram]',
    metadata: { telegram: baseTelegramMetadata },
  };
}

function toMessageTimestamp(value?: number): Date {
  if (!value || !Number.isFinite(value)) {
    return new Date();
  }

  return new Date(value * 1000);
}

function mapSavedMessage(row: any): Message {
  return {
    id: row.id,
    chat_id: row.chat_id,
    workspace_id: row.workspace_id,
    content: row.content || '',
    type: row.type,
    status: 'default',
    metadata: row.metadata || {},
    transcription: row.transcription || null,
    timestamp: new Date(row.created_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    formattedDate: new Date(row.created_at).toISOString(),
    from_me: row.from_me,
    message_id_from_api: row.message_id_from_api || undefined,
    source_from_api: row.source_from_api || undefined,
    instance_name: row.instance_name || undefined,
    api_message_status: row.api_message_status || undefined,
  };
}

async function markTelegramEventProcessed(eventId: string) {
  await db.query(
    `
      UPDATE telegram_webhook_events
      SET processed_at = timezone('utc', now())
      WHERE id = $1
    `,
    [eventId]
  );
}

export async function POST(
  request: Request,
  props: { params: Promise<{ webhookKey: string }> }
) {
  const { webhookKey } = await props.params;
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');

  if (secretHeader && secretHeader !== webhookKey) {
    return NextResponse.json({ error: 'Invalid Telegram webhook secret.' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const instance = await getTelegramInstanceByWebhookKey(webhookKey);
  if (!instance) {
    return NextResponse.json({ error: 'Telegram instance not found.' }, { status: 404 });
  }

  const message = pickTelegramMessage(update);
  const eventType = resolveTelegramEventType(update);
  const messageTimestamp = toMessageTimestamp(message?.date);

  const eventInsert = await db.query(
    `
      INSERT INTO telegram_webhook_events (
        instance_id,
        workspace_id,
        update_id,
        event_type,
        telegram_message_id,
        telegram_chat_id,
        telegram_from_id,
        payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (instance_id, update_id) DO NOTHING
      RETURNING id
    `,
    [
      instance.id,
      instance.workspace_id,
      update.update_id,
      eventType,
      message?.message_id || null,
      message ? String(message.chat.id) : null,
      message?.from?.id ? String(message.from.id) : null,
      update,
    ]
  );

  const eventId = eventInsert.rows[0]?.id as string | undefined;
  if (!eventId) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'duplicate_update' }, { status: 202 });
  }

  if (!message) {
    await markTelegramEventProcessed(eventId);
    return NextResponse.json({ ok: true, ignored: true, reason: 'unsupported_update' }, { status: 202 });
  }

  if (message.from?.id && String(message.from.id) === String(instance.bot_id)) {
    await markTelegramEventProcessed(eventId);
    return NextResponse.json({ ok: true, ignored: true, reason: 'bot_echo' }, { status: 202 });
  }

  const externalMessageId = `telegram:${message.chat.id}:${message.message_id}`;
  const senderFromApi = message.from?.username || (message.from?.id ? String(message.from.id) : null);
  const normalized = normalizeTelegramMessage(message);
  const metadata: MessageMetadata = {
    ...(normalized.metadata || {}),
    telegram: {
      ...(normalized.metadata?.telegram || {}),
      updateId: update.update_id,
      eventType,
      isEdited: eventType === 'edited_message',
    },
  };

  const existingMessage = await db.query(
    `
      SELECT id
      FROM messages
      WHERE workspace_id = $1
        AND message_id_from_api = $2
      LIMIT 1
    `,
    [instance.workspace_id, externalMessageId]
  );

  if (eventType === 'edited_message' && (existingMessage.rowCount ?? 0) > 0) {
    await db.query(
      `
        UPDATE messages
        SET content = $1,
            type = $2,
            metadata = $3,
            raw_payload = $4,
            api_message_status = 'EDITED'
        WHERE id = $5
      `,
      [normalized.content, normalized.type, metadata, update, existingMessage.rows[0].id]
    );
    await markTelegramEventProcessed(eventId);
    return NextResponse.json({ ok: true, updated: true }, { status: 202 });
  }

  let savedChat: Chat | null = null;
  let savedMessage: Message | null = null;
  let createdNewContact = false;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const contactJid = `telegram:${message.chat.id}`;
    let contactRes = await client.query(
      `
        SELECT *
        FROM contacts
        WHERE workspace_id = $1
          AND phone_number_jid = $2
        LIMIT 1
      `,
      [instance.workspace_id, contactJid]
    );

    if ((contactRes.rowCount ?? 0) === 0) {
      createdNewContact = true;
      contactRes = await client.query(
        `
          INSERT INTO contacts (workspace_id, name, phone, phone_number_jid, avatar_url)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [instance.workspace_id, resolveTelegramDisplayName(message), String(message.chat.id), contactJid, null]
      );
    }

    const contact = contactRes.rows[0] as Contact;

    let chatRes = await client.query(
      `
        SELECT *
        FROM chats
        WHERE workspace_id = $1
          AND contact_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [instance.workspace_id, contact.id]
    );

    if ((chatRes.rowCount ?? 0) === 0 || chatRes.rows[0].status === 'encerrados') {
      const chatId = randomUUID();
      const protocol = buildChatProtocol(chatId);
      chatRes = await client.query(
        `
          INSERT INTO chats (id, workspace_id, contact_id, status, protocol)
          VALUES ($1, $2, $3, 'gerais', $4)
          RETURNING *
        `,
        [chatId, instance.workspace_id, contact.id, protocol]
      );
    }

    const chatRow = chatRes.rows[0];

    const insertedMessage = await client.query(
      `
        INSERT INTO messages (
          workspace_id,
          chat_id,
          type,
          content,
          metadata,
          message_id_from_api,
          sender_from_api,
          instance_name,
          source_from_api,
          from_me,
          api_message_status,
          raw_payload,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'telegram', FALSE, 'RECEIVED', $9, $10)
        RETURNING *
      `,
      [
        instance.workspace_id,
        chatRow.id,
        normalized.type,
        normalized.content,
        metadata,
        externalMessageId,
        senderFromApi,
        instance.instance_name,
        update,
        messageTimestamp,
      ]
    );

    await client.query(
      `
        UPDATE telegram_webhook_events
        SET processed_at = timezone('utc', now())
        WHERE id = $1
      `,
      [eventId]
    );

    await client.query('COMMIT');

    savedChat = {
      id: chatRow.id,
      workspace_id: instance.workspace_id,
      status: chatRow.status,
      contact: {
        id: contact.id,
        workspace_id: instance.workspace_id,
        name: contact.name,
        phone: contact.phone,
        phone_number_jid: contact.phone_number_jid,
        avatar_url: contact.avatar_url,
        email: contact.email,
      } as Contact,
      messages: [],
      is_autopilot_active: chatRow.is_autopilot_active,
      agentId: chatRow.agent_id,
    };

    savedMessage = mapSavedMessage(insertedMessage.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[TELEGRAM_WEBHOOK] Falha ao processar update do Telegram:', error);
    return NextResponse.json({ error: 'Failed to process Telegram webhook.' }, { status: 500 });
  } finally {
    client.release();
  }

  if (createdNewContact && savedChat?.contact) {
    try {
      const { evaluateAutomations } = await import('@/lib/automation-engine');
      await evaluateAutomations({
        type: 'contact_created',
        contactId: savedChat.contact.id,
        workspaceId: instance.workspace_id,
        data: { name: savedChat.contact.name, phone: savedChat.contact.phone },
      });
    } catch (error) {
      console.error('[TELEGRAM_WEBHOOK] Falha ao disparar automacoes de contato:', error);
    }
  }

  if (savedChat && savedMessage) {
    try {
      await dispatchMessageToWebhooks(savedChat, savedMessage, instance.instance_name);
    } catch (error) {
      console.error('[TELEGRAM_WEBHOOK] Falha ao despachar webhook de saida:', error);
    }

    if (savedChat.is_autopilot_active) {
      try {
        await processAutopilotForChat(instance.workspace_id, savedChat, savedMessage.content, instance.instance_name);
      } catch (error) {
        console.error('[TELEGRAM_WEBHOOK] Falha ao disparar autopilot:', error);
      }
    }
  }

  return NextResponse.json({ ok: true, routed: 'telegram_native' }, { status: 202 });
}
