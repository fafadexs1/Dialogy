
'use client';

import React, { useState } from 'react';
import { Search, Settings, Plus, Upload, Filter, ChevronLeft, ChevronRight, Eye, PhoneSlash, PlusCircle, Trash2, MoreHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type User, type Tag, Contact } from '@/lib/types';
import { Button } from '../ui/button';
import { AddContactForm } from './add-contact-form';
import { CrmSettings } from './crm-settings';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { mockTags, agents, contacts as mockContacts } from '@/lib/mock-data';
import { Badge } from '../ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import CustomerProfile from './customer-profile';
import { AddActivityForm } from './add-activity-form';
import { LogAttemptForm } from './log-attempt-form';

interface CustomerListProps {
  customers: Contact[];
}

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
            <DropdownMenuItem onClick={() => onSelect('logAttempt', contact)}><PhoneSlash className="mr-2 h-4 w-4" /> Registrar Tentativa</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect('addActivity', contact)}><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Atividade</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect('delete', contact)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function CustomerList({ customers: initialCustomers = [] }: CustomerListProps) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [searchTerm, setSearchTerm] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('todos');
  const [tagFilter, setTagFilter] = useState('todos');

  // State for modals and panels
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isLogAttemptModalOpen, setIsLogAttemptModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  

  const handleAction = (action: 'view' | 'edit' | 'logAttempt' | 'addActivity' | 'delete', contact: Contact) => {
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
          setCustomers(prev => prev.filter(c => c.id !== contact.id));
        }
        break;
    }
  };

  const handleSaveContact = (contact: Contact) => {
    if (editingContact) {
      setCustomers(prev => prev.map(c => c.id === contact.id ? contact : c));
    } else {
      setCustomers(prev => [contact, ...prev]);
    }
    setIsAddEditModalOpen(false);
    setEditingContact(null);
  }


  const filteredCustomers = customers.filter((customer) => {
      const searchString = `${customer.name} ${customer.email || ''} ${customer.businessProfile?.companyName || ''}`.toLowerCase();
      const matchesSearch = searchString.includes(searchTerm.toLowerCase());
      const matchesOwner = ownerFilter === 'todos' || customer.businessProfile?.ownerId === ownerFilter;
      const matchesTag = tagFilter === 'todos' || customer.businessProfile?.tags.some(t => t.value === tagFilter);
      return matchesSearch && matchesOwner && matchesTag;
  });

  const getTagStyle = (tagValue: string) => {
      const tag = mockTags.find(t => t.value === tagValue);
      return tag ? { backgroundColor: tag.color, color: tag.color.startsWith('#FEE2E2') || tag.color.startsWith('#FEF9C3') ? '#000' : '#fff', borderColor: 'transparent' } : {};
  };

  return (
     <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card shadow-sm p-4 border-b border-border flex-shrink-0">
            <div className="flex flex-wrap justify-between items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">CRM Provedor ISP</h1>
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
                            {mockTags.map(tag => (
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
                                <TableHead>Telefone</TableHead>
                                <TableHead>Vendedor</TableHead>
                                <TableHead>Tags</TableHead>
                                <TableHead className="text-center">Plano Interesse</TableHead>
                                <TableHead className="text-center">Última Atividade</TableHead>
                                <TableHead className="text-center">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredCustomers.map(customer => (
                                <TableRow 
                                  key={customer.id} 
                                >
                                    <TableCell><Checkbox /></TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                <AvatarImage src={customer.avatar} alt={customer.name} data-ai-hint="person" />
                                                <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium text-sm">{customer.name}</p>
                                                <p className="text-xs text-muted-foreground">{customer.email}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs">{customer.phone}</TableCell>
                                    <TableCell className="text-xs">{customer.businessProfile?.ownerName || 'N/A'}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {customer.businessProfile?.tags.map(tag => (
                                                <Badge key={tag.id} style={getTagStyle(tag.value)}>{tag.label}</Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                       {customer.businessProfile?.serviceInterest && (
                                          <Badge variant={"secondary"}>
                                              {customer.businessProfile.serviceInterest}
                                          </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center text-xs">{customer.businessProfile?.lastActivity}</TableCell>
                                     <TableCell className="text-center">
                                        <TableActions contact={customer} onSelect={handleAction} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {filteredCustomers.length === 0 && (
                        <div className="text-center p-6 text-sm text-muted-foreground">Nenhum contato encontrado.</div>
                    )}
                </div>
                 <div className="p-4 flex justify-between items-center text-sm text-muted-foreground border-t">
                    <span>Mostrando {filteredCustomers.length} de {customers.length} contatos</span>
                     <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled><ChevronLeft className="h-4 w-4" /></Button>
                        <span>Página 1 de 1</span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                </div>
            </section>
        </div>
        
        {/* Modals and Side Panels */}
        <AddContactForm 
            isOpen={isAddEditModalOpen}
            setIsOpen={setIsAddEditModalOpen}
            onSave={handleSaveContact}
            contact={editingContact}
        />
        {selectedContact && (
            <>
                <CustomerProfile 
                    contact={selectedContact}
                    isOpen={isProfileOpen}
                    setIsOpen={setIsProfileOpen}
                    onAction={handleAction}
                />
                <AddActivityForm
                    contact={selectedContact}
                    isOpen={isActivityModalOpen}
                    setIsOpen={setIsActivityModalOpen}
                />
                 <LogAttemptForm
                    contact={selectedContact}
                    isOpen={isLogAttemptModalOpen}
                    setIsOpen={setIsLogAttemptModalOpen}
                />
            </>
        )}
    </div>
  );
}

    