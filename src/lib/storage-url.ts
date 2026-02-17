const PUBLIC_OBJECT_PREFIX = '/storage/v1/object/public/';
const SIGNED_OBJECT_PREFIX = '/storage/v1/object/sign/';

const SUPABASE_STORAGE_ORIGIN = (() => {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!rawUrl) return '';

  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
})();

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
