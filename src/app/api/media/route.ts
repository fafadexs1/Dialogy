import { NextRequest, NextResponse } from 'next/server';

import { consumeRateLimit } from '@/lib/ratelimit';
import { requireAuthenticatedUser } from '@/lib/security/access';
import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';

const IMAGE_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" rx="32" fill="#F4F4F5"/><text x="160" y="164" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#71717A">Midia indisponivel</text></svg>`;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function imageFallback(status = 502): NextResponse {
  return new NextResponse(IMAGE_PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
      'X-Upstream-Status': String(status),
      'X-Robots-Tag': 'noindex',
    },
  });
}

function configuredMediaHosts(): string[] {
  return (process.env.MEDIA_PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch {
    return NextResponse.json({ code: 'unauthenticated', error: 'Authentication required.' }, { status: 401 });
  }

  const rate = consumeRateLimit(`media:${user.id}`, 60, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { code: 'rate_limited', error: 'Too many media requests.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfter / 1000)) } },
    );
  }

  const sourceUrl = request.nextUrl.searchParams.get('url');
  const kind = request.nextUrl.searchParams.get('kind') === 'image' ? 'image' : 'media';
  if (!sourceUrl) return NextResponse.json({ error: 'Missing url parameter.' }, { status: 400 });
  const allowedHosts = configuredMediaHosts();
  if (!allowedHosts.length) {
    return NextResponse.json(
      { code: 'dependency_unavailable', error: 'Media proxy allowlist is not configured.' },
      { status: 503 },
    );
  }

  const headers = new Headers({ 'user-agent': 'DialogyMediaProxy/2.0' });
  const range = request.headers.get('range');
  const accept = request.headers.get('accept');
  if (range) headers.set('range', range);
  if (accept) headers.set('accept', accept);

  try {
    const upstream = await fetchSafeRemote(sourceUrl, { headers, cache: 'no-store' }, {
      allowedHosts,
      timeoutMs: 10_000,
      maxRedirects: 3,
    });
    if (!upstream.ok) {
      return kind === 'image'
        ? imageFallback(upstream.status)
        : NextResponse.json({ error: `Failed to fetch upstream media (${upstream.status}).` }, { status: 502 });
    }

    const body = await readResponseBodyLimited(upstream, kind === 'image' ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES);
    const responseHeaders = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, max-age=60',
      'X-Robots-Tag': 'noindex',
    });
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) responseHeaders.set('Content-Disposition', disposition);
    const responseBody = new Uint8Array(body.byteLength);
    responseBody.set(body);
    return new NextResponse(responseBody.buffer, { status: 200, headers: responseHeaders });
  } catch (error) {
    console.warn('[MEDIA_PROXY] Rejected or failed upstream request:', error instanceof Error ? error.message : error);
    return kind === 'image'
      ? imageFallback()
      : NextResponse.json({ error: 'Failed to fetch upstream media.' }, { status: 502 });
  }
}
