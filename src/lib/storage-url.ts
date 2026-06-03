const PUBLIC_OBJECT_PREFIX = '/storage/v1/object/public/';
const SIGNED_OBJECT_PREFIX = '/storage/v1/object/sign/';
const MEDIA_PROXY_PATH = '/api/media';

const SUPABASE_STORAGE_ORIGIN = (() => {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!rawUrl) return '';

  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
})();

const APP_ORIGIN = (() => {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!rawUrl) return '';

  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
})();

function getAppOrigin(): string {
  if (APP_ORIGIN) return APP_ORIGIN;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

function parseAbsoluteUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function normalizeImageThumbnailSource(url?: string | null): string {
  if (!url) return '';

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return '';

  if (trimmedUrl.startsWith('/9j/')) return `data:image/jpeg;base64,${trimmedUrl}`;
  if (trimmedUrl.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${trimmedUrl}`;
  if (trimmedUrl.startsWith('R0lGOD')) return `data:image/gif;base64,${trimmedUrl}`;
  if (trimmedUrl.startsWith('UklGR')) return `data:image/webp;base64,${trimmedUrl}`;

  return trimmedUrl;
}

/**
 * Normalizes Supabase Storage URLs to the current environment host.
 * Also rewrites signed object URLs to public object URLs to avoid stale tokens.
 */
export function normalizeSupabaseStorageUrl(url?: string | null): string {
  if (!url) return '';

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return '';

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return trimmedUrl;
  }

  if (!SUPABASE_STORAGE_ORIGIN) {
    return trimmedUrl;
  }

  const looksLikeSupabaseHost =
    parsedUrl.hostname.includes('supabase.') || parsedUrl.origin === SUPABASE_STORAGE_ORIGIN;

  if (!looksLikeSupabaseHost) {
    return trimmedUrl;
  }

  const path = parsedUrl.pathname;
  if (path.startsWith(SIGNED_OBJECT_PREFIX)) {
    const objectPath = path.slice(SIGNED_OBJECT_PREFIX.length);
    return `${SUPABASE_STORAGE_ORIGIN}${PUBLIC_OBJECT_PREFIX}${objectPath}`;
  }

  if (path.startsWith(PUBLIC_OBJECT_PREFIX)) {
    const objectPath = path.slice(PUBLIC_OBJECT_PREFIX.length);
    return `${SUPABASE_STORAGE_ORIGIN}${PUBLIC_OBJECT_PREFIX}${objectPath}`;
  }

  return trimmedUrl;
}

export function buildMediaProxyUrl(url: string, kind: 'image' | 'media' = 'media'): string {
  const search = new URLSearchParams({
    url,
    kind,
  });

  return `${MEDIA_PROXY_PATH}?${search.toString()}`;
}

export function toAbsoluteAppUrl(url?: string | null): string {
  if (!url) return '';

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return '';

  const parsed = parseAbsoluteUrl(trimmedUrl);
  if (parsed) return parsed.toString();

  if (!trimmedUrl.startsWith('/')) {
    return trimmedUrl;
  }

  const origin = getAppOrigin();
  if (!origin) return trimmedUrl;

  return new URL(trimmedUrl, origin).toString();
}

export function resolveClientMediaUrl(
  url?: string | null,
  options: { kind?: 'image' | 'media'; proxy?: boolean } = {}
): string {
  const normalizedUrl = normalizeSupabaseStorageUrl(
    options.kind === 'image' ? normalizeImageThumbnailSource(url) : url
  );
  if (!normalizedUrl) return '';

  if (
    normalizedUrl.startsWith('data:') ||
    normalizedUrl.startsWith('blob:') ||
    normalizedUrl.startsWith(MEDIA_PROXY_PATH) ||
    normalizedUrl.startsWith('./') ||
    normalizedUrl.startsWith('../') ||
    normalizedUrl.startsWith('/')
  ) {
    return normalizedUrl;
  }

  const parsed = parseAbsoluteUrl(normalizedUrl);
  if (!parsed) return normalizedUrl;

  if (parsed.pathname === MEDIA_PROXY_PATH) {
    return normalizedUrl;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }

  const appOrigin = getAppOrigin();
  if (appOrigin && parsed.origin === appOrigin) {
    return normalizedUrl;
  }

  if (options.proxy === false) {
    return normalizedUrl;
  }

  return buildMediaProxyUrl(parsed.toString(), options.kind ?? 'media');
}
