import { createHash } from 'crypto';

import { NextResponse } from 'next/server';

import { createTrackedWhatsappClick } from '@/lib/marketing-attribution-server';
import { consumeRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = Math.max(1, Number(process.env.GOOGLE_ADS_TRACKING_RATE_LIMIT || 20));
const RATE_LIMIT_WINDOW_MS = 60_000;

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * O IP so entra no banco como hash: serve para deduplicar e diagnosticar
 * abuso, nunca para identificar a pessoa.
 */
function hashIp(ip: string): string | null {
  if (!ip || ip === 'unknown') return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function GET(
  request: Request,
  props: { params: Promise<{ workspaceId: string; instanceName: string }> }
) {
  const params = await props.params;
  const url = new URL(request.url);
  const message = url.searchParams.get('text') || url.searchParams.get('message');
  const ip = clientIp(request);

  // Endpoint publico que escreve no banco a cada acesso: sem limite, bots e
  // prefetch de link inflam ad_clicks e poluem a atribuicao.
  const limit = consumeRateLimit(
    `gads-track:${params.workspaceId}:${params.instanceName}:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Muitas requisicoes. Tente novamente em instantes.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfter / 1000)) } }
    );
  }

  const trackedClick = await createTrackedWhatsappClick({
    workspaceId: params.workspaceId,
    instanceName: params.instanceName,
    requestUrl: url,
    message,
    userAgent: request.headers.get('user-agent'),
    ipHash: hashIp(ip),
  });

  if (!trackedClick) {
    return NextResponse.json(
      {
        error: 'Instancia sem telefone de WhatsApp configurado para tracking.',
      },
      { status: 404 }
    );
  }

  return NextResponse.redirect(trackedClick.redirectUrl, 302);
}
