import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';
import SettingsLayout from '@/components/settings/settings-layout';

export default async function SettingsPage() {
  const session = await auth();

  const user: User = {
    id: session?.user?.id ?? 'guest',
    name: session?.user?.name ?? 'Guest',
    email: session?.user?.email ?? '',
    avatar: session?.user?.image ?? 'https://placehold.co/40x40.png',
    firstName: session?.user?.name?.split(' ')[0] ?? 'Guest',
    lastName: session?.user?.name?.split(' ')[1] ?? '',
  };

  return (
    <MainLayout user={user}>
      <SettingsLayout />
    </MainLayout>
  );
}
