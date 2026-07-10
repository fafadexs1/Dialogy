
import { redirect } from 'next/navigation';
import ResponsiveInboxLayout from '@/components/layout/responsive-inbox-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { getInboxBootstrap } from '@/lib/server/inbox-bootstrap';

interface InboxPageProps {
  params: Promise<{ chatId?: string }>;
}

export default async function InboxPage({ params }: InboxPageProps) {
  const { chatId } = await params;
  const { user, initialData } = await getInboxBootstrap(chatId || null);

  if (!user) {
    return redirect('/login');
  }

  // If the user has no active workspace, show the onboarding flow.
  if (!user.activeWorkspaceId) {
    return <WorkspaceOnboarding user={user} />;
  }

  // Otherwise, show the main chat interface.
  // We pass the chatId from the URL to the layout component.
  return (
    <ResponsiveInboxLayout
      initialUser={user}
      initialChatId={chatId || null}
      initialData={initialData}
    />
  )
}
