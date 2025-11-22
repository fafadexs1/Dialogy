
'use client';

import React from 'react';
import CustomerList from './customer-list';
import { type Contact } from '@/lib/types';
import { contacts } from '@/lib/mock-data';

export default function CrmLayout() {
  return (
    <div className="flex flex-1 w-full min-h-0 bg-muted/40">
      <CustomerList customers={contacts} />
    </div>
  );
}
