import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processQueueOnce, shouldEnqueueJob } from '@/lib/queue';

export const dynamic = 'force-dynamic';

function hasValidWorkerToken(request: NextRequest): boolean {
  const expected = process.env.QUEUE_WORKER_TOKEN;
  const provided = request.headers.get('x-queue-token');
  if (!expected || !provided) return false;
  const expectedHash = createHash('sha256').update(expected).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

export async function GET(request: NextRequest) {
  if (!process.env.QUEUE_WORKER_TOKEN) {
    return NextResponse.json(
      { code: 'dependency_unavailable', error: 'Queue worker token is not configured.' },
      { status: 503 },
    );
  }
  if (!hasValidWorkerToken(request)) {
    return NextResponse.json({ code: 'unauthenticated', error: 'Invalid worker token.' }, { status: 401 });
  }
  const snapshot = await processQueueOnce();

  return NextResponse.json({
    mode: process.env.QUEUE_MODE || 'inline',
    worker: 'external',
    enabledJobs: {
      whatsapp_send: shouldEnqueueJob('whatsapp_send'),
      webhook_outbound: shouldEnqueueJob('webhook_outbound'),
      queue_auto_close: shouldEnqueueJob('queue_auto_close'),
      marketing_auto_close: shouldEnqueueJob('marketing_auto_close'),
    },
    snapshot,
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error: 'BullMQ worker runs in a separate process. Use GET for status only.',
    },
    { status: 405 }
  );
}
