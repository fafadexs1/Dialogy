import type { Message, MessageMetadata } from '@/lib/types';
import { resilientFetch } from '@/lib/http/resilient-fetch';
import {
  MetaChannelRecord,
  resolveMetaContext,
  persistNormalizedMessage,
  logWebhookEvent,
} from './meta-channel.service';
import { archiveInboundMetaMedia } from './archive-inbound-media';

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
      payload?: {
        url?: string;
        title?: string;
        reel_video_id?: string;
        coordinates?: { lat?: number | string; long?: number | string; latitude?: number | string; longitude?: number | string };
        generic?: {
          elements?: Array<{
            title?: string;
            subtitle?: string;
            image_url?: string;
            default_action?: { url?: string };
          }>;
        };
      };
    }>;
  };
};

function finiteCoordinate(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coordinatesFromMapUrl(rawUrl?: string): { latitude?: number; longitude?: number } {
  if (!rawUrl) return {};
  try {
    const url = new URL(rawUrl);
    const query = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('markers');
    const match = query?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return {};
    return { latitude: finiteCoordinate(match[1]), longitude: finiteCoordinate(match[2]) };
  } catch {
    return {};
  }
}

export async function fetchInstagramLocationDetails(
  accessToken: string,
  messageId: string,
): Promise<{
  title?: string;
  subtitle?: string;
  thumbnail?: string;
  latitude?: number;
  longitude?: number;
} | null> {
  const url = new URL(`https://graph.facebook.com/v24.0/${encodeURIComponent(messageId)}`);
  url.searchParams.set('fields', 'attachments');
  url.searchParams.set('access_token', accessToken);

  const response = await resilientFetch(url, {}, { timeoutMs: 10_000 });
  if (!response.ok) return null;
  const body = await response.json().catch(() => ({}));
  const template = body?.attachments?.data?.find((item: any) => item?.generic_template)?.generic_template;
  if (!template) return null;

  const thumbnail = typeof template.media_url === 'string' ? template.media_url : undefined;
  const coordinates = coordinatesFromMapUrl(thumbnail);
  return {
    title: typeof template.title === 'string' ? template.title : undefined,
    subtitle: typeof template.subtitle === 'string' ? template.subtitle : undefined,
    thumbnail,
    ...coordinates,
  };
}

function isEchoMessage(message?: { is_echo?: unknown }): boolean {
  if (!message) return false;
  return message.is_echo === true || message.is_echo === 'true' || message.is_echo === 1 || message.is_echo === '1';
}

export function normalizeInstagramMessage(event: MessagingEvent): {
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
    metadata.originalMediaUrl = mediaUrl || undefined;
    metadata.metaAttachmentType = attachment.type;
    metadata.metaAttachmentTitle = attachment.payload?.title;
    metadata.metaReelVideoId = attachment.payload?.reel_video_id;

    const genericElement = attachment.payload?.generic?.elements?.[0];
    const emptyGenericTemplate = attachment.type === 'template'
      && Array.isArray(attachment.payload?.generic?.elements)
      && attachment.payload.generic.elements.length === 0;
    const isLocation = attachment.type === 'location' || emptyGenericTemplate;
    if (isLocation) {
      const coordinates = attachment.payload?.coordinates;
      const mapUrl = attachment.payload?.url || genericElement?.default_action?.url;
      const parsedFromUrl = coordinatesFromMapUrl(mapUrl);
      const latitude = finiteCoordinate(coordinates?.lat ?? coordinates?.latitude) ?? parsedFromUrl.latitude;
      const longitude = finiteCoordinate(coordinates?.long ?? coordinates?.longitude) ?? parsedFromUrl.longitude;
      const locationUnavailable = latitude === undefined && longitude === undefined && !mapUrl;

      type = 'location';
      content = genericElement?.title
        || attachment.payload?.title
        || (locationUnavailable
          ? 'Localização compartilhada (dados não fornecidos pela Meta)'
          : 'Localização compartilhada');
      mediaUrl = null;
      delete metadata.mediaUrl;
      metadata.locationName = genericElement?.title || attachment.payload?.title;
      metadata.locationDescription = genericElement?.subtitle;
      metadata.thumbnail = genericElement?.image_url;
      metadata.mapUrl = mapUrl;
      metadata.latitude = latitude;
      metadata.longitude = longitude;
      metadata.metaLocationUnavailable = locationUnavailable;
      return { type, content, mediaUrl, metadata };
    }

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
      const attachment = event.message.attachments?.[0];
      if (normalized.metadata.metaLocationUnavailable && event.message.mid) {
        try {
          const location = await fetchInstagramLocationDetails(channel.access_token, event.message.mid);
          if (location) {
            const hasCoordinates = location.latitude !== undefined && location.longitude !== undefined;
            normalized.content = location.title || 'Localização compartilhada';
            normalized.metadata = {
              ...normalized.metadata,
              locationName: location.title,
              locationDescription: location.subtitle,
              latitude: location.latitude,
              longitude: location.longitude,
              mapUrl: hasCoordinates
                ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
                : undefined,
              thumbnail: location.thumbnail,
              metaLocationUnavailable: !hasCoordinates && !location.thumbnail,
            };
          }
        } catch (error) {
          console.error('[INSTAGRAM_LOCATION_ENRICHMENT] Failed to fetch message attachments:',
            error instanceof Error ? error.message : error);
        }
      }

      const archiveSourceUrl = normalized.mediaUrl
        || (normalized.type === 'location' ? normalized.metadata.thumbnail : undefined);
      if (archiveSourceUrl) {
        try {
          const archived = await archiveInboundMetaMedia({
            workspaceId: channel.workspace_id,
            sourceUrl: archiveSourceUrl,
            attachmentType: normalized.type === 'location' ? 'image' : attachment?.type,
          });
          if (normalized.type === 'location') {
            normalized.metadata = {
              ...normalized.metadata,
              originalThumbnailUrl: archiveSourceUrl,
              thumbnail: archived.url,
              storageProvider: 'minio',
              storageKey: archived.key,
              archivedContentType: archived.contentType,
              archivedSize: archived.size,
              mediaArchiveKind: archived.kind,
              mediaArchivedAt: new Date().toISOString(),
            };
          } else {
            normalized.mediaUrl = archived.url;
            normalized.metadata = {
              ...normalized.metadata,
              mediaUrl: archived.url,
              mimetype: archived.contentType,
              storageProvider: 'minio',
              storageKey: archived.key,
              archivedContentType: archived.contentType,
              archivedSize: archived.size,
              mediaArchiveKind: archived.kind,
              mediaArchivedAt: new Date().toISOString(),
            };
          }
        } catch (error) {
          console.error('[INSTAGRAM_MEDIA_ARCHIVE] Failed to archive inbound media:',
            error instanceof Error ? error.message : error);
          normalized.metadata.mediaArchiveStatus = 'failed';
        }
      }

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
