
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact } from '@/lib/types';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

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
            avatar_url: c.avatar_url,
            phone_number_jid: c.phone_number_jid,
            firstName: c.name.split(' ')[0] || '',
            lastName: c.name.split(' ').slice(1).join(' ') || '',
        }
    ]));

    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return usersMap.get(id) || contactsMap.get(id);
    };
    
    // Corrected query to fetch ALL chats for the workspace, allowing the frontend to filter.
    // This ensures consistency between server and client fetches.
    const chatRes = await db.query(`
        WITH LastMessage AS (
            SELECT
                chat_id,
                source_from_api,
                instance_name,
                created_at,
                ROW_NUMBER() OVER(PARTITION BY chat_id ORDER BY created_at DESC) as rn
            FROM messages
            WHERE type = 'text' OR type IS NULL
        )
        SELECT 
            c.id, 
            c.status, 
            c.workspace_id, 
            c.contact_id, 
            c.agent_id, 
            c.assigned_at,
            MAX(m.created_at) as last_message_time,
            lm.source_from_api as source,
            lm.instance_name
        FROM chats c
        LEFT JOIN messages m ON c.id = m.chat_id
        LEFT JOIN LastMessage lm ON c.id = lm.chat_id AND lm.rn = 1
        WHERE c.workspace_id = $1
        GROUP BY c.id, lm.source_from_api, lm.instance_name
        ORDER BY last_message_time DESC NULLS LAST
    `, [workspaceId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: contactsMap.get(r.contact_id)!, 
        agent: r.agent_id ? usersMap.get(r.agent_id) : undefined,
        messages: [],
        source: r.source,
        instance_name: r.instance_name,
        assigned_at: r.assigned_at,
    }));

    if (chats.length > 0) {
        // Fetch all messages for all contacts associated with the fetched chats.
        // This provides the full history needed for the toggle feature.
        const contactIds = Array.from(new Set(chats.map(c => c.contact.id)));

        const messageRes = await db.query(`
            SELECT m.id, m.content, m.created_at, m.chat_id, m.sender_id, m.workspace_id, m.instance_name, m.source_from_api, m.type, m.status, m.metadata, m.api_message_status, m.message_id_from_api, m.from_me, c.contact_id
            FROM messages m
            JOIN chats c ON m.chat_id = c.id
            WHERE c.contact_id = ANY($1::uuid[]) AND c.workspace_id = $2
            ORDER BY m.created_at ASC
        `, [contactIds, workspaceId]);

        const messagesByContact: { [key: string]: Message[] } = {};
        messageRes.rows.forEach(m => {
            if (!messagesByContact[m.contact_id]) {
                messagesByContact[m.contact_id] = [];
            }
            const createdAtDate = new Date(m.created_at);
            const zonedDate = toZonedTime(createdAtDate, timeZone);

            messagesByContact[m.contact_id].push({
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
                instance_name: m.instance_name,
                source_from_api: m.source_from_api,
                api_message_status: m.api_message_status,
                message_id_from_api: m.message_id_from_api,
                from_me: m.from_me,
            });
        });

        chats.forEach(chat => {
          // Assign the full message history of the contact to every chat with that contact
          chat.messages = messagesByContact[chat.contact.id] || [];
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

  const workspaceId = params.workspaceId;

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
