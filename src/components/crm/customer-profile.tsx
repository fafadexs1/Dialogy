'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Mail, Phone, Building, Briefcase, CheckSquare, Tag, Paperclip, Send, Calendar, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

interface CustomerProfileProps {
  customer: User | null;
}

export default function CustomerProfile({ customer }: CustomerProfileProps) {
  if (!customer) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-secondary/10 p-6">
        <div className="text-center">
          <Users className="h-16 w-16 mx-auto text-muted-foreground/50" />
          <h2 className="mt-4 text-2xl font-semibold">Selecione um Contato</h2>
          <p className="mt-1 text-muted-foreground">Escolha um contato na lista à esquerda para ver seus detalhes.</p>
        </div>
      </main>
    );
  }
  
  const { businessProfile } = customer;

  return (
    <main className="flex flex-1 flex-col bg-secondary/10">
      {/* Profile Header */}
      <div className="p-6 border-b bg-card">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20 border-2">
              <AvatarImage src={customer.avatar} alt={customer.name} data-ai-hint="person" />
              <AvatarFallback className="text-2xl">{customer.firstName.charAt(0)}{customer.lastName.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-3xl font-bold">{customer.name}</h1>
              <p className="text-lg text-muted-foreground">{businessProfile?.companyName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline"><Send className="mr-2 h-4 w-4"/> Enviar E-mail</Button>
            <Button><Briefcase className="mr-2 h-4 w-4"/> Criar Negócio</Button>
            <Button variant="secondary"><Calendar className="mr-2 h-4 w-4"/> Agendar Reunião</Button>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-y-auto">
        
        {/* Left Column */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Building className="h-5 w-5" /> Informações da Empresa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between">
                        <span className="font-medium text-muted-foreground">Website</span>
                        <a href="#" className="text-primary hover:underline">{businessProfile?.website}</a>
                    </div>
                    <div className="flex justify-between">
                        <span className="font-medium text-muted-foreground">Setor</span>
                        <span>{businessProfile?.industry}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="font-medium text-muted-foreground">Nº de Funcionários</span>
                        <span>{businessProfile?.employees}</span>
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Tag className="h-5 w-5" /> Etiquetas (Tags)</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                   {businessProfile?.tags.map(tag => (
                     <Badge key={tag} variant="secondary">{tag}</Badge>
                   ))}
                   <Input placeholder="+ Adicionar tag" className="h-8 mt-2" />
                </CardContent>
            </Card>
        </div>
        
        {/* Center Column */}
        <div className="col-span-12 lg:col-span-6">
            <Card className="h-full">
                <CardHeader>
                    <CardTitle>Linha do Tempo</CardTitle>
                </CardHeader>
                <CardContent>
                    <Textarea placeholder="Adicionar uma anotação, agendar uma tarefa, registrar uma ligação..." />
                    <p className="mt-4 text-muted-foreground text-center">Em breve: um feed cronológico de todas as interações do cliente, incluindo chats, tickets, e-mails e faturas.</p>
                </CardContent>
            </Card>
        </div>

        {/* Right Column */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
           <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between text-lg">
                        <span className="flex items-center gap-2"><Briefcase className="h-5 w-5" /> Negócios</span>
                        <Badge variant="default">{businessProfile?.deals.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {businessProfile?.deals.map(deal => (
                        <div key={deal.id} className="p-3 border rounded-lg bg-background">
                            <p className="font-semibold">{deal.name}</p>
                            <p className="text-sm text-green-600 font-medium">{deal.value}</p>
                            <Badge variant="outline" className="mt-1">{deal.stage}</Badge>
                        </div>
                    ))}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between text-lg">
                       <span className="flex items-center gap-2"><CheckSquare className="h-5 w-5" /> Tarefas</span>
                        <Badge variant="default">{businessProfile?.tasks.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {businessProfile?.tasks.map(task => (
                        <div key={task.id} className="flex items-start gap-3">
                           <CheckSquare className={`h-5 w-5 mt-0.5 ${task.completed ? 'text-primary' : 'text-muted-foreground'}`}/>
                           <div>
                             <p className={`font-medium ${task.completed ? 'line-through text-muted-foreground' : ''}`}>{task.description}</p>
                             <p className="text-xs text-muted-foreground">{task.dueDate}</p>
                           </div>
                        </div>
                    ))}
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Paperclip className="h-5 w-5" /> Anexos</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-center text-sm">Nenhum anexo.</p>
                    <Button variant="outline" className="w-full mt-2">Adicionar Anexo</Button>
                </CardContent>
            </Card>
        </div>
      </div>
    </main>
  );
}
