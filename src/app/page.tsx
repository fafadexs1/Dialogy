
import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact } from '@/lib/types';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { updateUserOnlineStatus } from '@/actions/user';
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

        // Fetch user_workspaces entries
        const uwRes = await db.query('SELECT workspace_id FROM user_workspaces WHERE user_id = $1', [userId]);
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

async function fetchDataForWorkspace(workspaceId: string) {
    console.log(`--- [PAGE_SERVER] fetchDataForWorkspace: Buscando dados para o workspace ID: ${workspaceId} ---`);
    if (!workspaceId) return { chats: [] };

    const userRes = await db.query('SELECT id, full_name, avatar_url FROM users');
    const allUsers: User[] = userRes.rows.map(u => ({ 
      id: u.id, 
      name: u.full_name, 
      avatar: u.avatar_url,
      firstName: u.full_name.split(' ')[0] || '',
      lastName: u.full_name.split(' ').slice(1).join(' ') || '',
    }));
    
    const contactRes = await db.query('SELECT id, name, avatar_url FROM contacts WHERE workspace_id = $1', [workspaceId]);
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
        return allSenders.find(s => s.id === id) || { 
            id: 'unknown', 
            name: 'Desconhecido', 
            avatar: 'https://placehold.co/40x40.png?text=?',
            firstName: '?',
            lastName: '?',
        };
    };

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
        messages: [],
    }));
    console.log(`[PAGE_SERVER] fetchDataForWorkspace: ${chats.length} chats encontrados.`);

    if (chats.length > 0) {
        const messageRes = await db.query(`
            SELECT id, content, created_at, chat_id, sender_id, workspace_id
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
                timestamp: createdAtDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                createdAt: createdAtDate.toISOString(),
                formattedDate: formatMessageDate(createdAtDate),
                sender: getSenderById(m.sender_id)!,
            });
        });

        chats.forEach(chat => {
          chat.messages = messagesByChat[chat.id] || [];
        });
    }

    console.log(`[PAGE_SERVER] fetchDataForWorkspace: Dados de chats e mensagens combinados.`);
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

  // Mark user as online when they access the main page
  await updateUserOnlineStatus(userId, true);
  
  const user = await fetchUserAndWorkspaces(userId);
  
  if (!user) {
    console.error("[PAGE_SERVER] Não foi possível carregar os dados do usuário. Exibindo mensagem de erro.");
    // Mark user as offline if fetching data fails and they are essentially logged out
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
  const { chats } = await fetchDataForWorkspace(user.activeWorkspaceId);

  console.log("[PAGE_SERVER] Renderizando layout principal com CustomerChatLayout.");
  return (
    <MainLayout user={user}>
      <CustomerChatLayout initialChats={chats} currentUser={user} />
    </MainLayout>
  );
}
