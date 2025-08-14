

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
import { useAuth } from '@/hooks/use-auth';
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
             <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSelect('edit', contact);}}><Edit className="mr-2 h-4 w-4" /> Editar Contato</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect('delete', contact)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Excluir Contato</DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function CustomerList() {
  const user = useAuth();
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('todos');
  const [tagFilter, setTagFilter] = useState('todos');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);

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
        toast({ title: "Erro ao carregar CRM", description: error.message, variant: 'destructive'});
    } finally {
        setLoading(false);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


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
            if(result.success) {
                toast({ title: 'Contato excluído!'});
                fetchData();
            } else {
                toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive'});
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
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, filteredCustomers.length);

  const getTagStyle = (tagValue: string) => {
      const tag = tags.find(t => t.value === tagValue);
      return tag ? { backgroundColor: tag.color, color: tag.color.startsWith('#FEE2E2') || tag.color.startsWith('#FEF9C3') ? '#000' : '#fff', borderColor: 'transparent' } : {};
  };
  
  const handleItemsPerPageChange = (value: string) => {
    setItemsPerPage(Number(value));
    setCurrentPage(1); // Reset to first page
  };

  if (!user) {
    return (
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
        </div>
    )
  }

  return (
     <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card shadow-sm p-4 border-b border-border flex-shrink-0">
            <div className="flex flex-wrap justify-between items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">CRM</h1>
                <div className="flex items-center space-x-3">
                     <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                        <SelectTrigger className="text-xs h-9 w-auto md:w-[150px]">
                            <SelectValue placeholder="Todos Vendedores" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">Todos Vendedores</SelectItem>
                            {agents.map(agent => (
                                <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                     <Select value={tagFilter} onValueChange={setTagFilter}>
                        <SelectTrigger className="text-xs h-9 w-auto md:w-[150px]">
                            <SelectValue placeholder="Todas Tags" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">Todas Tags</SelectItem>
                            {tags.map(tag => (
                                 <SelectItem key={tag.id} value={tag.value}>
                                    <div className='flex items-center gap-2'>
                                        <span className='w-2 h-2 rounded-full' style={{backgroundColor: tag.color}}></span>
                                        {tag.label}
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="Buscar contatos..."
                            className="text-xs w-full md:w-56 h-9 pl-8"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                     <CrmSettings>
                        <Button variant="ghost" size="icon" title="Configurações do CRM">
                            <Settings className="h-5 w-5" />
                        </Button>
                     </CrmSettings>
                    <Button className="h-9" onClick={() => { setEditingContact(null); setIsAddEditModalOpen(true); }}>
                        <Plus className="mr-1.5 h-4 w-4" />Novo Contato
                    </Button>
                </div>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 bg-muted/30">
            <section className="bg-card rounded-lg shadow-sm border">
                 <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12"><Checkbox /></TableHead>
                                <TableHead>Nome</TableHead>
                                <TableHead>JID do WhatsApp</TableHead>
                                <TableHead>Vendedor</TableHead>
                                <TableHead>Tags</TableHead>
                                <TableHead className="text-center">Última Atividade</TableHead>
                                <TableHead className="text-center">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center">
                                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                                    </TableCell>
                                </TableRow>
                            ) : paginatedCustomers.map(customer => (
                                <TableRow 
                                  key={customer.id} 
                                >
                                    <TableCell><Checkbox /></TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                <AvatarImage src={customer.avatar_url} alt={customer.name} />
                                                <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium text-sm">{customer.name}</p>
                                                <p className="text-xs text-muted-foreground">{customer.email}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs">{customer.phone_number_jid}</TableCell>
                                    <TableCell className="text-xs">{customer.owner?.name || 'N/A'}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {customer.tags?.map(tag => (
                                                <Badge key={tag.id} style={getTagStyle(tag.value)}>{tag.label}</Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center text-xs">
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
                        <div className="text-center p-6 text-sm text-muted-foreground">Nenhum contato encontrado.</div>
                    )}
                </div>
                 <div className="p-4 flex justify-between items-center text-sm text-muted-foreground border-t">
                    <span>{`Mostrando ${startItem}-${endItem} de ${filteredCustomers.length} contatos`}</span>
                     <div className="flex items-center gap-2">
                        <div className='flex items-center gap-1'>
                            <span>Linhas por página:</span>
                            <Select value={String(itemsPerPage)} onValueChange={handleItemsPerPageChange}>
                                <SelectTrigger className="h-8 w-20">
                                    <SelectValue placeholder={itemsPerPage} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="100">100</SelectItem>
                                    <SelectItem value="500">500</SelectItem>
                                    <SelectItem value="1000">1000</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <span className="w-[1px] h-6 bg-border mx-2"></span>
                        <span className='font-medium'>
                            Página {currentPage} de {totalPages}
                        </span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>
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
