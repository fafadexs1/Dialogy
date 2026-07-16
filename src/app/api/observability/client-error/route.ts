import { NextRequest, NextResponse } from 'next/server';

import { consumeRateLimit } from '@/lib/ratelimit';

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const key = `client-error:${forwarded || 'unknown'}`;
  const rate = consumeRateLimit(key, 30, 60_000);
  if (!rate.ok) {
    return NextResponse.json({ code: 'rate_limited', error: 'Too many reports.' }, { status: 429 });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 16 * 1024) {
    return NextResponse.json({ error: 'Report too large.' }, { status: 413 });
  }
  return NextResponse.json({ ok: true });
}
