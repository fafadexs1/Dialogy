
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact, SystemAgent } from '@/lib/types';
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
    console.log(`--- [API_ROUTE] fetchDataForWorkspace: Buscando dados para o workspace ID: ${workspaceId} e Usuário ID: ${userId} ---`);
    if (!workspaceId) return { chats: [] };

    // 1. Fetch all possible senders and create a map for quick lookup.
    const userRes = await db.query('SELECT id, full_name as name, avatar_url as avatar FROM users');
    const contactRes = await db.query('SELECT id, name, avatar_url as avatar, phone_number_jid FROM contacts WHERE workspace_id = $1', [workspaceId]);
    const systemAgentRes = await db.query('SELECT id, name, avatar_url as avatar FROM system_agents WHERE workspace_id = $1', [workspaceId]);

    const sendersMap = new Map<string, MessageSender>();
    userRes.rows.forEach(u => sendersMap.set(u.id, { ...u, type: 'user' }));
    contactRes.rows.forEach(c => sendersMap.set(c.id, { ...c, type: 'contact' }));
    systemAgentRes.rows.forEach(a => sendersMap.set(a.id, { ...a, type: 'system_agent' }));

    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return sendersMap.get(id);
    };
    
    // 2. Fetch chats visible to the current user
    const chatRes = await db.query(`
        WITH LastMessage AS (
            SELECT
                chat_id,
                content,
                type,
                metadata,
                created_at,
                ROW_NUMBER() OVER(PARTITION BY chat_id ORDER BY created_at DESC) as rn
            FROM messages
        )
        SELECT 
            c.id, 
            c.status, 
            c.workspace_id, 
            c.contact_id, 
            c.agent_id, 
            c.assigned_at,
            c.tag,
            c.color,
            t.name as team_name,
            lm.content as last_message_content,
            lm.type as last_message_type,
            lm.metadata as last_message_metadata,
            lm.created_at as last_message_time,
            COALESCE((SELECT COUNT(*) FROM messages msg WHERE msg.chat_id = c.id AND msg.is_read = FALSE AND msg.from_me = FALSE), 0) as unread_count
        FROM chats c
        LEFT JOIN LastMessage lm ON c.id = lm.chat_id AND lm.rn = 1
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        WHERE c.workspace_id = $1 AND (
            c.status IN ('gerais', 'atendimentos') OR 
            (c.status = 'encerrados' AND c.agent_id = $2)
        )
        GROUP BY c.id, t.name, lm.content, lm.type, lm.metadata, lm.created_at
        ORDER BY last_message_time DESC NULLS LAST
    `, [workspaceId, userId]);

    // 3. Fetch all messages for the selected chats to construct the full Chat object
     const chatIds = chatRes.rows.map(r => r.id);
     let allMessages: Message[] = [];
     if (chatIds.length > 0) {
        const messageRes = await db.query(`
            SELECT m.*, c.contact_id
            FROM messages m
            JOIN chats c ON m.chat_id = c.id
            WHERE m.chat_id = ANY($1::uuid[])
            ORDER BY m.created_at ASC
        `, [chatIds]);
        
        allMessages = messageRes.rows.map(m => {
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
     }
     
    const messagesByChatId = allMessages.reduce((acc, msg) => {
        if (!acc[msg.chat_id]) {
            acc[msg.chat_id] = [];
        }
        acc[msg.chat_id].push(msg);
        return acc;
    }, {} as Record<string, Message[]>);


    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: sendersMap.get(r.contact_id) as Contact, // Assuming contact will always be found
        agent: sendersMap.get(r.agent_id) as User | undefined,
        messages: messagesByChatId[r.id] || [],
        assigned_at: r.assigned_at,
        unreadCount: parseInt(r.unread_count, 10),
        teamName: r.team_name,
        tag: r.tag,
        color: r.color,
    }));

    console.log(`[API_ROUTE] fetchDataForWorkspace: Dados de chats e mensagens combinados para o usuário ${userId}.`);
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
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    console.error(`[API /chats/${workspaceId}] Error fetching data:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
