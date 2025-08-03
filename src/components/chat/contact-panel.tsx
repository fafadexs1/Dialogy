'use client';

import React, { useState, useEffect } from 'react';
import { type User } from '@/lib/types';
import {
  Mail,
  Phone,
  Briefcase,
  CheckSquare,
  Building,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface ContactPanelProps {
  contact: User;
}

export default function ContactPanel({ contact }: ContactPanelProps) {

  if (!contact.businessProfile) {
    return (
      <div className="hidden w-full max-w-xs flex-col border-l bg-card lg:flex">
        <div className="flex h-16 items-center border-b px-4">
          <h3 className="font-semibold">Informações do Contato</h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <Building className="h-16 w-16 text-muted-foreground/50 mb-4" />
          <h4 className="font-medium">Detalhes do Contato</h4>
          <p className="text-sm text-muted-foreground">
            Selecione um cliente para ver os detalhes.
          </p>
        </div>
      </div>
    );
  }

  const { businessProfile } = contact;

  return (
    <div className="hidden w-full max-w-xs flex-col border-l bg-card lg:flex">
      <div className="flex h-16 items-center justify-between border-b px-4">
        <h3 className="font-semibold">Detalhes do Contato</h3>
        <Link href="/crm">
            <Button variant="outline" size="sm">Ver Perfil 360º</Button>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        
          {/* Customer Info */}
          <div className="flex items-center">
            <Avatar className="h-14 w-14 shrink-0 border">
              <AvatarImage src={contact.avatar} alt={contact.name} data-ai-hint="person" />
              <AvatarFallback>{contact.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="ml-4">
              <h2 className="font-bold text-lg">{contact.name}</h2>
              <p className="text-sm text-muted-foreground">{businessProfile.companyName}</p>
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
        
        <hr className="my-4" />

        {/* Deals */}
        <Card className="bg-transparent border-0 shadow-none">
            <CardHeader className="p-0 mb-2">
                <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Negócios</span>
                    <Badge variant="default" className="text-xs">{businessProfile.deals.length}</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0 space-y-2">
                {businessProfile.deals.length > 0 ? (
                    businessProfile.deals.map(deal => (
                        <div key={deal.id} className="p-2 border rounded-md bg-background">
                            <p className="font-semibold text-sm">{deal.name}</p>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-green-600 font-medium">{deal.value}</span>
                                <Badge variant="secondary" className="text-xs">{deal.stage}</Badge>
                            </div>
                        </div>
                    ))
                ) : (
                     <p className="text-sm text-muted-foreground p-2 text-center">Nenhum negócio ativo.</p>
                )}
            </CardContent>
        </Card>
        
        <hr className="my-4" />

        {/* Tasks */}
         <Card className="bg-transparent border-0 shadow-none">
            <CardHeader className="p-0 mb-2">
                <CardTitle className="flex items-center justify-between text-base">
                   <span className="flex items-center gap-2"><CheckSquare className="h-4 w-4" /> Tarefas</span>
                    <Badge variant="default" className="text-xs">{businessProfile.tasks.length}</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0 space-y-2">
                {businessProfile.tasks.length > 0 ? (
                    businessProfile.tasks.map(task => (
                        <div key={task.id} className="flex items-start gap-2 p-2 border rounded-md bg-background text-sm">
                           <CheckSquare className={`h-4 w-4 mt-0.5 shrink-0 ${task.completed ? 'text-primary' : 'text-muted-foreground'}`}/>
                           <p className={`font-medium ${task.completed ? 'line-through text-muted-foreground' : ''}`}>{task.description}</p>
                        </div>
                    ))
                ) : (
                     <p className="text-sm text-muted-foreground p-2 text-center">Nenhuma tarefa pendente.</p>
                )}
            </CardContent>
        </Card>

      </div>
    </div>
  );
}