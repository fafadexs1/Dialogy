
'use client';

import React, { useState } from 'react';
import { Search, Settings, Plus, Upload, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type User, type Tag } from '@/lib/types';
import { Button } from '../ui/button';
import { AddContactForm } from './add-contact-form';
import { CrmSettings } from './crm-settings';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { mockTags, agents } from '@/lib/mock-data';
import { Badge } from '../ui/badge';

interface CustomerListProps {
  customers: User[];
  selectedCustomer: User | null;
  onSelectCustomer: (customer: User) => void;
}

export default function CustomerList({ customers = [], selectedCustomer, onSelectCustomer }: CustomerListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('todos');
  const [tagFilter, setTagFilter] = useState('todos');

  const filteredCustomers = customers.filter((customer) => {
      const searchString = `${customer.name} ${customer.email || ''} ${customer.businessProfile?.companyName || ''}`.toLowerCase();
      const matchesSearch = searchString.includes(searchTerm.toLowerCase());
      const matchesOwner = ownerFilter === 'todos' || customer.businessProfile?.ownerId === ownerFilter;
      const matchesTag = tagFilter === 'todos' || customer.businessProfile?.tags.some(t => t.value === tagFilter);
      return matchesSearch && matchesOwner && matchesTag;
  });

  const getTagStyle = (tagValue: string) => {
      const tag = mockTags.find(t => t.value === tagValue);
      return tag ? { backgroundColor: tag.color, color: '#fff', borderColor: 'transparent' } : {};
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
                    <AddContactForm>
                      <Button className="h-9">
                          <Plus className="mr-1.5 h-4 w-4" />Novo Contato
                      </Button>
                    </AddContactForm>
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
                                <TableHead>Empresa</TableHead>
                                <TableHead>Telefone</TableHead>
                                <TableHead>Proprietário</TableHead>
                                <TableHead>Tags</TableHead>
                                <TableHead className="text-center">Prioridade</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredCustomers.map(customer => (
                                <TableRow 
                                  key={customer.id} 
                                  onClick={() => onSelectCustomer(customer)} 
                                  className="cursor-pointer"
                                  data-state={selectedCustomer?.id === customer.id ? 'selected' : undefined}
                                >
                                    <TableCell><Checkbox checked={selectedCustomer?.id === customer.id} /></TableCell>
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
                                    <TableCell className="text-xs">{customer.businessProfile?.companyName || '--'}</TableCell>
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
                                       {customer.businessProfile?.dialogPriorityScore && (
                                          <Badge variant={customer.businessProfile.dialogPriorityScore > 70 ? "destructive" : "secondary"}>
                                              {customer.businessProfile.dialogPriorityScore}
                                          </Badge>
                                      )}
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
    </div>
  );
}
