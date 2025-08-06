import { MainLayout } from '@/components/layout/main-layout';
import { createServerClient } from '@supabase/auth-helpers-nextjs';
import type { User } from '@/lib/types';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { agents } from '@/lib/mock-data';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: () => cookieStore }
  );

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  // In a real app, you would fetch user data from your database or Supabase
  // For now, we'll use a mock agent.
  const user = agents.find(a => a.email === session.user.email) || {
      ...agents[0],
      name: session.user.user_metadata.full_name || session.user.email,
      email: session.user.email
  };

  return (
    <MainLayout user={user}>
      <div className="flex-1 flex flex-col h-[calc(100vh_-_1rem)]">
        <CustomerChatLayout />
      </div>
    </MainLayout>
  );
}
