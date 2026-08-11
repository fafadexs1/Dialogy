import { NextRequest, NextResponse } from 'next/server';
import { getInitialChatsData } from '@/actions/chats';
import { requireMobileAuth } from '@/lib/mobile-api/auth';
import { mapMobileChat, mapMobileUser } from '@/lib/mobile-api/mappers';
import { createTrustedUserContext } from '@/lib/security/trusted-server-context';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const auth = await requireMobileAuth(request, workspaceId);
  if ('response' in auth) return auth.response;

  const { user, workspace } = auth.context;
  const payload = await getInitialChatsData({
    workspaceId: workspace.id,
    selectedChatId: null,
    ownership: 'everyone',
    workspaceTimezone: workspace.timezone || null,
  }, createTrustedUserContext(user.id));

  if (payload.error) {
    return NextResponse.json({ error: payload.error }, { status: 500 });
  }

  return NextResponse.json({
    user: mapMobileUser(user, workspace),
    chats: payload.chats.map(mapMobileChat),
    messagesByChatId: {},
    chatPagination: payload.chatPagination,
  });
}
