

import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact, SystemAgent } from '@/lib/types';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { updateUserOnlineStatus } from '@/actions/user';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';

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

async function fetchUserAndWorkspaces(userId: string): Promise<User | null> {
    console.log(`--- [PAGE_SERVER] fetchUserAndWorkspaces: Buscando dados para o usuário ID: ${userId} ---`);
    if (!userId) return null;
    try {
        // Fetch user
        const userRes = await db.query('SELECT id, full_name, avatar_url, email, last_active_workspace_id FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            console.error('[PAGE_SERVER] fetchUserAndWorkspaces: Nenhum usuário encontrado com o ID:', userId);
            return null;
        }
        const dbUser = userRes.rows[0];
        console.log(`[PAGE_SERVER] fetchUserAndWorkspaces: Usuário encontrado: ${dbUser.full_name}`);

        // Fetch user's workspaces from the correct table
        const uwRes = await db.query('SELECT workspace_id FROM user_workspace_roles WHERE user_id = $1', [userId]);
        const workspaceIds = uwRes.rows.map(r => r.workspace_id);
        console.log(`[PAGE_SERVER] fetchUserAndWorkspaces: IDs dos workspaces do usuário: ${workspaceIds.join(', ')}`);

        let workspaces: Workspace[] = [];
        if (workspaceIds.length > 0) {
            const wsRes = await db.query('SELECT id, name, avatar_url FROM workspaces WHERE id = ANY($1)', [workspaceIds]);
            workspaces = wsRes.rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar_url }));
        }

        const userObject = {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url,
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
        };
        console.log(`[PAGE_SERVER] fetchUserAndWorkspaces: Objeto de usuário montado:`, userObject);
        return userObject;
    } catch (error) {
        console.error('[PAGE_SERVER] fetchUserAndWorkspaces: Erro ao buscar dados:', error);
        return null;
    }
}

async function fetchDataForWorkspace(workspaceId: string, userId: string) {
    console.log(`--- [PAGE_SERVER] fetchDataForWorkspace: Buscando dados para o workspace ID: ${workspaceId} e Usuário ID: ${userId} ---`);
    if (!workspaceId) return { chats: [] };

    // 1. Fetch all possible senders (users, contacts, system agents) and create a map for quick lookup.
    const userRes = await db.query('SELECT id, full_name as name, avatar_url as avatar FROM users');
    const contactRes = await db.query('SELECT id, name, avatar_url as avatar, phone_number_jid FROM contacts WHERE workspace_id = $1', [workspaceId]);
    const systemAgentRes = await db.query('SELECT id, name, avatar_url as avatar FROM system_agents WHERE workspace_id = $1', [workspaceId]);

    const sendersMap = new Map<string, MessageSender>();
    userRes.rows.forEach(u => sendersMap.set(u.id, { ...u, type: 'user' }));
    contactRes.rows.forEach(c => sendersMap.set(c.id, { ...c, type: 'contact' }));
    systemAgentRes.rows.forEach(a => sendersMap.set(a.id, { ...a, type: 'system_agent' }));

    // Helper to find any sender by their ID
    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return sendersMap.get(id);
    };
    
    // 3. Fetch chats visible to the current user (Gerais, Atendimentos, and their own Encerrados)
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
            c.tag,
            c.color,
            t.name as team_name,
            MAX(m.created_at) as last_message_time,
            lm.source_from_api as source,
            lm.instance_name,
            COALESCE((SELECT COUNT(*) FROM messages msg WHERE msg.chat_id = c.id AND msg.is_read = FALSE AND msg.from_me = FALSE), 0) as unread_count
        FROM chats c
        LEFT JOIN messages m ON c.id = m.chat_id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        LEFT JOIN LastMessage lm ON c.id = lm.chat_id AND lm.rn = 1
        WHERE c.workspace_id = $1 AND (
            c.status IN ('gerais', 'atendimentos') OR 
            (c.status = 'encerrados' AND c.agent_id = $2)
        )
        GROUP BY c.id, lm.source_from_api, lm.instance_name, t.name
        ORDER BY last_message_time DESC NULLS LAST
    `, [workspaceId, userId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: sendersMap.get(r.contact_id) as Contact,
        agent: sendersMap.get(r.agent_id) as User | undefined,
        messages: [],
        source: r.source,
        instance_name: r.instance_name,
        assigned_at: r.assigned_at,
        unreadCount: parseInt(r.unread_count, 10),
        teamName: r.team_name,
        tag: r.tag,
        color: r.color,
    }));

    // 4. Fetch and combine messages if chats exist
    if (chats.length > 0) {
        // Fetch the complete message history for all contacts present in the visible chats.
        const contactIds = Array.from(new Set(chats.map(c => c.contact.id)));
        
        const messageRes = await db.query(`
            SELECT m.id, m.content, m.created_at, m.chat_id, m.sender_id, m.workspace_id, m.instance_name, m.source_from_api, m.type, m.status, m.metadata, m.api_message_status, m.message_id_from_api, m.from_me, c.contact_id, m.is_read
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
                is_read: m.is_read,
            });
        });

        // Assign the full history to each chat object for that contact
        chats.forEach(chat => {
          chat.messages = messagesByContact[chat.contact.id] || [];
        });
    }

    console.log(`[PAGE_SERVER] fetchDataForWorkspace: Dados de chats e mensagens combinados para o usuário ${userId}.`);
    return { chats };
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-1 w-full min-h-0">
          <div className="flex w-[360px] flex-shrink-0 flex-col border-r bg-card p-4 gap-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <div className="space-y-2 mt-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
              </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
              <Skeleton className="h-16 w-full" />
              <div className="flex-1 p-6 space-y-4">
                  <Skeleton className="h-10 w-1/2 ml-auto" />
                  <Skeleton className="h-10 w-1/2" />
                  <Skeleton className="h-10 w-1/2 ml-auto" />
              </div>
              <Skeleton className="h-24 w-full" />
          </div>
           <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l bg-card p-4 gap-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
           </div>
        </div>
    )
}


export default async function Home() {
  console.log("--- [PAGE_SERVER] Renderizando a página Home ---");
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    console.log("[PAGE_SERVER] Usuário não autenticado. Redirecionando para /login.");
    redirect('/login');
  }
  
  const userId = session.user.id;
  console.log("[PAGE_SERVER] Sessão encontrada para o usuário ID:", userId);

  await updateUserOnlineStatus(userId, true);
  
  const user = await fetchUserAndWorkspaces(userId);
  
  if (!user) {
    console.error("[PAGE_SERVER] Não foi possível carregar os dados do usuário. Exibindo mensagem de erro.");
    await updateUserOnlineStatus(userId, false);
    return (
       <MainLayout>
            <div className="flex-1 flex items-center justify-center">
                <p>Ocorreu um erro ao carregar os dados do usuário. Tente novamente mais tarde.</p>
            </div>
       </MainLayout>
    )
  }

  if (!user.activeWorkspaceId) {
    console.log("[PAGE_SERVER] Usuário não possui workspace ativo. Renderizando onboarding.");
    return (
        <MainLayout user={user}>
            <WorkspaceOnboarding user={user} />
        </MainLayout>
    )
  }

  console.log(`[PAGE_SERVER] Usuário tem um workspace ativo (ID: ${user.activeWorkspaceId}). Buscando dados...`);
  const { chats } = await fetchDataForWorkspace(user.activeWorkspaceId, user.id);

  console.log("[PAGE_SERVER] Renderizando layout principal com CustomerChatLayout.");
  
  if(!chats) {
    return (
        <MainLayout user={user}>
            <LoadingSkeleton />
        </MainLayout>
    )
  }

  return (
    <MainLayout user={user}>
      <CustomerChatLayout initialChats={chats} currentUser={user} />
    </MainLayout>
  );
}
