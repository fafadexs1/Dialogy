import { NextRequest, NextResponse } from 'next/server';
import { getInitialChatsData } from '@/actions/chats';
import { requireMobileAuth } from '@/lib/mobile-api/auth';
import { mapMobileChat } from '@/lib/mobile-api/mappers';
import { createTrustedUserContext } from '@/lib/security/trusted-server-context';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const before = request.nextUrl.searchParams.get('before');
  const beforeId = request.nextUrl.searchParams.get('beforeId');
  const kind = request.nextUrl.searchParams.get('kind') === 'closed' ? 'closed' : 'active';
  const auth = await requireMobileAuth(request, workspaceId);
  if ('response' in auth) return auth.response;
  if (!before) {
    return NextResponse.json({ error: 'Cursor obrigatorio.' }, { status: 400 });
  }

  const { user, workspace } = auth.context;
  const payload = await getInitialChatsData({
    workspaceId: workspace.id,
    selectedChatId: null,
    ownership: 'everyone',
    workspaceTimezone: workspace.timezone || null,
    pagination: {
      before,
      beforeId,
      statuses: kind === 'closed' ? ['encerrados'] : ['gerais', 'atendimentos'],
      limit: 25,
    },
  }, createTrustedUserContext(user.id));

  if (payload.error) {
    return NextResponse.json({ error: payload.error }, { status: 500 });
  }
  return NextResponse.json({
    chats: payload.chats.map(mapMobileChat),
    hasMore: payload.hasMoreChats,
    nextCursor: payload.nextCursor ?? null,
  });
}
