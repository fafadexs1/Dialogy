import { randomUUID } from 'crypto';
import { putPrivateObject } from '@/lib/storage/private-s3';

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_REEL_PAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/octet-stream': 'bin',
};

export type ArchivedInboundMedia = {
  url: string;
  key: string;
  contentType: string;
  size: number;
  kind: 'attachment' | 'reel_preview';
};

function isAllowedMetaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'instagram.com'
    || host.endsWith('.instagram.com')
    || host.endsWith('.cdninstagram.com')
    || host.endsWith('.fbcdn.net')
    || host.endsWith('.fbsbx.com');
}

function parseAllowedMetaUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' || !isAllowedMetaHost(parsed.hostname)) {
    throw new Error('Unsupported Meta media URL.');
  }
  return parsed;
}

function normalizedContentType(response: Response): string {
  return (response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractOpenGraphImage(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\b(?:property|name)\s*=\s*["']og:image(?::secure_url)?["']/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (content) return decodeHtmlAttribute(content);
  }
  return null;
}

async function fetchWithLimit(url: URL, maxBytes: number): Promise<{ body: Buffer; contentType: string }> {
  let currentUrl = url;
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'Dialogy-Media-Archiver/1.0' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 5) throw new Error('Too many or invalid Meta media redirects.');
    currentUrl = parseAllowedMetaUrl(new URL(location, currentUrl).toString());
  }
  if (!response) throw new Error('Meta media download failed.');
  if (!response.ok) throw new Error(`Meta media download failed with status ${response.status}.`);

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Meta media exceeds the archive size limit.');
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > maxBytes) {
    throw new Error('Meta media is empty or exceeds the archive size limit.');
  }
  return { body, contentType: normalizedContentType(response) };
}

async function resolveDownloadableMedia(
  sourceUrl: URL,
  attachmentType?: string | null,
): Promise<{ body: Buffer; contentType: string; kind: ArchivedInboundMedia['kind'] }> {
  const downloaded = await fetchWithLimit(
    sourceUrl,
    attachmentType === 'ig_reel' ? MAX_REEL_PAGE_BYTES : MAX_MEDIA_BYTES,
  );
  if (EXTENSION_BY_CONTENT_TYPE[downloaded.contentType]) {
    const contentType = attachmentType === 'audio' && downloaded.contentType === 'video/mp4'
      ? 'audio/mp4'
      : downloaded.contentType;
    return { ...downloaded, contentType, kind: 'attachment' };
  }

  if (attachmentType !== 'ig_reel' || downloaded.contentType !== 'text/html') {
    throw new Error(`Unsupported Meta media content type: ${downloaded.contentType || 'unknown'}.`);
  }

  const previewUrl = extractOpenGraphImage(downloaded.body.toString('utf8'));
  if (!previewUrl) throw new Error('Instagram Reel preview was not available.');

  const preview = await fetchWithLimit(parseAllowedMetaUrl(previewUrl), MAX_MEDIA_BYTES);
  if (!preview.contentType.startsWith('image/') || !EXTENSION_BY_CONTENT_TYPE[preview.contentType]) {
    throw new Error(`Unsupported Instagram Reel preview type: ${preview.contentType || 'unknown'}.`);
  }
  return { ...preview, kind: 'reel_preview' };
}

export async function archiveInboundMetaMedia(input: {
  workspaceId: string;
  sourceUrl: string;
  attachmentType?: string | null;
}): Promise<ArchivedInboundMedia> {
  const sourceUrl = parseAllowedMetaUrl(input.sourceUrl);
  const media = await resolveDownloadableMedia(sourceUrl, input.attachmentType);
  const extension = EXTENSION_BY_CONTENT_TYPE[media.contentType];
  const key = `workspaces/${input.workspaceId}/message-media/${randomUUID()}.${extension}`;

  await putPrivateObject({ key, body: media.body, contentType: media.contentType });

  return {
    url: `/api/storage/object?key=${encodeURIComponent(key)}`,
    key,
    contentType: media.contentType,
    size: media.body.length,
    kind: media.kind,
  };
}
