
import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { agents, workspaces } from '@/lib/mock-data';

export default async function Home() {
  // MOCK IMPLEMENTATION: Simulating fetching a user and their workspaces.
  const user = agents[0]; // Assume the first agent is the logged-in user.
  
  const hasWorkspaces = user.workspaces && user.workspaces.length > 0;
  const activeWorkspaceId = user.activeWorkspaceId || (hasWorkspaces ? user.workspaces?.[0].id : undefined);
  
  const appUser = {
    ...user,
    workspaces: user.workspaces || [],
    activeWorkspaceId: activeWorkspaceId,
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
