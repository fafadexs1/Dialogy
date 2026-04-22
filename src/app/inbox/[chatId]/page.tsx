
import { redirect } from 'next/navigation';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import MobileChatLayout from '@/components/layout/mobile-chat-layout';
import InboxLoadingShell from '@/components/layout/inbox-loading-shell';
import ResponsiveLayoutWrapper from '@/components/layout/responsive-layout-wrapper';
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
    <ResponsiveLayoutWrapper
      desktopLayout={
        <div className="flex w-full h-full">
          <CustomerChatLayout
            initialUser={user}
            chatId={chatId || null}
            initialData={initialData}
          />
        </div>
      }
      mobileLayout={
        <div className="flex w-full h-full">
          <MobileChatLayout
            initialUser={user}
            chatId={chatId || null}
            initialData={initialData}
          />
        </div>
      }
      loadingFallback={<InboxLoadingShell />}
    />
  )
}
