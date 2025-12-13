

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { getCurrentUser } from '@/actions/user';

export default async function InboxRootPage() {
  const user = await getCurrentUser();

  if (!user) {
    return redirect('/login');
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
