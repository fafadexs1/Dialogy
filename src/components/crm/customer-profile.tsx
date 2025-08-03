'use client';

import React from 'react';
import { type User } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Mail, Phone, MapPin, User as UserIcon, Wifi, FileText, Receipt, Headset, Briefcase, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';

interface CustomerProfileProps {
  customer: User | null;
}

const getStatusBadgeVariant = (status: 'Paga' | 'Vencida' | 'Pendente') => {
    switch (status) {
      case 'Vencida': return 'destructive';
      case 'Pendente': return 'secondary'
      default: return 'default';
    }
};

const getTicketBadgeVariant = (status: 'Resolvido' | 'Aberto' | 'Em análise'): 'default' | 'secondary' | 'destructive' | 'outline' | null | undefined => {
    switch (status) {
        case 'Resolvido': return 'secondary';
        case 'Aberto': return 'default';
        case 'Em análise': return 'outline';
        default: return 'secondary';
    }
};

export default function CustomerProfile({ customer }: CustomerProfileProps) {
  if (!customer) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-gray-50 p-6">
        <div className="text-center">
          <UserIcon className="h-16 w-16 mx-auto text-muted-foreground/50" />
          <h2 className="mt-4 text-2xl font-semibold">Selecione um Cliente</h2>
          <p className="mt-1 text-muted-foreground">Escolha um cliente na lista à esquerda para ver seus detalhes.</p>
        </div>
      </main>
    );
  }
  
  const mainAddress = customer.customerInfo?.contracts[0]?.address || 'Endereço não informado';

  return (
    <main className="flex flex-1 flex-col bg-secondary/50">
      {/* Profile Header */}
      <div className="p-6 border-b bg-white">
        <div className="flex items-start gap-6">
          <Avatar className="h-20 w-20 border-2">
            <AvatarImage src={customer.avatar} alt={customer.name} data-ai-hint="person" />
            <AvatarFallback className="text-2xl">{customer.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{customer.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-muted-foreground">
              <span className="flex items-center gap-1.5 text-sm"><Mail className="h-4 w-4" /> {customer.email}</span>
              <span className="flex items-center gap-1.5 text-sm"><Phone className="h-4 w-4" /> {customer.phone}</span>
              <span className="flex items-center gap-1.5 text-sm"><MapPin className="h-4 w-4" /> {mainAddress}</span>
            </div>
             <div className="flex flex-wrap items-center gap-2 mt-3">
                <Badge variant="secondary">#ClienteAtivo</Badge>
                <Badge variant="outline">#Fibra</Badge>
                <Badge variant="outline">#SuporteTécnico</Badge>
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
                <TabsTrigger value="invoices">Faturas</TabsTrigger>
                <TabsTrigger value="opportunities">Oportunidades</TabsTrigger>
            </TabsList>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
            <TabsContent value="timeline" className="mt-0">
                <Card>
                    <CardHeader>
                        <CardTitle>Linha do Tempo Unificada</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: um feed cronológico de todas as interações do cliente, incluindo chats, tickets, e-mails e faturas.</p>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="contracts" className="mt-0 space-y-4">
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Histórico de Contratos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                       {customer.customerInfo?.contracts.map(contract => (
                         <div key={contract.contractId} className="p-4 border rounded-lg bg-background">
                            <div className="flex justify-between items-start">
                               <div>
                                    <p className="font-semibold">{contract.address}</p>
                                    <p className="text-sm text-muted-foreground">{contract.currentPlan}</p>
                               </div>
                               <Badge variant={contract.connectionStatus === 'Online' ? 'default' : contract.connectionStatus === 'Offline' ? 'destructive' : 'secondary'}>
                                    <Wifi className="h-3 w-3 mr-1.5"/>
                                    {contract.connectionStatus}
                                </Badge>
                            </div>
                            <div className="mt-3">
                                <div className="flex justify-between text-xs font-medium mb-1 text-muted-foreground">
                                    <span>Consumo de Dados</span>
                                    <span>{contract.dataUsage.used}{contract.dataUsage.unit} / {contract.dataUsage.total}{contract.dataUsage.unit}</span>
                                </div>
                                <Progress value={(contract.dataUsage.used / contract.dataUsage.total) * 100} className="h-2" />
                            </div>
                         </div>
                       ))}
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="tickets" className="mt-0">
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Headset className="h-5 w-5" /> Tickets de Suporte</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {customer.customerInfo?.technicalTickets.length > 0 ? customer.customerInfo.technicalTickets.map(ticket => (
                             <div key={ticket.id} className="flex items-center justify-between p-3 border rounded-lg bg-background">
                                <div>
                                    <p className="font-medium">{ticket.subject}</p>
                                    <p className="text-sm text-muted-foreground">{ticket.id} - {ticket.date}</p>
                                </div>
                                <Badge variant={getTicketBadgeVariant(ticket.status)}>{ticket.status}</Badge>
                             </div>
                        )) : (
                            <p className="text-muted-foreground text-center py-4">Nenhum chamado técnico encontrado.</p>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="invoices" className="mt-0">
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Faturas</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {customer.customerInfo?.openInvoices.length > 0 ? customer.customerInfo.openInvoices.map(invoice => (
                             <div key={invoice.id} className="flex items-center justify-between p-3 border rounded-lg bg-background">
                                <div>
                                    <p className="font-medium">{invoice.amount}</p>
                                    <p className="text-sm text-muted-foreground">Vencimento: {invoice.dueDate}</p>
                                </div>
                                <Badge variant={getStatusBadgeVariant(invoice.status)}>{invoice.status}</Badge>
                             </div>
                        )) : (
                            <p className="text-muted-foreground text-center py-4">Nenhuma fatura pendente.</p>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="opportunities" className="mt-0">
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5" /> Oportunidades de Venda</CardTitle>
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
