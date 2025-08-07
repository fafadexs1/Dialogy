
import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace } from '@/lib/types';
import { revalidatePath } from 'next/cache';

async function fetchUserAndWorkspaces(userId: string): Promise<User | null> {
    try {
        // Fetch user
        const userRes = await db.query('SELECT id, full_name, avatar_url, email, last_active_workspace_id FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            console.error('No user found with id:', userId);
            return null;
        }
        const dbUser = userRes.rows[0];

        // Fetch user_workspaces entries
        const uwRes = await db.query('SELECT workspace_id FROM user_workspaces WHERE user_id = $1', [userId]);
        const workspaceIds = uwRes.rows.map(r => r.workspace_id);

        let workspaces: Workspace[] = [];
        if (workspaceIds.length > 0) {
            const wsRes = await db.query('SELECT id, name, avatar_url FROM workspaces WHERE id = ANY($1)', [workspaceIds]);
            workspaces = wsRes.rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar_url }));
        }

        return {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url,
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
        };
    } catch (error) {
        console.error('Error fetching user and workspaces:', error);
        return null;
    }
}


export default async function Home() {
  // MOCK: Replace with actual auth logic to get the logged-in user ID
  const mockUserId = '8f5a948d-9b37-41d3-ac8f-0797282b9e6f'; // Assuming this is the logged in user
  
  const user = await fetchUserAndWorkspaces(mockUserId);
  
  if (!user) {
    // This could be a loading state or an error page
    return (
       <MainLayout>
            <div className="flex-1 flex items-center justify-center">
                <p>Ocorreu um erro ao carregar os dados do usuário. Tente novamente mais tarde.</p>
            </div>
       </MainLayout>
    )
  }

  // Ensure path is revalidated if needed, for instance after a workspace switch
  revalidatePath('/', 'layout');

  if (!user.activeWorkspaceId) {
    return (
        <MainLayout user={user}>
            <WorkspaceOnboarding user={user} />
        </MainLayout>
    )
  }

  return (
    <MainLayout user={user}>
      <CustomerChatLayout />
    </MainLayout>
  );
}
