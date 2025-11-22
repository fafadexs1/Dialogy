
'use client';

import type { User } from '@/lib/types';
import CustomerList from '@/components/crm/customer-list';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

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
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
        </div>
    )
  }

  return (
    <div className="flex flex-1 w-full min-h-0 bg-muted/40">
      <CustomerList user={user} />
    </div>
  );
}
