import { MainLayout } from '@/components/layout/main-layout';
import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import type { User } from '@/lib/types';
import { BarChart2 } from 'lucide-react';
import { agents } from '@/lib/mock-data';
import { redirect } from 'next/navigation';

export default async function AnalyticsPage() {
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

  // In a real app, you would fetch user data from your database
  // For now, we'll use the first agent from our mock data
  const user = agents.find(a => a.email === session.user.email) || {
    ...agents[0],
    name: session.user.user_metadata.full_name || session.user.email,
    email: session.user.email
  };

  return (
    <MainLayout user={user}>
      <div className="flex-1 flex flex-col bg-secondary/10">
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="mx-auto max-w-4xl text-center">
              <BarChart2 className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
              <h1 className="text-3xl font-bold mb-2">Módulo de Analytics</h1>
              <p className="text-muted-foreground mb-8">Em breve: Dashboards e relatórios detalhados para uma visão completa do seu negócio.</p>
          </div>
      </main>
      </div>
    </MainLayout>
  );
}
