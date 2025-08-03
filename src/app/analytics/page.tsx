import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';
import { BarChart2 } from 'lucide-react';

export default async function AnalyticsPage() {
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
      <main className="flex-1 flex-col bg-secondary/10 p-6 flex items-center justify-center">
       <div className="mx-auto max-w-4xl text-center">
            <BarChart2 className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
            <h1 className="text-3xl font-bold mb-2">Módulo de Analytics</h1>
            <p className="text-muted-foreground mb-8">Em breve: Dashboards e relatórios detalhados para uma visão completa do seu negócio.</p>
       </div>
    </main>
    </MainLayout>
  );
}
