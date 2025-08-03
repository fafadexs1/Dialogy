'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type User } from '@/lib/types';

interface CustomerListProps {
  customers: User[];
  selectedCustomer: User | null;
  onSelectCustomer: (customer: User) => void;
}

export default function CustomerList({ customers = [], selectedCustomer, onSelectCustomer }: CustomerListProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex w-full max-w-sm flex-col border-r bg-card">
      <div className="p-4 border-b">
        <h2 className="text-2xl font-bold">Clientes</h2>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Pesquisar cliente..." 
            className="pl-9" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      <ScrollArea className="h-0 flex-1">
        <div className="p-2 space-y-1">
          {filteredCustomers.map((customer) => (
            <div
              key={customer.id}
              className={`flex cursor-pointer items-center gap-4 rounded-lg p-3 transition-colors ${
                selectedCustomer?.id === customer.id ? 'bg-primary/10' : 'hover:bg-accent'
              }`}
              onClick={() => onSelectCustomer(customer)}
            >
              <Avatar className="h-10 w-10 border">
                <AvatarImage src={customer.avatar} alt={customer.name} data-ai-hint="person" />
                <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="font-semibold truncate">{customer.name}</p>
                <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
