import CrmLayout from '@/components/crm/crm-layout';
import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data';

export default async function CrmPage() {
  const session = await auth();

  const user = agents.find(a => a.email === session?.user?.email) || agents[0];

  return (
    <MainLayout user={user}>
       <div className="flex-1 flex flex-col h-full">
            <CrmLayout />
       </div>
    </MainLayout>
  );
}
