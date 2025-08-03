'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import { mockCustomFieldDefinitions, agents, leadSources, contactChannels } from '@/lib/mock-data';
import type { CustomFieldDefinition } from '@/lib/types';

interface AddContactFormProps {
  customFieldDefinitions?: CustomFieldDefinition[];
}

export function AddContactForm({ customFieldDefinitions = mockCustomFieldDefinitions }: AddContactFormProps) {
  const owners = agents;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full">
          <Plus className="mr-2 h-4 w-4" /> Adicionar Contato
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Criar Novo Contato</DialogTitle>
          <DialogDescription>
            Preencha os detalhes abaixo para adicionar um novo contato ao seu CRM.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-1 gap-8 overflow-y-auto p-1 md:grid-cols-2">
          {/* Coluna da Esquerda */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Informações Essenciais</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Nome</Label>
                <Input id="firstName" placeholder="João" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Sobrenome</Label>
                <Input id="lastName" placeholder="Silva" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Empresa</Label>
              <Input id="company" placeholder="InnovateTech Soluções" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" placeholder="joao.silva@innovatetech.com" />
            </div>
             <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" type="tel" placeholder="+55 11 98765-4321" />
            </div>

            <hr className="my-4"/>

            <h3 className="text-lg font-semibold">Informações Adicionais</h3>
             <div className="space-y-2">
              <Label htmlFor="secondaryPhone">Telefone Secundário</Label>
              <Input id="secondaryPhone" type="tel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" placeholder="www.innovatetech.com" />
            </div>
             <div className="space-y-2">
              <Label htmlFor="address">Endereço</Label>
              <Textarea id="address" placeholder="Rua das Flores, 123, São Paulo, SP, 01234-567" />
            </div>
          </div>
          
          {/* Coluna da Direita */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Informações de Contexto</h3>
            <div className="space-y-2">
              <Label htmlFor="title">Cargo</Label>
              <Input id="title" placeholder="Diretor de Vendas" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="owner">Proprietário do Contato</Label>
                <Select>
                    <SelectTrigger id="owner">
                        <SelectValue placeholder="Selecione um proprietário" />
                    </SelectTrigger>
                    <SelectContent>
                        {owners.map(owner => (
                            <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label htmlFor="leadSource">Origem do Lead</Label>
                <Select>
                    <SelectTrigger id="leadSource">
                        <SelectValue placeholder="Selecione a origem" />
                    </SelectTrigger>
                    <SelectContent>
                        {leadSources.map(source => (
                            <SelectItem key={source} value={source.toLowerCase().replace(/\s+/g, '_')}>{source}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
             <div className="space-y-2">
                <Label htmlFor="contactChannel">Canal de Contato Inicial</Label>
                <Select>
                    <SelectTrigger id="contactChannel">
                        <SelectValue placeholder="Selecione o canal" />
                    </SelectTrigger>
                    <SelectContent>
                        {contactChannels.map(channel => (
                             <SelectItem key={channel} value={channel.toLowerCase().replace(/\s+/g, '_')}>{channel}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label htmlFor="description">Descrição / Anotações</Label>
                <Textarea id="description" placeholder="Anotações importantes sobre o contato..." />
            </div>
            
             <hr className="my-4"/>

            <h3 className="text-lg font-semibold">Campos Personalizados</h3>
            <div className='space-y-4 p-4 border bg-secondary/30 rounded-lg'>
                {customFieldDefinitions.map(field => (
                  <div key={field.id} className="space-y-2">
                    <Label htmlFor={field.id}>{field.label}</Label>
                    <Input id={field.id} placeholder={field.placeholder} type={field.type} />
                  </div>
                ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline">Cancelar</Button>
          <Button type="submit">Salvar Contato</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
