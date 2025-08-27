

'use client';

import CustomerList from '@/components/crm/customer-list';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth.tsx';
import { Loader2 } from 'lucide-react';

export default function CrmPage() {
  const user = useAuth();
  
  if (!user) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="flex flex-1 w-full min-h-0 bg-muted/40">
        <CustomerList />
      </div>
    </MainLayout>
  );
}
