'use client';

import React from 'react';
import CustomerList from './customer-list';
import { type User } from '@/lib/types';
import { contacts } from '@/lib/mock-data';

export default function CrmLayout() {
  // A lógica para o painel de detalhes foi removida.
  // O layout agora renderiza apenas a lista de clientes.
  return (
    <div className="flex flex-1 w-full min-h-0 bg-muted/40">
      <CustomerList customers={contacts} />
    </div>
  );
}
