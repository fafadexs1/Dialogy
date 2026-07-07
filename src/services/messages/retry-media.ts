import type { Message, MessageMetadata } from '@/lib/types';

export type RetryableMediaMessageType = Extract<Message['type'], 'audio' | 'image' | 'video' | 'document'>;

export type RetryMediaPayload = {
  mediaUrl: string;
  mimetype: string;
  filename: string;
  mediatype: RetryableMediaMessageType;
  caption: string;
  thumbnail?: string;
};

type BuildRetryMediaPayloadInput = {
  type: Message['type'] | string | null | undefined;
  content?: string | null;
  metadata?: MessageMetadata | null;
  mediaUrl?: string | null;
};

type RetriedMediaResponseDetails = {
  messageIdFromApi: string | null;
  returnedMediaUrl: string | null;
  returnedMimetype: string | null;
};

const RETRYABLE_MEDIA_TYPES = new Set(['audio', 'image', 'video', 'document']);

export function isRetryableMediaMessageType(type: unknown): type is RetryableMediaMessageType {
  return typeof type === 'string' && RETRYABLE_MEDIA_TYPES.has(type);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultMimeForType(type: RetryableMediaMessageType): string {
  if (type === 'image') return 'image/jpeg';
  if (type === 'video') return 'video/mp4';
  if (type === 'audio') return 'audio/mp4';
  return 'application/octet-stream';
}

function defaultFilenameForType(type: RetryableMediaMessageType, mimetype: string): string {
  const subtype = mimetype.split('/')[1]?.split(';')[0]?.split('+')[0] || '';
  const extension = subtype || (type === 'document' ? 'bin' : type);
  if (type === 'audio') return `audio.${extension}`;
  if (type === 'image') return `imagem.${extension}`;
  if (type === 'video') return `video.${extension}`;
  return `arquivo.${extension}`;
}

export function buildRetryMediaPayload(input: BuildRetryMediaPayloadInput): {
  payload: RetryMediaPayload | null;
  error?: string;
} {
  if (!isRetryableMediaMessageType(input.type)) {
    return { payload: null, error: 'Tipo de midia nao suportado para reenvio.' };
  }

  const metadata = input.metadata || {};
  const mediaUrl = cleanString(metadata.mediaUrl) || cleanString(input.mediaUrl);
  if (!mediaUrl) {
    return {
      payload: null,
      error: 'Midia original nao encontrada para reenvio.',
    };
  }

  const mimetype = cleanString(metadata.mimetype) || defaultMimeForType(input.type);
  const filename = cleanString(metadata.fileName) || defaultFilenameForType(input.type, mimetype);

  return {
    payload: {
      mediaUrl,
      mimetype,
      filename,
      mediatype: input.type,
      caption: cleanString(input.content),
      thumbnail: cleanString(metadata.thumbnail) || undefined,
    },
  };
}

export function extractRetriedMediaResponseDetails(
  apiResponse: any,
  mediatype: RetryableMediaMessageType,
): RetriedMediaResponseDetails {
  const messageTypeKey = `${mediatype}Message`;
  const message = apiResponse?.message || {};
  let returnedMediaUrl =
    cleanString(message.mediaUrl) ||
    cleanString(message?.[messageTypeKey]?.media) ||
    cleanString(message?.[messageTypeKey]?.url) ||
    cleanString(message?.[messageTypeKey]?.directPath) ||
    cleanString(apiResponse?.tempMediaPublicUrl) ||
    null;

  let returnedMimetype = cleanString(message?.[messageTypeKey]?.mimetype) || null;

  if (mediatype === 'audio') {
    returnedMediaUrl =
      returnedMediaUrl ||
      cleanString(message?.audioMessage?.media) ||
      cleanString(message?.audioMessage?.url) ||
      cleanString(message?.documentMessage?.url) ||
      cleanString(apiResponse?.url) ||
      null;

    returnedMimetype =
      returnedMimetype ||
      cleanString(message?.audioMessage?.mimetype) ||
      cleanString(message?.documentMessage?.mimetype) ||
      null;
  }

  return {
    messageIdFromApi:
      cleanString(apiResponse?.key?.id) ||
      cleanString(apiResponse?.message_id) ||
      cleanString(apiResponse?.id) ||
      null,
    returnedMediaUrl,
    returnedMimetype,
  };
}
