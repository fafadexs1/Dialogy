import CrmLayout from '@/components/crm/crm-layout';
import { MainLayout } from '@/components/layout/main-layout';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { redirect } from 'next/navigation';

export default async function CrmPage() {
  const supabase = createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();

   if (!authUser) {
    redirect('/login');
  }

  const user = agents.find(a => a.email === authUser.email) || {
      ...agents[0],
      name: authUser.user_metadata.full_name || authUser.email,
      email: authUser.email
  };

  return (
    <MainLayout user={user}>
        <CrmLayout />
    </MainLayout>
  );
}
