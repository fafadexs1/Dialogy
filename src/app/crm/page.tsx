import CrmLayout from '@/components/crm/crm-layout';
import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';

export default async function CrmPage() {
  const session = await auth();

  const user: User = {
    id: session?.user?.id ?? 'guest',
    name: session?.user?.name ?? 'Guest',
    email: session?.user?.email ?? '',
    avatar: session?.user?.image ?? 'https://placehold.co/40x40.png',
  };

  return (
    <MainLayout user={user}>
      <CrmLayout />
    </MainLayout>
  );
}
