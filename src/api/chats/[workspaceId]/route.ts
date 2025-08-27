
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
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
    
    // Fetch chats visible to the current user (Gerais, Atendimentos, and their own Encerrados)
    const chatRes = await prisma.chat.findMany({
        where: {
            workspaceId,
            OR: [
                { status: { in: ['gerais', 'atendimentos'] } },
                { status: 'encerrados', agentId: userId }
            ]
        },
        include: {
            contact: true,
            agent: true,
            team: true,
            messages: {
                orderBy: {
                    createdAt: 'desc',
                },
                take: 1,
            },
            _count: {
                select: {
                    messages: {
                        where: {
                            isRead: false,
                            fromMe: false,
                        }
                    }
                }
            }
        },
        orderBy: {
            // This is tricky, Prisma doesn't easily allow ordering by a relation's field.
            // We'll sort in application code.
            createdAt: 'desc', 
        }
    });

    const chats: Chat[] = chatRes.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspaceId,
        contact: r.contact,
        agent: r.agent,
        messages: r.messages, // Will be replaced or enriched later
        source: r.messages[0]?.sourceFromApi,
        instance_name: r.messages[0]?.instanceName,
        assigned_at: r.assignedAt?.toISOString(),
        unreadCount: r._count.messages,
        teamName: r.team?.name,
        tag: r.tag,
        color: r.color,
    })).sort((a, b) => {
        const timeA = a.messages[0] ? new Date(a.messages[0].createdAt).getTime() : 0;
        const timeB = b.messages[0] ? new Date(b.messages[0].createdAt).getTime() : 0;
        return timeB - timeA;
    });

    // Fetch message history for all unique contact IDs in the visible chats.
    const contactIds = [...new Set(chats.map(c => c.contact?.id).filter(Boolean))] as string[];

    let allMessagesForContacts: any[] = [];
    if (contactIds.length > 0) {
        allMessagesForContacts = await prisma.message.findMany({
            where: {
                chat: {
                    contactId: { in: contactIds },
                    workspaceId: workspaceId,
                }
            },
            include: {
                sender: true,
                systemAgentSender: true,
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
    }

    const messagesByContact: { [key: string]: Message[] } = {};
    for (const m of allMessagesForContacts) {
        const contactId = m.chat.contactId;
        if (!messagesByContact[contactId]) {
            messagesByContact[contactId] = [];
        }
        
        const createdAtDate = new Date(m.createdAt);
        const zonedDate = toZonedTime(createdAtDate, timeZone);

        // Determine the sender (User or SystemAgent)
        let sender: MessageSender;
        if (m.sender) {
            sender = { ...m.sender, type: 'user' };
        } else if (m.systemAgentSender) {
            sender = { ...m.systemAgentSender, type: 'system_agent' };
        } else {
            // Fallback for contact-sent messages (from webhook)
            sender = { ...chats.find(c => c.id === m.chatId)?.contact, type: 'contact' };
        }
        
        messagesByContact[contactId].push({
            id: m.id,
            chat_id: m.chatId,
            workspace_id: m.workspaceId,
            content: m.content || '',
            type: m.type as Message['type'],
            status: 'default', // Assuming default status
            metadata: m.metadata as MessageMetadata,
            timestamp: formatInTimeZone(zonedDate, 'HH:mm', { locale: ptBR }),
            createdAt: createdAtDate.toISOString(),
            formattedDate: formatMessageDate(createdAtDate),
            sender: sender, 
            instance_name: m.instanceName,
            source_from_api: m.sourceFromApi,
            api_message_status: m.apiMessageStatus,
            message_id_from_api: m.messageIdFromApi,
            from_me: m.fromMe,
            is_read: m.isRead,
        });
    }

    // Assign full message history to each chat
    chats.forEach(chat => {
      if (chat.contact?.id && messagesByContact[chat.contact.id]) {
        chat.messages = messagesByContact[chat.contact.id];
      } else {
        chat.messages = []; // Ensure it's an empty array if no history found
      }
    });

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
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API /chats/${workspaceId}] Error fetching data:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
