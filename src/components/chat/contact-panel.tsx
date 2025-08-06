'use client';

import React from 'react';
import { type User } from '@/lib/types';
import {
  Mail,
  Phone,
  Briefcase,
  CheckSquare,
  Building,
  User as UserIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';

interface ContactPanelProps {
  contact: User;
}

export default function ContactPanel({ contact }: ContactPanelProps) {

  if (!contact.businessProfile) {
    return (
      <div className="hidden w-full max-w-sm flex-col border-l bg-card lg:flex">
        <div className="flex h-16 items-center border-b px-4">
          <h3 className="font-semibold">Informações do Contato</h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <UserIcon className="h-16 w-16 text-muted-foreground/50 mb-4" />
          <h4 className="font-medium">Detalhes do Contato</h4>
          <p className="text-sm text-muted-foreground">
            Selecione uma conversa para ver os detalhes.
          </p>
        </div>
      </div>
    );
  }

  const { businessProfile } = contact;

  return (
    <div className="hidden w-full lg:w-1/4 flex-shrink-0 flex-col border-l bg-card lg:flex">
      <div className="flex h-16 items-center justify-between border-b px-6">
        <h3 className="font-semibold text-lg">Detalhes do Contato</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        
          <div className="flex flex-col items-center text-center">
            <Avatar className="h-20 w-20 shrink-0 border">
              <AvatarImage src={contact.avatar} alt={contact.name} data-ai-hint="person" />
              <AvatarFallback className="text-2xl">{contact.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <h2 className="font-bold text-xl mt-4">{contact.name}</h2>
            <p className="text-sm text-muted-foreground">{businessProfile.companyName}</p>
            <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" size="sm">
                    <Mail className="mr-2 h-4 w-4"/>
                    E-mail
                </Button>
                 <Button variant="outline" size="sm">
                    <Phone className="mr-2 h-4 w-4"/>
                    Ligar
                </Button>
            </div>
          </div>
          
          <Separator className="my-6"/>

          <div className="space-y-4 text-sm">
             <h4 className="font-medium text-muted-foreground mb-2">Informações</h4>
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${contact.email}`} className="truncate hover:underline cursor-pointer">
                  {contact.email}
                </a>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{contact.phone}</span>
              </div>
            )}
             {businessProfile.companyName && (
              <div className="flex items-center gap-3">
                <Building className="h-4 w-4 text-muted-foreground" />
                <span>{businessProfile.companyName}</span>
              </div>
            )}
          </div>
        
        <Separator className="my-6"/>

        <div className="space-y-6">
            <Card className="bg-transparent border-0 shadow-none">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2 font-semibold"><Briefcase className="h-4 w-4" /> Negócios</span>
                        <Badge variant="secondary" className="text-xs">{businessProfile.deals.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0 space-y-3">
                    {businessProfile.deals.length > 0 ? (
                        businessProfile.deals.map(deal => (
                            <div key={deal.id} className="p-3 border rounded-lg bg-background">
                                <p className="font-semibold text-sm">{deal.name}</p>
                                <div className="flex justify-between items-center text-xs mt-1">
                                    <span className="text-green-600 font-medium">{deal.value}</span>
                                    <Badge variant="outline" className="text-xs font-normal">{deal.stage}</Badge>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-muted-foreground p-2 text-center">Nenhum negócio ativo.</p>
                    )}
                </CardContent>
            </Card>
            
            <Card className="bg-transparent border-0 shadow-none">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2 font-semibold"><CheckSquare className="h-4 w-4" /> Tarefas</span>
                        <Badge variant="secondary" className="text-xs">{businessProfile.tasks.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0 space-y-3">
                    {businessProfile.tasks.length > 0 ? (
                        businessProfile.tasks.map(task => (
                            <div key={task.id} className="flex items-start gap-2 p-3 border rounded-lg bg-background text-sm">
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
         <Separator className="my-6"/>
         <Link href="/crm">
            <Button variant="outline" className="w-full">Ver Perfil Completo no CRM</Button>
        </Link>
      </div>
    </div>
  );
}
