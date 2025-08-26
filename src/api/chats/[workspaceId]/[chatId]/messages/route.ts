
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { Message, MessageSender, Contact, SystemAgent } from '@/lib/types';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';

const timeZone = 'America/Sao_Paulo';

function formatMessageDate(date: Date): string {
    const zonedDate = toZonedTime(date, timeZone);
    if (isToday(zonedDate)) {
        return `Hoje`;
    }
    if (isYesterday(zonedDate)) {
        return `Ontem`;
    }
    return formatDate(zonedDate, "dd/MM/yyyy", { locale: ptBR });
}

export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string, chatId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { workspaceId, chatId } = params;

  if (!workspaceId || !chatId) {
    return NextResponse.json({ error: 'Workspace ID and Chat ID are required' }, { status: 400 });
  }

  try {
    // 1. Verify user has access to this workspace
    const memberCheck = await db.query('SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [session.user.id, workspaceId]);
    if (memberCheck.rowCount === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Fetch senders map
    const userRes = await db.query('SELECT id, full_name as name, avatar_url as avatar FROM users');
    const contactRes = await db.query('SELECT id, name, avatar_url as avatar FROM contacts WHERE workspace_id = $1', [workspaceId]);
    const systemAgentRes = await db.query('SELECT id, name, avatar_url as avatar FROM system_agents WHERE workspace_id = $1', [workspaceId]);

    const sendersMap = new Map<string, MessageSender>();
    userRes.rows.forEach(u => sendersMap.set(u.id, { ...u, type: 'user' }));
    contactRes.rows.forEach(c => sendersMap.set(c.id, { ...c, type: 'contact' }));
    systemAgentRes.rows.forEach(a => sendersMap.set(a.id, { ...a, type: 'system_agent' }));

    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return sendersMap.get(id);
    };

    // 3. Fetch messages for the specific chat
    const messageRes = await db.query(
      `SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`,
      [chatId]
    );

    const messages: Message[] = messageRes.rows.map(m => {
        const createdAtDate = new Date(m.created_at);
        const zonedDate = toZonedTime(createdAtDate, timeZone);
        return {
            id: m.id,
            chat_id: m.chat_id,
            workspace_id: m.workspace_id,
            content: m.content,
            type: m.type,
            status: m.status,
            metadata: m.metadata,
            timestamp: formatInTimeZone(zonedDate, 'HH:mm', { locale: ptBR }),
            createdAt: createdAtDate.toISOString(),
            formattedDate: formatMessageDate(createdAtDate),
            sender: getSenderById(m.sender_id),
            from_me: m.from_me,
            is_read: m.is_read,
            message_id_from_api: m.message_id_from_api,
            api_message_status: m.api_message_status
        };
    });

    return NextResponse.json({ messages });
    
  } catch (error) {
    console.error(`[API /chats/.../messages] Error fetching messages:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
