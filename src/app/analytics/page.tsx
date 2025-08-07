import { MainLayout } from '@/components/layout/main-layout';
import type { User } from '@/lib/types';
import { BarChart2 } from 'lucide-react';
import { agents } from '@/lib/mock-data';

export default async function AnalyticsPage() {
  // Mock implementation: Use the first agent as the current user.
  const user = agents[0];

  return (
    <MainLayout user={user}>
      <div className="flex-1 flex flex-col items-center justify-center bg-secondary/10 p-6">
        <div className="mx-auto max-w-4xl text-center">
            <BarChart2 className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
            <h1 className="text-3xl font-bold">Módulo de Analytics</h1>
            <p className="text-muted-foreground mb-8">Em breve: Dashboards e relatórios detalhados para uma visão completa do seu negócio.</p>
        </div>
      </div>
    </MainLayout>
  );
}
