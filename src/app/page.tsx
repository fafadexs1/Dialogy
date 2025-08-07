
import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace, Chat, Message, MessageSender, Contact } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/[...nextauth]/route';


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
    if (!workspaceId) return { chats: [], messagesByChat: {} };

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

    const allSenders = [...allUsers, ...allContacts];

    const getSenderById = (id: string): MessageSender => {
      const sender = allSenders.find(s => s.id === id);
      return sender || { 
        id: 'unknown', 
        name: 'Desconhecido', 
        avatar: 'https://placehold.co/40x40.png?text=?',
        firstName: '?',
        lastName: '?',
      };
    }

    // 2. Fetch chats
    const chatRes = await db.query(`
        SELECT c.id, c.status, c.workspace_id, c.contact_id, c.agent_id
        FROM chats c
        WHERE c.workspace_id = $1
    `, [workspaceId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: getSenderById(r.contact_id) as Contact,
        agent: getSenderById(r.agent_id) as User,
        messages: [], // Messages will be populated next
    }));
    console.log(`[PAGE_SERVER] fetchDataForWorkspace: ${chats.length} chats encontrados.`);

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
        messagesByChat[m.chat_id].push({
            id: m.id,
            chat_id: m.chat_id,
            workspace_id: m.workspace_id,
            content: m.content,
            timestamp: new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            sender: getSenderById(m.sender_id),
        });
    });

    // 4. Combine chats and their messages
    const chatsWithMessages = chats.map(chat => ({
      ...chat,
      messages: messagesByChat[chat.id] || [],
    }))

    console.log(`[PAGE_SERVER] fetchDataForWorkspace: Dados de chats e mensagens combinados.`);
    return { chats: chatsWithMessages };
}


export default async function Home() {
  console.log("--- [PAGE_SERVER] Renderizando a página Home ---");
  const session = await auth();

  if (!session?.user?.id) {
    console.log("[PAGE_SERVER] Usuário não autenticado. Redirecionando para /login.");
    redirect('/login');
  }
  
  console.log("[PAGE_SERVER] Sessão encontrada para o usuário ID:", session.user.id);
  const user = await fetchUserAndWorkspaces(session.user.id);
  
  if (!user) {
    console.error("[PAGE_SERVER] Não foi possível carregar os dados do usuário. Exibindo mensagem de erro.");
    return (
       <MainLayout>
            <div className="flex-1 flex items-center justify-center">
                <p>Ocorreu um erro ao carregar os dados do usuário. Tente novamente mais tarde.</p>
            </div>
       </MainLayout>
    )
  }

  revalidatePath('/', 'layout');

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
