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

/**
 * Hosts de storage que mudaram de endereco.
 *
 * O MinIO da Evolution migrou de dominio, mas as URLs antigas continuam gravadas
 * nas mensagens apontando para o host desativado. Os objetos foram para o host
 * novo com as mesmas chaves, entao trocar o host recupera a midia.
 *
 * Sobrescrevivel por `NEXT_PUBLIC_LEGACY_MEDIA_HOST_REWRITES` no formato
 * "antigo1=novo1,antigo2=novo2" caso o endereco mude de novo.
 */
const LEGACY_STORAGE_HOST_REWRITES: Record<string, string> = (() => {
  const defaults: Record<string, string> = {
    'evo-minio.fhgg2n.easypanel.host': 'storage.klyraai.com.br',
  };

  const rawConfig =
    process.env.MEDIA_HOST_REWRITES ||
    process.env.NEXT_PUBLIC_MEDIA_HOST_REWRITES ||
    process.env.NEXT_PUBLIC_LEGACY_MEDIA_HOST_REWRITES ||
    '';

  const configured = rawConfig.trim();
  if (!configured) return defaults;

  const rewrites: Record<string, string> = { ...defaults };
  for (const pair of configured.split(',')) {
    const [from, to] = pair.split('=').map((part) => part.trim().toLowerCase());
    if (from && to) rewrites[from] = to;
  }
  return rewrites;
})();

/** Aponta a URL para o host atual quando o storage mudou de endereco. */
export function rewriteLegacyStorageHost(url?: string | null): string {
  if (!url) return '';

  const trimmed = url.trim();
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const replacement = LEGACY_STORAGE_HOST_REWRITES[parsed.host.toLowerCase()];
  if (!replacement) return trimmed;

  parsed.host = replacement;
  parsed.protocol = 'https:';
  return parsed.toString();
}

// Parametros de assinatura SigV4. Presentes = URL com prazo de validade.
const SIGV4_QUERY_PARAMS = [
  'X-Amz-Algorithm',
  'X-Amz-Credential',
  'X-Amz-Date',
  'X-Amz-Expires',
  'X-Amz-SignedHeaders',
  'X-Amz-Signature',
  'X-Amz-Security-Token',
];

/**
 * Descarta a assinatura temporaria de uma URL de storage, deixando o caminho
 * bruto do objeto.
 *
 * A Evolution entrega a midia do MinIO via `presignedGetObject` sem prazo
 * explicito, o que produz uma assinatura de 7 dias (padrao do MinIO). O Dialogy
 * gravava essa URL como endereco definitivo da mensagem, entao passada uma
 * semana o arquivo continuava intacto no bucket e o link e que morria — dando
 * "midia expirada".
 *
 * O bucket e de leitura publica, entao o caminho sem querystring resolve
 * sozinho e nao vence nunca. Mesma ideia que `normalizeSupabaseStorageUrl` ja
 * aplica para as URLs assinadas do Supabase.
 */
export function stripStorageSignature(url?: string | null): string {
  if (!url) return '';

  const trimmed = url.trim();
  if (!trimmed || !trimmed.includes('X-Amz-Signature=')) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // Nao remover assinatura de storages que exigem SigV4 autenticado (Cloudflare R2, AWS S3)
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname.endsWith('.r2.cloudflarestorage.com') ||
    hostname.endsWith('.amazonaws.com') ||
    hostname.includes('r2.cloudflarestorage.com')
  ) {
    return trimmed;
  }

  for (const param of SIGV4_QUERY_PARAMS) {
    parsed.searchParams.delete(param);
  }

  return parsed.toString();
}

/**
 * Deixa a URL de midia no formato duravel: host atual e sem assinatura com prazo.
 *
 * Usada tanto na gravacao (para o banco ficar canonico) quanto na leitura (para
 * as URLs ja gravadas antes desta correcao continuarem abrindo).
 */
export function normalizeStoredMediaUrl(url?: string | null): string {
  return stripStorageSignature(rewriteLegacyStorageHost(url));
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
  const normalizedUrl = normalizeStoredMediaUrl(
    normalizeSupabaseStorageUrl(
      options.kind === 'image' ? normalizeImageThumbnailSource(url) : url
    )
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
