import { NextResponse } from 'next/server';
import { processQueueOnce } from '@/lib/queue';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const token = process.env.QUEUE_WORKER_TOKEN;
  if (!token) return true;
  const headerToken = request.headers.get('x-queue-token');
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  return token === headerToken || token === queryToken;
}

async function handleRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  const batchSize = body?.batchSize ? Number(body.batchSize) : undefined;
  const concurrency = body?.concurrency ? Number(body.concurrency) : undefined;
  const workerId = body?.workerId || undefined;

  const result = await processQueueOnce({ batchSize, concurrency, workerId });
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
