'use client';

import React, { useState, useEffect } from 'react';
import { type User, type Contract } from '@/lib/types';
import {
  Mail,
  Phone,
  FileText,
  Wifi,
  ChartPie,
  Receipt,
  Headset,
  UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

interface ContactPanelProps {
  contact: User;
}

export default function ContactPanel({ contact }: ContactPanelProps) {
  const [selectedContract, setSelectedContract] = useState<Contract | undefined>(
    contact.customerInfo?.contracts?.[0]
  );

  useEffect(() => {
    setSelectedContract(contact.customerInfo?.contracts?.[0]);
  }, [contact]);

  if (!contact.customerInfo) {
    return (
      <div className="hidden w-full max-w-xs flex-col border-l bg-card lg:flex">
        <div className="flex h-16 items-center border-b px-4">
          <h3 className="font-semibold">Informações do Contato</h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <UserCog className="h-16 w-16 text-muted-foreground/50 mb-4" />
          <h4 className="font-medium">Detalhes do Contato</h4>
          <p className="text-sm text-muted-foreground">
            Selecione uma conversa com cliente para ver os detalhes.
          </p>
        </div>
      </div>
    );
  }

  const { customerInfo } = contact;
  const dataUsagePercentage = selectedContract
    ? (selectedContract.dataUsage.used / selectedContract.dataUsage.total) * 100
    : 0;

  const getStatusIcon = (status: Contract['connectionStatus']) => {
    switch (status) {
      case 'Online':
        return <Wifi className="h-4 w-4 text-green-500" />;
      case 'Offline':
        return <Wifi className="h-4 w-4 text-red-500" />;
      case 'Instável':
        return <Wifi className="h-4 w-4 text-yellow-500" />;
      default:
        return <Wifi className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (
    status: 'Paga' | 'Vencida' | 'Pendente'
  ) => {
    switch (status) {
      case 'Vencida':
        return 'destructive';
      default:
        return 'default';
    }
  };

  const getTicketBadgeVariant = (
    status: 'Resolvido' | 'Aberto' | 'Em análise'
  ): 'default' | 'secondary' | 'destructive' | 'outline' | null | undefined => {
    switch (status) {
      case 'Resolvido':
        return 'secondary';
      case 'Aberto':
        return 'default';
      case 'Em análise':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="hidden w-full max-w-xs flex-col border-l bg-white lg:flex">
      <div className="flex h-16 items-center border-b px-4">
        <h3 className="font-semibold">Detalhes do Cliente</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Customer Info */}
          <div className="flex items-center">
            <Avatar className="h-14 w-14 shrink-0 border">
              <AvatarImage src={contact.avatar} alt={contact.name} data-ai-hint="person" />
              <AvatarFallback>{contact.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="ml-4">
              <h2 className="font-bold text-lg">{contact.name}</h2>
              <p className="text-xs text-muted-foreground">ID: {contact.id}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate hover:underline cursor-pointer">
                  {contact.email}
                </span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{contact.phone}</span>
              </div>
            )}
          </div>
        </div>
        <hr className="shrink-0 bg-gray-200 h-[1px] w-full" />

        {/* Contract Info */}
        <div className="p-4">
          <label
            htmlFor="contract-selector"
            className="flex items-center text-sm font-semibold mb-2"
          >
            <FileText className="h-4 w-4 mr-2" /> Contrato/Serviço
          </label>
          <Select
            value={selectedContract?.contractId}
            onValueChange={(value) =>
              setSelectedContract(
                customerInfo.contracts.find((c) => c.contractId === value)
              )
            }
            disabled={customerInfo.contracts.length <= 1}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione um contrato" />
            </SelectTrigger>
            <SelectContent>
              {customerInfo.contracts.map((contract) => (
                <SelectItem key={contract.contractId} value={contract.contractId}>
                  {contract.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedContract && (
          <>
            <hr className="shrink-0 bg-gray-200 h-[1px] w-full" />
            <div className="p-4 space-y-4">
              {/* Connection Status */}
              <div>
                <h4 className="flex items-center text-sm font-semibold mb-2">
                  <Wifi className="h-4 w-4 mr-2" />
                  Status da Conexão
                </h4>
                <div className="flex items-center gap-2 rounded-md border p-2 bg-gray-100">
                  {getStatusIcon(selectedContract.connectionStatus)}
                  <span className="text-sm font-medium">
                    {selectedContract.connectionStatus}
                  </span>
                </div>
              </div>

              {/* Data Usage */}
              <div>
                <h4 className="flex items-center text-sm font-semibold mb-2">
                  <ChartPie className="h-4 w-4 mr-2" />
                  Consumo de Dados
                </h4>
                <div className="rounded-md border p-2 bg-gray-100">
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span>
                      {selectedContract.dataUsage.used}
                      {selectedContract.dataUsage.unit}
                    </span>
                    <span>
                      {selectedContract.dataUsage.total}
                      {selectedContract.dataUsage.unit}
                    </span>
                  </div>
                  <Progress value={dataUsagePercentage} className="h-2" />
                </div>
              </div>

              {/* Invoices */}
              <div>
                <h4 className="flex items-center text-sm font-semibold mb-2">
                  <Receipt className="h-4 w-4 mr-2" />
                  Faturas Pendentes
                  {customerInfo.openInvoices.length > 0 && (
                    <Badge variant="destructive" className="ml-auto">
                      {customerInfo.openInvoices.length}
                    </Badge>
                  )}
                </h4>
                <div className="space-y-2">
                  {customerInfo.openInvoices.length > 0 ? (
                    customerInfo.openInvoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="rounded-md border p-2 text-sm bg-gray-100"
                      >
                        <div className="flex justify-between items-center">
                          <p className="font-semibold">{invoice.id}</p>
                          <Badge variant={getStatusBadgeVariant(invoice.status)}>
                            {invoice.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Venc.: {invoice.dueDate} - {invoice.amount}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground p-2 text-center">
                      Nenhuma fatura pendente.
                    </p>
                  )}
                </div>
              </div>

              {/* Tickets */}
              <div>
                <h4 className="flex items-center text-sm font-semibold mb-2">
                  <Headset className="h-4 w-4 mr-2" />
                  Chamados Técnicos
                </h4>
                <div className="space-y-2">
                  {customerInfo.technicalTickets.length > 0 ? (
                    customerInfo.technicalTickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="rounded-md border p-2 text-sm bg-gray-100"
                      >
                        <div className="flex justify-between items-center">
                          <p className="font-semibold truncate pr-2">
                            {ticket.subject}
                          </p>
                          <Badge variant={getTicketBadgeVariant(ticket.status)}>
                            {ticket.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ticket.id} - {ticket.date}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground p-2 text-center">
                      Nenhum chamado recente.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="p-4 border-t mt-auto">
        <Button variant="outline" className="w-full">
          Ver Perfil Completo
        </Button>
      </div>
    </div>
  );
}