'use client';

import React from 'react';
import CustomerList from './customer-list';
import CustomerProfile from './customer-profile';
import { type User } from '@/lib/types';
import { contacts } from '@/lib/mock-data';

export default function CrmLayout() {
  const [selectedCustomer, setSelectedCustomer] = React.useState<User | null>(contacts[0]);

  return (
    <>
      <CustomerList
        customers={contacts}
        selectedCustomer={selectedCustomer}
        onSelectCustomer={setSelectedCustomer}
      />
      <CustomerProfile customer={selectedCustomer} />
    </>
  );
}
