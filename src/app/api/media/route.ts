import { NextRequest, NextResponse } from 'next/server';

const IMAGE_PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" fill="none">
  <rect width="320" height="320" rx="32" fill="#F4F4F5"/>
  <rect x="56" y="76" width="208" height="168" rx="20" fill="#E4E4E7"/>
  <circle cx="114" cy="128" r="18" fill="#D4D4D8"/>
  <path d="M88 212L138 162L176 196L210 154L244 212H88Z" fill="#C4C4CC"/>
  <text x="160" y="276" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#71717A">
    Midia indisponivel
  </text>
</svg>
`.trim();

function buildImageFallbackResponse(upstreamStatus?: number): NextResponse {
  return new NextResponse(IMAGE_PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'X-Upstream-Status': String(upstreamStatus ?? 502),
      'X-Robots-Tag': 'noindex',
    },
  });
}

function copyResponseHeaders(upstream: Response, kind: 'image' | 'media'): Headers {
  const headers = new Headers();
  const passthroughHeaders = [
    'accept-ranges',
    'cache-control',
    'content-disposition',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ];

  for (const headerName of passthroughHeaders) {
    const headerValue = upstream.headers.get(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }

  if (!headers.has('cache-control')) {
    headers.set(
      'Cache-Control',
      kind === 'image'
        ? 'public, max-age=300, stale-while-revalidate=600'
        : 'public, max-age=60, stale-while-revalidate=300'
    );
  }

  headers.set('X-Robots-Tag', 'noindex');

  return headers;
}

function isPrivateHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  if (!normalizedHostname) return true;

  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '::1' ||
    normalizedHostname.endsWith('.local')
  ) {
    return true;
  }

  const ipv4Match = normalizedHostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const [firstOctet, secondOctet] = ipv4Match.slice(1, 3).map(Number);
  if (firstOctet === 10 || firstOctet === 127) return true;
  if (firstOctet === 169 && secondOctet === 254) return true;
  if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return true;
  if (firstOctet === 192 && secondOctet === 168) return true;

  return false;
}

export async function GET(request: NextRequest) {
  const sourceUrl = request.nextUrl.searchParams.get('url');
  const kind = request.nextUrl.searchParams.get('kind') === 'image' ? 'image' : 'media';

  if (!sourceUrl) {
    return NextResponse.json({ error: 'Missing url parameter.' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid url parameter.' }, { status: 400 });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'Unsupported protocol.' }, { status: 400 });
  }

  if (isPrivateHostname(parsedUrl.hostname)) {
    return NextResponse.json({ error: 'Private hosts are not allowed.' }, { status: 400 });
  }

  if (parsedUrl.pathname === '/api/media') {
    return NextResponse.json({ error: 'Recursive media proxy requests are not allowed.' }, { status: 400 });
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get('range');
  const accept = request.headers.get('accept');

  if (range) upstreamHeaders.set('range', range);
  if (accept) upstreamHeaders.set('accept', accept);
  upstreamHeaders.set('user-agent', 'DialogyMediaProxy/1.0');

  try {
    const upstreamResponse = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      if (kind === 'image') {
        return buildImageFallbackResponse(upstreamResponse.status);
      }

      return NextResponse.json(
        { error: `Failed to fetch upstream media (${upstreamResponse.status}).` },
        { status: upstreamResponse.status || 502 }
      );
    }

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: copyResponseHeaders(upstreamResponse, kind),
    });
  } catch (error) {
    if (kind === 'image') {
      return buildImageFallbackResponse();
    }

    return NextResponse.json({ error: 'Failed to fetch upstream media.' }, { status: 502 });
  }
}
