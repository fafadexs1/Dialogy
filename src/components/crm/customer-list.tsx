'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BriefcaseBusiness,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Download,
    Edit,
    Eye,
    Filter,
    ListFilter,
    Loader2,
    MessageCircle,
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
import { Checkbox } from '@/components/ui/checkbox';
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
            tone: 'border-white/10 bg-white/[0.03] text-zinc-500',
        };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return {
            label: 'Data invalida',
            detail: String(value),
            tone: 'border-white/10 bg-white/[0.03] text-zinc-500',
        };
    }

    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    const tone = days <= 7
        ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
        : days <= 30
            ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
            : 'border-rose-400/30 bg-rose-400/10 text-rose-100';

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
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-zinc-400 hover:bg-white/10 hover:text-white">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-white/10 bg-zinc-950 text-zinc-100 shadow-2xl">
                <DropdownMenuItem onClick={() => onSelect('view', contact)} className="focus:bg-emerald-400/10 focus:text-emerald-100">
                    <Eye className="mr-2 h-4 w-4" /> Ver detalhes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('logAttempt', contact)} className="focus:bg-emerald-400/10 focus:text-emerald-100">
                    <PhoneOff className="mr-2 h-4 w-4" /> Registrar tentativa
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('addActivity', contact)} className="focus:bg-emerald-400/10 focus:text-emerald-100">
                    <PlusCircle className="mr-2 h-4 w-4" /> Adicionar atividade
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSelect('edit', contact); }} className="focus:bg-emerald-400/10 focus:text-emerald-100">
                    <Edit className="mr-2 h-4 w-4" /> Editar contato
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('delete', contact)} className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-200">
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
    const recentContacts = customers.filter((contact) => {
        if (!contact.last_activity) return false;
        return new Date(contact.last_activity).getTime() >= subDays(new Date(), 7).getTime();
    }).length;
    const withoutActivity = customers.filter((contact) => !contact.last_activity).length;

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
        refreshKey,
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
    }, [fetchData, user?.activeWorkspaceId]);

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
        <div className="flex h-full flex-1 overflow-hidden bg-black text-zinc-100">
            <aside className="hidden w-[292px] shrink-0 border-r border-white/10 bg-[#050807] p-5 lg:flex lg:flex-col">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300">CRM Dialogy</p>
                        <h2 className="mt-1 text-xl font-semibold text-white">Listas</h2>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full border border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 hover:text-white"
                        onClick={() => setIsSegmentBuilderOpen(true)}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>

                <Button
                    variant="ghost"
                    className={cn(
                        'mb-5 h-12 w-full justify-start rounded-2xl border px-4 text-sm font-semibold',
                        selectedSegmentId === null
                            ? 'border-emerald-400/35 bg-emerald-400/15 text-emerald-100 shadow-[0_0_26px_rgba(16,185,129,0.12)]'
                            : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                    )}
                    onClick={() => setSelectedSegmentId(null)}
                >
                    <Users className="mr-3 h-4 w-4" />
                    Todos os contatos
                    <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-zinc-300">{totalItems}</span>
                </Button>

                <div className="mb-5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Atalhos por data
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {DATE_FILTERS.map((filter) => {
                            const Icon = filter.icon;
                            const isActive = dateFilter === filter.id;
                            return (
                                <button
                                    key={filter.id}
                                    type="button"
                                    onClick={() => setDateFilter(filter.id)}
                                    className={cn(
                                        'rounded-2xl border p-3 text-left transition',
                                        isActive
                                            ? 'border-emerald-400/45 bg-emerald-400/15 text-white'
                                            : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-100'
                                    )}
                                >
                                    <Icon className={cn('mb-2 h-4 w-4', isActive ? 'text-emerald-300' : 'text-zinc-500')} />
                                    <div className="text-xs font-bold">{filter.label}</div>
                                    <div className="mt-0.5 text-[10px] text-zinc-500">{filter.description}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                    <span>Listas inteligentes</span>
                    <span>{segments.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {segments.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
                            Crie listas por tag, vendedor, data de contato ou campos personalizados.
                        </div>
                    ) : segments.map((segment) => (
                        <div key={segment.id} className="group relative">
                            <Button
                                variant="ghost"
                                className={cn(
                                    'h-auto min-h-12 w-full justify-start rounded-2xl border px-4 py-3 pr-10 text-left text-sm font-semibold',
                                    selectedSegmentId === segment.id
                                        ? 'border-emerald-400/35 bg-emerald-400/15 text-emerald-100'
                                        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                                )}
                                onClick={() => setSelectedSegmentId(segment.id)}
                            >
                                <ListFilter className="mr-3 h-4 w-4 shrink-0" />
                                <span className="truncate">{segment.name}</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-zinc-500 opacity-0 hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100"
                                onClick={(event) => handleDeleteSegment(event, segment.id)}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    ))}
                </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.13),transparent_34%),linear-gradient(180deg,#07100d_0%,#030504_44%,#000_100%)]">
                <div className="shrink-0 border-b border-white/10 bg-black/40 px-5 py-4 backdrop-blur-xl lg:px-7">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 font-semibold text-emerald-200">
                                    {selectedSegment?.name || 'Todos os contatos'}
                                </span>
                                {dateFilter !== 'all' && (
                                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-zinc-300">
                                        {DATE_FILTERS.find((filter) => filter.id === dateFilter)?.description}
                                    </span>
                                )}
                            </div>
                            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Lista do CRM</h1>
                            <p className="mt-1 text-sm text-zinc-400">
                                Organize contatos por comportamento, responsavel e recencia de atendimento.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {selectedSegment && (
                                <Button
                                    variant="outline"
                                    className="h-10 rounded-full border-white/10 bg-white/[0.04] px-4 text-zinc-200 hover:bg-white/10 hover:text-white"
                                    disabled={exportingSegmentId === selectedSegment.id}
                                    onClick={() => handleExportSegment(selectedSegment)}
                                >
                                    {exportingSegmentId === selectedSegment.id
                                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        : <Download className="mr-2 h-4 w-4" />}
                                    Exportar para Google Ads
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                className="h-10 rounded-full border-emerald-400/25 bg-emerald-400/10 px-4 text-emerald-100 hover:bg-emerald-400/20 hover:text-white"
                                onClick={() => setIsSegmentBuilderOpen(true)}
                            >
                                <Filter className="mr-2 h-4 w-4" />
                                Nova lista inteligente
                            </Button>
                            <CrmSettings user={user}>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    title="Configuracoes do CRM"
                                    className="h-10 w-10 rounded-full border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10 hover:text-white"
                                >
                                    <Settings className="h-4 w-4" />
                                </Button>
                            </CrmSettings>
                            <Button
                                className="h-10 rounded-full bg-white px-5 font-bold text-black hover:bg-emerald-100"
                                onClick={() => { setEditingContact(null); setIsAddEditModalOpen(true); }}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Novo contato
                            </Button>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                                    <Users className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Resultado</p>
                                    <p className="text-2xl font-bold text-white">{totalItems}</p>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                                    <MessageCircle className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Ativos na pagina</p>
                                    <p className="text-2xl font-bold text-white">{recentContacts}</p>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-zinc-300">
                                    <PhoneOff className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Sem atividade na pagina</p>
                                    <p className="text-2xl font-bold text-white">{withoutActivity}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="shrink-0 border-b border-white/10 bg-black/25 px-5 py-4 lg:px-7">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
                            <div className="relative w-full md:max-w-md">
                                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                                <Input
                                    type="text"
                                    placeholder="Buscar por nome, telefone, JID ou email..."
                                    className="h-11 rounded-2xl border-white/10 bg-white/[0.05] pl-11 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-emerald-400/30"
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                />
                            </div>

                            <div className="lg:hidden">
                                <Select value={selectedSegmentId || 'all'} onValueChange={(value) => setSelectedSegmentId(value === 'all' ? null : value)}>
                                    <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-white/[0.05] text-white">
                                        <SelectValue placeholder="Listas" />
                                    </SelectTrigger>
                                    <SelectContent className="border-white/10 bg-zinc-950 text-zinc-100">
                                        <SelectItem value="all">Todos os contatos</SelectItem>
                                        {segments.map((segment) => (
                                            <SelectItem key={segment.id} value={segment.id}>{segment.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
                            {DATE_FILTERS.map((filter) => {
                                const Icon = filter.icon;
                                const isActive = dateFilter === filter.id;
                                return (
                                    <Button
                                        key={filter.id}
                                        variant="outline"
                                        className={cn(
                                            'h-10 shrink-0 rounded-full border px-4 text-sm',
                                            isActive
                                                ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100'
                                                : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/10 hover:text-white'
                                        )}
                                        onClick={() => setDateFilter(filter.id)}
                                    >
                                        <Icon className="mr-2 h-4 w-4" />
                                        {filter.label}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-7">
                    <section className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#070b09]/92 shadow-[0_24px_80px_-44px_rgba(16,185,129,0.35)]">
                        <Table>
                            <TableHeader className="bg-white/[0.04]">
                                <TableRow className="border-white/10 hover:bg-transparent">
                                    <TableHead className="w-12 text-zinc-500">
                                        <Checkbox className="border-white/20 data-[state=checked]:border-emerald-400 data-[state=checked]:bg-emerald-500" />
                                    </TableHead>
                                    <TableHead className="min-w-[280px] text-zinc-400">Contato</TableHead>
                                    <TableHead className="min-w-[190px] text-zinc-400">Canal</TableHead>
                                    <TableHead className="min-w-[180px] text-zinc-400">Responsavel</TableHead>
                                    <TableHead className="min-w-[180px] text-zinc-400">Tags</TableHead>
                                    <TableHead className="min-w-[210px] text-zinc-400">Ultima atividade</TableHead>
                                    <TableHead className="w-20 text-center text-zinc-400">Acoes</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow className="border-white/10 hover:bg-white/[0.02]">
                                        <TableCell colSpan={7} className="h-56 text-center">
                                            <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-300" />
                                            <p className="mt-3 text-sm text-zinc-500">Carregando contatos...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : customers.length === 0 ? (
                                    <TableRow className="border-white/10 hover:bg-white/[0.02]">
                                        <TableCell colSpan={7} className="h-56 text-center">
                                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-500">
                                                <Search className="h-6 w-6" />
                                            </div>
                                            <p className="mt-4 text-base font-semibold text-white">Nenhum contato encontrado</p>
                                            <p className="mt-1 text-sm text-zinc-500">Ajuste a busca, data ou lista selecionada.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : customers.map((customer) => {
                                    const activity = formatLastActivity(customer.last_activity);
                                    return (
                                        <TableRow
                                            key={customer.id}
                                            className="group border-white/10 transition-colors hover:bg-emerald-400/[0.045]"
                                        >
                                            <TableCell>
                                                <Checkbox className="border-white/20 data-[state=checked]:border-emerald-400 data-[state=checked]:bg-emerald-500" />
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-11 w-11 border border-white/10 bg-white/[0.04]">
                                                        <AvatarImage src={customer.avatar_url || undefined} alt={customer.name} />
                                                        <AvatarFallback className="bg-emerald-400/12 font-bold text-emerald-100">
                                                            {getInitials(customer.name)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAction('view', customer)}
                                                            className="block max-w-[280px] truncate text-left text-sm font-bold text-white underline-offset-4 hover:text-emerald-200 hover:underline"
                                                        >
                                                            {customer.name || 'Contato sem nome'}
                                                        </button>
                                                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                                                            <Phone className="h-3.5 w-3.5" />
                                                            <span className="truncate">{getPhoneLabel(customer)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="inline-flex max-w-[260px] items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                                                    <MessageCircle className="h-3.5 w-3.5" />
                                                    <span className="truncate">{customer.phone_number_jid || customer.phone || 'Sem canal'}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {customer.owner?.name ? (
                                                    <div className="flex items-center gap-2 text-sm text-zinc-200">
                                                        <UserRound className="h-4 w-4 text-emerald-300" />
                                                        <span className="truncate">{customer.owner.name}</span>
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-500">
                                                        <BriefcaseBusiness className="h-3.5 w-3.5" />
                                                        Sem vendedor
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
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
                                                            <Badge className="rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-zinc-400">
                                                                +{customer.tags.length - 3}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                                                        <Tags className="h-3.5 w-3.5" />
                                                        Sem tags
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className={cn('inline-flex flex-col rounded-2xl border px-3 py-2 text-xs', activity.tone)}>
                                                    <span className="font-bold">{activity.label}</span>
                                                    <span className="mt-0.5 text-[11px] opacity-70">{activity.detail}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <TableActions contact={customer} onSelect={handleAction} />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>

                        <div className="flex flex-col gap-3 border-t border-white/10 bg-white/[0.025] p-4 text-sm text-zinc-500 lg:flex-row lg:items-center lg:justify-between">
                            <span>{`Mostrando ${startItem}-${endItem} de ${totalItems} contatos`}</span>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-2">
                                    <span>Linhas:</span>
                                    <Select value={String(itemsPerPage)} onValueChange={(value) => setItemsPerPage(Number(value))}>
                                        <SelectTrigger className="h-9 w-20 rounded-full border-white/10 bg-black/30 text-zinc-200">
                                            <SelectValue placeholder={itemsPerPage} />
                                        </SelectTrigger>
                                        <SelectContent className="border-white/10 bg-zinc-950 text-zinc-100">
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="25">25</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="100">100</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-semibold text-zinc-200">
                                    Pagina {currentPage} de {totalPages || 1}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 rounded-full border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
                                    onClick={() => setCurrentPage((page) => page - 1)}
                                    disabled={currentPage === 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 rounded-full border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
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
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
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
