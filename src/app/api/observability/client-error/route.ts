'use server';

import { NextResponse } from 'next/server';
import { logAction } from '@/lib/observability/logger';
import { recordClientError, recordClientMetric } from '@/lib/observability/metrics';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.type === 'metric' ? 'client_metric' : 'client_error';
    if (body.type === 'metric' && body.metric?.name && typeof body.metric?.durationMs === 'number') {
      recordClientMetric(body.metric.name, body.metric.durationMs);
    } else if (body.type === 'error') {
      recordClientError(body.component);
    }
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
