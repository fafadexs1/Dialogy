import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireMobileAuth } from '@/lib/mobile-api/auth';
import { broadcastChatUpdate } from '@/lib/realtime/chat-broadcast';

type Params = {
  params: Promise<{ chatId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const auth = await requireMobileAuth(request);
  if ('response' in auth) return auth.response;

  const access = await db.query(
    `SELECT c.workspace_id
       FROM chats c
       JOIN user_workspace_roles uwr
         ON uwr.workspace_id = c.workspace_id
        AND uwr.user_id = $2
      WHERE c.id = $1
      LIMIT 1`,
    [chatId, auth.context.user.id],
  );
  if ((access.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
  }

  await db.query(
    `UPDATE messages
        SET is_read = TRUE
      WHERE chat_id = $1
        AND from_me = FALSE
        AND COALESCE(is_read, FALSE) = FALSE`,
    [chatId],
  );

  const workspaceId = String(access.rows[0].workspace_id);
  await broadcastChatUpdate(workspaceId, chatId, { unread_count: 0 });
  return NextResponse.json({ success: true });
}
