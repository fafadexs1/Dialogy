'use client';

import React, { useState, useEffect } from 'react';
import { type Chat, type User, type Team, EvolutionInstance } from '@/lib/types';
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
    MapPin,
    Calendar,
    Globe,
    MessageSquarePlus
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
import { transferChatAction } from '@/actions/chats';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { startNewConversation } from '@/actions/messages';
import { toast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import { AddContactForm } from '../crm/add-contact-form';
import { cn } from '@/lib/utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface ContactPanelProps {
    chat: Chat | null;
    currentUser: User | null;
    onTransferSuccess: () => void;
    onContactUpdate: () => void;
}

function TransferChatDialog({ chat, currentUser, onTransferSuccess, disabled }: { chat: Chat, currentUser: User | null, onTransferSuccess: () => void, disabled?: boolean }) {
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
                if (data.teams) setTeams(data.teams);
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
                <Button variant="outline" size="sm" disabled={disabled} className="bg-white/5 border-white/10 hover:bg-white/10 text-white">
                    <Send className="mr-2 h-4 w-4" />
                    Transferir
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-black/90 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle>Transferir Atendimento</DialogTitle>
                    <DialogDescription className="text-white/50">
                        Envie esta conversa para outra equipe ou agente.
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="team" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-white/5">
                        <TabsTrigger value="team" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Para Equipe</TabsTrigger>
                        <TabsTrigger value="agent" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Para Agente</TabsTrigger>
                    </TabsList>
                    <TabsContent value="team">
                        <ScrollArea className="h-64">
                            <div className="p-1 space-y-2">
                                {loading ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-blue-400" /> :
                                    teams.map(team => (
                                        <div key={team.id} className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="h-3 w-3 rounded-full flex-shrink-0 ring-2 ring-white/10" style={{ backgroundColor: team.color }}></span>
                                                <div>
                                                    <p className="font-medium text-white">{team.name}</p>
                                                    <p className="text-xs text-white/50">{team.onlineMembersCount} agente(s) online</p>
                                                </div>
                                            </div>
                                            <Button size="sm" onClick={() => handleTransfer({ teamId: team.id })} disabled={isTransferring || team.onlineMembersCount === 0} className="bg-blue-600 hover:bg-blue-500 text-white">
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
                                    <div key={agent.user.id} className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8 border border-white/10">
                                                <AvatarImage src={agent.user.avatar} />
                                                <AvatarFallback className="bg-zinc-800 text-white">{agent.user.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <p className="font-medium text-white">{agent.user.name}</p>
                                        </div>
                                        <Button size="sm" onClick={() => handleTransfer({ agentId: agent.user.id })} disabled={isTransferring} className="bg-blue-600 hover:bg-blue-500 text-white">
                                            {isTransferring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Transferir
                                        </Button>
                                    </div>
                                )) : <p className="text-sm text-white/50 text-center pt-10">Nenhum outro agente online.</p>}
                            </div>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}

function ResumeConversationDialog({ chat, currentUser, onSuccess }: { chat: Chat, currentUser: User | null, onSuccess: () => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [selectedInstance, setSelectedInstance] = useState('');
    const [message, setMessage] = useState('Olá! Podemos retomar nossa conversa por aqui?');
    const [phone, setPhone] = useState('');
    const [isLoadingInstances, setIsLoadingInstances] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const derivePhone = () => {
        const candidate =
            chat.contact.phone_number_jid ||
            chat.contact.phone ||
            (chat as any)?.contact?.phone ||
            '';
        const lastMessage = (chat as any)?.messages?.[(chat as any).messages?.length - 1];
        const externalId = lastMessage?.externalSenderId || lastMessage?.external_sender_id || '';
        const raw = candidate || externalId;
        return raw.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    };

    useEffect(() => {
        if (!isOpen || !currentUser?.activeWorkspaceId) return;
        const initialPhone = derivePhone();
        if (initialPhone) setPhone(initialPhone);
        setIsLoadingInstances(true);
        getEvolutionApiInstances(currentUser.activeWorkspaceId)
            .then((data) => {
                setInstances(data);
                const fallbackInstance = chat.instance_name || data[0]?.instance_name || '';
                setSelectedInstance((prev) => prev || fallbackInstance);
            })
            .finally(() => setIsLoadingInstances(false));
    }, [isOpen, currentUser?.activeWorkspaceId, chat.instance_name]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser?.activeWorkspaceId) {
            toast({ title: 'Sem workspace ativo', description: 'Selecione um workspace para reenviar a conversa.', variant: 'destructive' });
            return;
        }
        if (!phone) {
            toast({ title: 'Contato sem número válido', description: 'Adicione um telefone ao contato antes de reiniciar a conversa.', variant: 'destructive' });
            return;
        }
        if (!selectedInstance) {
            toast({ title: 'Escolha uma instância', description: 'Selecione a instância de envio para continuar.', variant: 'destructive' });
            return;
        }

        setIsSubmitting(true);
        const result = await startNewConversation({
            workspaceId: currentUser.activeWorkspaceId,
            instanceName: selectedInstance,
            phoneNumber: phone,
            message,
            tabId: null
        });

        if (result.success) {
            toast({ title: 'Nova conversa iniciada', description: 'A conversa reaberta aparecerá na sua lista.' });
            setIsOpen(false);
            onSuccess();
        } else {
            toast({ title: 'Falha ao iniciar', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="bg-white/5 border-white/10 text-white hover:bg-white/10">
                    <MessageSquarePlus className="mr-2 h-4 w-4" />
                    Nova conversa
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg bg-black/90 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle>Reabrir atendimento</DialogTitle>
                    <DialogDescription className="text-white/60">
                        Inicie um novo tópico com este contato sem perder o histórico.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Instância</Label>
                        <Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={isLoadingInstances || instances.length === 0}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white">
                                <SelectValue placeholder={isLoadingInstances ? 'Carregando...' : 'Selecione a instância'} />
                            </SelectTrigger>
                            <SelectContent>
                                {isLoadingInstances && <div className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>}
                                {!isLoadingInstances && instances.map((instance) => (
                                    <SelectItem key={instance.id} value={instance.instance_name}>
                                        {instance.display_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Telefone</Label>
                        <Input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="5511999999999"
                            className="bg-white/5 border-white/10 text-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Mensagem inicial</Label>
                        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="bg-white/5 border-white/10 text-white" rows={3} />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <DialogClose asChild>
                            <Button variant="ghost">Cancelar</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isSubmitting || !phone} className="bg-blue-600 hover:bg-blue-500 text-white">
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Enviar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}


export default function ContactPanel({ chat, currentUser, onTransferSuccess, onContactUpdate }: ContactPanelProps) {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [agents, setAgents] = useState<User[]>([]);

    useEffect(() => {
        if (currentUser?.activeWorkspaceId) {
            getWorkspaceUsers(currentUser.activeWorkspaceId).then(res => {
                if (!res.error) setAgents(res.users || []);
            });
        }
    }, [currentUser?.activeWorkspaceId]);


    if (!chat) {
        return (
            <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l border-white/10 bg-black/20 backdrop-blur-xl">
                <div className="flex h-16 items-center border-b border-white/10 px-4 xl:px-6">
                    <h3 className="font-semibold text-white">Informações do Contato</h3>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="h-20 w-20 bg-white/5 rounded-full flex items-center justify-center mb-4 ring-1 ring-white/10">
                        <UserIcon className="h-10 w-10 text-white/30" />
                    </div>
                    <h4 className="font-medium text-white">Detalhes do Contato</h4>
                    <p className="text-sm text-white/50 mt-2 max-w-[200px]">
                        Selecione uma conversa para ver os detalhes.
                    </p>
                </div>
            </div>
        );
    }

    const { contact, agent } = chat;

    const lastMessage = (chat as any)?.messages?.[(chat as any)?.messages?.length - 1];
    const platform = (
        lastMessage?.platform ||
        lastMessage?.source_from_api ||
        chat.source ||
        chat.instance_type ||
        ''
    ).toString().toLowerCase();
    const instanceTypeDisplay =
        platform === 'instagram'
            ? 'Instagram'
            : platform === 'messenger'
                ? 'Messenger'
                : (chat.instance_type === 'wa_cloud' || platform === 'wa_cloud')
                    ? 'Cloud API'
                    : 'Baileys';
    const externalId = lastMessage?.externalSenderId
        || lastMessage?.external_sender_id
        || null;

    return (
        <div className="hidden lg:flex lg:flex-col lg:w-[clamp(320px,25vw,420px)] lg:min-w-[320px] lg:flex-shrink-0 border-l border-white/10 bg-black/20 backdrop-blur-xl h-full">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-4 xl:px-6 flex-shrink-0">
                <h3 className="font-semibold text-base xl:text-lg text-white">Detalhes</h3>
                <div className="flex items-center gap-2">
                    {chat.status === 'encerrados' && (
                        <ResumeConversationDialog chat={chat} currentUser={currentUser} onSuccess={onContactUpdate} />
                    )}
                    <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                        <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10">
                                <Edit className="mr-2 h-4 w-4" />
                                Editar
                            </Button>
                        </DialogTrigger>
                        <AddContactForm
                            isOpen={isEditModalOpen}
                            setIsOpen={setIsEditModalOpen}
                            contact={contact}
                            onSave={onContactUpdate}
                            workspaceId={chat.workspace_id}
                            agents={agents}
                            user={currentUser}
                        />
                    </Dialog>
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 xl:p-6 space-y-6">
                    <div className="flex flex-col items-center text-center">
                        <Avatar className="h-24 w-24 shrink-0 border-2 border-white/10 ring-4 ring-white/5 shadow-xl">
                            <AvatarImage src={contact.avatar_url} alt={contact.name} data-ai-hint="person" />
                            <AvatarFallback className="text-3xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">{contact.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="mt-4 space-y-1">
                            <h2 className="font-bold text-lg xl:text-xl text-white">{contact.name}</h2>
                            {chat.tag && chat.color && (
                                <Badge style={{ backgroundColor: chat.color, color: chat.color.startsWith('#FEE') ? '#000' : '#fff' }} className="border-transparent shadow-sm">
                                    {chat.tag}
                                </Badge>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-white/10" />

                    <div className="space-y-4">
                        <h4 className="font-medium text-white/70 text-sm uppercase tracking-wider">Informações de Contato</h4>
                        <div className="space-y-3 text-sm">
                            {contact.email && (
                                <div className="flex items-center gap-3 text-white/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                                        <Mail className="h-4 w-4 text-blue-400" />
                                    </div>
                                    <span className="truncate">{contact.email}</span>
                                </div>
                            )}
                            {contact.phone_number_jid && (
                                <div className="flex items-center gap-3 text-white/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                                        <Smartphone className="h-4 w-4 text-green-400" />
                                    </div>
                                    <span>{contact.phone_number_jid}</span>
                                </div>
                            )}
                            {chat.instance_name && (
                                <div className="flex items-center gap-3 text-white/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                                        <Server className="h-4 w-4 text-purple-400" />
                                    </div>
                                    <span>{chat.instance_name} <span className="text-white/40 text-xs">({instanceTypeDisplay})</span></span>
                                </div>
                            )}
                            {externalId && (
                                <div className="flex items-center gap-3 text-white/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                                        <UserIcon className="h-4 w-4 text-blue-400" />
                                    </div>
                                    <span>ID externo: {externalId}</span>
                                </div>
                            )}
                            {contact.address && (
                                <div className="flex items-center gap-3 text-white/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                                        <MapPin className="h-4 w-4 text-red-400" />
                                    </div>
                                    <span>{contact.address}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-white/10" />

                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h4 className="font-medium text-white/70 flex items-center gap-2 text-sm uppercase tracking-wider">
                                Atendente Responsável
                            </h4>
                        </div>

                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            {agent && agent.id !== 'unknown' ? (
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10 border border-white/10">
                                        <AvatarImage src={agent.avatar} alt={agent.name} />
                                        <AvatarFallback className="bg-zinc-800 text-white">{agent.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-white truncate">{agent.name}</p>
                                        {chat.assigned_at && <p className="text-xs text-white/50">Desde {new Date(chat.assigned_at).toLocaleDateString()}</p>}
                                    </div>
                                    <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />
                                </div>
                            ) : (
                                <div className="flex flex-col items-center text-center py-2">
                                    <p className="text-white/50 text-sm mb-3">Nenhum atendente atribuído.</p>
                                    <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-white/10" />

                    <div className="space-y-4">
                        <h4 className="font-medium text-white/70 text-sm uppercase tracking-wider mb-2">CRM & Tarefas</h4>

                        <Card className="bg-white/5 border-white/10 shadow-none hover:bg-white/10 transition-colors cursor-pointer group">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                                        <Briefcase className="h-4 w-4" />
                                    </div>
                                    <span className="font-medium text-white">Negócios</span>
                                </div>
                                <Badge variant="secondary" className="bg-white/10 text-white group-hover:bg-white/20">0</Badge>
                            </CardContent>
                        </Card>

                        <Card className="bg-white/5 border-white/10 shadow-none hover:bg-white/10 transition-colors cursor-pointer group">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400">
                                        <CheckSquare className="h-4 w-4" />
                                    </div>
                                    <span className="font-medium text-white">Tarefas</span>
                                </div>
                                <Badge variant="secondary" className="bg-white/10 text-white group-hover:bg-white/20">0</Badge>
                            </CardContent>
                        </Card>
                    </div>

                    <Separator className="bg-white/10" />

                    <Link href="/crm" className="block">
                        <Button variant="outline" className="w-full bg-transparent border-white/10 text-white hover:bg-white/5 hover:text-white">
                            Ver Perfil Completo no CRM
                        </Button>
                    </Link>
                </div>
            </ScrollArea>
        </div>
    );
}
