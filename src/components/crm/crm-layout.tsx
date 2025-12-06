'use client';

import React from 'react';
import CustomerList from './customer-list';
import { useCurrentUser } from '@/hooks/use-online-status';

export default function CrmLayout() {
  const user = useCurrentUser();

  if (!user) return null;

  return (
    <div className="flex flex-1 w-full min-h-0 bg-muted/40">
      <CustomerList user={user} />
    </div>
  );
}
