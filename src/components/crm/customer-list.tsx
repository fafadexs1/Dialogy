'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BriefcaseBusiness,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Download,
    UploadCloud,
    Edit,
    Eye,
    ListFilter,
    Loader2,
    MoreHorizontal,
    Phone,
    PhoneOff,
    Plus,
    PlusCircle,
    Search,
    Settings,
    Tags,
    Trash2,
    UserRound,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { AddContactForm } from './add-contact-form';
import { AddActivityForm } from './add-activity-form';
import { CrmSettings } from './crm-settings';
import CustomerProfile from './customer-profile';
import { LogAttemptForm } from './log-attempt-form';
import { SegmentBuilder } from './segment-builder';
import {
    createSegment,
    deleteContactAction,
    deleteSegment,
    getContacts,
    getCustomFieldDefinitions,
    getSegments,
    getTags,
    getWorkspaceUsers,
} from '@/actions/crm';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CriteriaGroup } from '@/lib/crm-query-builder';
import { Contact, CustomFieldDefinition, Segment, Tag, User } from '@/lib/types';

type ContactAction = 'view' | 'edit' | 'logAttempt' | 'addActivity' | 'delete';
type DateFilter = 'all' | '7d' | '30d' | 'inactive';

const DATE_FILTERS: {
    id: DateFilter;
    label: string;
    description: string;
    icon: LucideIcon;
}[] = [
    { id: 'all', label: 'Todos', description: 'Sem filtro de data', icon: Users },
    { id: '7d', label: '7 dias', description: 'Contato recente', icon: Clock3 },
    { id: '30d', label: '30 dias', description: 'Aquecidos no mes', icon: CalendarClock },
    { id: 'inactive', label: 'Sem contato', description: '+30 dias ou vazio', icon: PhoneOff },
];

function getInitials(name?: string | null) {
    const cleanName = (name || 'Contato').trim();
    const parts = cleanName.split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || 'C') + (parts[1]?.[0] || '');
}

function getPhoneLabel(contact: Contact) {
    const raw = contact.phone || contact.phone_number_jid || contact.phone_canonical || '';
    return raw.replace('@s.whatsapp.net', '') || 'Sem telefone';
}

function formatLastActivity(value?: string | null) {
    if (!value) {
        return {
            label: 'Sem registro',
            detail: 'Nenhuma mensagem ou atividade',
            tone: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500',
        };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return {
            label: 'Data invalida',
            detail: String(value),
            tone: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500',
        };
    }

    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    const tone = days <= 7
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-400/10 dark:text-emerald-200'
        : days <= 30
            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100'
            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100';

    return {
        label: formatDistanceToNow(date, { addSuffix: true, locale: ptBR }),
        detail: format(date, "dd/MM/yyyy 'as' HH:mm", { locale: ptBR }),
        tone,
    };
}

function buildDateCriteria(filter: DateFilter): CriteriaGroup | undefined {
    const today = new Date();
    if (filter === '7d') {
        return {
            operator: 'AND',
            conditions: [{ field: 'last_activity', operator: 'gte', value: format(subDays(today, 7), 'yyyy-MM-dd') }],
        };
    }
    if (filter === '30d') {
        return {
            operator: 'AND',
            conditions: [{ field: 'last_activity', operator: 'gte', value: format(subDays(today, 30), 'yyyy-MM-dd') }],
        };
    }
    if (filter === 'inactive') {
        return {
            operator: 'OR',
            conditions: [
                { field: 'last_activity', operator: 'lt', value: format(subDays(today, 30), 'yyyy-MM-dd') },
                { field: 'last_activity', operator: 'is_not_set' },
            ],
        };
    }
    return undefined;
}

function TableActions({ contact, onSelect }: { contact: Contact; onSelect: (action: ContactAction, contact: Contact) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Ações de ${contact.name || 'contato'}`} className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-slate-200 bg-white text-slate-700 shadow-xl dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                <DropdownMenuItem onClick={() => onSelect('view', contact)} className="focus:bg-emerald-50 focus:text-emerald-800 dark:focus:bg-emerald-400/10 dark:focus:text-emerald-100">
                    <Eye className="mr-2 h-4 w-4" /> Ver detalhes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('logAttempt', contact)} className="focus:bg-emerald-50 focus:text-emerald-800 dark:focus:bg-emerald-400/10 dark:focus:text-emerald-100">
                    <PhoneOff className="mr-2 h-4 w-4" /> Registrar tentativa
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('addActivity', contact)} className="focus:bg-emerald-50 focus:text-emerald-800 dark:focus:bg-emerald-400/10 dark:focus:text-emerald-100">
                    <PlusCircle className="mr-2 h-4 w-4" /> Adicionar atividade
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSelect('edit', contact); }} className="focus:bg-emerald-50 focus:text-emerald-800 dark:focus:bg-emerald-400/10 dark:focus:text-emerald-100">
                    <Edit className="mr-2 h-4 w-4" /> Editar contato
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('delete', contact)} className="text-rose-600 focus:bg-rose-50 focus:text-rose-700 dark:text-rose-300 dark:focus:bg-rose-500/10 dark:focus:text-rose-200">
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir contato
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default function CustomerList({ user }: { user: User }) {
    const [customers, setCustomers] = useState<Contact[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [agents, setAgents] = useState<User[]>([]);
    const [segments, setSegments] = useState<Segment[]>([]);
    const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);

    const [loading, setLoading] = useState(true);
    const [exportingSegmentId, setExportingSegmentId] = useState<string | null>(null);
    const [syncingSegmentId, setSyncingSegmentId] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isSegmentBuilderOpen, setIsSegmentBuilderOpen] = useState(false);

    const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
    const [dateFilter, setDateFilter] = useState<DateFilter>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [totalItems, setTotalItems] = useState(0);

    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
    const [isLogAttemptModalOpen, setIsLogAttemptModalOpen] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact | null>(null);

    const selectedSegment = useMemo(
        () => segments.find((segment) => segment.id === selectedSegmentId) || null,
        [segments, selectedSegmentId]
    );

    const dateCriteria = useMemo(() => buildDateCriteria(dateFilter), [dateFilter]);
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startItem = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);

        try {
            if (tags.length === 0 || agents.length === 0 || segments.length === 0 || customFields.length === 0) {
                const [tagsRes, agentsRes, segmentsRes, customFieldsRes] = await Promise.all([
                    getTags(user.activeWorkspaceId),
                    getWorkspaceUsers(user.activeWorkspaceId),
                    getSegments(user.activeWorkspaceId),
                    getCustomFieldDefinitions(user.activeWorkspaceId),
                ]);
                if (tagsRes.tags) setTags(tagsRes.tags);
                if (agentsRes.users) setAgents(agentsRes.users);
                if (segmentsRes.segments) setSegments(segmentsRes.segments);
                if (customFieldsRes.fields) setCustomFields(customFieldsRes.fields);
            }

            const contactsRes = await getContacts(user.activeWorkspaceId, {
                page: currentPage,
                limit: itemsPerPage,
                search: searchTerm,
                segmentId: selectedSegmentId || undefined,
                criteria: dateCriteria,
            });

            if (contactsRes.error) throw new Error(contactsRes.error);
            setCustomers(contactsRes.contacts || []);
            setTotalItems(contactsRes.total || 0);
        } catch (error: any) {
            toast({ title: 'Erro ao carregar CRM', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [
        agents.length,
        currentPage,
        customFields.length,
        dateCriteria,
        itemsPerPage,
        searchTerm,
        segments.length,
        selectedSegmentId,
        tags.length,
        user?.activeWorkspaceId,
    ]);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            fetchData();
        }
    }, [fetchData, refreshKey, user?.activeWorkspaceId]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, selectedSegmentId, dateFilter]);

    useEffect(() => {
        if (selectedContact) {
            const updated = customers.find((contact) => contact.id === selectedContact.id);
            if (updated && updated !== selectedContact) {
                setSelectedContact(updated);
            }
        }
    }, [customers, selectedContact]);

    const handleSaveSegment = async (criteria: CriteriaGroup, name: string, description: string) => {
        if (!user.activeWorkspaceId) return;
        setLoading(true);
        const res = await createSegment(user.activeWorkspaceId, name, description, criteria);
        if (res.success) {
            toast({ title: 'Lista criada com sucesso' });
            setIsSegmentBuilderOpen(false);
            const segmentsRes = await getSegments(user.activeWorkspaceId);
            if (segmentsRes.segments) setSegments(segmentsRes.segments);
        } else {
            toast({ title: 'Erro ao criar lista', description: res.error, variant: 'destructive' });
        }
        setLoading(false);
    };

    const handleDeleteSegment = async (event: React.MouseEvent, segmentId: string) => {
        event.stopPropagation();
        if (!confirm('Tem certeza que deseja apagar esta lista? Esta acao nao pode ser desfeita.')) return;

        setLoading(true);
        const res = await deleteSegment(segmentId);
        if (res.success) {
            toast({ title: 'Lista apagada com sucesso' });
            if (selectedSegmentId === segmentId) setSelectedSegmentId(null);
            const segmentsRes = await getSegments(user.activeWorkspaceId!);
            if (segmentsRes.segments) setSegments(segmentsRes.segments);
        } else {
            toast({ title: 'Erro ao apagar lista', description: res.error, variant: 'destructive' });
        }
        setLoading(false);
    };

    const handleExportSegment = async (segment: Segment) => {
        setExportingSegmentId(segment.id);
        try {
            const response = await fetch(`/api/crm/segments/${encodeURIComponent(segment.id)}/google-ads`);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error || 'Falha ao gerar o CSV.');
            }

            const blob = await response.blob();
            const disposition = response.headers.get('content-disposition') || '';
            const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'lista-crm-google-ads.csv';
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = downloadUrl;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(downloadUrl);

            const exportedCount = response.headers.get('x-exported-contacts');
            const skippedCount = Number(response.headers.get('x-skipped-contacts') || 0);
            toast({
                title: 'CSV do Google Ads gerado',
                description: `${exportedCount || 'Os'} contato(s) exportado(s)${skippedCount > 0 ? `; ${skippedCount} sem e-mail ou telefone foram ignorados.` : '.'}`,
            });
        } catch (error) {
            toast({
                title: 'Erro ao exportar lista',
                description: error instanceof Error ? error.message : 'Não foi possível gerar o CSV.',
                variant: 'destructive',
            });
        } finally {
            setExportingSegmentId(null);
        }
    };

    /**
     * Sincroniza a lista direto como publico de Customer Match, sem CSV manual.
     * Os contatos sobem apenas com hash SHA-256.
     */
    const handleSyncSegmentToGoogleAds = async (segment: Segment) => {
        const workspaceId = user.activeWorkspaceId;
        if (!workspaceId) return;
        setSyncingSegmentId(segment.id);
        try {
            const { syncSegmentToGoogleAdsAudience } = await import('@/actions/google-ads');
            const { result, error } = await syncSegmentToGoogleAdsAudience(workspaceId, segment.id);

            if (error || !result) {
                toast({
                    title: 'Erro ao sincronizar público',
                    description: error || 'Não foi possível sincronizar com o Google Ads.',
                    variant: 'destructive',
                });
                return;
            }

            toast({
                title: 'Público sincronizado',
                description:
                    `${result.uploadedCount} contato(s) enviados para "${result.userListName}"` +
                    `${result.skippedCount > 0 ? `; ${result.skippedCount} sem e-mail ou telefone foram ignorados.` : '.'}` +
                    ' O Google leva algumas horas para processar a lista.',
            });
        } finally {
            setSyncingSegmentId(null);
        }
    };

    const handleAction = useCallback(async (action: ContactAction, contact: Contact) => {
        setSelectedContact(contact);
        switch (action) {
            case 'view':
                setIsProfileOpen(true);
                break;
            case 'edit':
                setEditingContact(contact);
                setIsAddEditModalOpen(true);
                break;
            case 'addActivity':
                setIsActivityModalOpen(true);
                break;
            case 'logAttempt':
                setIsLogAttemptModalOpen(true);
                break;
            case 'delete':
                if (window.confirm(`Tem certeza que deseja excluir o contato "${contact.name}"?`)) {
                    const result = await deleteContactAction(contact.id);
                    if (result.success) {
                        toast({ title: 'Contato excluido' });
                        setRefreshKey((prev) => prev + 1);
                    } else {
                        toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive' });
                    }
                }
                break;
        }
    }, []);

    const handleSaveSuccess = useCallback(() => {
        setIsAddEditModalOpen(false);
        setEditingContact(null);
        setIsActivityModalOpen(false);
        setIsLogAttemptModalOpen(false);
        setRefreshKey((prev) => prev + 1);
    }, []);

    const getTagStyle = (tagValue: string) => {
        const tag = tags.find((item) => item.value === tagValue);
        if (!tag) return {};
        return {
            backgroundColor: `${tag.color}24`,
            color: tag.color,
            borderColor: `${tag.color}55`,
        };
    };

    return (
        <div className="flex h-full flex-1 overflow-hidden bg-[#f4f6f2] text-slate-900 dark:bg-[#090e0c] dark:text-zinc-100">
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f6f2] dark:bg-[#090e0c]">
                <div className="shrink-0 px-4 pt-4 lg:px-7 lg:pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <h1 className="text-[23px] font-semibold tracking-[-0.04em] text-[#132b20] dark:text-white">Contatos</h1>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">{totalItems.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CrmSettings user={user}>
                                <Button variant="outline" size="icon" title="Configurações do CRM" aria-label="Configurações do CRM" className="h-9 w-9 rounded-xl border-[#dfe8dd] bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"><Settings className="h-4 w-4" /></Button>
                            </CrmSettings>
                            <Button className="h-9 rounded-xl bg-[#164e34] px-4 text-xs font-semibold text-white hover:bg-[#0b6b42] dark:bg-emerald-400 dark:text-[#092015] dark:hover:bg-emerald-300" onClick={() => { setEditingContact(null); setIsAddEditModalOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Novo contato</Button>
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[18px] border border-[#e1e9df] bg-white p-2 shadow-[0_10px_28px_-25px_rgba(14,47,27,.35)] dark:border-white/10 dark:bg-[#121b16]">
                        <Select value={selectedSegmentId || 'all'} onValueChange={(value) => setSelectedSegmentId(value === 'all' ? null : value)}>
                            <SelectTrigger aria-label="Selecionar lista" className="h-9 w-full shrink-0 rounded-xl border-[#dfe8dd] bg-[#f7f9f5] text-xs font-semibold text-[#23402d] dark:border-white/10 dark:bg-white/[0.04] dark:text-white sm:w-[215px]">
                                <ListFilter className="mr-2 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" /><SelectValue placeholder="Selecionar lista" />
                            </SelectTrigger>
                            <SelectContent className="border-[#dfe8dd] bg-white text-slate-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                                <SelectItem value="all">Todos os contatos</SelectItem>
                                {segments.map((segment) => <SelectItem key={segment.id} value={segment.id}>{segment.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <div className="relative min-w-[190px] flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input type="search" placeholder="Buscar nome, telefone ou e-mail" aria-label="Buscar contatos" className="h-9 rounded-xl border-[#dfe8dd] bg-white pl-9 text-xs dark:border-white/10 dark:bg-white/[0.04] dark:text-white" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
                        </div>
                        <Button variant="outline" size="sm" className="h-9 shrink-0 rounded-xl border-[#dfe8dd] bg-white px-3 text-xs font-semibold text-emerald-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-emerald-200" onClick={() => setIsSegmentBuilderOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" /> Nova lista</Button>
                        {selectedSegment && <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" title="Ações da lista" aria-label="Ações da lista" className="h-9 w-9 shrink-0 rounded-xl border-[#dfe8dd] bg-white dark:border-white/10 dark:bg-white/[0.04]"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60 border-[#dfe8dd] bg-white dark:border-white/10 dark:bg-zinc-950">
                                <DropdownMenuItem disabled={exportingSegmentId === selectedSegment.id} onClick={() => handleExportSegment(selectedSegment)}><Download className="mr-2 h-4 w-4" /> Baixar CSV</DropdownMenuItem>
                                <DropdownMenuItem disabled={syncingSegmentId === selectedSegment.id} onClick={() => handleSyncSegmentToGoogleAds(selectedSegment)}><UploadCloud className="mr-2 h-4 w-4" /> Sincronizar com Google Ads</DropdownMenuItem>
                                <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={(event) => handleDeleteSegment(event, selectedSegment.id)}><Trash2 className="mr-2 h-4 w-4" /> Excluir lista</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>}
                    </div>

                    <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
                        <span className="hidden shrink-0 pr-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 md:inline">Atividade</span>
                        {DATE_FILTERS.map((filter) => { const Icon = filter.icon; const active = dateFilter === filter.id; return <Button key={filter.id} variant="outline" size="sm" className={cn('h-8 shrink-0 rounded-full px-3 text-[11px] font-semibold', active ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200' : 'border-transparent bg-transparent text-slate-500 hover:border-[#dfe8dd] hover:bg-white dark:text-zinc-400 dark:hover:border-white/10 dark:hover:bg-white/[0.04]')} onClick={() => setDateFilter(filter.id)}><Icon className="mr-1.5 h-3.5 w-3.5" />{filter.label}</Button>; })}
                        {selectedSegment && <span className="ml-auto hidden shrink-0 text-xs text-slate-400 lg:inline">Lista: {selectedSegment.name}</span>}
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 lg:px-7 lg:pb-5 lg:pt-2">
                    <section className="overflow-hidden rounded-[22px] border border-[#e1e9df] bg-white shadow-[0_12px_36px_-28px_rgba(14,47,27,.35)] dark:border-white/10 dark:bg-[#121b16]">
                        <div className="hidden overflow-x-auto xl:block"><Table className="min-w-[880px]">
                            <TableHeader className="bg-slate-50/80 dark:bg-white/[0.04]">
                                <TableRow className="border-slate-200 hover:bg-transparent dark:border-white/10">
                                    <TableHead className="min-w-[280px] text-xs font-semibold text-slate-600 dark:text-zinc-400">Contato</TableHead>
                                    <TableHead className="min-w-[180px] text-xs font-semibold text-slate-600 dark:text-zinc-400">Responsavel</TableHead>
                                    <TableHead className="min-w-[180px] text-xs font-semibold text-slate-600 dark:text-zinc-400">Tags</TableHead>
                                    <TableHead className="min-w-[210px] text-xs font-semibold text-slate-600 dark:text-zinc-400">Ultima atividade</TableHead>
                                    <TableHead className="w-20 text-center text-xs font-semibold text-slate-600 dark:text-zinc-400">Acoes</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow className="border-slate-200 hover:bg-slate-50/60 dark:border-white/10 dark:hover:bg-white/[0.02]">
                                        <TableCell colSpan={5} className="h-56 text-center">
                                            <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-600 dark:text-emerald-300" />
                                            <p className="mt-3 text-sm text-slate-500 dark:text-zinc-500">Carregando contatos...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : customers.length === 0 ? (
                                    <TableRow className="border-slate-200 hover:bg-slate-50/60 dark:border-white/10 dark:hover:bg-white/[0.02]">
                                        <TableCell colSpan={5} className="h-56 text-center">
                                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-500">
                                                <Search className="h-6 w-6" />
                                            </div>
                                            <p className="mt-4 text-base font-semibold text-slate-900 dark:text-white">Nenhum contato encontrado</p>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-zinc-500">Ajuste a busca, data ou lista selecionada.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : customers.map((customer) => {
                                    const activity = formatLastActivity(customer.last_activity);
                                    return (
                                        <TableRow
                                            key={customer.id}
                                            className="group border-slate-200 transition-colors hover:bg-emerald-50/50 dark:border-white/10 dark:hover:bg-emerald-400/[0.045]"
                                        >
                                            <TableCell className="py-3">
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-10 w-10 border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]">
                                                        <AvatarImage src={customer.avatar_url || undefined} alt={customer.name} />
                                                        <AvatarFallback className="bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-100">
                                                            {getInitials(customer.name)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAction('view', customer)}
                                                            className="block max-w-[280px] truncate text-left text-sm font-bold text-slate-900 underline-offset-4 hover:text-emerald-700 hover:underline dark:text-white dark:hover:text-emerald-200"
                                                        >
                                                            {customer.name || 'Contato sem nome'}
                                                        </button>
                                                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-500">
                                                            <Phone className="h-3.5 w-3.5" />
                                                            <span className="truncate">{getPhoneLabel(customer)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {customer.owner?.name ? (
                                                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-zinc-200">
                                                        <UserRound className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                                                        <span className="truncate">{customer.owner.name}</span>
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500">
                                                        <BriefcaseBusiness className="h-3.5 w-3.5" />
                                                        Sem vendedor
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {customer.tags?.length ? (
                                                    <div className="flex max-w-[240px] flex-wrap gap-1.5">
                                                        {customer.tags.slice(0, 3).map((tag) => (
                                                            <Badge
                                                                key={tag.id}
                                                                style={getTagStyle(tag.value)}
                                                                className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                                                            >
                                                                {tag.label}
                                                            </Badge>
                                                        ))}
                                                        {customer.tags.length > 3 && (
                                                            <Badge className="rounded-full border border-slate-200 bg-slate-50 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                                                                +{customer.tags.length - 3}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-500">
                                                        <Tags className="h-3.5 w-3.5" />
                                                        Sem tags
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <div className={cn('inline-flex flex-col rounded-lg border px-3 py-1.5 text-xs', activity.tone)}>
                                                    <span className="font-bold">{activity.label}</span>
                                                    <span className="mt-0.5 text-[11px] opacity-70">{activity.detail}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-3 text-center">
                                                <TableActions contact={customer} onSelect={handleAction} />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table></div>

                        <div className="divide-y divide-[#e9eee7] dark:divide-white/10 xl:hidden">
                            {loading ? <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> Carregando contatos...</div>
                                : customers.length === 0 ? <div className="flex min-h-36 flex-col items-center justify-center px-4 text-center"><Search className="mb-2 h-5 w-5 text-emerald-600" /><p className="text-sm font-semibold text-[#142d20] dark:text-white">Nenhum contato encontrado</p><p className="mt-1 text-xs text-slate-500">Ajuste a busca ou os filtros.</p></div>
                                    : customers.map((customer) => {
                                        const activity = formatLastActivity(customer.last_activity);
                                        return <article key={customer.id} className="p-4 transition-colors hover:bg-emerald-50/40 dark:hover:bg-white/[0.025]">
                                            <div className="flex items-start gap-3">
                                                <Avatar className="h-10 w-10 shrink-0 border border-emerald-100 dark:border-white/10"><AvatarImage src={customer.avatar_url || undefined} alt={customer.name} /><AvatarFallback className="bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">{getInitials(customer.name)}</AvatarFallback></Avatar>
                                                <div className="min-w-0 flex-1"><button type="button" onClick={() => handleAction('view', customer)} className="block max-w-full truncate text-left text-sm font-semibold text-[#142d20] hover:text-emerald-700 dark:text-white dark:hover:text-emerald-300">{customer.name || 'Contato sem nome'}</button><p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400"><Phone className="h-3 w-3 shrink-0" /><span className="truncate">{getPhoneLabel(customer)}</span></p></div>
                                                <TableActions contact={customer} onSelect={handleAction} />
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px] text-[11px]"><span className="inline-flex items-center gap-1 text-slate-500 dark:text-zinc-400"><UserRound className="h-3 w-3" />{customer.owner?.name || 'Sem responsável'}</span><span className={cn('rounded-full border px-2 py-0.5 font-medium', activity.tone)}>{activity.label}</span></div>
                                            {customer.tags?.length ? <div className="mt-2 flex flex-wrap gap-1 pl-[52px]">{customer.tags.slice(0, 3).map((tag) => <Badge key={tag.id} style={getTagStyle(tag.value)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">{tag.label}</Badge>)}{customer.tags.length > 3 && <span className="text-[11px] text-slate-400">+{customer.tags.length - 3}</span>}</div> : null}
                                        </article>;
                                    })}
                        </div>

                        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.025] dark:text-zinc-500 lg:flex-row lg:items-center lg:justify-between">
                            <span>{`Mostrando ${startItem}-${endItem} de ${totalItems} contatos`}</span>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-2">
                                    <span>Linhas:</span>
                                    <Select value={String(itemsPerPage)} onValueChange={(value) => setItemsPerPage(Number(value))}>
                                        <SelectTrigger className="h-9 w-20 rounded-lg border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-black/30 dark:text-zinc-200">
                                            <SelectValue placeholder={itemsPerPage} />
                                        </SelectTrigger>
                                        <SelectContent className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="25">25</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="100">100</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 dark:border-white/10 dark:bg-black/30 dark:text-zinc-200">
                                    Pagina {currentPage} de {totalPages || 1}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 rounded-lg border border-slate-200 text-slate-400 hover:bg-white hover:text-slate-700 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                                    onClick={() => setCurrentPage((page) => page - 1)}
                                    disabled={currentPage === 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 rounded-lg border border-slate-200 text-slate-400 hover:bg-white hover:text-slate-700 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                                    onClick={() => setCurrentPage((page) => page + 1)}
                                    disabled={currentPage === totalPages || totalPages === 0}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>

                {user.activeWorkspaceId && (
                    <AddContactForm
                        isOpen={isAddEditModalOpen}
                        setIsOpen={setIsAddEditModalOpen}
                        onSave={handleSaveSuccess}
                        contact={editingContact}
                        workspaceId={user.activeWorkspaceId}
                        agents={agents}
                        user={user}
                    />
                )}

                {user.activeWorkspaceId && isSegmentBuilderOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm dark:bg-black/85">
                        <div className="w-full max-w-3xl animate-in fade-in zoom-in duration-200">
                            <SegmentBuilder
                                tags={tags}
                                customFields={customFields}
                                onCancel={() => setIsSegmentBuilderOpen(false)}
                                onSave={handleSaveSegment}
                            />
                        </div>
                    </div>
                )}

                {selectedContact && (
                    <>
                        <CustomerProfile
                            contact={selectedContact}
                            isOpen={isProfileOpen}
                            setIsOpen={setIsProfileOpen}
                            onAction={handleAction}
                            onMutate={() => setRefreshKey((key) => key + 1)}
                        />
                        <AddActivityForm
                            contact={selectedContact}
                            isOpen={isActivityModalOpen}
                            setIsOpen={setIsActivityModalOpen}
                            onSave={handleSaveSuccess}
                        />
                        <LogAttemptForm
                            contact={selectedContact}
                            isOpen={isLogAttemptModalOpen}
                            setIsOpen={setIsLogAttemptModalOpen}
                            onSave={handleSaveSuccess}
                        />
                    </>
                )}
            </main>
        </div>
    );
}
