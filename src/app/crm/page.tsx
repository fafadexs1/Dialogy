

'use client';

import CrmLayout from '@/components/crm/crm-layout';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
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
    <MainLayout user={user}>
        <CrmLayout />
    </MainLayout>
  );
}
