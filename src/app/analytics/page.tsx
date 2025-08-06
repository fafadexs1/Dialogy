import { MainLayout } from '@/components/layout/main-layout';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@/lib/types';
import { BarChart2 } from 'lucide-react';
import { agents } from '@/lib/mock-data';
import { redirect } from 'next/navigation';

export default async function AnalyticsPage() {
    const supabase = createClient();
  
    const { data: { user: authUser } } = await supabase.auth.getUser();

     if (!authUser) {
        redirect('/login');
    }

  // In a real app, you would fetch user data from your database
  // For now, we'll use the first agent from our mock data
  const user = agents.find(a => a.email === authUser.email) || {
    ...agents[0],
    name: authUser.user_metadata.full_name || authUser.email,
    email: authUser.email
  };

  return (
    <MainLayout user={user}>
      <div className="flex-1 flex flex-col items-center justify-center bg-secondary/10 p-6">
        <div className="mx-auto max-w-4xl text-center">
            <BarChart2 className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
            <h1 className="text-3xl font-bold mb-2">Módulo de Analytics</h1>
            <p className="text-muted-foreground mb-8">Em breve: Dashboards e relatórios detalhados para uma visão completa do seu negócio.</p>
        </div>
      </div>
    </MainLayout>
  );
}
