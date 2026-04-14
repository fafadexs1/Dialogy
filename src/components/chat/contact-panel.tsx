'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { type Chat, type User, type Team, type Contact, type Deal, EvolutionInstance, type TelegramBotInstance, CustomFieldDefinition } from '@/lib/types';
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
    ArrowRight,
    ArrowRightLeft,
    Copy,
    ExternalLink,
    Zap,
    LayoutGrid,
    Cpu,
    Target,
    Check,
    DollarSign,
    History,
    AlertTriangle,
    Download,
    Upload,
    Receipt,
    Clock,
    Router,
    ChevronDown,
    ChevronUp,
    Wrench,
    FileText,
    Plus,
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
import { transferChatAction, getContactProtocolsAction, searchChatsAndContacts } from '@/actions/chats';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { getTelegramInstances } from '@/actions/telegram';
import { getIntegrationConfig } from '@/actions/integrations';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getChatContactDisplayValue, getChatPlatformLabel, resolveChatPlatform } from '@/lib/chat-platform';
import {
    createSGPServiceOrder,
    fetchSGPContactPanelData,
    generateSGPInvoicePix,
} from '@/plugins/sgp/actions';
import type { SGPContactPanelContract, SGPContactPanelData, SGPContactPanelInvoice } from '@/plugins/sgp/types';

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
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground">
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
    const [instances, setInstances] = useState<Array<
        Omit<EvolutionInstance, 'status' | 'qrCode'> |
        Omit<TelegramBotInstance, 'status'>
    >>([]);
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
    const isTelegram = useMemo(() => instances.find(i => i.instance_name === selectedInstance)?.type === 'telegram', [instances, selectedInstance]);
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
        Promise.all([
            getEvolutionApiInstances(currentUser.activeWorkspaceId),
            getTelegramInstances(currentUser.activeWorkspaceId),
        ])
            .then(([whatsappRes, telegramRes]) => {
                if (whatsappRes.error) {
                    toast({ title: 'Erro ao carregar instancias', description: whatsappRes.error, variant: 'destructive' });
                    setInstances([]);
                    setSelectedInstance('');
                    return;
                }
                if (telegramRes.error) {
                    toast({ title: 'Erro ao carregar bots', description: telegramRes.error, variant: 'destructive' });
                    setInstances([]);
                    setSelectedInstance('');
                    return;
                }
                const loaded = [...(whatsappRes.instances || []), ...(telegramRes.instances || [])];
                setInstances(loaded);
                const fallbackInstance = chat.instance_name || loaded[0]?.instance_name || '';
                setSelectedInstance((prev) => prev || fallbackInstance);
            })
            .catch((error) => {
                console.error('[CONTACT_PANEL] Falha ao buscar instancias', error);
                toast({ title: 'Erro ao carregar instancias', description: 'Nao foi possivel buscar as instancias de mensageria.', variant: 'destructive' });
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
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground">
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
                                        {instance.display_name} {instance.type === 'wa_cloud' && '(Cloud API)'} {instance.type === 'telegram' && '(Telegram)'}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>{isTelegram ? 'Chat ID do Telegram' : 'Telefone'}</Label>
                        <Input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder={isTelegram ? 'telegram:123456789' : '5511999999999'}
                            className="bg-muted/50 border-input text-foreground"
                        />
                    </div>

                    {isCloud ? (
                        <div className="space-y-4 border-l-2 border-blue-500 pl-4 bg-muted/30 p-2 rounded-r-md">
                            <div className="space-y-2 [&_h4]:!text-muted-foreground">
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
                                <div className="space-y-3 [&_label]:!text-muted-foreground">
                                    <Label className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Variáveis do Template</Label>
                                    {variableKeys.map((key) => (
                                        <div key={key} className="space-y-1">
                                            <Label htmlFor={`var-${key}`} className="text-xs text-slate-600 dark:text-zinc-200">Variável {`{{${key}}}`}</Label>
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
            className="h-6 w-6 rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            onClick={handleCopy}
        >
            {copied ? <CheckSquare className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </Button>
    );
}

function formatSgpCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

function formatSgpDate(value?: string | null) {
    if (!value) {
        return null;
    }

    const normalizedValue = String(value).includes('T') ? String(value) : `${value}T00:00:00`;
    const date = new Date(normalizedValue);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString('pt-BR');
}

function formatSgpConnectionDetails(contract: SGPContactPanelContract) {
    if (contract.connectionStatus === 'online' && contract.connectedAt) {
        return `Conectado desde ${formatSgpDate(contract.connectedAt)}`;
    }

    if (contract.disconnectedAt) {
        return `Ultima desconexao em ${formatSgpDate(contract.disconnectedAt)}`;
    }

    if (contract.contractDate) {
        return `Contrato desde ${formatSgpDate(contract.contractDate)}`;
    }

    return contract.reason || 'Sem historico recente';
}

function findNestedStringValue(source: unknown, acceptedKeys: string[]): string | null {
    if (!source || typeof source !== 'object') {
        return null;
    }

    if (Array.isArray(source)) {
        for (const item of source) {
            const nestedValue = findNestedStringValue(item, acceptedKeys);
            if (nestedValue) {
                return nestedValue;
            }
        }

        return null;
    }

    for (const [key, value] of Object.entries(source)) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
        if (acceptedKeys.includes(normalizedKey) && typeof value === 'string' && value.trim()) {
            return value.trim();
        }

        const nestedValue = findNestedStringValue(value, acceptedKeys);
        if (nestedValue) {
            return nestedValue;
        }
    }

    return null;
}

function extractSgpPixCode(payload: unknown, raw?: string | null) {
    const pixCode = findNestedStringValue(payload, [
        'codigopix',
        'codigocopiaecola',
        'copiaecola',
        'pixcopiacola',
        'pixcode',
        'qrcode',
    ]);

    if (pixCode) {
        return pixCode;
    }

    if (raw && !raw.startsWith('{') && !raw.startsWith('[') && !raw.startsWith('http')) {
        return raw.trim();
    }

    return null;
}

function extractSgpPixLink(payload: unknown, raw?: string | null) {
    const link = findNestedStringValue(payload, [
        'link',
        'linkcobranca',
        'url',
    ]);

    if (link) {
        return link;
    }

    if (raw && /^https?:\/\//i.test(raw.trim())) {
        return raw.trim();
    }

    return null;
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
    const [protocolHistory, setProtocolHistory] = useState<Array<{
        chatId: string;
        protocol: string;
        status: Chat['status'];
        createdAt: string;
        lastActivityAt: string;
        lastMessageContent: string | null;
    }>>([]);
    const [protocolHistoryLoading, setProtocolHistoryLoading] = useState(false);
    const [protocolSelectorOpen, setProtocolSelectorOpen] = useState(false);
    const [switchingProtocol, setSwitchingProtocol] = useState<string | null>(null);
    const [isSgpActive, setIsSgpActive] = useState(false);
    const [expandedContractId, setExpandedContractId] = useState<string | null>(null);
    const [sgpData, setSgpData] = useState<SGPContactPanelData | null>(null);
    const [sgpLoading, setSgpLoading] = useState(false);
    const [sgpError, setSgpError] = useState<string | null>(null);
    const [sgpPixLoadingInvoiceId, setSgpPixLoadingInvoiceId] = useState<string | null>(null);
    const [sgpOrderContract, setSgpOrderContract] = useState<SGPContactPanelContract | null>(null);
    const [sgpOrderNotes, setSgpOrderNotes] = useState('');
    const [isSgpOrderDialogOpen, setIsSgpOrderDialogOpen] = useState(false);
    const [isSubmittingSgpOrder, setIsSubmittingSgpOrder] = useState(false);

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
            getIntegrationConfig(currentUser.activeWorkspaceId, 'sgp').then(res => {
                setIsSgpActive(res.isActive);
            });
        }
    }, [currentUser?.activeWorkspaceId]);

    useEffect(() => {
        if (!isSgpActive || !chat?.id) {
            setSgpData(null);
            setSgpError(null);
            setSgpLoading(false);
            setExpandedContractId(null);
            return;
        }

        let cancelled = false;
        setSgpLoading(true);
        setSgpError(null);

        fetchSGPContactPanelData(chat.id)
            .then((res) => {
                if (cancelled) {
                    return;
                }

                if (!res.success || !res.data) {
                    setSgpData(null);
                    setSgpError(res.error || 'Falha ao carregar dados do SGP.');
                    setExpandedContractId(null);
                    return;
                }

                setSgpData(res.data);
                setExpandedContractId((currentValue) => {
                    if (currentValue && res.data?.contracts.some((contract) => contract.id === currentValue)) {
                        return currentValue;
                    }

                    return res.data?.contracts[0]?.id || null;
                });
            })
            .finally(() => {
                if (!cancelled) {
                    setSgpLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isSgpActive, chat?.id]);

    // Fetch deals for the contact
    useEffect(() => {
        if (!contactId) { setDeals([]); return; }
        setDealsLoading(true);
        getDealsByContact(contactId)
            .then(res => setDeals(res.deals || []))
            .finally(() => setDealsLoading(false));
    }, [contactId]);

    useEffect(() => {
        if (!chat?.workspace_id || !contactId) {
            setProtocolHistory([]);
            return;
        }

        setProtocolHistoryLoading(true);
        getContactProtocolsAction(chat.workspace_id, contactId)
            .then((res) => {
                if (res.error) {
                    setProtocolHistory([]);
                    return;
                }
                setProtocolHistory(res.protocols || []);
            })
            .finally(() => setProtocolHistoryLoading(false));
    }, [chat?.workspace_id, contactId]);

    const openDeals = useMemo(() => deals.filter(d => d.won === null || d.won === undefined), [deals]);
    const totalOpenValue = useMemo(() => openDeals.reduce((s, d) => s + d.value, 0), [openDeals]);
    const sgpContracts = sgpData?.contracts || [];
    const sgpInvoices = sgpData?.invoices || [];
    const sgpOverdueInvoices = sgpData?.overdueInvoices || 0;
    const sgpOnlineContracts = sgpData?.onlineContracts || 0;
    const hasSgpDebt = sgpOverdueInvoices > 0;

    const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const handleSelectProtocol = useCallback(async (protocol: string) => {
        if (!chat?.workspace_id) return;

        setSwitchingProtocol(protocol);
        try {
            const searchResult = await searchChatsAndContacts(chat.workspace_id, protocol);
            if (searchResult.error || !searchResult.chats?.length) {
                toast({ title: "Nao foi possivel abrir o protocolo.", variant: 'destructive' });
                return;
            }

            const selectedProtocolChat = {
                ...searchResult.chats[0],
                protocolScoped: true,
                messages: searchResult.chats[0].messages || [],
            } as Chat;

            const store = useInboxStore.getState();
            store.upsertChats([selectedProtocolChat]);
            store.setMessagesForChat(
                selectedProtocolChat.id,
                selectedProtocolChat.messages || [],
                null,
                null,
                null,
                false,
                true
            );
            store.setSelectedChatId(selectedProtocolChat.id);
            setProtocolSelectorOpen(false);
        } catch (error) {
            toast({ title: "Falha ao carregar protocolo.", variant: 'destructive' });
        } finally {
            setSwitchingProtocol(null);
        }
    }, [chat?.workspace_id]);

    const handleGenerateSgpPix = useCallback(async (invoice: SGPContactPanelInvoice) => {
        if (invoice.pixCode) {
            await navigator.clipboard.writeText(invoice.pixCode);
            toast({ title: 'Codigo PIX copiado!' });
            return;
        }

        setSgpPixLoadingInvoiceId(invoice.id);
        try {
            const result = await generateSGPInvoicePix(invoice.id, invoice.contractId);
            if (!result.success) {
                toast({ title: 'Erro ao gerar PIX', description: result.error, variant: 'destructive' });
                return;
            }

            const pixCode = extractSgpPixCode(result.payload, result.raw);
            if (pixCode) {
                await navigator.clipboard.writeText(pixCode);
                toast({ title: 'PIX copiado!', description: 'O codigo PIX foi copiado para a area de transferencia.' });
                return;
            }

            const pixLink = extractSgpPixLink(result.payload, result.raw);
            if (pixLink) {
                window.open(pixLink, '_blank');
                toast({ title: 'PIX aberto', description: 'O link de cobranca foi aberto em outra aba.' });
                return;
            }

            toast({ title: 'PIX gerado', description: 'A resposta do SGP foi recebida, mas sem codigo copiavel.' });
        } finally {
            setSgpPixLoadingInvoiceId(null);
        }
    }, []);

    const handleOpenSgpOrderDialog = useCallback((contract: SGPContactPanelContract) => {
        setSgpOrderContract(contract);
        setSgpOrderNotes('');
        setIsSgpOrderDialogOpen(true);
    }, []);

    const handleCreateSgpOrder = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!chat?.id || !sgpOrderContract) {
            return;
        }

        setIsSubmittingSgpOrder(true);
        try {
            const result = await createSGPServiceOrder(chat.id, sgpOrderContract.id, sgpOrderNotes);
            if (!result.success) {
                toast({ title: 'Erro ao criar chamado no SGP', description: result.error, variant: 'destructive' });
                return;
            }

            const protocol = result.apiResponse?.protocolo || result.apiResponse?.id || sgpOrderContract.id;
            toast({ title: 'Chamado criado no SGP', description: `Protocolo: ${protocol}` });
            setIsSgpOrderDialogOpen(false);
            setSgpOrderNotes('');
        } finally {
            setIsSubmittingSgpOrder(false);
        }
    }, [chat?.id, sgpOrderContract, sgpOrderNotes]);


    if (!chat) {
        return (
            <div className="hidden lg:flex lg:flex-col lg:w-[280px] xl:w-[340px] 2xl:w-[400px] lg:flex-shrink-0 border-l border-border/70 bg-background/80 backdrop-blur-xl">
                <div className="flex h-16 items-center border-b border-border px-4 xl:px-6">
                    <h3 className="font-semibold text-foreground">Informações de Contato</h3>
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
    const currentProtocol = chat.protocol || buildChatProtocol(chat.id);

    const resolvedPlatform = resolveChatPlatform(chat);
    const instanceTypeDisplay = getChatPlatformLabel(resolvedPlatform);
    const contactChannelLabel =
        resolvedPlatform === 'telegram'
            ? 'Telegram'
            : resolvedPlatform === 'instagram'
                ? 'Instagram'
                : resolvedPlatform === 'messenger'
                    ? 'Messenger'
                    : 'WhatsApp';
    const contactDisplayValue = getChatContactDisplayValue(contact, resolvedPlatform) || 'Sem numero';

    // For Meta chats (Instagram/Messenger), use the external_id from meta_contacts
    // For other platforms, fall back to the message's external_sender_id
    const lastMessage = (chat as any)?.messages?.[(chat as any)?.messages?.length - 1];
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
            className="relative z-10 hidden h-full overflow-x-hidden overflow-y-hidden border-l border-slate-200/80 bg-white/95 shadow-[-20px_0_60px_rgba(15,23,42,0.12)] backdrop-blur-[40px] dark:border-white/5 dark:bg-black dark:shadow-[-20px_0_60px_rgba(0,0,0,0.8)] lg:flex lg:w-[280px] lg:max-w-[400px] lg:min-w-[240px] lg:flex-shrink-0 lg:flex-col xl:w-[340px] 2xl:w-[400px]"
        >
            {/* Background Glows */}
            <div className="pointer-events-none absolute right-0 top-0 h-[300px] w-[300px] -mr-20 -mt-20 rounded-full bg-blue-200/70 blur-[120px] dark:bg-transparent dark:opacity-0" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-[200px] w-[200px] -mb-20 -ml-20 rounded-full bg-emerald-100/70 blur-[100px] dark:bg-transparent dark:opacity-0" />

            {/* Header */}
            <div className="sticky top-0 z-20 flex flex-col border-b border-slate-200/80 bg-white/90 px-3 pb-2 pt-3 backdrop-blur-md dark:border-white/5 dark:bg-black">
                {/* Quick Actions Bar - Icon only */}
                <div className="flex flex-wrap items-center gap-1 justify-end min-w-0">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-black dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
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
                                        className="h-7 w-7 rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-black dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
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
                <div className="overflow-x-hidden p-3.5 space-y-3.5 pb-24 sm:p-4 sm:space-y-4">
                    {/* Profile section always visible above tabs */}
                    <div className="relative">
                        <div className={cn(
                            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 blur-[60px] opacity-30 pointer-events-none transition-all duration-700 dark:opacity-10",
                            resolvedPlatform === 'instagram' ? "bg-pink-500" :
                                resolvedPlatform === 'messenger' ? "bg-blue-500" :
                                    resolvedPlatform === 'telegram' ? "bg-sky-500" :
                                        "bg-green-500"
                        )} />

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", damping: 20 }}
                            className="relative flex w-full flex-col items-center text-center overflow-hidden"
                        >
                            <div className="relative group cursor-pointer" onClick={() => contact.avatar_url && window.open(contact.avatar_url, '_blank')}>
                                <div className="absolute -inset-2 rounded-full bg-gradient-to-tr from-blue-100/80 to-transparent opacity-0 blur transition duration-500 group-hover:opacity-100 dark:from-transparent dark:group-hover:opacity-0"></div>
                                <div className="rounded-full border border-slate-200/80 bg-white p-1 shadow-lg backdrop-blur-md dark:border-white/5 dark:bg-black">
                                    <Avatar className="relative h-16 w-16 shrink-0 rounded-full border-2 border-slate-200/80 shadow-2xl sm:h-20 sm:w-20 dark:border-white/10">
                                        <AvatarImage src={contact.avatar_url || undefined} alt={contact.name} className="object-cover" />
                                        <AvatarFallback className="bg-slate-100 text-xl font-bold text-slate-700 sm:text-2xl dark:bg-zinc-900 dark:text-zinc-300">
                                            {contact.name.charAt(0)}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>

                                <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200/80 bg-white shadow-lg transition-transform group-hover:scale-110 sm:h-8 sm:w-8 dark:border-white/5 dark:bg-black">
                                    {resolvedPlatform === 'instagram' ? (
                                        <Globe className="h-3.5 w-3.5 text-pink-500 drop-shadow-[0_0_8px_rgba(236,72,153,0.5)] sm:h-4 sm:w-4" />
                                    ) : resolvedPlatform === 'messenger' ? (
                                        <Globe className="h-3.5 w-3.5 text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] sm:h-4 sm:w-4" />
                                    ) : (
                                        <Smartphone className={cn(
                                            "h-3.5 w-3.5 sm:h-4 sm:w-4",
                                            resolvedPlatform === 'telegram'
                                                ? "text-sky-500 drop-shadow-[0_0_8px_rgba(14,165,233,0.5)]"
                                                : "text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                                        )} />
                                    )}
                                </div>
                            </div>

                            <div className="mt-3 w-full px-4 space-y-1.5 sm:mt-4 sm:px-6 sm:space-y-2">
                                <div className="flex w-full min-w-0 flex-col items-center gap-1.5 px-1">
                                    <h2 className="w-full max-w-full text-center font-black text-base leading-tight tracking-tight text-foreground break-words [overflow-wrap:anywhere] sm:text-lg" title={contact.name}>
                                        {contact.name}
                                    </h2>
                                    <LeadScoreBadge score={contact.lead_score} size="sm" className="shrink-0" />
                                </div>
                                <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
                                    {chat.tag && chat.color && (
                                        <div
                                            style={{ backgroundColor: `${chat.color}20`, color: chat.color, borderColor: `${chat.color}40` }}
                                            className="flex min-w-0 max-w-[120px] items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-tighter sm:text-[10px]"
                                            title={chat.tag}
                                        >
                                            <div className="h-1 w-1 rounded-full animate-pulse shrink-0" style={{ backgroundColor: chat.color }} />
                                            <span className="truncate">{chat.tag}</span>
                                        </div>
                                    )}
                                    <div className="min-w-0 max-w-[120px] truncate rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground sm:text-[10px] dark:border-white/10 dark:bg-black dark:text-zinc-400" title={instanceTypeDisplay}>
                                        {instanceTypeDisplay}
                                    </div>
                                    <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                                        <DialogTrigger asChild>
                                            <button className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-all hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-black dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white">
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
                    <Tabs defaultValue="info" className="w-full min-w-0">
                        <TabsList className={cn("grid h-8 w-full rounded-xl border border-border bg-muted/40 dark:border-white/10 dark:bg-[#07080b]", isSgpActive ? "grid-cols-3" : "grid-cols-2")}>
                            <TabsTrigger value="info" className="h-7 min-w-0 rounded-lg px-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground sm:text-[11px] dark:data-[state=active]:bg-black dark:data-[state=active]:text-white">Info</TabsTrigger>
                            <TabsTrigger value="crm" className="h-7 min-w-0 rounded-lg px-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground sm:text-[11px] dark:data-[state=active]:bg-black dark:data-[state=active]:text-white">
                                CRM
                                {openDeals.length > 0 && (
                                    <span className="ml-1.5 h-4 px-1.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-black rounded flex items-center">{openDeals.length}</span>
                                )}
                            </TabsTrigger>
                            {isSgpActive && (
                                <TabsTrigger value="sgp" className="h-7 min-w-0 rounded-lg px-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground sm:text-[11px] dark:data-[state=active]:bg-black dark:data-[state=active]:text-white">
                                    SGP
                                </TabsTrigger>
                            )}
                        </TabsList>

                        {/* INFO TAB */}
                        <TabsContent value="info" className="mt-3 space-y-4 overflow-x-hidden overflow-y-hidden animate-in fade-in slide-in-from-bottom-2 duration-500 sm:mt-4 sm:space-y-5">
                            {/* Contact data cards */}
                            <div className="space-y-2">
                                {/* Phone Card */}
                                <div className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-sm transition-all hover:bg-slate-100 dark:border-white/5 dark:bg-[#07080b] dark:hover:bg-white/5">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <div className={cn(
                                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border sm:h-8 sm:w-8",
                                            contact.phone_number_jid?.includes('@g.us')
                                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        )}>
                                            {contact.phone_number_jid?.includes('@g.us') ? <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Phone className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="block truncate text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-500">{contactChannelLabel}</span>
                                                <CopyButton value={(contact.phone_number_jid || contact.phone || '').replace(/@.*$/, '')} label="Telefone" />
                                            </div>
                                            <span className="mt-0.5 block break-all text-[12px] font-semibold leading-tight tabular-nums text-slate-900 sm:text-[13px] dark:text-zinc-100">
                                                {(contact.phone_number_jid || contact.phone || 'Sem número').replace(/@.*$/, '')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Email Card */}
                                <div className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-sm transition-all hover:bg-slate-100 dark:border-white/5 dark:bg-[#07080b] dark:hover:bg-white/5">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 sm:h-8 sm:w-8">
                                            <Mail className="h-3.5 w-3.5 text-blue-400 sm:h-4 sm:w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="block truncate text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-500">Email</span>
                                                {contact.email && <CopyButton value={contact.email} label="Email" />}
                                            </div>
                                            <span className="mt-0.5 block break-all text-[12px] font-semibold leading-tight text-slate-900 sm:text-[13px] dark:text-zinc-100">{contact.email || 'Não informado'}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Protocol Card */}
                                <div className="group relative overflow-hidden rounded-xl border border-dashed border-slate-200/80 bg-white/90 p-2.5 shadow-sm transition-all hover:bg-slate-100 dark:border-white/5 dark:bg-[#07080b] dark:hover:bg-white/5">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/10 sm:h-8 sm:w-8">
                                            <Hash className="h-3.5 w-3.5 text-purple-400 sm:h-4 sm:w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="block truncate text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-500">Protocolo</span>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <Popover open={protocolSelectorOpen} onOpenChange={setProtocolSelectorOpen}>
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                type="button"
                                                                className="h-5 w-5 rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-6 sm:w-6 dark:border-white/10 dark:bg-black dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
                                                                title="Ver histórico"
                                                            >
                                                                <History className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] border-border bg-popover p-2 shadow-xl">
                                                            <div className="px-2 py-1.5">
                                                                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground sm:text-[10px]">Histórico de Protocolos</p>
                                                            </div>
                                                            <div className="max-h-[200px] overflow-y-auto space-y-1">
                                                                {protocolHistoryLoading ? (
                                                                    <div className="flex items-center justify-center py-4 text-muted-foreground">
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    </div>
                                                                ) : protocolHistory.length === 0 ? (
                                                                    <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum histórico encontrado.</p>
                                                                ) : (
                                                                    protocolHistory.map((entry) => (
                                                                        <button
                                                                            key={entry.chatId}
                                                                            type="button"
                                                                            onClick={() => handleSelectProtocol(entry.protocol)}
                                                                            className={cn(
                                                                                "w-full rounded-lg border px-2 py-1.5 text-left transition-colors",
                                                                                entry.protocol === currentProtocol ? "border-purple-500/40 bg-purple-500/10" : "border-border hover:bg-muted/50"
                                                                            )}
                                                                        >
                                                                            <span className="block truncate text-[10px] font-mono font-semibold text-purple-300 sm:text-[11px]">{entry.protocol}</span>
                                                                            <span className="block text-[9px] text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</span>
                                                                        </button>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </PopoverContent>
                                                    </Popover>
                                                    <CopyProtocolButton protocol={currentProtocol} />
                                                </div>
                                            </div>
                                            <span className="mt-0.5 block break-words text-[10.5px] font-mono font-semibold leading-[1.3] tracking-tight text-purple-300 sm:text-[11.5px]">
                                                {currentProtocol}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* SGP Quick Summary */}
                            {isSgpActive && (
                                <div className="space-y-2">
                                    <h4 className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Resumo Conexão</h4>
                                    <div
                                        className={cn(
                                            "group flex min-w-0 cursor-pointer items-center justify-between rounded-xl border p-2.5 transition-all",
                                            hasSgpDebt
                                                ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
                                                : "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                                        )}
                                        onClick={() => {
                                            const tabsList = document.querySelector('[role="tablist"]');
                                            if (tabsList) {
                                                const sgpTab = tabsList.querySelector('[value="sgp"]');
                                                if (sgpTab) (sgpTab as HTMLElement).click();
                                            }
                                        }}
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                            <div className={cn(
                                                "flex h-7 w-7 items-center justify-center rounded-lg shrink-0 border sm:h-8 sm:w-8",
                                                hasSgpDebt ? "bg-red-500/20 text-red-500 border-red-500/30" : "bg-emerald-500/20 text-emerald-500 border-emerald-500/30"
                                            )}>
                                                {sgpLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : hasSgpDebt ? <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <CheckSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className={cn("block break-words text-[9px] font-black uppercase tracking-[0.18em] leading-tight sm:text-[10px]", hasSgpDebt ? "text-red-500/80" : "text-emerald-500/80")}>
                                                    {sgpLoading ? 'SGP • Carregando' : sgpError ? 'SGP • Erro' : hasSgpDebt ? 'SGP • Inadimplente' : 'SGP • Em dia'}
                                                </span>
                                                <span className={cn("mt-0.5 block break-words text-[11px] font-semibold leading-tight sm:text-[12px]", hasSgpDebt ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                                                    {sgpLoading ? 'Consultando...' : sgpError ? sgpError : `${sgpOnlineContracts} ON, ${sgpOverdueInvoices} PEND`}
                                                </span>
                                            </div>
                                        </div>
                                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5" />
                                    </div>
                                </div>
                            )}

                            {/* Agent Info */}
                            <div className="space-y-2">
                                <h4 className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Responsável</h4>
                                <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 dark:border-white/5 dark:bg-[#07080b] sm:p-3">
                                    {agent && agent.id !== 'unknown' ? (
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="relative shrink-0">
                                                <Avatar className="h-7 w-7 rounded-lg border border-border shadow-lg sm:h-8 sm:w-8">
                                                    <AvatarImage src={agent.avatar || undefined} alt={agent.name} />
                                                    <AvatarFallback className="bg-zinc-900 text-zinc-300 font-black text-xs">{agent.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-black" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden">
                                                    <p className="truncate text-[13px] font-semibold leading-tight text-foreground sm:text-sm" title={agent.name}>{agent.name}</p>
                                                    <Badge className="bg-blue-500/10 text-blue-400 text-[9px] font-black px-1.5 h-4 border-blue-500/20 shrink-0">AGENTE</Badge>
                                                </div>
                                                {chat.assigned_at && (
                                                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground sm:text-[10px]" title={new Date(chat.assigned_at).toLocaleDateString()}>
                                                        Assumido em {new Date(chat.assigned_at).toLocaleDateString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-border bg-slate-50 dark:bg-zinc-900 shrink-0 sm:h-8 sm:w-8">
                                                <UserCheck className="h-3.5 w-3.5 text-muted-foreground/40 sm:h-4 sm:w-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[13px] font-semibold text-foreground sm:text-sm">Sem agente</p>
                                                <p className="text-[9px] text-muted-foreground sm:text-[10px]">Aguardando atendimento</p>
                                            </div>
                                            <TransferChatDialog chat={chat} currentUser={currentUser} onTransferSuccess={onTransferSuccess} disabled={chat.status === 'encerrados'} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Quick Stats Grid */}
                            <div className="grid grid-cols-1 gap-2 min-[340px]:grid-cols-2">
                                <Card
                                    className="cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-none transition-all hover:bg-blue-500/5 dark:border-white/5 dark:bg-[#07080b]"
                                    onClick={() => setIsStatsOpen(true)}
                                >
                                    <CardContent className="flex min-w-0 items-center gap-2 p-2.5 sm:p-3">
                                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                                            <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                        </div>
                                        <span className="truncate text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px] dark:text-zinc-400">Stats</span>
                                    </CardContent>
                                </Card>
                                <Link href="/crm" className="block">
                                    <Card className="h-full cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-none transition-all hover:bg-purple-500/5 dark:border-white/5 dark:bg-[#07080b]">
                                        <CardContent className="flex min-w-0 items-center gap-2 p-2.5 sm:p-3">
                                            <div className="flex h-7 w-7 rounded-lg bg-purple-500/10 items-center justify-center text-purple-400 border border-purple-500/20 shrink-0">
                                                <LayoutGrid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                            </div>
                                            <span className="truncate text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px] dark:text-zinc-400">CRM</span>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </div>

                            {/* Timeline Toggle */}
                            <div className="space-y-2">
                                <h4 className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Atividade</h4>
                                <div className="rounded-xl border border-slate-200/80 bg-white/90 dark:border-white/5 dark:bg-[#07080b]">
                                    {!showTimeline ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="w-full h-10 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 hover:text-foreground sm:text-[10px]"
                                            onClick={() => setShowTimeline(true)}
                                        >
                                            Ver Histórico Completo
                                        </Button>
                                    ) : contactId ? (
                                        <div className="p-2">
                                            <ContactTimeline contactId={contactId} compact maxItems={5} />
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </TabsContent>

                        {/* CRM TAB */}
                        <TabsContent value="crm" className="mt-4 space-y-5 overflow-x-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                            {/* Deals Card Section */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-1">
                                    <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-500">Negócios em Aberto</h4>
                                    {totalOpenValue > 0 && <span className="text-xs font-black text-emerald-500 tabular-nums">{formatBRL(totalOpenValue)}</span>}
                                </div>

                                {dealsLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
                                    </div>
                                ) : openDeals.length > 0 ? (
                                    <div className="space-y-2">
                                        {openDeals.map(deal => (
                                            <div key={deal.id} className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm hover:bg-slate-100 dark:border-white/5 dark:bg-[#07080b] dark:hover:bg-white/5">
                                                <div className="flex items-start gap-3">
                                                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400 shrink-0">
                                                        <DollarSign className="h-4 w-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <h5 className="truncate text-[13px] font-bold text-foreground">{deal.title}</h5>
                                                            <span className="shrink-0 text-[13px] font-black text-emerald-500 tabular-nums">{formatBRL(deal.value)}</span>
                                                        </div>
                                                        <div className="mt-1.5 flex items-center gap-1.5">
                                                            <Badge className="h-4 border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[9px] font-bold text-emerald-500 uppercase">{deal.stage}</Badge>
                                                            <span className="text-[10px] font-medium text-muted-foreground">{deal.probability}% Prob.</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200/80 p-8 text-center bg-slate-50/50 dark:border-white/5 dark:bg-white/5/30">
                                        <DollarSign className="h-6 w-6 text-muted-foreground/20 mb-2" />
                                        <p className="text-[11px] font-medium text-muted-foreground">Nenhum negócio ativo encontrado.</p>
                                    </div>
                                )}

                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-9 rounded-xl border-slate-200 bg-white text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 dark:border-white/10 dark:bg-black"
                                    onClick={() => setDealFormOpen(true)}
                                >
                                    <Plus className="h-3.5 w-3.5 mr-2" />
                                    Novo Negócio
                                </Button>
                            </div>

                            {/* Additional Info / Custom Fields */}
                            {customFields.length > 0 && customFields.some(f => contact.custom_fields?.[f.id] && contact.custom_fields?.[f.id] !== '[]') && (
                                <div className="space-y-3">
                                    <h4 className="px-1 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-500">Dados Estruturados</h4>
                                    <div className="grid grid-cols-1 gap-2">
                                        {customFields.map(field => {
                                            const value = contact.custom_fields?.[field.id];
                                            if (!value || value === '[]') return null;

                                            let displayValue: React.ReactNode = value;
                                            if (field.type === 'select') {
                                                const option = field.options?.find(opt => opt.value === value);
                                                displayValue = option ? option.label : value;
                                            }

                                            return (
                                                <div key={field.id} className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-white/5 dark:bg-[#07080b]">
                                                    <span className="block truncate text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-zinc-500">{field.label}</span>
                                                    <span className="mt-1 block break-words text-[13px] font-bold text-slate-900 dark:text-zinc-100">{displayValue}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </TabsContent>

                        {/* ▬▬ SGP TAB ▬▬ */}
                        {isSgpActive && (
                            <TabsContent value="sgp" className="mt-4 space-y-5 overflow-x-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                                {sgpLoading ? (
                                    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200/80 bg-white/90 p-4 text-sm text-muted-foreground dark:border-white/5 dark:bg-[#07080b]">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span className="min-w-0 break-words">Carregando dados do SGP pelo CPF configurado na integracao.</span>
                                    </div>
                                ) : sgpError ? (
                                    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 dark:border-red-500/20">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 shrink-0">
                                            <AlertTriangle className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="truncate text-[13px] font-bold text-red-600 dark:text-red-400">Nao foi possivel consultar o SGP</h4>
                                            <p className="mt-1 break-all text-[11px] text-red-500/80">{sgpError}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div
                                            className={cn(
                                                "flex min-w-0 flex-col gap-3 rounded-xl border p-3",
                                                hasSgpDebt
                                                    ? "border-red-500/30 bg-red-500/10 dark:bg-red-500/5"
                                                    : "border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/5"
                                            )}
                                        >
                                            <div className="flex min-w-0 items-center gap-3">
                                                <div
                                                    className={cn(
                                                        "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                                                        hasSgpDebt ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"
                                                    )}
                                                >
                                                    {hasSgpDebt ? <AlertTriangle className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className={cn("break-words text-[13px] font-bold", hasSgpDebt ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                                                        {hasSgpDebt ? 'Cliente com pendencia financeira' : 'Cliente sem pendencia financeira'}
                                                    </h4>
                                                    <p className={cn("break-words text-[11px] font-medium", hasSgpDebt ? "text-red-500/80" : "text-emerald-600/80 dark:text-emerald-400/80")}>
                                                        {sgpData?.customerName || contact.name} {'\u2022'} {sgpOnlineContracts} contrato{sgpOnlineContracts === 1 ? '' : 's'} online
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="min-w-0 text-left">
                                                <span className={cn("block text-[12px] font-black tabular-nums", hasSgpDebt ? "text-red-500" : "text-emerald-500")}>
                                                    {sgpOverdueInvoices} vencida{sgpOverdueInvoices === 1 ? '' : 's'}
                                                </span>
                                                {sgpData?.cpfCnpj && (
                                                    <span className="block truncate text-[10px] uppercase tracking-widest text-muted-foreground" title={`CPF/CNPJ ${sgpData.cpfCnpj}`}>
                                                        CPF/CNPJ {sgpData.cpfCnpj}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between px-1">
                                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-500">
                                                    Contratos ({sgpContracts.length})
                                                </h4>
                                            </div>

                                            {sgpContracts.length > 0 ? (
                                                sgpContracts.map((contract) => {
                                                    const isExpanded = expandedContractId === contract.id;
                                                    const isOnline = contract.connectionStatus === 'online';
                                                    const isOffline = contract.connectionStatus === 'offline';

                                                    return (
                                                        <div
                                                            key={contract.id}
                                                            className={cn(
                                                                "relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-sm transition-all dark:border-white/5 dark:bg-[#07080b]",
                                                                isExpanded
                                                                    ? isOnline
                                                                        ? "border-emerald-500/30 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                                                                        : "border-slate-300 bg-slate-50 ring-1 ring-slate-200 dark:border-white/10 dark:bg-white/5/50"
                                                                    : isOnline
                                                                        ? "cursor-pointer hover:border-emerald-500/30 hover:bg-emerald-500/5"
                                                                        : "cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                                                            )}
                                                        >
                                                            <div
                                                                className={cn(
                                                                    "absolute left-0 top-0 h-full w-1",
                                                                    isOnline ? "bg-emerald-500/50" : isOffline ? "bg-slate-300 dark:bg-slate-700" : "bg-amber-400/60"
                                                                )}
                                                            />
                                                            <div
                                                                className="flex min-w-0 items-start justify-between p-3"
                                                                onClick={() => setExpandedContractId(isExpanded ? null : contract.id)}
                                                            >
                                                                <div className="flex w-full min-w-0 gap-2">
                                                                    <div
                                                                        className={cn(
                                                                            "flex h-8 w-8 items-center justify-center rounded-lg border shrink-0",
                                                                            isOnline
                                                                                ? "border-emerald-500/20 bg-emerald-500/10"
                                                                                : isOffline
                                                                                    ? "border-slate-200 bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800"
                                                                                    : "border-amber-500/20 bg-amber-500/10"
                                                                        )}
                                                                    >
                                                                        <Router className={cn("h-4 w-4", isOnline ? "text-emerald-500" : isOffline ? "text-slate-400" : "text-amber-500")} />
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                            <h5 className="min-w-0 flex-1 break-words text-[13px] font-bold leading-tight text-slate-800 dark:text-slate-200">
                                                                                {contract.planDescription}
                                                                            </h5>
                                                                            <span
                                                                                className={cn(
                                                                                    "flex h-4 shrink-0 items-center gap-1 rounded-full px-1.5 text-[9px] font-bold uppercase",
                                                                                    isOnline
                                                                                        ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
                                                                                        : isOffline
                                                                                            ? "border border-slate-300 bg-slate-100 text-slate-500 dark:border-zinc-700 dark:bg-zinc-800"
                                                                                            : "border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                                                )}
                                                                            >
                                                                                <div className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-emerald-500 animate-pulse" : isOffline ? "bg-slate-400" : "bg-amber-500")} />
                                                                                {contract.statusLabel}
                                                                            </span>
                                                                        </div>
                                                                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={contract.detailsLabel}>{contract.detailsLabel}</p>
                                                                        <div className="mt-1 flex items-start gap-1 text-[9.5px] leading-tight text-muted-foreground/80">
                                                                            <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                                                            <span className="line-clamp-2 break-words">{contract.addressLabel}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="shrink-0 pt-1 text-slate-400">
                                                                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {isExpanded && (
                                                                <div className="animate-in slide-in-from-top-1 px-3 pb-3 duration-200">
                                                                    <div className="grid grid-cols-1 gap-2 border-t border-slate-200/50 pt-2 dark:border-white/10">
                                                                        <div className="min-w-0 flex flex-col gap-0.5">
                                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contrato</span>
                                                                            <span className="break-all text-[12px] font-bold text-slate-700 dark:text-slate-300">{contract.id}</span>
                                                                        </div>
                                                                        <div className="min-w-0 flex flex-col gap-0.5">
                                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Servico</span>
                                                                            <span className="break-words text-[12px] font-bold text-slate-700 dark:text-slate-300">{contract.serviceType || 'Nao informado'}</span>
                                                                        </div>
                                                                        <div className="min-w-0 flex flex-col gap-0.5">
                                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Login</span>
                                                                            <span className="break-all text-[12px] font-bold text-slate-700 dark:text-slate-300">{contract.login || 'Nao informado'}</span>
                                                                        </div>
                                                                        <div className="min-w-0 flex flex-col gap-0.5">
                                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Serial</span>
                                                                            <span className="break-all text-[12px] font-bold text-slate-700 dark:text-slate-300">{contract.serial || 'Nao informado'}</span>
                                                                        </div>
                                                                        <div className="min-w-0 flex flex-col gap-0.5">
                                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">IP</span>
                                                                            <span className="break-all text-[12px] font-bold text-slate-700 dark:text-slate-300">{contract.ip || 'Nao informado'}</span>
                                                                        </div>
                                                                        <div className="min-w-0 flex flex-col gap-0.5">
                                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">MAC</span>
                                                                            <span className="break-all text-[12px] font-bold text-slate-700 dark:text-slate-300">{contract.mac || 'Nao informado'}</span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="mt-2 flex min-w-0 items-start gap-1 text-[10px] font-medium text-muted-foreground">
                                                                        <Clock className={cn("h-3 w-3", isOnline ? "text-emerald-500/70" : "text-slate-400")} />
                                                                        <span className="min-w-0 break-words">{formatSgpConnectionDetails(contract)}</span>
                                                                    </div>

                                                                    <div className="mt-3 flex gap-2">
                                                                        <Button
                                                                            variant="outline"
                                                                            size="sm"
                                                                            className="h-7 flex-1 border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-zinc-800 dark:text-slate-300 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400"
                                                                            title="Abrir Chamado Tecnico"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                handleOpenSgpOrderDialog(contract);
                                                                            }}
                                                                        >
                                                                            <Wrench className="mr-1.5 h-3 w-3 text-emerald-500" /> Abrir Chamado
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <p className="py-3 text-center text-[12px] text-slate-500 dark:text-zinc-500">Nenhum contrato retornado pelo SGP.</p>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between px-1">
                                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-500">Faturas</h4>
                                                <span className={cn("text-[12px] font-bold tabular-nums", hasSgpDebt ? "text-red-500" : "text-emerald-500")}>
                                                    {sgpOverdueInvoices} vencida{sgpOverdueInvoices === 1 ? '' : 's'}
                                                </span>
                                            </div>

                                            {sgpInvoices.length > 0 ? (
                                                sgpInvoices.map((invoice) => {
                                                    const canGeneratePix = Boolean(invoice.pixCode || invoice.contractId);

                                                    return (
                                                        <div
                                                            key={invoice.id}
                                                            className={cn(
                                                                "group flex flex-col rounded-xl border p-2 transition-all",
                                                                invoice.isOverdue
                                                                    ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10 dark:border-red-500/20"
                                                                    : "border-slate-200/80 bg-white/90 hover:bg-slate-100 dark:border-white/5 dark:bg-[#07080b] dark:hover:bg-white/5"
                                                            )}
                                                        >
                                                            <div className="flex min-w-0 items-start justify-between gap-3">
                                                                <div className="flex min-w-0 items-center gap-3">
                                                                    <div
                                                                        className={cn(
                                                                            "flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm shrink-0",
                                                                            invoice.isOverdue
                                                                                ? "border-red-200 bg-white text-red-500 dark:border-red-900/50 dark:bg-black/50"
                                                                                : "border-slate-200 bg-slate-100 text-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-emerald-400"
                                                                        )}
                                                                    >
                                                                        <Receipt className="h-4 w-4" />
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <span className={cn("block text-[13px] font-bold", invoice.isOverdue ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-200")}>
                                                                            {formatSgpCurrency(invoice.correctedAmount || invoice.amount)}
                                                                        </span>
                                                                        <span className={cn("block text-[10px] font-semibold uppercase tracking-widest", invoice.isOverdue ? "text-red-500/80" : "text-slate-500")}>
                                                                            Venc.: {formatSgpDate(invoice.dueDate) || 'Sem data'}
                                                                        </span>
                                                                        <span className="mt-1 block truncate text-[10px] text-muted-foreground" title={`Status: ${invoice.status} ${invoice.daysLate > 0 ? `• ${invoice.daysLate} dia(s) atraso` : ''}`}>
                                                                            Status: {invoice.status} {invoice.daysLate > 0 ? `• ${invoice.daysLate} dia(s) atraso` : ''}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <Button
                                                                    variant={invoice.isOverdue ? "ghost" : "outline"}
                                                                    size="sm"
                                                                    className={cn(
                                                                        "h-7 text-[10px] font-bold uppercase tracking-wider",
                                                                        invoice.isOverdue
                                                                            ? "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:bg-black dark:hover:bg-red-900/60"
                                                                            : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                                                                    )}
                                                                    disabled={!canGeneratePix || sgpPixLoadingInvoiceId === invoice.id}
                                                                    onClick={() => handleGenerateSgpPix(invoice)}
                                                                >
                                                                    {sgpPixLoadingInvoiceId === invoice.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'PIX'}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <p className="py-3 text-center text-[12px] text-slate-500 dark:text-zinc-500">Nenhuma fatura retornada pelo SGP.</p>
                                            )}
                                        </div>
                                    </>
                                )}

                                {false && (
                                    <>
                                {/* OVERALL STATUS */}
                                <div className="flex items-center justify-between p-3 rounded-xl border border-red-500/30 bg-red-500/10 dark:bg-red-500/5">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 text-red-500 shrink-0">
                                            <AlertTriangle className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-[13px] font-bold text-red-600 dark:text-red-400">Cliente Inadimplente</h4>
                                            <p className="text-[11px] font-medium text-red-500/80">O cliente possui faturas em atraso.</p>
                                        </div>
                                    </div>
                                </div>

                                {/* CONTRACTS */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between px-1">
                                        <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-500">Contratos (2)</h4>
                                    </div>
                                    
                                    {/* Contract 1 (Online) */}
                                    <div 
                                        className={cn(
                                            "relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-sm transition-all dark:border-white/5 dark:bg-[#07080b]",
                                            expandedContractId === '1' ? "border-emerald-500/30 bg-emerald-500/5 ring-1 ring-emerald-500/20" : "hover:border-emerald-500/30 hover:bg-emerald-500/5 cursor-pointer"
                                        )}
                                    >
                                        <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/50" />
                                        <div 
                                            className={cn("flex justify-between items-start p-3")}
                                            onClick={() => setExpandedContractId(expandedContractId === '1' ? null : '1')}
                                        >
                                            <div className="flex gap-2 w-full">
                                                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
                                                    <Router className="h-4 w-4 text-emerald-500" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h5 className="text-[13px] font-bold text-slate-800 dark:text-slate-200">Fibra 500MB Residencial</h5>
                                                        <span className="flex shrink-0 h-4 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[9px] font-bold uppercase text-emerald-500">
                                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                            Online
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate border-none outline-none">IP: 177.100.22.45 • MAC: 00:1A:2B:3C:4D:5E</p>
                                                    <div className="flex items-start gap-1 text-[9.5px] text-muted-foreground/80 mt-1 leading-tight">
                                                        <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                                        <span className="line-clamp-2">Av. Paulista, 1500, Apt 42 - Bela Vista, São Paulo - SP</span>
                                                    </div>
                                                </div>
                                                <div className="shrink-0 pt-1 text-slate-400">
                                                    {expandedContractId === '1' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {expandedContractId === '1' && (
                                            <div className="px-3 pb-3 animate-in slide-in-from-top-1 duration-200">
                                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/50 dark:border-white/10">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                            <Download className="h-3 w-3" /> Download
                                                        </span>
                                                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300">452 GB</span>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                            <Upload className="h-3 w-3" /> Upload
                                                        </span>
                                                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300">120 GB</span>
                                                    </div>
                                                </div>
                                                <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                                                    <Clock className="h-3 w-3 text-emerald-500/70" /> Conectado há 14 dias
                                                </div>
                                                <div className="mt-3 flex gap-2">
                                                    <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] font-bold hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 border-slate-200 dark:border-zinc-800" onClick={(e) => e.stopPropagation()}>
                                                        Desconectar
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] font-bold hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300" title="Abrir Chamado Técnico" onClick={(e) => e.stopPropagation()}>
                                                        <Wrench className="h-3 w-3 mr-1.5 text-emerald-500" /> Abrir Chamado
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] font-bold hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300" title="Ler Chamados" onClick={(e) => e.stopPropagation()}>
                                                        <FileText className="h-3 w-3 mr-1.5" /> Histórico
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Contract 2 (Offline) */}
                                    <div 
                                        className={cn(
                                            "relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-sm transition-all dark:border-white/5 dark:bg-[#07080b]",
                                            expandedContractId === '2' ? "border-slate-300 bg-slate-50 ring-1 ring-slate-200 dark:border-white/10 dark:bg-white/5/50 opacity-100" : "hover:bg-slate-50 dark:hover:bg-white/5 opacity-70 cursor-pointer"
                                        )}
                                    >
                                        <div className="absolute top-0 left-0 w-1 h-full bg-slate-300 dark:bg-slate-700" />
                                        <div 
                                            className={cn("flex justify-between items-start p-3")}
                                            onClick={() => setExpandedContractId(expandedContractId === '2' ? null : '2')}
                                        >
                                            <div className="flex gap-2 w-full">
                                                <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-zinc-700 shrink-0">
                                                    <Router className="h-4 w-4 text-slate-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h5 className="text-[13px] font-bold text-slate-800 dark:text-slate-200">Rádio 50MB Backup</h5>
                                                        <span className="flex shrink-0 h-4 items-center gap-1 rounded-full border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 px-1.5 text-[9px] font-bold uppercase text-slate-500">
                                                            <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                                            Offline
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">PPPoE: cliente_bkp</p>
                                                    <div className="flex items-start gap-1 text-[9.5px] text-muted-foreground/80 mt-1 leading-tight">
                                                        <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                                        <span className="line-clamp-2">Av. Paulista, 1500, Apt 42 - Bela Vista, São Paulo - SP</span>
                                                    </div>
                                                </div>
                                                <div className="shrink-0 pt-1 text-slate-400">
                                                    {expandedContractId === '2' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </div>
                                            </div>
                                        </div>

                                        {expandedContractId === '2' && (
                                            <div className="px-3 pb-3 animate-in slide-in-from-top-1 duration-200">
                                                <div className="mt-1 flex gap-2 pt-2 border-t border-slate-200/50 dark:border-white/10">
                                                    <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] font-bold hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300" title="Abrir Chamado Técnico" onClick={(e) => e.stopPropagation()}>
                                                        <Wrench className="h-3 w-3 mr-1.5 text-emerald-500" /> Abrir Chamado
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] font-bold hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300" title="Ler Chamados" onClick={(e) => e.stopPropagation()}>
                                                        <FileText className="h-3 w-3 mr-1.5" /> Histórico
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* INVOICES */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between px-1">
                                        <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-500">Faturas</h4>
                                        <span className="text-[12px] font-bold text-red-500 tabular-nums">1 vencida</span>
                                    </div>

                                    {/* Overdue Invoice */}
                                    <div className="group flex flex-col rounded-xl border border-red-500/30 bg-red-500/5 p-2 transition-all hover:bg-red-500/10 dark:border-red-500/20">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-lg bg-white dark:bg-black/50 shadow-sm flex items-center justify-center border border-red-200 dark:border-red-900/50 shrink-0">
                                                    <Receipt className="h-4 w-4 text-red-500" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <span className="block text-[13px] font-bold text-red-600 dark:text-red-400">R$ 149,90</span>
                                                    <span className="block text-[10px] uppercase tracking-widest text-red-500/80 font-semibold">Venc.: 10/11/2023</span>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" className="h-7 bg-white dark:bg-black border border-red-200 dark:border-red-900/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/60 text-[10px] font-bold uppercase tracking-wider">
                                                Pix
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Open Invoice */}
                                    <div className="group flex flex-col rounded-xl border border-slate-200/80 bg-white/90 p-2 transition-all hover:bg-slate-100 dark:border-white/5 dark:bg-[#07080b] dark:hover:bg-white/5">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-zinc-800 shadow-sm flex items-center justify-center border border-slate-200 dark:border-zinc-700 shrink-0">
                                                    <Receipt className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <span className="block text-[13px] font-bold text-slate-800 dark:text-slate-200">R$ 149,90</span>
                                                    <span className="block text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Venc.: 10/12/2023</span>
                                                </div>
                                            </div>
                                            <Button variant="outline" size="sm" className="h-7 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100">
                                                Pix
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                    </>
                                )}
                            </TabsContent>
                        )}
                    </Tabs>
                </div>
            </ScrollArea>
            <Dialog
                open={isSgpOrderDialogOpen}
                onOpenChange={(open) => {
                    if (!isSubmittingSgpOrder) {
                        setIsSgpOrderDialogOpen(open);
                    }

                    if (!open && !isSubmittingSgpOrder) {
                        setSgpOrderContract(null);
                        setSgpOrderNotes('');
                    }
                }}
            >
                <DialogContent className="border-border bg-popover text-foreground">
                    <DialogHeader>
                        <DialogTitle>Abrir chamado no SGP</DialogTitle>
                        <DialogDescription>
                            {sgpOrderContract
                                ? `Contrato ${sgpOrderContract.id} - ${sgpOrderContract.planDescription}`
                                : 'Selecione um contrato para abrir o chamado.'}
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleCreateSgpOrder} className="space-y-4">
                        {sgpOrderContract && (
                            <div className="rounded-lg border border-border bg-muted/30 p-3">
                                <p className="text-sm font-semibold text-foreground">{sgpOrderContract.planDescription}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{sgpOrderContract.addressLabel}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Status: {sgpOrderContract.statusLabel} • Contrato {sgpOrderContract.id}
                                </p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="sgp-order-notes">Descricao do chamado</Label>
                            <Textarea
                                id="sgp-order-notes"
                                value={sgpOrderNotes}
                                onChange={(event) => setSgpOrderNotes(event.target.value)}
                                rows={5}
                                placeholder="Descreva o motivo do atendimento para envio ao SGP."
                                className="border-input bg-muted/50 text-foreground"
                                required
                            />
                            <p className="text-xs text-muted-foreground">
                                O texto acima sera enviado como conteudo do chamado na URA do SGP.
                            </p>
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    setIsSgpOrderDialogOpen(false);
                                    setSgpOrderContract(null);
                                    setSgpOrderNotes('');
                                }}
                                disabled={isSubmittingSgpOrder}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={isSubmittingSgpOrder || !sgpOrderNotes.trim()}>
                                {isSubmittingSgpOrder && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Criar Chamado
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
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

