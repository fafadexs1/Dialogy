'use client';

import React from 'react';
import { type User } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Mail, Phone, MapPin, User as UserIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface CustomerProfileProps {
  customer: User | null;
}

export default function CustomerProfile({ customer }: CustomerProfileProps) {
  if (!customer) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-gray-50">
        <div className="text-center">
          <UserIcon className="h-16 w-16 mx-auto text-muted-foreground" />
          <h2 className="mt-4 text-2xl font-semibold">Selecione um Cliente</h2>
          <p className="mt-1 text-muted-foreground">Escolha um cliente na lista à esquerda para ver seus detalhes.</p>
        </div>
      </div>
    );
  }
  
  const mainAddress = customer.customerInfo?.contracts[0]?.address || 'Endereço não informado';

  return (
    <main className="flex flex-1 flex-col bg-gray-50">
      <div className="p-6 border-b bg-white">
        <div className="flex items-center gap-4">
          <Avatar className="h-20 w-20 border-2">
            <AvatarImage src={customer.avatar} alt={customer.name} data-ai-hint="person" />
            <AvatarFallback className="text-2xl">{customer.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-3xl font-bold">{customer.name}</h1>
            <div className="flex items-center gap-4 mt-2 text-muted-foreground">
              <span className="flex items-center gap-1.5 text-sm"><Mail className="h-4 w-4" /> {customer.email}</span>
              <span className="flex items-center gap-1.5 text-sm"><Phone className="h-4 w-4" /> {customer.phone}</span>
              <span className="flex items-center gap-1.5 text-sm"><MapPin className="h-4 w-4" /> {mainAddress}</span>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="timeline" className="flex-1 flex flex-col">
        <div className="bg-white border-b px-6">
            <TabsList>
                <TabsTrigger value="timeline">Linha do Tempo</TabsTrigger>
                <TabsTrigger value="contracts">Contratos</TabsTrigger>
                <TabsTrigger value="tickets">Tickets</TabsTrigger>
                <TabsTrigger value="opportunities">Oportunidades</TabsTrigger>
            </TabsList>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
            <TabsContent value="timeline">
                <Card>
                    <CardHeader>
                        <CardTitle>Linha do Tempo Unificada</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: um feed cronológico de todas as interações do cliente, incluindo chats, tickets, e-mails e faturas.</p>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="contracts">
                 <Card>
                    <CardHeader>
                        <CardTitle>Histórico de Contratos</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: Registros de planos atuais e antigos, upgrades e downgrades.</p>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="tickets">
                 <Card>
                    <CardHeader>
                        <CardTitle>Sistema de Ticketing Integrado</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: Gestão de tickets de suporte, com prioridade e SLA.</p>
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="opportunities">
                 <Card>
                    <CardHeader>
                        <CardTitle>Gestão de Oportunidades</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: Funil de vendas para acompanhar oportunidades de upgrade e novas vendas.</p>
                    </CardContent>
                </Card>
            </TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
