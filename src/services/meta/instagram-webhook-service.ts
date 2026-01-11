import type { Message, MessageMetadata } from '@/lib/types';
import { resilientFetch } from '@/lib/http/resilient-fetch';
import {
  MetaChannelRecord,
  resolveMetaContext,
  persistNormalizedMessage,
  logWebhookEvent,
} from './meta-channel.service';

type MessagingEvent = {
  sender?: { id: string; username?: string };
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

function normalizeInstagramMessage(event: MessagingEvent): {
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

async function fetchInstagramProfile(
  accessToken: string,
  senderId: string
): Promise<{ username?: string; name?: string; profile_pic?: string } | null> {
  const url = `https://graph.facebook.com/v20.0/${senderId}?fields=username,name,profile_pic&access_token=${encodeURIComponent(
    accessToken
  )}`;
  try {
    const res = await resilientFetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return {
      username: json?.username || undefined,
      name: json?.name || undefined,
      profile_pic: json?.profile_pic || undefined,
    };
  } catch {
    return null;
  }
}

export async function handleInstagramWebhook(channel: MetaChannelRecord, payload: any) {
  const entries = payload?.entry || [];

  for (const entry of entries) {
    const messaging: MessagingEvent[] = entry.messaging || [];
    for (const event of messaging) {
      if (!event.message) {
        await logWebhookEvent({
          channelId: channel.id,
          source: 'meta-instagram',
          event: 'ignored',
          payload: event,
        });
        continue;
      }

      // Ignore echo messages - these are messages sent by us via API
      // They are already persisted when we send them, so we don't need to save them again
      if (isEchoMessage(event.message)) {
        await logWebhookEvent({
          channelId: channel.id,
          source: 'meta-instagram',
          event: 'echo-ignored',
          payload: event,
        });
        continue;
      }
      // Since echoes are ignored above, we always use sender.id for incoming messages
      const externalUserId = event.sender?.id;
      if (!externalUserId) {
        await logWebhookEvent({
          channelId: channel.id,
          source: 'meta-instagram',
          event: 'missing-user',
          payload: event,
        });
        continue;
      }

      const threadKey = externalUserId;
      const fetchedProfile = await fetchInstagramProfile(channel.access_token, externalUserId);
      const profile = {
        name: fetchedProfile?.name,
        username: fetchedProfile?.username ?? event.sender?.username,
        avatarUrl: fetchedProfile?.profile_pic,
      };

      const { contact, chat } = await resolveMetaContext({
        channel,
        externalUserId,
        profile,
        platform: 'instagram',
        threadKey,
      });

      const normalized = normalizeInstagramMessage(event);

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
        platform: 'instagram',
        direction: 'incoming',
        externalMessageId: event.message?.mid,
        externalSenderId: event.sender?.id || null,
        externalChannelId: channel.ig_business_id || channel.external_page_id || null,
        rawPayload: event,
        fromMe: false,
      });
    }
  }
}
