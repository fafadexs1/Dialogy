import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { SettingsLayout } from '@/components/settings/settings-layout';

export default async function SettingsPage() {
  const session = await auth();

  // In a real app, you would fetch user data from your database
  // For now, we'll use the first agent from our mock data
  const user = agents.find(a => a.email === session?.user?.email) || agents[0];

  return (
    <MainLayout user={user}>
      <SettingsLayout />
    </MainLayout>
  );
}
