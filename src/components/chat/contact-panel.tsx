

'use client';

import React, { useState, useEffect } from 'react';
import { type Chat, type User, type Team, Contact as ContactType } from '@/lib/types';
import {
  Mail,
  Phone,
  Briefcase,
  CheckSquare,
  Building,
  User as UserIcon,
  UserCheck,
  Smartphone,
  Server,
  Send,
  Loader2,
  Users,
  Edit,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { usePresence } from '@/hooks/use-online-status';
import { getTeamsWithOnlineMembers } from '@/actions/teams';
import { getWorkspaceUsers } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { transferChatAction } from '@/actions/chats';
import { toast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import { AddContactForm } from '../crm/add-contact-form';

interface ContactPanelProps {
  chat: Chat | null;
  onTransferSuccess: () => void;
  onContactUpdate: () => void;
}

function TransferChatDialog({ chat, onTransferSuccess }: { chat: Chat, onTransferSuccess: () => void }) {
    const currentUser = useAuth();
    const allOnlineAgents = usePresence();
    const [teams, setTeams] = useState<Awaited<ReturnType<typeof getTeamsWithOnlineMembers>>['teams']>([]);
    const [loading, setLoading] = useState(true);
    const [isTransferring, setIsTransferring] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    useEffect(() => {
        if (!isDialogOpen || !currentUser?.activeWorkspaceId) return;
        
        setLoading(true);
        getTeamsWithOnlineMembers(currentUser.activeWorkspaceId)
            .then(data => {
                if(data.teams) setTeams(data.teams);
            })
            .finally(() => setLoading(false));

    }, [isDialogOpen, currentUser?.activeWorkspaceId]);

    const handleTransfer = async (target: { teamId?: string; agentId?: string }) => {
        setIsTransferring(true);
        const result = await transferChatAction({
            chatId: chat.id,
            ...target
        });

        if (result.error) {
            toast({ title: "Erro ao transferir", description: result.error, variant: 'destructive' });
        } else {
            toast({ title: "Atendimento transferido!" });
            onTransferSuccess();
            setIsDialogOpen(false);
        }
        setIsTransferring(false);
    }
    
    const availableAgents = allOnlineAgents.filter(agent => agent.user.id !== currentUser?.id);

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Send className="mr-2 h-4 w-4" />
                    Transferir
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Transferir Atendimento</DialogTitle>
                    <DialogDescription>
                        Envie esta conversa para outra equipe ou agente.
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="team" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="team">Para Equipe</TabsTrigger>
                        <TabsTrigger value="agent">Para Agente</TabsTrigger>
                    </TabsList>
                    <TabsContent value="team">
                       <ScrollArea className="h-64">
                            <div className="p-1 space-y-2">
                                {loading ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" /> :
                                teams.map(team => (
                                    <div key={team.id} className="flex items-center justify-between p-2 rounded-md border">
                                        <div className="flex items-center gap-3">
                                            <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }}></span>
                                            <div>
                                                <p className="font-medium">{team.name}</p>
                                                <p className="text-xs text-muted-foreground">{team.onlineMembersCount} agente(s) online</p>
                                            </div>
                                        </div>
                                        <Button size="sm" onClick={() => handleTransfer({ teamId: team.id })} disabled={isTransferring || team.onlineMembersCount === 0}>
                                            {isTransferring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Transferir
                                        </Button>
                                    </div>
                                ))}
                            </div>
                       </ScrollArea>
                    </TabsContent>
                    <TabsContent value="agent">
                         <ScrollArea className="h-64">
                             <div className="p-1 space-y-2">
                                {availableAgents.length > 0 ? availableAgents.map(agent => (
                                    <div key={agent.user.id} className="flex items-center justify-between p-2 rounded-md border">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                <AvatarImage src={agent.user.avatar} />
                                                <AvatarFallback>{agent.user.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <p className="font-medium">{agent.user.name}</p>
                                        </div>
                                        <Button size="sm" onClick={() => handleTransfer({ agentId: agent.user.id })} disabled={isTransferring}>
                                            {isTransferring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Transferir
                                        </Button>
                                    </div>
                                )) : <p className="text-sm text-muted-foreground text-center pt-10">Nenhum outro agente online.</p>}
                            </div>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}


export default function ContactPanel({ chat, onTransferSuccess, onContactUpdate }: ContactPanelProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [agents, setAgents] = useState<User[]>([]);
  const user = useAuth();
  
  useEffect(() => {
    if(user?.activeWorkspaceId) {
        getWorkspaceUsers(user.activeWorkspaceId).then(res => {
            if(!res.error) setAgents(res.users || []);
        });
    }
  }, [user?.activeWorkspaceId]);


  if (!chat) {
    return (
      <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l bg-card">
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

  const { contact, agent } = chat;

  return (
    <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l bg-card">
      <div className="flex h-16 items-center justify-between border-b px-6 flex-shrink-0">
        <h3 className="font-semibold text-lg">Detalhes do Contato</h3>
         <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Edit className="mr-2 h-4 w-4"/>
                    Editar Contato
                </Button>
            </DialogTrigger>
            <AddContactForm
                isOpen={isEditModalOpen}
                setIsOpen={setIsEditModalOpen}
                contact={contact}
                onSave={onContactUpdate}
                workspaceId={chat.workspace_id}
                agents={agents}
            />
         </Dialog>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        
          <div className="flex flex-col items-center text-center">
            <Avatar className="h-20 w-20 shrink-0 border">
              <AvatarImage src={contact.avatar} alt={contact.name} data-ai-hint="person" />
              <AvatarFallback className="text-2xl">{contact.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <h2 className="font-bold text-xl mt-4">{contact.name}</h2>
          </div>
          
          <Separator className="my-6"/>

          <div className="space-y-4 text-sm">
             <h4 className="font-medium text-muted-foreground mb-2">Informações</h4>
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{contact.email}</span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{contact.phone}</span>
              </div>
            )}
            {chat.instance_name && (
              <div className="flex items-center gap-3">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span>Instância: {chat.instance_name}</span>
              </div>
            )}
             {contact.address && (
              <div className="flex items-center gap-3">
                <Building className="h-4 w-4 text-muted-foreground" />
                <span>{contact.address}</span>
              </div>
            )}
          </div>

          <Separator className="my-6"/>
        
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium text-muted-foreground flex items-center gap-2 text-sm">
                  <UserCheck className="h-4 w-4" />
                  Atendente Responsável
              </h4>
               <TransferChatDialog chat={chat} onTransferSuccess={onTransferSuccess} />
            </div>

            {agent && agent.id !== 'unknown' ? (
                <div className="flex items-center gap-3 p-3 rounded-md bg-secondary/50">
                  <Avatar className="h-9 w-9">
                      <AvatarImage src={agent.avatar} alt={agent.name} />
                      <AvatarFallback>{agent.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                      <p className="font-medium">{agent.name}</p>
                      {chat.assigned_at && <p className="text-xs text-muted-foreground">Atribuído em {new Date(chat.assigned_at).toLocaleDateString()}</p>}
                  </div>
                </div>
            ) : (
                <p className="text-muted-foreground italic text-sm px-2">Nenhum atendente atribuído.</p>
            )}
         </div>

        <Separator className="my-6"/>

        <div className="space-y-6">
            <Card className="bg-transparent border-0 shadow-none">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2 font-semibold"><Briefcase className="h-4 w-4" /> Negócios</span>
                        <Badge variant="secondary" className="text-xs">0</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0 space-y-3">
                    <p className="text-sm text-muted-foreground p-2 text-center">Nenhum negócio ativo.</p>
                </CardContent>
            </Card>
            
            <Card className="bg-transparent border-0 shadow-none">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2 font-semibold"><CheckSquare className="h-4 w-4" /> Tarefas</span>
                        <Badge variant="secondary" className="text-xs">0</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0 space-y-3">
                    <p className="text-sm text-muted-foreground p-2 text-center">Nenhuma tarefa pendente.</p>
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
