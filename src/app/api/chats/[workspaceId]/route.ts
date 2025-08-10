
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact } from '@/lib/types';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

function formatMessageDate(date: Date): string {
    if (isToday(date)) {
        return `Hoje`;
    }
    if (isYesterday(date)) {
        return `Ontem`;
    }
    return format(date, "dd/MM/yyyy", { locale: ptBR });
}

async function fetchDataForWorkspace(workspaceId: string, userId: string) {
    if (!workspaceId) return { chats: [] };

    const userRes = await db.query('SELECT id, full_name, avatar_url FROM users');
    const usersMap = new Map<string, User>(userRes.rows.map(u => [
        u.id,
        {
            id: u.id,
            name: u.full_name,
            avatar: u.avatar_url,
            firstName: u.full_name.split(' ')[0] || '',
            lastName: u.full_name.split(' ').slice(1).join(' ') || '',
        }
    ]));

    const contactRes = await db.query('SELECT id, name, avatar_url, phone_number_jid FROM contacts WHERE workspace_id = $1', [workspaceId]);
    const contactsMap = new Map<string, Contact>(contactRes.rows.map(c => [
        c.id,
        {
            id: c.id,
            workspace_id: workspaceId,
            name: c.name,
            avatar: c.avatar_url,
            phone_number_jid: c.phone_number_jid,
            firstName: c.name.split(' ')[0] || '',
            lastName: c.name.split(' ').slice(1).join(' ') || '',
        }
    ]));

    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return usersMap.get(id) || contactsMap.get(id);
    };
    
    const chatRes = await db.query(`
        WITH LastMessage AS (
            SELECT
                chat_id,
                source_from_api,
                instance_name,
                created_at,
                ROW_NUMBER() OVER(PARTITION BY chat_id ORDER BY created_at DESC) as rn
            FROM messages
            WHERE type = 'text'
        )
        SELECT 
            c.id, 
            c.status, 
            c.workspace_id, 
            c.contact_id, 
            c.agent_id, 
            MAX(m.created_at) as last_message_time,
            lm.source_from_api as source,
            lm.instance_name
        FROM chats c
        LEFT JOIN messages m ON c.id = m.chat_id
        LEFT JOIN LastMessage lm ON c.id = lm.chat_id AND lm.rn = 1
        WHERE c.workspace_id = $1 AND (c.status IN ('gerais', 'encerrados') OR c.agent_id = $2)
        GROUP BY c.id, lm.source_from_api, lm.instance_name
        ORDER BY last_message_time DESC NULLS LAST
    `, [workspaceId, userId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: contactsMap.get(r.contact_id)!, 
        agent: r.agent_id ? usersMap.get(r.agent_id) : undefined,
        messages: [],
        source: r.source,
        instance_name: r.instance_name,
    }));

    if (chats.length > 0) {
        const messageRes = await db.query(`
            SELECT id, content, created_at, chat_id, sender_id, workspace_id, instance_name, source_from_api, type, status, metadata, api_message_status, message_id_from_api, from_me
            FROM messages
            WHERE chat_id = ANY($1::uuid[])
            ORDER BY created_at ASC
        `, [chats.map(c => c.id)]);

        const messagesByChat: { [key: string]: Message[] } = {};
        messageRes.rows.forEach(m => {
            if (!messagesByChat[m.chat_id]) {
                messagesByChat[m.chat_id] = [];
            }
            const createdAtDate = new Date(m.created_at);
            messagesByChat[m.chat_id].push({
                id: m.id,
                chat_id: m.chat_id,
                workspace_id: m.workspace_id,
                content: m.content,
                type: m.type,
                status: m.status,
                metadata: m.metadata,
                timestamp: createdAtDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                createdAt: createdAtDate.toISOString(),
                formattedDate: formatMessageDate(createdAtDate),
                sender: getSenderById(m.sender_id), 
                instance_name: m.instance_name,
                source_from_api: m.source_from_api,
                api_message_status: m.api_message_status,
                message_id_from_api: m.message_id_from_api,
                from_me: m.from_me,
            });
        });

        chats.forEach(chat => {
          chat.messages = messagesByChat[chat.id] || [];
        });
    }

    return { chats };
}

export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { workspaceId } = params;

  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  try {
    const data = await fetchDataForWorkspace(workspaceId, session.user.id);
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API /chats/${workspaceId}] Error fetching data:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
