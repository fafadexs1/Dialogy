


import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { db } from '@/lib/db';
import type { User, Workspace } from '@/lib/types';

// Helper to fetch user data and workspaces in a single query
async function getUserData(userId: string): Promise<User | null> {
  if (!userId) return null;
  try {
    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) return null;

    const dbUser = userRes.rows[0];

    const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url, r.name as role_name, (w.owner_id = $1) AS is_owner
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
      isOwner: r.is_owner,
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

export default async function InboxRootPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const authUser = session?.user;

  if (!authUser) {
    return redirect('/login');
  }

  const user = await getUserData(authUser.id);

  if (!user) {
    // If the user exists in Auth but not in DB, we must avoid an infinite loop with /login
    // /login redirects to /inbox if authenticated.
    // So we must sign out or redirect to a page that handles this state.
    // For now, we redirect to login with a clear error that the login page can respect.
    return redirect('/login?error=account_not_found');
  }

  // If the user has no active workspace, show the onboarding flow.
  if (!user.activeWorkspaceId) {
    return <WorkspaceOnboarding user={user} />;
  }

  // Render the chat layout without a pre-selected chat.
  return (
    <CustomerChatLayout initialUser={user} chatId={null} />
  )
}
