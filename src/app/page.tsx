
import { MainLayout } from '@/components/layout/main-layout';
import { createClient } from '@/lib/supabase/server';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { agents } from '@/lib/mock-data';
import { redirect } from 'next/navigation';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import type { Workspace } from '@/lib/types';

export default async function Home() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch workspaces for the user
  const { data: userWorkspaces, error } = await supabase
      .from('user_workspaces')
      .select('workspaces(*)')
      .eq('user_id', user.id);
  
  if (error) {
    console.error("Error fetching user workspaces", error);
    // Handle error appropriately
  }

  const workspaces: Workspace[] = userWorkspaces?.map((uw: any) => ({
      id: uw.workspaces.id,
      name: uw.workspaces.name,
      avatar: uw.workspaces.avatar_url,
  })) || [];
  
  const activeWorkspaceId = workspaces.length > 0 ? workspaces[0].id : undefined;

  const appUser = {
      id: user.id,
      name: user.user_metadata.full_name || user.email || 'Usuário',
      email: user.email || '',
      avatar: user.user_metadata.avatar_url || `https://placehold.co/40x40.png?text=${(user.user_metadata.full_name || 'U').charAt(0)}`,
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
