import CrmLayout from '@/components/crm/crm-layout';
import { MainLayout } from '@/components/layout/main-layout';
import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { redirect } from 'next/navigation';

export default async function CrmPage() {
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

  const user = agents.find(a => a.email === session.user.email) || {
      ...agents[0],
      name: session.user.user_metadata.full_name || session.user.email,
      email: session.user.email
  };

  return (
    <MainLayout user={user}>
       <div className="flex-1 flex flex-col h-full">
            <CrmLayout />
       </div>
    </MainLayout>
  );
}
