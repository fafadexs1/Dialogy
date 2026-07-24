import { NextRequest, NextResponse } from 'next/server';
import { addPublicMessage, authenticatePublicSession, listPublicMessages } from '@/services/webchat/public-api';

function bearer(request: NextRequest) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await authenticatePublicSession(sessionId, bearer(request));
  if (!session) return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
  return NextResponse.json({ messages: await listPublicMessages(session, request.nextUrl.searchParams.get('after')) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const session = await authenticatePublicSession(sessionId, bearer(request));
    if (!session) return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
    const body = await request.json();
    const message = await addPublicMessage(session, String(body.content || ''));
    return NextResponse.json({ id: message.id, createdAt: message.created_at }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'message_failed';
    const status = code === 'rate_limited' ? 429 : code === 'chat_limit_reached' ? 402 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
