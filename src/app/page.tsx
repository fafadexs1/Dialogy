
import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact } from '@/lib/types';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { updateUserOnlineStatus } from '@/actions/user';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';

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

    // 1. Fetch all users (agents) and create a map for quick lookup.
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

    // 2. Fetch all contacts for the workspace and create a map.
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

    // Helper to find any sender (user or contact) by their ID
    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return usersMap.get(id) || contactsMap.get(id);
    };
    
    // 3. Fetch chats and order them by the most recent message, also fetching the source and instance name of the last message.
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
        WHERE c.workspace_id = $1 AND (c.status IN ('gerais', 'atendimentos') OR c.agent_id = $2)
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
        assigned_at: r.assigned_at,
    }));

    // 4. Fetch and combine messages if chats exist
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
            const zonedDate = toZonedTime(createdAtDate, timeZone);
            
            messagesByChat[m.chat_id].push({
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
          chat.messages = messagesByChat[chat.id] || [];
        });
    }

    console.log(`[PAGE_SERVER] fetchDataForWorkspace: Dados de chats e mensagens combinados para o usuário ${userId}.`);
    return { chats };
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
  return (
    <MainLayout user={user}>
      <CustomerChatLayout initialChats={chats} currentUser={user} />
    </MainLayout>
  );
}
