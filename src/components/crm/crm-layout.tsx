
'use client';

import React, { useState, useEffect } from 'react';
import CustomerList from './customer-list';
import CustomerProfile from './customer-profile';
import { type User } from '@/lib/types';
import { contacts } from '@/lib/mock-data';

export default function CrmLayout() {
  const [selectedCustomer, setSelectedCustomer] = useState<User | null>(null);

  useEffect(() => {
    if (contacts && contacts.length > 0) {
      setSelectedCustomer(contacts[0]);
    }
  }, []);

  return (
    <div className="flex flex-1 w-full min-h-0 bg-muted/40">
      <CustomerList
        customers={contacts}
        selectedCustomer={selectedCustomer}
        onSelectCustomer={setSelectedCustomer}
      />
      <CustomerProfile customer={selectedCustomer} />
    </div>
  );
}
