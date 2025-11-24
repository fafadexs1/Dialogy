
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Settings, Plus, Filter, ChevronLeft, ChevronRight, Eye, PhoneOff, PlusCircle, Trash2, Edit, MoreHorizontal, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Contact, Tag, User, Activity } from '@/lib/types';
import { Button } from '../ui/button';
import { AddContactForm } from './add-contact-form';
import { CrmSettings } from './crm-settings';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import CustomerProfile from './customer-profile';
import { AddActivityForm } from './add-activity-form';
import { LogAttemptForm } from './log-attempt-form';
import { getContacts, getTags, getWorkspaceUsers, deleteContactAction } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
    const [customers, setCustomers] = useState<Contact[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [agents, setAgents] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    const [searchTerm, setSearchTerm] = useState('');
    const [ownerFilter, setOwnerFilter] = useState('todos');
    const [tagFilter, setTagFilter] = useState('todos');

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // State for modals and panels
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
            const [contactsRes, tagsRes, agentsRes] = await Promise.all([
                getContacts(user.activeWorkspaceId),
                getTags(user.activeWorkspaceId),
                getWorkspaceUsers(user.activeWorkspaceId)
            ]);

            if (contactsRes.error) throw new Error(contactsRes.error);
            setCustomers(contactsRes.contacts || []);

            if (tagsRes.error) throw new Error(tagsRes.error);
            setTags(tagsRes.tags || []);

            if (agentsRes.error) throw new Error(agentsRes.error);
            setAgents(agentsRes.users || []);

        } catch (error: any) {
            toast({ title: "Erro ao carregar CRM", description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        if (user) {
            fetchData();
        }
    }, [user, fetchData]);


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
                        fetchData();
                    } else {
                        toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive' });
                    }
                }
                break;
        }
    }, [fetchData]);

    const handleSaveSuccess = useCallback(() => {
        setIsAddEditModalOpen(false);
        setEditingContact(null);
        setIsActivityModalOpen(false);
        setIsLogAttemptModalOpen(false);
        fetchData(); // Re-fetch all data to reflect changes
    }, [fetchData]);


    const filteredCustomers = customers.filter((customer) => {
        const searchString = `${customer.name} ${customer.email || ''} ${customer.address || ''}`.toLowerCase();
        const matchesSearch = searchString.includes(searchTerm.toLowerCase());
        const matchesOwner = ownerFilter === 'todos' || customer.owner_id === ownerFilter;
        const matchesTag = tagFilter === 'todos' || customer.tags?.some(t => t.value === tagFilter);
        return matchesSearch && matchesOwner && matchesTag;
    });

    // Pagination logic
    const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage);
    const paginatedCustomers = filteredCustomers.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );
    const startItem = filteredCustomers.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endItem = Math.min(currentPage * itemsPerPage, filteredCustomers.length);

    const getTagStyle = (tagValue: string) => {
        const tag = tags.find(t => t.value === tagValue);
        return tag ? { backgroundColor: tag.color, color: tag.color.startsWith('#FEE') ? '#000' : '#fff', borderColor: 'transparent' } : {};
    };

    const handleItemsPerPageChange = (value: string) => {
        setItemsPerPage(Number(value));
        setCurrentPage(1); // Reset to first page
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden h-full">
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
                    <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                        <SelectTrigger className="text-xs h-9 w-auto md:w-[150px] bg-white/5 border-white/10 text-white">
                            <SelectValue placeholder="Todos Vendedores" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-white/10 text-white">
                            <SelectItem value="todos">Todos Vendedores</SelectItem>
                            {agents.map(agent => (
                                <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={tagFilter} onValueChange={setTagFilter}>
                        <SelectTrigger className="text-xs h-9 w-auto md:w-[150px] bg-white/5 border-white/10 text-white">
                            <SelectValue placeholder="Todas Tags" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-white/10 text-white">
                            <SelectItem value="todos">Todas Tags</SelectItem>
                            {tags.filter(t => !t.is_close_reason).map(tag => (
                                <SelectItem key={tag.id} value={tag.value}>
                                    <div className='flex items-center gap-2'>
                                        <span className='w-2 h-2 rounded-full' style={{ backgroundColor: tag.color }}></span>
                                        {tag.label}
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2">
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
                                ) : paginatedCustomers.map(customer => (
                                    <TableRow
                                        key={customer.id}
                                        className="border-white/10 hover:bg-white/5 transition-colors"
                                    >
                                        <TableCell><Checkbox className="border-white/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" /></TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-8 w-8 border border-white/10">
                                                    <AvatarImage src={customer.avatar_url} alt={customer.name} />
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
                        {!loading && filteredCustomers.length === 0 && (
                            <div className="text-center p-6 text-sm text-white/50">Nenhum contato encontrado.</div>
                        )}
                    </div>
                    <div className="p-4 flex justify-between items-center text-sm text-white/50 border-t border-white/10">
                        <span>{`Mostrando ${startItem}-${endItem} de ${filteredCustomers.length} contatos`}</span>
                        <div className="flex items-center gap-2">
                            <div className='flex items-center gap-1'>
                                <span>Linhas por página:</span>
                                <Select value={String(itemsPerPage)} onValueChange={handleItemsPerPageChange}>
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
            {selectedContact && (
                <>
                    <CustomerProfile
                        contact={selectedContact}
                        isOpen={isProfileOpen}
                        setIsOpen={setIsProfileOpen}
                        onAction={handleAction}
                        onMutate={fetchData}
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
    );
}
