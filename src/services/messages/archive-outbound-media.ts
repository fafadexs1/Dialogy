import 'server-only';

import { randomUUID } from 'crypto';
import { putPrivateObject } from '@/lib/storage/private-s3';

/**
 * Arquiva no MinIO a midia enviada pelo atendente.
 *
 * O bucket `temp-media` do Supabase existe so como ponte: o arquivo precisa
 * ficar publicamente acessivel para a Evolution conseguir busca-lo e entregar ao
 * WhatsApp. Um job apaga esse objeto 24h depois (RETRY_MEDIA_RETENTION_DAYS).
 *
 * O problema era que a URL dessa ponte tambem virava o `metadata.mediaUrl` da
 * mensagem — ou seja, o registro permanente da conversa apontava para um arquivo
 * descartavel. Passadas 24h a midia sumia e o atendimento mostrava
 * "midia expirada".
 *
 * Aqui copiamos o arquivo para o mesmo storage permanente que a midia recebida
 * usa (`workspaces/<ws>/message-media/...` no MinIO), servido por
 * `/api/storage/object` com verificacao de permissao.
 */

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
};

function extensionFor(mimetype: string, sourceUrl: string): string {
  const normalized = (mimetype || '').split(';', 1)[0].trim().toLowerCase();
  const mapped = EXTENSION_BY_CONTENT_TYPE[normalized];
  if (mapped) return mapped;

  // Sem mapeamento conhecido: tenta a extensao do proprio nome do arquivo.
  const fromPath = sourceUrl.split('?')[0].split('.').pop();
  if (fromPath && /^[a-z0-9]{1,5}$/i.test(fromPath)) return fromPath.toLowerCase();

  return 'bin';
}

function allowedSourceOrigins(): string[] {
  const origins: string[] = [];
  for (const raw of [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]) {
    if (!raw?.trim()) continue;
    try {
      origins.push(new URL(raw.trim()).origin);
    } catch {
      /* configuracao invalida e ignorada */
    }
  }
  return origins;
}

/**
 * So baixamos de origens nossas. A URL vem do nosso proprio upload, entao
 * qualquer outra coisa aqui seria SSRF.
 */
function parseAllowedSourceUrl(rawUrl: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return allowedSourceOrigins().includes(parsed.origin) ? parsed : null;
}

export function isTemporaryMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes('/temp-media/');
}

export type ArchivedOutboundMedia = {
  url: string;
  key: string;
  size: number;
};

export async function archiveOutboundMedia(input: {
  workspaceId: string;
  sourceUrl: string;
  mimetype: string;
}): Promise<ArchivedOutboundMedia> {
  const sourceUrl = parseAllowedSourceUrl(input.sourceUrl);
  if (!sourceUrl) throw new Error('URL de origem nao permitida para arquivamento.');

  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'Dialogy-Media-Archiver/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar midia para arquivamento: ${response.status}.`);
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
    throw new Error('Midia excede o limite de arquivamento.');
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) throw new Error('Midia vazia; nada a arquivar.');
  if (body.length > MAX_MEDIA_BYTES) throw new Error('Midia excede o limite de arquivamento.');

  const contentType = (response.headers.get('content-type') || input.mimetype || 'application/octet-stream')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  const key = `workspaces/${input.workspaceId}/message-media/${randomUUID()}.${extensionFor(contentType, sourceUrl.pathname)}`;
  await putPrivateObject({ key, body, contentType });

  return {
    url: `/api/storage/object?key=${encodeURIComponent(key)}`,
    key,
    size: body.length,
  };
}

/**
 * Versao que nunca lanca: arquivar e desejavel, mas nao pode derrubar um envio
 * que ja chegou ao cliente. Em caso de falha o chamador mantem a URL atual.
 */
export async function archiveOutboundMediaSafely(input: {
  workspaceId: string;
  sourceUrl: string;
  mimetype: string;
}): Promise<ArchivedOutboundMedia | null> {
  try {
    return await archiveOutboundMedia(input);
  } catch (error) {
    console.error(
      '[ARCHIVE_OUTBOUND_MEDIA] Falha ao arquivar midia enviada; mantendo URL temporaria.',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
