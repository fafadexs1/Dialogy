
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact, SystemAgent } from '@/lib/types';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

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
    
    // Fetch chats visible to the current user (Gerais, Atendimentos, and their own Encerrados)
    const chatQuery = `
        SELECT 
            c.id, c.status, c.workspace_id, c.assigned_at, c.tag, c.color,
            json_build_object(
                'id', ct.id, 'name', ct.name, 'email', ct.email, 'phone_number_jid', ct.phone_number_jid, 'avatar_url', ct.avatar_url
            ) as contact,
            json_build_object(
                'id', a.id, 'name', a.full_name, 'avatar', a.avatar_url
            ) as agent,
            t.name as team_name,
            (SELECT m.source_from_api FROM messages m WHERE m.chat_id = c.id AND m.source_from_api IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as source,
            (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as instance_name,
            (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.is_read = FALSE AND m.from_me = FALSE) as unread_count,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id) as last_message_time
        FROM chats c
        JOIN contacts ct ON c.contact_id = ct.id
        LEFT JOIN users a ON c.agent_id = a.id
        LEFT JOIN teams t ON c.agent_id = ANY(SELECT tm.user_id FROM team_members tm WHERE tm.team_id = t.id)
        WHERE c.workspace_id = $1 AND (c.status IN ('gerais', 'atendimentos') OR (c.status = 'encerrados' AND c.agent_id = $2))
        ORDER BY last_message_time DESC NULLS LAST;
    `;
    const chatRes = await db.query(chatQuery, [workspaceId, userId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        ...r,
        agent: r.agent.id ? r.agent : undefined,
        messages: [],
        unreadCount: parseInt(r.unread_count, 10),
    }));

    // Fetch message history for all unique contact IDs in the visible chats.
    const contactIds = [...new Set(chats.map(c => c.contact?.id).filter(Boolean))] as string[];

    let allMessagesForContacts: any[] = [];
    if (contactIds.length > 0) {
        const messagesQuery = `
            SELECT 
                m.*,
                sender_user.id as user_id, sender_user.full_name as user_name, sender_user.avatar_url as user_avatar,
                sender_agent.id as agent_id, sender_agent.name as agent_name, sender_agent.avatar_url as agent_avatar,
                ct.id as contact_id
            FROM messages m
            JOIN chats ch ON m.chat_id = ch.id
            JOIN contacts ct ON ch.contact_id = ct.id
            LEFT JOIN users sender_user ON m.sender_id_user = sender_user.id
            LEFT JOIN system_agents sender_agent ON m.sender_id_system_agent = sender_agent.id
            WHERE ch.contact_id = ANY($1::uuid[]) AND m.workspace_id = $2
            ORDER BY m.created_at ASC
        `;
        const messagesRes = await db.query(messagesQuery, [contactIds, workspaceId]);
        allMessagesForContacts = messagesRes.rows;
    }

    const messagesByContact: { [key: string]: Message[] } = {};
    for (const m of allMessagesForContacts) {
        const contactId = m.contact_id;
        if (!messagesByContact[contactId]) {
            messagesByContact[contactId] = [];
        }
        
        const createdAtDate = new Date(m.created_at);
        const zonedDate = toZonedTime(createdAtDate, timeZone);

        let sender: MessageSender;
        if (m.user_id) {
            sender = { id: m.user_id, name: m.user_name, avatar: m.user_avatar, type: 'user' };
        } else if (m.agent_id) {
            sender = { id: m.agent_id, name: m.agent_name, avatar: m.agent_avatar, type: 'system_agent' };
        } else {
             const chatForMessage = chats.find(c => c.id === m.chat_id);
             sender = { ...chatForMessage?.contact, type: 'contact' };
        }
        
        messagesByContact[contactId].push({
            id: m.id,
            chat_id: m.chat_id,
            workspace_id: m.workspace_id,
            content: m.content || '',
            type: m.type as Message['type'],
            status: m.content === 'Mensagem apagada' ? 'deleted' : 'default', // Infer status
            metadata: m.metadata as MessageMetadata,
            timestamp: formatInTimeZone(zonedDate, 'HH:mm', { locale: ptBR }),
            createdAt: createdAtDate.toISOString(),
            formattedDate: formatMessageDate(createdAtDate),
            sender: sender, 
            instance_name: m.instance_name,
            source_from_api: m.source_from_api,
            api_message_status: m.api_message_status,
            message_id_from_api: m.message_id_from_api,
            from_me: m.from_me,
            is_read: m.is_read,
        });
    }

    // Assign full message history to each chat
    chats.forEach(chat => {
      if (chat.contact?.id && messagesByContact[chat.contact.id]) {
        // Filter messages for this specific chat ID
        chat.messages = messagesByContact[chat.contact.id].filter(m => m.chat_id === chat.id);
      } else {
        chat.messages = [];
      }
    });

    console.log(`[API_ROUTE] fetchDataForWorkspace: Dados de chats e mensagens combinados para o usuário ${userId}.`);
    return { chats };
}

export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const { data: { session } } = await supabase.auth.getSession();
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
