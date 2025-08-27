
'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import CustomerList from '@/components/crm/customer-list';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { Loader2 } from 'lucide-react';

export default function CrmPage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
        const res = await fetch('/api/user');
        if (res.ok) {
            setUser(await res.json());
        }
    };
    fetchUser();
  }, []);
  
  if (!user) {
    return (
      <MainAppLayout user={null}>
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
        </div>
      </MainAppLayout>
    )
  }

  return (
    <MainAppLayout user={user}>
      <div className="flex flex-1 w-full min-h-0 bg-muted/40">
        <CustomerList />
      </div>
    </MainAppLayout>
  );
}
