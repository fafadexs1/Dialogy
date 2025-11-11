
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace } from '@/lib/types';
import { MainAppLayout } from '@/components/layout/main-app-layout';


// Helper to fetch user data and workspaces in a single query
async function getUserData(userId: string): Promise<User | null> {
    if (!userId) return null;
    try {
        const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userRes.rowCount === 0) return null;
        
        const dbUser = userRes.rows[0];
        
        const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url, r.name as role_name
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            JOIN roles r ON uwr.role_id = r.id
            WHERE uwr.user_id = $1
        `, [userId]);

        const workspaces: Workspace[] = workspacesRes.rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            avatar: r.avatar_url || '',
            roleName: r.role_name,
        }));
        
        return {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url || undefined,
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
        };
    } catch (error) {
        console.error("[HOME_PAGE] Error fetching user data:", error);
        return null;
    }
}


export default async function InboxPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return redirect('/login');
  }

  const user = await getUserData(authUser.id);

  if (!user) {
    // This case might happen if the user record in public.users is not yet created
    // or if there's a DB error. Redirecting to login is a safe fallback.
    return redirect('/login');
  }

  // If the user has no active workspace, show the onboarding flow.
  if (!user.activeWorkspaceId) {
    return <WorkspaceOnboarding user={user} />;
  }
  
  // Otherwise, show the main chat interface.
  return (
    <MainAppLayout user={user}>
      <CustomerChatLayout initialUser={user} />
    </MainAppLayout>
  )
}
