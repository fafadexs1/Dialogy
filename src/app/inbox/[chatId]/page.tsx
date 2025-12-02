
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import { getCurrentUser } from '@/actions/user';

interface InboxPageProps {
  params: Promise<{ chatId?: string }>;
}

export default async function InboxPage({ params }: InboxPageProps) {
  const { chatId } = await params;
  const user = await getCurrentUser();

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
    <CustomerChatLayout initialUser={user} chatId={chatId || null} />
  )
}
