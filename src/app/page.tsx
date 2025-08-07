
import { MainLayout } from '@/components/layout/main-layout';
import { createClient } from '@/lib/supabase/server';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { redirect } from 'next/navigation';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import type { Workspace } from '@/lib/types';

export default async function Home() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch a single user row to get the last active workspace
   const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, full_name, avatar_url, email, last_active_workspace_id')
    .eq('id', user.id)
    .single();

    if (userError) {
        console.error("Error fetching user data", userError);
        // Handle error appropriately, maybe redirect to an error page
    }

  // Fetch all workspaces for the user
  const { data: userWorkspaces, error: workspacesError } = await supabase
      .from('user_workspaces')
      .select('workspaces(*)')
      .eq('user_id', user.id);
  
  if (workspacesError) {
    console.error("Error fetching user workspaces", workspacesError);
    // Handle error appropriately
  }

  const workspaces: Workspace[] = userWorkspaces?.map((uw: any) => ({
      id: uw.workspaces.id,
      name: uw.workspaces.name,
      avatar: uw.workspaces.avatar_url || `https://placehold.co/40x40.png?text=${(uw.workspaces.name || 'W').charAt(0)}`,
  })) || [];
  
  const activeWorkspaceId = userData?.last_active_workspace_id || (workspaces.length > 0 ? workspaces[0].id : undefined);

  const appUser = {
      id: user.id,
      name: userData?.full_name || userData?.email || 'Usuário',
      email: userData?.email || '',
      avatar: userData?.avatar_url || `https://placehold.co/40x40.png?text=${(userData?.full_name || 'U').charAt(0)}`,
      workspaces,
      activeWorkspaceId,
  };


  if (!appUser.activeWorkspaceId) {
    return (
        <MainLayout user={appUser}>
            <WorkspaceOnboarding user={appUser} />
        </MainLayout>
    )
  }

  return (
    <MainLayout user={appUser}>
      <CustomerChatLayout />
    </MainLayout>
  );
}
