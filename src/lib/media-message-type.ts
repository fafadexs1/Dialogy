import type { Message } from '@/lib/types';

type MessageType = Message['type'];

const audioExtensions = new Set(['aac', 'amr', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav']);
const videoExtensions = new Set(['3gp', 'avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);
const imageExtensions = new Set(['bmp', 'gif', 'heic', 'heif', 'jpg', 'jpeg', 'png', 'webp']);

export function normalizeMimeType(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.split(';')[0]?.trim().toLowerCase();
  return trimmed || null;
}

export function inferMessageTypeFromMime(mime: string): MessageType | null {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('application/') || mime.startsWith('text/')) return 'document';
  return null;
}

export function inferMessageTypeFromFilename(fileName?: string | null): MessageType | null {
  if (!fileName) return null;
  const parts = fileName.split('.');
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1]?.toLowerCase();
  if (!ext) return null;
  if (audioExtensions.has(ext)) return 'audio';
  if (videoExtensions.has(ext)) return 'video';
  if (imageExtensions.has(ext)) return 'image';
  return null;
}

export function resolveMediaMessageType(params: {
  currentType: MessageType;
  mimetype?: string | null;
  fileName?: string | null;
}): MessageType {
  const { currentType, mimetype, fileName } = params;
  if (currentType === 'location') return currentType;

  const normalized = normalizeMimeType(mimetype);
  const typeFromMime = normalized ? inferMessageTypeFromMime(normalized) : null;
  const typeFromFile = inferMessageTypeFromFilename(fileName);
  const inferred = typeFromMime || typeFromFile;
  return inferred || currentType;
}
