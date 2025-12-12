'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Settings, Plus, Filter, ChevronLeft, ChevronRight, Eye, PhoneOff, PlusCircle, Trash2, Edit, MoreHorizontal, Loader2, ListFilter, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Contact, Tag, User, Activity, Segment } from '@/lib/types';
import { Button } from '../ui/button';
import { AddContactForm } from './add-contact-form';
import { CrmSettings } from './crm-settings';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import CustomerProfile from './customer-profile';
import { AddActivityForm } from './add-activity-form';
import { LogAttemptForm } from './log-attempt-form';
import { getContacts, getTags, getWorkspaceUsers, deleteContactAction, getSegments, createSegment } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { SegmentBuilder } from './segment-builder';
import { CriteriaGroup } from '@/lib/crm-query-builder';

function TableActions({ contact, onSelect }: { contact: Contact, onSelect: (action: 'view' | 'edit' | 'logAttempt' | 'addActivity' | 'delete', contact: Contact) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelect('view', contact)}><Eye className="mr-2 h-4 w-4" /> Ver Detalhes</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('logAttempt', contact)}><PhoneOff className="mr-2 h-4 w-4" /> Registrar Tentativa</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('addActivity', contact)}><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Atividade</DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSelect('edit', contact); }}><Edit className="mr-2 h-4 w-4" /> Editar Contato</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect('delete', contact)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Excluir Contato</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default function CustomerList({ user }: { user: User }) {
    // Data State
    const [customers, setCustomers] = useState<Contact[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [agents, setAgents] = useState<User[]>([]);
    const [segments, setSegments] = useState<Segment[]>([]);

    // UI State
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0); // To force re-fetch
    const [isSegmentBuilderOpen, setIsSegmentBuilderOpen] = useState(false);

    // Filters & Pagination
    const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null); // null = "All Contacts"
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [totalItems, setTotalItems] = useState(0);

    // Modals
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
    const [isLogAttemptModalOpen, setIsLogAttemptModalOpen] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact | null>(null);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            // First load metadata if empty
            if (tags.length === 0 || agents.length === 0 || segments.length === 0) {
                const [tagsRes, agentsRes, segmentsRes] = await Promise.all([
                    getTags(user.activeWorkspaceId),
                    getWorkspaceUsers(user.activeWorkspaceId),
                    getSegments(user.activeWorkspaceId)
                ]);
                if (tagsRes.tags) setTags(tagsRes.tags);
                if (agentsRes.users) setAgents(agentsRes.users);
                if (segmentsRes.segments) setSegments(segmentsRes.segments);
            }

            // Then load contacts with filters
            const contactsRes = await getContacts(user.activeWorkspaceId, {
                page: currentPage,
                limit: itemsPerPage,
                search: searchTerm,
                segmentId: selectedSegmentId || undefined
            });

            if (contactsRes.error) throw new Error(contactsRes.error);
            setCustomers(contactsRes.contacts || []);
            setTotalItems(contactsRes.total || 0);

        } catch (error: any) {
            toast({ title: "Erro ao carregar CRM", description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId, currentPage, itemsPerPage, searchTerm, selectedSegmentId, refreshKey]); // Add refreshKey

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            fetchData();
        }
    }, [fetchData, user?.activeWorkspaceId]);

    // Reset page on filter change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, selectedSegmentId]);

    // Update selectedContact when customers list changes (to reflect edits/new activities)
    useEffect(() => {
        if (selectedContact) {
            const updated = customers.find(c => c.id === selectedContact.id);
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
            toast({ title: 'Segmento criado com sucesso!' });
            setIsSegmentBuilderOpen(false);
            // Refresh segments
            const segmentsRes = await getSegments(user.activeWorkspaceId);
            if (segmentsRes.segments) setSegments(segmentsRes.segments);
        } else {
            toast({ title: 'Erro ao criar segmento', description: res.error, variant: 'destructive' });
        }
        setLoading(false);
    };

    const handleAction = useCallback(async (action: 'view' | 'edit' | 'logAttempt' | 'addActivity' | 'delete', contact: Contact) => {
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
                        toast({ title: 'Contato excluído!' });
                        setRefreshKey(prev => prev + 1);
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
        setRefreshKey(prev => prev + 1);
    }, []);

    const getTagStyle = (tagValue: string) => {
        const tag = tags.find(t => t.value === tagValue);
        return tag ? { backgroundColor: tag.color, color: tag.color.startsWith('#FEE') ? '#000' : '#fff', borderColor: 'transparent' } : {};
    };

    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startItem = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);

    return (
        <div className="flex-1 flex overflow-hidden h-full">
            {/* Sidebar / Segments List (Visible on Desktop) */}
            <div className="hidden lg:flex flex-col w-64 border-r border-white/10 bg-black/40 backdrop-blur-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Listas</h2>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-white/50 hover:text-white" onClick={() => setIsSegmentBuilderOpen(true)}>
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>

                <div className="space-y-1">
                    <Button
                        variant={selectedSegmentId === null ? 'secondary' : 'ghost'}
                        className={`w-full justify-start ${selectedSegmentId === null ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30' : 'text-white/70'}`}
                        onClick={() => setSelectedSegmentId(null)}
                    >
                        <Users className="w-4 h-4 mr-2" /> Todos Contatos
                    </Button>
                    {segments.map(seg => (
                        <Button
                            key={seg.id}
                            variant={selectedSegmentId === seg.id ? 'secondary' : 'ghost'}
                            className={`w-full justify-start ${selectedSegmentId === seg.id ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30' : 'text-white/70'}`}
                            onClick={() => setSelectedSegmentId(seg.id)}
                        >
                            <ListFilter className="w-4 h-4 mr-2" /> {seg.name}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden h-full">
                {/* Header Actions */}
                <div className="flex-shrink-0 p-4 border-b border-white/10 bg-black/20 backdrop-blur-xl flex flex-wrap justify-between items-center gap-3">
                    <div className="flex items-center space-x-3 w-full md:w-auto">
                        <div className="relative flex-1 md:w-auto">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                            <Input
                                type="text"
                                placeholder="Buscar contatos..."
                                className="text-xs w-full md:w-64 h-9 pl-8 bg-white/5 border-white/10 text-white placeholder:text-white/50 focus-visible:ring-white/20"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {/* Mobile Segment Trigger */}
                        <div className="lg:hidden">
                            <Select value={selectedSegmentId || 'all'} onValueChange={(val) => setSelectedSegmentId(val === 'all' ? null : val)}>
                                <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white h-9">
                                    <SelectValue placeholder="Listas" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                    <SelectItem value="all">Todos Contatos</SelectItem>
                                    {segments.map(seg => <SelectItem key={seg.id} value={seg.id}>{seg.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="hidden lg:flex h-9 bg-white/5 border-white/10 text-white hover:bg-white/10" onClick={() => setIsSegmentBuilderOpen(true)}>
                            <Filter className="w-4 h-4 mr-2" /> Nova Lista Inteligente
                        </Button>

                        <CrmSettings user={user}>
                            <Button variant="outline" size="icon" title="Configurações do CRM" className="h-9 w-9 bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white">
                                <Settings className="h-4 w-4" />
                            </Button>
                        </CrmSettings>
                        <Button className="h-9 bg-blue-600 hover:bg-blue-700 text-white border-0" onClick={() => { setEditingContact(null); setIsAddEditModalOpen(true); }}>
                            <Plus className="mr-1.5 h-4 w-4" />Novo Contato
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-transparent">
                    <section className="bg-black/40 rounded-lg shadow-sm border border-white/10 backdrop-blur-md">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-white/5">
                                    <TableRow className="border-white/10 hover:bg-white/5">
                                        <TableHead className="w-12 text-white/70"><Checkbox className="border-white/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" /></TableHead>
                                        <TableHead className="text-white/70">Nome</TableHead>
                                        <TableHead className="text-white/70">JID do WhatsApp</TableHead>
                                        <TableHead className="text-white/70">Vendedor</TableHead>
                                        <TableHead className="text-white/70">Tags</TableHead>
                                        <TableHead className="text-center text-white/70">Última Atividade</TableHead>
                                        <TableHead className="text-center text-white/70">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow className="border-white/10 hover:bg-white/5">
                                            <TableCell colSpan={7} className="h-24 text-center">
                                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" />
                                            </TableCell>
                                        </TableRow>
                                    ) : customers.length === 0 ? (
                                        <TableRow className="border-white/10 hover:bg-white/5">
                                            <TableCell colSpan={7} className="h-24 text-center text-white/50">
                                                Nenhum contato encontrado.
                                            </TableCell>
                                        </TableRow>
                                    ) : customers.map(customer => (
                                        <TableRow
                                            key={customer.id}
                                            className="border-white/10 hover:bg-white/5 transition-colors"
                                        >
                                            <TableCell><Checkbox className="border-white/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" /></TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-8 w-8 border border-white/10">
                                                        <AvatarImage src={customer.avatar_url || undefined} alt={customer.name} />
                                                        <AvatarFallback className="bg-white/10 text-white">{customer.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-medium text-sm text-white">{customer.name}</p>
                                                        <p className="text-xs text-white/50">{customer.email}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-white/70">{customer.phone_number_jid}</TableCell>
                                            <TableCell className="text-xs text-white/70">{customer.owner?.name || 'N/A'}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {customer.tags?.map(tag => (
                                                        <Badge key={tag.id} style={getTagStyle(tag.value)} className="border-0">{tag.label}</Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center text-xs text-white/70">
                                                {customer.last_activity ? format(new Date(customer.last_activity), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <TableActions contact={customer} onSelect={handleAction} />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="p-4 flex justify-between items-center text-sm text-white/50 border-t border-white/10">
                            <span>{`Mostrando ${startItem}-${endItem} de ${totalItems} contatos`}</span>
                            <div className="flex items-center gap-2">
                                <div className='flex items-center gap-1'>
                                    <span>Linhas por página:</span>
                                    <Select value={String(itemsPerPage)} onValueChange={(v) => setItemsPerPage(Number(v))}>
                                        <SelectTrigger className="h-8 w-20 bg-white/5 border-white/10 text-white">
                                            <SelectValue placeholder={itemsPerPage} />
                                        </SelectTrigger>
                                        <SelectContent className="bg-black border-white/10 text-white">
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="25">25</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="100">100</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <span className="w-[1px] h-6 bg-white/10 mx-2"></span>
                                <span className='font-medium text-white'>
                                    Página {currentPage} de {totalPages || 1}
                                </span>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages || totalPages === 0}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Modals and Side Panels */}
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
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <div className="w-full max-w-2xl animate-in fade-in zoom-in duration-200">
                            <SegmentBuilder
                                tags={tags}
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
                            onMutate={() => setRefreshKey(k => k + 1)}
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
            </div>
        </div>
    );
}
