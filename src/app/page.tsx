import { MainLayout } from '@/components/layout/main-layout';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@/lib/types';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { agents } from '@/lib/mock-data';
import { redirect } from 'next/navigation';

export default async function Home() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // In a real app, you would fetch user data from your database or Supabase
  // For now, we'll use a mock agent.
  const appUser = agents.find(a => a.email === user.email) || {
      ...agents[0],
      name: user.user_metadata.full_name || user.email,
      email: user.email
  };

  return (
    <MainLayout user={appUser}>
      <CustomerChatLayout />
    </MainLayout>
  );
}
