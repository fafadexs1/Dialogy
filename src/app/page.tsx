import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { agents } from '@/lib/mock-data';

export default async function Home() {
  const session = await auth();

  const user = agents.find(a => a.email === session?.user?.email) || agents[0];

  return (
    <MainLayout user={user}>
      <CustomerChatLayout />
    </MainLayout>
  );
}
