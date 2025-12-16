'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { type Chat, type User, type Team, EvolutionInstance, CustomFieldDefinition } from '@/lib/types';
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
    MessageSquarePlus,
    BarChart3,
    Hash,
    ArrowRightLeft
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
import { getWorkspaceUsers, getCustomFieldDefinitions } from '@/actions/crm';
import { transferChatAction } from '@/actions/chats';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { startNewConversation } from '@/actions/messages';
import { toast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import { AddContactForm } from '../crm/add-contact-form';
import { ContactStatisticsDialog } from '../crm/contact-statistics-dialog';
import { buildChatProtocol, cn } from '@/lib/utils';
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
    const { onlineAgents: allOnlineAgents } = usePresence();
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
                <Button variant="outline" size="sm" className="bg-muted/50 border-input text-foreground hover:bg-muted/80">
                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                    Transferir
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-popover border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Transferir Atendimento</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Envie esta conversa para outra equipe ou agente.
                    </DialogDescription>
                </DialogHeader>
                {currentUser && chat.agent?.id !== currentUser.id && (
                    <div className="mb-2">
                        <Button
                            onClick={() => handleTransfer({ agentId: currentUser.id })}
                            disabled={isTransferring}
                            className="w-full bg-green-600 hover:bg-green-500 text-white"
                        >
                            {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                            Assumir Atendimento
                        </Button>
                        <div className="relative my-4">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-border" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-popover px-2 text-muted-foreground">Ou transferir para</span>
                            </div>
                        </div>
                    </div>
                )}
                <Tabs defaultValue="team" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-muted/50">
                        <TabsTrigger value="team" className="data-[state=active]:bg-background data-[state=active]:text-foreground">Para Equipe</TabsTrigger>
                        <TabsTrigger value="agent" className="data-[state=active]:bg-background data-[state=active]:text-foreground">Para Agente</TabsTrigger>
                    </TabsList>
                    <TabsContent value="team">
                        <ScrollArea className="h-64">
                            <div className="p-1 space-y-2">
                                {loading ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-primary" /> :
                                    teams.map(team => (
                                        <div key={team.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="h-3 w-3 rounded-full flex-shrink-0 ring-2 ring-border" style={{ backgroundColor: team.color }}></span>
                                                <div>
                                                    <p className="font-medium text-foreground">{team.name}</p>
                                                    <p className="text-xs text-muted-foreground">{team.onlineMembersCount} agente(s) online</p>
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
                                    <div key={agent.user.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8 border border-border">
                                                <AvatarImage src={agent.user.avatar} />
                                                <AvatarFallback className="bg-muted text-foreground">{agent.user.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <p className="font-medium text-foreground">{agent.user.name}</p>
                                        </div>
                                        <Button size="sm" onClick={() => handleTransfer({ agentId: agent.user.id })} disabled={isTransferring} className="bg-blue-600 hover:bg-blue-500 text-white">
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
        </Dialog >
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

    const [templates, setTemplates] = useState<any[]>([]);
    const [selectedTemplateName, setSelectedTemplateName] = useState('');
    const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    const isCloud = useMemo(() => instances.find(i => i.instance_name === selectedInstance)?.type === 'wa_cloud', [instances, selectedInstance]);
    const selectedTemplate = useMemo(() => templates.find(t => t.name === selectedTemplateName), [templates, selectedTemplateName]);

    const variableKeys = useMemo(() => {
        if (!selectedTemplate) return [];
        const bodyComponent = selectedTemplate.components.find((c: any) => c.type === 'BODY');
        if (!bodyComponent || !bodyComponent.text) return [];
        const matches = bodyComponent.text.match(/\{\{\d+\}\}/g);
        if (!matches) return [];
        const uniqueNumbers = Array.from(new Set(matches.map((m: string) => parseInt(m.replace(/\{|\}/g, ''), 10)))) as number[];
        return uniqueNumbers.sort((a, b) => a - b).map(n => n.toString());
    }, [selectedTemplate]);

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
            .then((res) => {
                if (res.error) {
                    toast({ title: 'Erro ao carregar instâncias', description: res.error, variant: 'destructive' });
                    setInstances([]);
                    setSelectedInstance('');
                    return;
                }
                const loaded = res.instances || [];
                setInstances(loaded);
                const fallbackInstance = chat.instance_name || loaded[0]?.instance_name || '';
                setSelectedInstance((prev) => prev || fallbackInstance);
            })
            .catch((error) => {
                console.error('[CONTACT_PANEL] Falha ao buscar instâncias', error);
                toast({ title: 'Erro ao carregar instâncias', description: 'Não foi possível buscar as instâncias de WhatsApp.', variant: 'destructive' });
                setInstances([]);
                setSelectedInstance('');
            })
            .finally(() => setIsLoadingInstances(false));
    }, [isOpen, currentUser?.activeWorkspaceId, chat.instance_name]);

    useEffect(() => {
        if (isCloud && selectedInstance) {
            setLoadingTemplates(true);
            import('@/actions/evolution-api').then(({ findWhatsappTemplates }) => {
                findWhatsappTemplates(selectedInstance)
                    .then(res => {
                        if (res.templates) {
                            setTemplates(res.templates.filter((t: any) => t.status === 'APPROVED'));
                        } else {
                            setTemplates([]);
                        }
                    })
                    .catch(err => {
                        console.error('Failed to fetch templates', err);
                        setTemplates([]);
                    })
                    .finally(() => setLoadingTemplates(false));
            });
        } else {
            setTemplates([]);
            setSelectedTemplateName('');
            setTemplateVariables({});
        }
    }, [isCloud, selectedInstance]);

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

        let templatePayload = undefined;
        if (isCloud && selectedTemplate) {
            const parameters = variableKeys.map(key => ({
                type: 'text',
                text: templateVariables[key] || ''
            }));
            templatePayload = {
                name: selectedTemplate.name,
                language: selectedTemplate.language,
                components: [
                    { type: 'body', parameters }
                ]
            };
        }

        setIsSubmitting(true);
        const result = await startNewConversation({
            workspaceId: currentUser.activeWorkspaceId,
            instanceName: selectedInstance,
            phoneNumber: phone,
            message: templatePayload ? `[Template: ${selectedTemplate.name}]` : message,
            tabId: null,
            template: templatePayload
        });

        if (result.success) {
            toast({ title: 'Nova conversa iniciada', description: 'A conversa reaberta aparecerá na sua lista.' });
            setIsOpen(false);
            onSuccess();
            setTemplateVariables({});
            setSelectedTemplateName('');
        } else {
            toast({ title: 'Falha ao iniciar', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="bg-muted/50 border-input text-foreground hover:bg-muted/80">
                    <MessageSquarePlus className="mr-2 h-4 w-4" />
                    Nova conversa
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg bg-popover border-border text-foreground max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Reabrir atendimento</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Inicie um novo tópico com este contato sem perder o histórico.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Instância</Label>
                        <Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={isLoadingInstances || instances.length === 0}>
                            <SelectTrigger className="bg-muted/50 border-input text-foreground">
                                <SelectValue placeholder={isLoadingInstances ? 'Carregando...' : 'Selecione a instância'} />
                            </SelectTrigger>
                            <SelectContent>
                                {isLoadingInstances && <div className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>}
                                {!isLoadingInstances && instances.map((instance) => (
                                    <SelectItem key={instance.id} value={instance.instance_name}>
                                        {instance.display_name} {instance.type === 'wa_cloud' && '(Cloud API)'}
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
                            className="bg-muted/50 border-input text-foreground"
                        />
                    </div>

                    {isCloud ? (
                        <div className="space-y-4 border-l-2 border-blue-500 pl-4 bg-muted/30 p-2 rounded-r-md">
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">Selecionar Template (Cloud API)</Label>
                                <Select value={selectedTemplateName} onValueChange={setSelectedTemplateName} required>
                                    <SelectTrigger className="bg-muted/50 border-input text-foreground">
                                        <SelectValue placeholder={loadingTemplates ? "Carregando templates..." : "Selecione um template..."} />
                                    </SelectTrigger>
                                    <SelectContent className="bg-popover border-border text-foreground max-h-[200px]">
                                        {loadingTemplates ? (
                                            <div className="p-2 text-center text-xs text-muted-foreground">Carregando...</div>
                                        ) : templates.length === 0 ? (
                                            <div className="p-2 text-center text-xs text-muted-foreground">Nenhum template aprovado encontrado.</div>
                                        ) : (
                                            templates.map((t: any) => (
                                                <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                                {selectedTemplate && (
                                    <p className="text-xs text-muted-foreground italic mt-1 bg-muted p-2 rounded">
                                        "{(selectedTemplate.components.find((c: any) => c.type === 'BODY')?.text || '')}"
                                    </p>
                                )}
                            </div>

                            {variableKeys.length > 0 && (
                                <div className="space-y-3">
                                    <Label className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Variáveis do Template</Label>
                                    {variableKeys.map((key) => (
                                        <div key={key} className="space-y-1">
                                            <Label htmlFor={`var-${key}`} className="text-xs text-white/70">Variável {`{{${key}}}`}</Label>
                                            <Input
                                                id={`var-${key}`}
                                                className="bg-muted/50 border-input h-8 text-sm"
                                                placeholder={`Valor para {{${key}}}`}
                                                value={templateVariables[key] || ''}
                                                onChange={(e) => setTemplateVariables(prev => ({ ...prev, [key]: e.target.value }))}
                                                required
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label>Mensagem inicial</Label>
                            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="bg-muted/50 border-input text-foreground" rows={3} />
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <DialogClose asChild>
                            <Button variant="ghost">Cancelar</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isSubmitting || !phone || (isCloud && !selectedTemplate)} className="bg-blue-600 hover:bg-blue-500 text-white">
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isCloud ? 'Enviar Template' : 'Enviar'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}


export default function ContactPanel({ chat, currentUser, onTransferSuccess, onContactUpdate }: ContactPanelProps) {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [agents, setAgents] = useState<User[]>([]);
    const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);

    useEffect(() => {
        if (currentUser?.activeWorkspaceId) {
            getWorkspaceUsers(currentUser.activeWorkspaceId).then(res => {
                if (!res.error) setAgents(res.users || []);
            });
            getCustomFieldDefinitions(currentUser.activeWorkspaceId).then(res => {
                if (!res.error) setCustomFields(res.fields || []);
            });
        }
    }, [currentUser?.activeWorkspaceId]);


    if (!chat) {
        return (
            <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 bg-background/30 backdrop-blur-xl border-l border-border/50 dark:bg-black dark:border-white/10">
                <div className="flex h-16 items-center border-b border-border px-4 xl:px-6">
                    <h3 className="font-semibold text-foreground">Informações do Contato</h3>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mb-4 ring-1 ring-border">
                        <UserIcon className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h4 className="font-medium text-foreground">Detalhes do Contato</h4>
                    <p className="text-sm text-muted-foreground mt-2 max-w-[200px]">
                        Selecione uma conversa para ver os detalhes.
                    </p>
                </div>
            </div>
        );
    }

    const { contact, agent } = chat;
    const isProtocolScoped = (chat as any).protocolScoped;

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
        <div className="hidden lg:flex lg:flex-col lg:w-[clamp(320px,25vw,420px)] lg:min-w-[320px] lg:flex-shrink-0 border-l border-border/50 bg-background/30 backdrop-blur-md h-full dark:bg-black dark:border-white/10">
            <div className="flex h-16 items-center justify-between border-b border-border dark:border-white/10 px-4 xl:px-6 flex-shrink-0">
                <h3 className="font-semibold text-base xl:text-lg text-foreground">Detalhes</h3>
                <div className="flex items-center gap-2">
                    {chat.status === 'encerrados' && (
                        <ResumeConversationDialog chat={chat} currentUser={currentUser} onSuccess={onContactUpdate} />
                    )}
                    <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                        <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-blue-500 hover:text-blue-400 hover:bg-blue-500/10">
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
                        <Avatar className="h-24 w-24 shrink-0 border-2 border-border ring-4 ring-muted shadow-xl">
                            <AvatarImage src={contact.avatar_url || undefined} alt={contact.name} data-ai-hint="person" />
                            <AvatarFallback className="text-3xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">{contact.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="mt-4 space-y-1">
                            <h2 className="font-bold text-lg xl:text-xl text-foreground">{contact.name}</h2>
                            {chat.tag && chat.color && (
                                <Badge style={{ backgroundColor: chat.color, color: chat.color.startsWith('#FEE') ? '#000' : '#fff' }} className="border-transparent shadow-sm">
                                    {chat.tag}
                                </Badge>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-border" />

                    <div className="space-y-4">
                        <h4 className="font-medium text-muted-foreground text-sm uppercase tracking-wider">Informações de Contato</h4>
                        <div className="space-y-3 text-sm">
                            {contact.email && (
                                <div className="flex items-center gap-3 text-foreground group">
                                    <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                        <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <span className="truncate text-foreground/80">{contact.email}</span>
                                </div>
                            )}
                            {contact.phone_number_jid && (
                                <div className="flex items-center gap-3 text-foreground/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                                        <Smartphone className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    </div>
                                    <span className="text-foreground/80">{contact.phone_number_jid}</span>
                                </div>
                            )}
                            {(chat.protocol || chat.id) && (
                                <div className="flex items-center gap-3 text-foreground/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
                                        <Hash className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                    <div className="flex flex-col leading-tight">
                                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Protocolo</span>
                                        <span className="font-mono text-sm text-foreground">{chat.protocol || buildChatProtocol(chat.id)}</span>
                                    </div>
                                </div>
                            )}
                            {chat.instance_name && (
                                <div className="flex items-center gap-3 text-foreground/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                        <Server className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <span className="text-foreground/80">{chat.instance_name} <span className="opacity-50 text-xs">({instanceTypeDisplay})</span></span>
                                </div>
                            )}
                            {externalId && (
                                <div className="flex items-center gap-3 text-foreground/80 group">
                                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
                                        <UserIcon className="h-4 w-4 text-blue-500" />
                                    </div>
                                    <span className="text-foreground/80">ID externo: {externalId}</span>
                                </div>
                            )}
                            {contact.address && (
                                <div className="flex items-center gap-3 text-foreground group">
                                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
                                        <MapPin className="h-4 w-4 text-red-500" />
                                    </div>
                                    <span>{contact.address}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-border" />

                    {customFields.length > 0 && (
                        <>
                            <div className="space-y-4">
                                <h4 className="font-medium text-muted-foreground text-sm uppercase tracking-wider">Informações Adicionais</h4>
                                <div className="space-y-3 text-sm">
                                    {customFields.map(field => {
                                        const value = contact.custom_fields?.[field.id];
                                        if (!value) return null;

                                        let displayValue = value;
                                        if (field.type === 'select') {
                                            const option = field.options?.find(opt => opt.value === value);
                                            displayValue = option ? option.label : value;
                                        }

                                        return (
                                            <div key={field.id} className="flex flex-col gap-1 text-foreground group">
                                                <span className="text-xs text-muted-foreground">{field.label}</span>
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
                                                        <Briefcase className="h-4 w-4 text-yellow-500" />
                                                    </div>
                                                    <span className="truncate">{displayValue}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {customFields.every(f => !contact.custom_fields?.[f.id]) && (
                                        <p className="text-muted-foreground italic text-xs">Nenhuma informação adicional preenchida.</p>
                                    )}
                                </div>
                            </div>
                            <Separator className="bg-border" />
                        </>
                    )}

                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h4 className="font-medium text-muted-foreground flex items-center gap-2 text-sm uppercase tracking-wider">
                                Atendente Responsável
                            </h4>
                        </div>

                        <div className="bg-muted/30 border border-border rounded-xl p-4">
                            {agent && agent.id !== 'unknown' ? (
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10 border border-border">
                                        <AvatarImage src={agent.avatar || undefined} alt={agent.name} />
                                        <AvatarFallback className="bg-muted text-foreground">{agent.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-foreground truncate">{agent.name}</p>
                                        {chat.assigned_at && <p className="text-xs text-muted-foreground">Desde {new Date(chat.assigned_at).toLocaleDateString()}</p>}
                                    </div>
                                    <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />
                                </div>
                            ) : (
                                <div className="flex flex-col items-center text-center py-2">
                                    <p className="text-muted-foreground text-sm mb-3">Nenhum atendente atribuído.</p>
                                    <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-border" />

                    <div className="space-y-4">
                        <h4 className="font-medium text-muted-foreground text-sm uppercase tracking-wider mb-2">CRM & Tarefas</h4>

                        <Card
                            className="bg-card border-border shadow-none hover:bg-muted/50 transition-colors cursor-pointer group"
                            onClick={() => setIsStatsOpen(true)}
                        >
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                                        <BarChart3 className="h-4 w-4" />
                                    </div>
                                    <span className="font-medium text-foreground">Estatísticas</span>
                                </div>
                                <Badge variant="secondary" className="bg-muted text-foreground group-hover:bg-muted/80">Ver</Badge>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border shadow-none hover:bg-muted/50 transition-colors cursor-pointer group">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400">
                                        <CheckSquare className="h-4 w-4" />
                                    </div>
                                    <span className="font-medium text-foreground">Tarefas</span>
                                </div>
                                <Badge variant="secondary" className="bg-muted text-foreground group-hover:bg-muted/80">0</Badge>
                            </CardContent>
                        </Card>
                    </div>

                    <Separator className="bg-border" />

                    <Link href="/crm" className="block">
                        <Button variant="outline" className="w-full bg-transparent border-input text-foreground hover:bg-muted hover:text-foreground">
                            Ver Perfil Completo no CRM
                        </Button>
                    </Link>
                </div>
            </ScrollArea>
            <ContactStatisticsDialog
                isOpen={isStatsOpen}
                setIsOpen={setIsStatsOpen}
                contactId={contact.id}
                contactName={contact.name}
            />
        </div>
    );
}
