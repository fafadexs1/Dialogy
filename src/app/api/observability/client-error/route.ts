'use server';

import { NextResponse } from 'next/server';
import { logAction } from '@/lib/observability/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.type === 'metric' ? 'client_metric' : 'client_error';
    await logAction({
      action,
      payload: {
        ...body,
        receivedAt: Date.now(),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[CLIENT_ERROR_API]', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
