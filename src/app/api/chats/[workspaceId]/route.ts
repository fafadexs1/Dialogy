
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact } from '@/lib/types';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function formatMessageDate(date: Date): string {
    if (isToday(date)) {
        return `Hoje`;
    }
    if (isYesterday(date)) {
        return `Ontem`;
    }
    return format(date, "dd/MM/yyyy", { locale: ptBR });
}

async function fetchDataForWorkspace(workspaceId: string) {
    if (!workspaceId) return { chats: [] };

    // 1. Fetch all users and contacts for the workspace
    const userRes = await db.query('SELECT id, full_name, avatar_url FROM users');
    const contactRes = await db.query('SELECT id, name, avatar_url FROM contacts WHERE workspace_id = $1', [workspaceId]);

    const allUsers: User[] = userRes.rows.map(u => ({ 
      id: u.id, 
      name: u.full_name, 
      avatar: u.avatar_url,
      firstName: u.full_name.split(' ')[0] || '',
      lastName: u.full_name.split(' ').slice(1).join(' ') || '',
    }));
    
    const allContacts: Contact[] = contactRes.rows.map(c => ({ 
      id: c.id, 
      workspace_id: workspaceId,
      name: c.name, 
      avatar: c.avatar_url,
      firstName: c.name.split(' ')[0] || '',
      lastName: c.name.split(' ').slice(1).join(' ') || '',
    }));

    const allSenders: (User | Contact)[] = [...allUsers, ...allContacts];

    const getSenderById = (id: string | null): MessageSender | undefined => {
      if (!id) return undefined;
      const sender = allSenders.find(s => s.id === id);
      // Se não encontrar, retorna um objeto padrão para evitar quebras
      return sender || { 
        id: 'unknown', 
        name: 'Desconhecido', 
        avatar: 'https://placehold.co/40x40.png?text=?',
        firstName: '?',
        lastName: '?',
      };
    }

    // 2. Fetch chats and order them by the most recent message
    const chatRes = await db.query(`
        SELECT c.id, c.status, c.workspace_id, c.contact_id, c.agent_id, MAX(m.created_at) as last_message_time
        FROM chats c
        LEFT JOIN messages m ON c.id = m.chat_id
        WHERE c.workspace_id = $1
        GROUP BY c.id
        ORDER BY last_message_time DESC NULLS LAST
    `, [workspaceId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: getSenderById(r.contact_id) as Contact,
        agent: getSenderById(r.agent_id) as User,
        messages: [], // Messages will be populated next
    }));
    
    if (chats.length === 0) {
        return { chats: [] };
    }

    // 3. Fetch messages
    const messageRes = await db.query(`
        SELECT id, content, created_at, chat_id, sender_id, workspace_id
        FROM messages
        WHERE workspace_id = $1
        ORDER BY created_at ASC
    `, [workspaceId]);

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
            timestamp: createdAtDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            createdAt: createdAtDate.toISOString(),
            formattedDate: formatMessageDate(createdAtDate),
            sender: getSenderById(m.sender_id)!, // Non-null assertion as sender should exist
        });
    });

    // 4. Combine chats and their messages
    const chatsWithMessages = chats.map(chat => ({
      ...chat,
      messages: messagesByChat[chat.id] || [],
    }))

    return { chats: chatsWithMessages };
}

export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const { workspaceId } = params;

  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  try {
    const data = await fetchDataForWorkspace(workspaceId);
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API /chats/${workspaceId}] Error fetching data:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
