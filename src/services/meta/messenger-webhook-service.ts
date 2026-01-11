import type { Message, MessageMetadata } from '@/lib/types';
import {
  MetaChannelRecord,
  resolveMetaContext,
  persistNormalizedMessage,
  logWebhookEvent,
} from './meta-channel.service';

type MessengerEvent = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{
      type: string;
      payload?: { url?: string; title?: string };
    }>;
  };
};

function isEchoMessage(message?: { is_echo?: unknown }): boolean {
  if (!message) return false;
  return message.is_echo === true || message.is_echo === 'true' || message.is_echo === 1 || message.is_echo === '1';
}

function normalizeMessengerMessage(event: MessengerEvent): {
  type: Message['type'];
  content: string | null;
  mediaUrl: string | null;
  metadata: MessageMetadata;
} {
  const msg = event.message;
  if (!msg) {
    return { type: 'text', content: null, mediaUrl: null, metadata: {} };
  }

  let type: Message['type'] = 'text';
  let content: string | null = msg.text || null;
  let mediaUrl: string | null = null;
  const metadata: MessageMetadata = {};

  const attachment = msg.attachments?.[0];
  if (attachment) {
    mediaUrl = attachment.payload?.url || null;
    metadata.mediaUrl = mediaUrl || undefined;

    switch (attachment.type) {
      case 'image':
        type = 'image';
        content = content || '[imagem]';
        break;
      case 'video':
        type = 'video';
        content = content || '[video]';
        break;
      case 'audio':
        type = 'audio';
        content = content || '[audio]';
        break;
      case 'file':
      case 'document':
        type = 'document';
        content = content || '[arquivo]';
        break;
      default:
        type = 'document';
        content = content || `[${attachment.type}]`;
        break;
    }
  }

  return { type, content, mediaUrl, metadata };
}

export async function handleMessengerWebhook(channel: MetaChannelRecord, payload: any) {
  const entries = payload?.entry || [];

  for (const entry of entries) {
    const messaging: MessengerEvent[] = entry.messaging || [];

    for (const event of messaging) {
      if (!event.message) {
        await logWebhookEvent({
          channelId: channel.id,
          source: 'meta-messenger',
          event: 'ignored',
          payload: event,
        });
        continue;
      }

      if (isEchoMessage(event.message)) {
        await logWebhookEvent({
          channelId: channel.id,
          source: 'meta-messenger',
          event: 'echo-ignored',
          payload: event,
        });
        continue;
      }

      const externalUserId = event.sender?.id;
      if (!externalUserId) {
        await logWebhookEvent({
          channelId: channel.id,
          source: 'meta-messenger',
          event: 'missing-user',
          payload: event,
        });
        continue;
      }

      const threadKey = externalUserId;

      const { contact, chat } = await resolveMetaContext({
        channel,
        externalUserId,
        platform: 'messenger',
        threadKey,
      });

      const normalized = normalizeMessengerMessage(event);

      await persistNormalizedMessage({
        channel,
        chat,
        contact,
        message: {
          type: normalized.type,
          content: normalized.content,
          metadata: normalized.metadata,
          mediaUrl: normalized.mediaUrl,
        },
        platform: 'messenger',
        direction: 'incoming',
        externalMessageId: event.message?.mid,
        externalSenderId: event.sender?.id || null,
        externalChannelId: channel.external_page_id || null,
        rawPayload: event,
        fromMe: false,
      });
    }
  }
}
