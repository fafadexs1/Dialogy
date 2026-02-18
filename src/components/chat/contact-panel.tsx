'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { type Chat, type User, type Team, type Contact, type Deal, EvolutionInstance, CustomFieldDefinition } from '@/lib/types';
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
    ArrowRightLeft,
    Copy,
    ExternalLink,
    Zap,
    LayoutGrid,
    Cpu,
    Target,
    Check,
    DollarSign
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
import { getDealsByContact } from '@/actions/deals';
import { transferChatAction } from '@/actions/chats';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { startNewConversation } from '@/actions/messages';
import { toast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import { AddContactForm } from '../crm/add-contact-form';
import { ContactStatisticsDialog } from '../crm/contact-statistics-dialog';
import { buildChatProtocol, cn } from '@/lib/utils';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ContactTimeline from '../crm/contact-timeline';
import DealForm from '../crm/deal-form';
import LeadScoreBadge from '../crm/lead-score-badge';
import { CopyProtocolButton } from './copy-protocol-button';

interface ContactPanelProps {
    chat: Chat | null;
    currentUser: User | null;
    onTransferSuccess: () => void;
    onContactUpdate: (contact?: Contact) => void;
}

export function TransferChatDialog({ chat, currentUser, onTransferSuccess, disabled, trigger }: { chat: Chat, currentUser: User | null, onTransferSuccess: () => void, disabled?: boolean, trigger?: React.ReactNode }) {
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
            if (result.chat) {
                // Immediate update of local store with full chat details (tags, colors)
                useInboxStore.getState().upsertChats([result.chat]);
            }
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
                {trigger || (
                    <Button variant="ghost" size="sm" className="h-7 px-2.5 bg-white/5 border border-white/5 text-[9px] font-bold uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/10 rounded-lg shrink-0 gap-1.5">
                        <ArrowRightLeft className="h-3 w-3 text-blue-400" />
                        Transferir
                    </Button>
                )}
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

export function ResumeConversationDialog({ chat, currentUser, onSuccess, trigger }: { chat: Chat, currentUser: User | null, onSuccess: () => void, trigger?: React.ReactNode }) {
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

            // Render the template body with substituted variables
            const bodyText = selectedTemplate.components.find((c: any) => c.type === 'BODY')?.text || '';
            let renderedContent = bodyText;
            variableKeys.forEach((key, index) => {
                const value = templateVariables[key] || '';
                renderedContent = renderedContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
            });

            templatePayload = {
                name: selectedTemplate.name,
                language: selectedTemplate.language,
                components: [
                    { type: 'body', parameters }
                ],
                renderedContent: renderedContent || `[Template: ${selectedTemplate.name}]`
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
                {trigger || (
                    <Button variant="ghost" size="sm" className="h-7 px-2.5 bg-white/5 border border-white/5 text-[9px] font-bold uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/10 rounded-lg shrink-0 gap-1.5">
                        <MessageSquarePlus className="h-3 w-3 text-green-400" />
                        Reabrir
                    </Button>
                )}
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

function CopyButton({ value, label }: { value: string, label?: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        toast({ title: label ? `${label} copiado!` : "Copiado para a área de transferência" });
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md hover:bg-white/10 text-white/40 hover:text-white transition-all"
            onClick={handleCopy}
        >
            {copied ? <CheckSquare className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </Button>
    );
}


export default function ContactPanel({ chat, currentUser, onTransferSuccess, onContactUpdate }: ContactPanelProps) {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [agents, setAgents] = useState<User[]>([]);
    const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
    const [deals, setDeals] = useState<Deal[]>([]);
    const [dealsLoading, setDealsLoading] = useState(false);
    const [dealFormOpen, setDealFormOpen] = useState(false);
    const [showTimeline, setShowTimeline] = useState(false);

    const handleContactSave = useCallback((updatedContact?: Contact | null) => {
        // If we received an updated contact, update it directly in the store
        if (updatedContact) {
            useInboxStore.getState().updateChatContact(updatedContact);
        }
        // Still call the original callback for any other sync operations
        onContactUpdate();
    }, [onContactUpdate]);

    const contactId = chat?.contact?.id;

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

    // Fetch deals for the contact
    useEffect(() => {
        if (!contactId) { setDeals([]); return; }
        setDealsLoading(true);
        getDealsByContact(contactId)
            .then(res => setDeals(res.deals || []))
            .finally(() => setDealsLoading(false));
    }, [contactId]);

    const openDeals = useMemo(() => deals.filter(d => d.won === null || d.won === undefined), [deals]);
    const totalOpenValue = useMemo(() => openDeals.reduce((s, d) => s + d.value, 0), [openDeals]);

    const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });


    if (!chat) {
        return (
            <div className="hidden lg:flex lg:flex-col lg:w-[280px] xl:w-[340px] 2xl:w-[400px] lg:flex-shrink-0 bg-background/30 backdrop-blur-xl border-l border-border/50 dark:bg-black dark:border-white/10">
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

    // Check for Meta contact signals
    const hasMetaContact = !!(chat.metaContactExternalId || chat.metaContactUsername);
    const isMetaUser = chat.contact?.name?.startsWith('Meta User');

    let platform = (
        // Priority: message-level platform sources first, then chat-level
        lastMessage?.platform ||
        lastMessage?.source_from_api ||
        chat.source ||
        chat.instance_type ||
        ''
    ).toString().toLowerCase();

    // Force platform to instagram/messenger if we have reliable Meta signals and current platform is vague/missing
    if (chat.metaPlatform) {
        platform = chat.metaPlatform;
    } else if (hasMetaContact && !platform.includes('messenger') && !platform.includes('facebook')) {
        platform = 'instagram';
    } else if (isMetaUser && !platform.includes('instagram')) {
        platform = 'messenger';
    }
    const instanceTypeDisplay =
        platform === 'instagram'
            ? 'Instagram'
            : platform === 'messenger'
                ? 'Messenger'
                : (chat.instance_type === 'wa_cloud' || platform === 'wa_cloud')
                    ? 'Cloud API'
                    : 'Baileys';

    // For Meta chats (Instagram/Messenger), use the external_id from meta_contacts
    // For other platforms, fall back to the message's external_sender_id
    const externalId = chat.metaContactExternalId
        || lastMessage?.externalSenderId
        || lastMessage?.external_sender_id
        || null;

    // Instagram/Messenger username  
    const metaUsername = chat.metaContactUsername || null;

    return (
        <motion.div
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="hidden lg:flex lg:flex-col lg:w-[280px] xl:w-[340px] 2xl:w-[400px] lg:max-w-[400px] lg:min-w-[240px] lg:flex-shrink-0 border-l border-white/10 bg-[#050505]/80 backdrop-blur-[40px] h-full shadow-[-20px_0_80px_rgba(0,0,0,0.4)] z-10 relative overflow-x-hidden overflow-y-hidden"
        >
            {/* Background Glows */}
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-blue-600/5 blur-[120px] rounded-full -mr-20 -mt-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[200px] h-[200px] bg-purple-600/5 blur-[100px] rounded-full -ml-20 -mb-20 pointer-events-none" />

            {/* Header */}
            <div className="sticky top-0 z-20 flex flex-col px-3 pt-3 pb-2 bg-black/20 backdrop-blur-md border-b border-white/5">
                {/* Quick Actions Bar - Icon only */}
                <div className="flex items-center gap-1 justify-end">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 bg-white/5 border border-white/5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg"
                                    onClick={() => setIsStatsOpen(true)}
                                >
                                    <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Relatórios</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />

                    {chat.status === 'encerrados' ? (
                        <ResumeConversationDialog chat={chat} currentUser={currentUser} onSuccess={onContactUpdate} />
                    ) : (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 bg-white/5 border border-white/5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg"
                                        onClick={() => {
                                            const protocol = chat.protocol || buildChatProtocol(chat.id);
                                            navigator.clipboard.writeText(protocol);
                                            toast({ title: "Protocolo copiado!" });
                                        }}
                                    >
                                        <Hash className="h-3.5 w-3.5 text-purple-400" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Copiar Protocolo</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            </div>

            <ScrollArea className="flex-1 custom-scrollbar">
                <div className="p-4 space-y-4 pb-24">
                    {/* Profile Section — always visible above tabs */}
                    <div className="relative">
                        <div className={cn(
                            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 blur-[60px] opacity-30 pointer-events-none transition-all duration-700",
                            platform === 'instagram' ? "bg-pink-500" :
                                platform === 'messenger' ? "bg-blue-500" :
                                    (chat.instance_type === 'wa_cloud' || platform === 'wa_cloud' || platform === 'whatsapp') ? "bg-green-500" : "bg-blue-400"
                        )} />

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", damping: 20 }}
                            className="flex flex-col items-center text-center relative"
                        >
                            <div className="relative group cursor-pointer" onClick={() => contact.avatar_url && window.open(contact.avatar_url, '_blank')}>
                                <div className="absolute -inset-2 bg-gradient-to-tr from-white/10 to-transparent rounded-full blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
                                <div className="p-1 rounded-full bg-gradient-to-b from-white/20 to-transparent border border-white/10 backdrop-blur-md">
                                    <Avatar className="h-20 w-20 shrink-0 rounded-full border-2 border-black/50 shadow-2xl relative">
                                        <AvatarImage src={contact.avatar_url || undefined} alt={contact.name} className="object-cover" />
                                        <AvatarFallback className="text-2xl font-bold bg-gradient-to-br from-neutral-800 to-black text-white">
                                            {contact.name.charAt(0)}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>

                                <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-xl bg-black border border-white/10 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                                    {platform === 'instagram' ? (
                                        <Globe className="h-4 w-4 text-pink-500 drop-shadow-[0_0_8px_rgba(236,72,153,0.5)]" />
                                    ) : platform === 'messenger' ? (
                                        <Globe className="h-4 w-4 text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                    ) : (
                                        <Smartphone className="h-4 w-4 text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 space-y-2">
                                <div className="flex items-center justify-center gap-2">
                                    <h2 className="font-black text-xl tracking-tight text-white/90">{contact.name}</h2>
                                    <LeadScoreBadge score={contact.lead_score} size="sm" />
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                    {chat.tag && chat.color && (
                                        <div
                                            style={{ backgroundColor: `${chat.color}20`, color: chat.color, borderColor: `${chat.color}40` }}
                                            className="px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-tighter flex items-center gap-1"
                                        >
                                            <div className="h-1 w-1 rounded-full animate-pulse" style={{ backgroundColor: chat.color }} />
                                            {chat.tag}
                                        </div>
                                    )}
                                    <div className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/5 text-white/40 text-[10px] font-bold uppercase tracking-wider">
                                        {instanceTypeDisplay}
                                    </div>
                                    <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                                        <DialogTrigger asChild>
                                            <button className="h-5 w-5 rounded-full bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all">
                                                <Edit className="h-2.5 w-2.5" />
                                            </button>
                                        </DialogTrigger>
                                        <AddContactForm
                                            isOpen={isEditModalOpen}
                                            setIsOpen={setIsEditModalOpen}
                                            contact={contact}
                                            onSave={handleContactSave}
                                            workspaceId={chat.workspace_id}
                                            agents={agents}
                                            user={currentUser}
                                        />
                                    </Dialog>
                                </div>
                            </div>
                        </motion.div>
                    </div>

                    {/* ==== TABBED CONTENT ==== */}
                    <Tabs defaultValue="info" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-white/[0.03] border border-white/5 rounded-xl h-8">
                            <TabsTrigger value="info" className="text-[11px] font-bold uppercase tracking-widest data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/40 rounded-lg h-7">Info</TabsTrigger>
                            <TabsTrigger value="crm" className="text-[11px] font-bold uppercase tracking-widest data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/40 rounded-lg h-7">
                                CRM
                                {openDeals.length > 0 && (
                                    <span className="ml-1.5 h-4 px-1.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-black rounded flex items-center">{openDeals.length}</span>
                                )}
                            </TabsTrigger>
                        </TabsList>

                        {/* ── INFO TAB ── */}
                        <TabsContent value="info" className="mt-4 space-y-5">
                            {/* Contact Details — compact rows */}
                            <div className="space-y-2">
                                {/* Phone */}
                                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-all group">
                                    <div className="h-7 w-7 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/20 shrink-0">
                                        <Smartphone className="h-3.5 w-3.5 text-green-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/20 block">WhatsApp</span>
                                        <span className="text-[13px] font-bold text-white/80 tabular-nums truncate block">
                                            {(contact.phone_number_jid || contact.phone || 'Sem número').replace(/@.*$/, '')}
                                        </span>
                                    </div>
                                    <CopyButton value={(contact.phone_number_jid || contact.phone || '').replace(/@.*$/, '')} label="Telefone" />
                                </div>

                                {/* Email */}
                                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-all group">
                                    <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
                                        <Mail className="h-3.5 w-3.5 text-blue-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/20 block">Email</span>
                                        <span className="text-[13px] font-bold text-white/80 truncate block">{contact.email || 'Não informado'}</span>
                                    </div>
                                    {contact.email && <CopyButton value={contact.email} label="Email" />}
                                </div>

                                {/* Protocol */}
                                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 border-dashed hover:bg-white/[0.06] transition-all group">
                                    <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                                        <Hash className="h-3.5 w-3.5 text-purple-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/20 block">Protocolo</span>
                                        <span className="text-[12px] font-mono font-bold text-purple-300 tracking-tighter truncate block" title={chat.protocol || buildChatProtocol(chat.id)}>
                                            {chat.protocol || buildChatProtocol(chat.id)}
                                        </span>
                                    </div>
                                    <CopyProtocolButton protocol={chat.protocol || buildChatProtocol(chat.id)} />
                                </div>
                            </div>

                            {/* Custom Fields */}
                            {customFields.length > 0 && customFields.some(f => contact.custom_fields?.[f.id]) && (
                                <div className="space-y-2">
                                    <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white/25 px-1">Campos Adicionais</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {customFields.map(field => {
                                            const value = contact.custom_fields?.[field.id];
                                            if (!value) return null;
                                            let displayValue = value;
                                            if (field.type === 'select') {
                                                const option = field.options?.find(opt => opt.value === value);
                                                displayValue = option ? option.label : value;
                                            }
                                            return (
                                                <div key={field.id} className="p-2 rounded-xl bg-white/[0.03] border border-white/5 flex flex-col gap-0.5">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-white/20">{field.label}</span>
                                                    <span className="text-[13px] font-bold text-white/70 truncate">{displayValue}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Agent */}
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white/25 px-1">Agente Responsável</h4>
                                <div className="relative bg-white/[0.03] border border-white/5 rounded-xl p-3">
                                    {agent && agent.id !== 'unknown' ? (
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="relative shrink-0">
                                                <Avatar className="h-8 w-8 rounded-lg border border-white/10 shadow-lg">
                                                    <AvatarImage src={agent.avatar || undefined} alt={agent.name} />
                                                    <AvatarFallback className="bg-neutral-800 text-white/60 font-black text-xs">{agent.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-black" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="font-bold text-white/90 truncate text-sm">{agent.name}</p>
                                                    <Badge className="bg-blue-500/10 text-blue-400 text-[9px] font-bold uppercase px-1.5 h-4 border-blue-500/20 shrink-0">AGENTE</Badge>
                                                </div>
                                                {chat.assigned_at && (
                                                    <p className="text-[11px] text-white/40 mt-0.5">Desde {new Date(chat.assigned_at).toLocaleDateString()}</p>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-lg bg-white/[0.02] border border-dashed border-white/10 flex items-center justify-center">
                                                <UserCheck className="h-4 w-4 text-white/10" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm font-bold text-white/40">Sem agente</p>
                                                <p className="text-[11px] text-white/20">Fila de espera</p>
                                            </div>
                                            <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="grid grid-cols-2 gap-2">
                                <Card
                                    className="bg-white/[0.02] border-white/5 shadow-none hover:bg-blue-500/5 hover:border-blue-500/30 transition-all cursor-pointer group rounded-xl overflow-hidden"
                                    onClick={() => setIsStatsOpen(true)}
                                >
                                    <CardContent className="p-3 flex items-center gap-2">
                                        <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 shrink-0">
                                            <BarChart3 className="h-3.5 w-3.5" />
                                        </div>
                                        <span className="text-[11px] font-black uppercase tracking-wider text-white/50">Stats</span>
                                    </CardContent>
                                </Card>

                                <Link href="/crm" className="block">
                                    <Card className="bg-white/[0.02] border-white/5 shadow-none hover:bg-purple-500/5 hover:border-purple-500/30 transition-all cursor-pointer group rounded-xl overflow-hidden h-full">
                                        <CardContent className="p-3 flex items-center gap-2">
                                            <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20 shrink-0">
                                                <LayoutGrid className="h-3.5 w-3.5" />
                                            </div>
                                            <span className="text-[11px] font-black uppercase tracking-wider text-white/50">CRM</span>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </div>
                        </TabsContent>

                        {/* ── CRM TAB ── */}
                        <TabsContent value="crm" className="mt-4 space-y-5">
                            {/* Deals */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-1">
                                    <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white/25">Negócios</h4>
                                    {totalOpenValue > 0 && (
                                        <span className="text-[12px] font-bold text-emerald-400 tabular-nums">{formatBRL(totalOpenValue)}</span>
                                    )}
                                </div>

                                {dealsLoading ? (
                                    <div className="flex justify-center py-4">
                                        <Loader2 className="h-4 w-4 animate-spin text-white/30" />
                                    </div>
                                ) : openDeals.length > 0 ? (
                                    <div className="space-y-1.5">
                                        {openDeals.map(deal => (
                                            <div key={deal.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-all">
                                                <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
                                                    <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-[13px] font-bold text-white/80 truncate block">{deal.title}</span>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <Badge className="h-4 px-1.5 bg-white/5 border-white/10 text-[10px] font-bold text-white/35">{deal.stage}</Badge>
                                                        <span className="text-[10px] text-white/25">{deal.probability}%</span>
                                                    </div>
                                                </div>
                                                <span className="text-[13px] font-black text-emerald-400 tabular-nums shrink-0">{formatBRL(deal.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[12px] text-white/20 text-center py-3">Nenhum negócio em aberto.</p>
                                )}

                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-8 bg-white/[0.02] border-white/5 text-white/40 hover:text-emerald-400 hover:bg-emerald-500/5 hover:border-emerald-500/20 rounded-lg transition-all text-[11px] font-bold uppercase tracking-widest gap-1.5"
                                    onClick={() => setDealFormOpen(true)}
                                >
                                    <DollarSign className="h-3 w-3" />
                                    Novo Negócio
                                </Button>
                            </div>

                            {/* Timeline */}
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white/25 px-1">Timeline</h4>
                                {!showTimeline ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full h-8 bg-white/[0.02] border-white/5 text-white/40 hover:text-white hover:bg-white/5 hover:border-white/20 rounded-lg transition-all text-[11px] font-bold uppercase tracking-widest"
                                        onClick={() => setShowTimeline(true)}
                                    >
                                        Carregar Timeline
                                    </Button>
                                ) : contactId ? (
                                    <ContactTimeline contactId={contactId} compact maxItems={8} />
                                ) : null}
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </ScrollArea>
            <ContactStatisticsDialog
                isOpen={isStatsOpen}
                setIsOpen={setIsStatsOpen}
                contactId={contact.id}
                contactName={contact.name}
            />
            {/* Deal Form Dialog */}
            {currentUser?.activeWorkspaceId && contactId && (
                <DealForm
                    isOpen={dealFormOpen}
                    setIsOpen={setDealFormOpen}
                    workspaceId={currentUser.activeWorkspaceId}
                    contactId={contactId}
                    contactName={contact.name}
                    onSaved={() => {
                        getDealsByContact(contactId).then(res => setDeals(res.deals || []));
                    }}
                />
            )}
        </motion.div>
    );
}

