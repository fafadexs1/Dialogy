import { NextResponse } from 'next/server';
import { processQueueOnce, shouldEnqueueJob } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export async function GET() {
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
