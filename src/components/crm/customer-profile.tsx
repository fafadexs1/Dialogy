
'use client';

import React from 'react';
import type { User, Tag } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Mail, Phone, Building, Briefcase, CheckSquare, Paperclip, Send, Calendar, Users, TrendingUp, AlertTriangle, Palette, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { mockTags } from '@/lib/mock-data';

interface CustomerProfileProps {
  customer: User | null;
}

export default function CustomerProfile({ customer }: CustomerProfileProps) {
  if (!customer) {
    return (
      <main className="hidden lg:flex flex-1 flex-col items-center justify-center bg-background p-6 w-full lg:w-2/5 border-l">
        <div className="text-center">
          <Users className="h-16 w-16 mx-auto text-muted-foreground/50" />
          <h2 className="mt-4 text-2xl font-semibold">Selecione um Contato</h2>
          <p className="mt-1 text-muted-foreground">Escolha um diálogo na lista para ver os detalhes e o histórico.</p>
        </div>
      </main>
    );
  }
  
  const { businessProfile } = customer;

  const getPriorityColor = (score: number) => {
    if (score > 70) return "text-red-500";
    if (score > 40) return "text-amber-500";
    return "text-green-500";
  }

  const getRiskColor = (score: number) => {
    if (score > 75) return "text-red-500";
    if (score > 50) return "text-amber-500";
    return "text-green-500";
  }
  
  const getTagStyle = (tagValue: string) => {
      const tag = mockTags.find(t => t.value === tagValue);
      return tag ? { backgroundColor: tag.color, color: '#fff', borderColor: 'transparent' } : {};
  };

  return (
    <div className="hidden lg:flex flex-1 flex-col bg-card h-full w-full lg:w-2/5 border-l">
      <header className="p-6 border-b bg-card flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20 border-2">
              <AvatarImage src={customer.avatar} alt={customer.name} data-ai-hint="person" />
              <AvatarFallback className="text-2xl">{customer.firstName?.charAt(0)}{customer.lastName?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-3xl font-bold">{customer.name}</h1>
              <p className="text-lg text-muted-foreground">{businessProfile?.companyName}</p>
              <div className="flex items-center gap-6 mt-2">
                  <div className='flex items-center gap-2'>
                    <TrendingUp className={`h-5 w-5 ${getPriorityColor(businessProfile?.dialogPriorityScore ?? 0)}`} />
                    <div className='text-sm'>
                        <span className='font-semibold'>SPD</span>
                        <p className={`${getPriorityColor(businessProfile?.dialogPriorityScore ?? 0)}`}>{businessProfile?.dialogPriorityScore ?? 'N/A'}</p>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <AlertTriangle className={`h-5 w-5 ${getRiskColor(businessProfile?.financialRiskScore ?? 0)}`} />
                    <div className='text-sm'>
                        <span className='font-semibold'>SRI</span>
                        <p className={`${getRiskColor(businessProfile?.financialRiskScore ?? 0)}`}>{businessProfile?.financialRiskScore ?? 'N/A'}</p>
                    </div>
                  </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline"><Send className="mr-2 h-4 w-4"/> Enviar E-mail</Button>
            <Button><Briefcase className="mr-2 h-4 w-4"/> Criar Negócio</Button>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-12 gap-6 p-6">
          
          <div className="col-span-12 xl:col-span-4 space-y-6">
              <Card>
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">Informações do Contato</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                       <div className="flex justify-between items-center">
                          <span className="font-medium text-muted-foreground">Email</span>
                          <a href={`mailto:${customer.email}`} className="text-primary hover:underline truncate">{customer.email}</a>
                      </div>
                       <div className="flex justify-between items-center">
                          <span className="font-medium text-muted-foreground">Telefone</span>
                          <span>{customer.phone}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="font-medium text-muted-foreground">Website</span>
                          <a href="#" className="text-primary hover:underline">{businessProfile?.website}</a>
                      </div>
                       <div className="flex justify-between items-center">
                          <span className="font-medium text-muted-foreground">Setor</span>
                          <span>{businessProfile?.industry}</span>
                      </div>
                  </CardContent>
              </Card>
               <Card>
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">Etiquetas (Tags)</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                     {businessProfile?.tags.map((tag: Tag) => (
                       <Badge key={tag.id} style={getTagStyle(tag.value)}>
                          {tag.label}
                      </Badge>
                     ))}
                     <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-primary">
                          <Plus className="mr-1 h-3 w-3" /> Adicionar tag
                     </Button>
                  </CardContent>
              </Card>
               <Card>
                  <CardHeader>
                      <CardTitle className="flex items-center justify-between text-base">
                         <span className="flex items-center gap-2"> Anexos</span>
                          <Badge variant="secondary">{businessProfile?.attachments?.length || 0}</Badge>
                      </CardTitle>
                  </CardHeader>
                  <CardContent>
                      <p className="text-muted-foreground text-center text-xs p-4">Nenhum anexo.</p>
                      <Button variant="outline" className="w-full mt-2 h-9">Adicionar Anexo</Button>
                  </CardContent>
              </Card>
          </div>
          
          <div className="col-span-12 xl:col-span-8">
              <Card className="h-full">
                  <CardHeader>
                      <CardTitle>Linha do Tempo</CardTitle>
                  </CardHeader>
                  <CardContent>
                      <Textarea placeholder="Adicionar uma anotação, agendar uma tarefa, registrar uma ligação..." />
                      <p className="mt-4 text-muted-foreground text-center text-sm p-8 bg-muted rounded-lg">Em breve: um feed cronológico de todas as interações do cliente, incluindo chats, tickets, e-mails e faturas.</p>
                  </CardContent>
              </Card>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}
