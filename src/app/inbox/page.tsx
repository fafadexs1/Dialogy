

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import MobileChatLayout from '@/components/layout/mobile-chat-layout';
import ResponsiveLayoutWrapper from '@/components/layout/responsive-layout-wrapper';
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

  // Detect Device
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') || '';
  const isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const defaultLayout = isMobile ? 'mobile' : 'desktop';

  // Render the chat layout without a pre-selected chat.
  return (
    <ResponsiveLayoutWrapper
      defaultLayout={defaultLayout}
      desktopLayout={
        <div className="flex w-full h-full">
          <CustomerChatLayout
            initialUser={user}
            chatId={initialData?.selectedChatId ?? null}
            initialData={initialData}
          />
        </div>
      }
      mobileLayout={
        <div className="flex w-full h-full">
          <MobileChatLayout
            initialUser={user}
            chatId={initialData?.selectedChatId ?? null}
            initialData={initialData}
          />
        </div>
      }
    >
      {/* Wrapper decides what to render */}
      {null}
    </ResponsiveLayoutWrapper>
  )
}
