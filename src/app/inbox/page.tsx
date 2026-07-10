
import { redirect } from 'next/navigation';
import ResponsiveInboxLayout from '@/components/layout/responsive-inbox-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { getInboxBootstrap } from '@/lib/server/inbox-bootstrap';

export default async function InboxRootPage() {
  const { user, initialData } = await getInboxBootstrap(null);

  if (!user) {
    return redirect('/login');
  }

  // If the user has no active workspace, show the onboarding flow.
  if (!user.activeWorkspaceId) {
    return <WorkspaceOnboarding user={user} />;
  }

  // Render the chat layout without a pre-selected chat.
  return (
    <ResponsiveInboxLayout
      initialUser={user}
      initialChatId={initialData?.selectedChatId ?? null}
      initialData={initialData}
    />
  )
}
