
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
import { agents, leadSources } from '@/lib/mock-data';

export function AddContactForm({ children }: { children: React.ReactNode }) {
  const owners = agents;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Criar Novo Contato</DialogTitle>
          <DialogDescription>
            Preencha os detalhes abaixo para adicionar um novo contato ao seu CRM.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] grid-cols-1 gap-8 overflow-y-auto p-1 md:grid-cols-2">
          {/* Coluna da Esquerda */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">Nome Completo*</Label>
              <Input id="firstName" placeholder="João da Silva" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" placeholder="joao.silva@email.com" />
            </div>
             <div className="space-y-2">
              <Label htmlFor="phone">Telefone*</Label>
              <Input id="phone" type="tel" placeholder="+55 11 98765-4321" required />
            </div>
             <div className="space-y-2">
              <Label htmlFor="company">Empresa (Opcional)</Label>
              <Input id="company" placeholder="InnovateTech Soluções" />
            </div>
             <div className="space-y-2">
              <Label htmlFor="address">Endereço Completo*</Label>
              <Input id="address" placeholder="Rua das Flores, 123, Bairro Jardim, São Paulo" required />
            </div>
          </div>
          
          {/* Coluna da Direita */}
          <div className="space-y-4">
             <div className="space-y-2">
                <Label htmlFor="service-interest">Plano de Interesse</Label>
                 <Select>
                    <SelectTrigger id="service-interest">
                        <SelectValue placeholder="Selecione um plano" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        <SelectItem value="fibra-100">Fibra 100MB</SelectItem>
                        <SelectItem value="fibra-300">Fibra 300MB</SelectItem>
                        <SelectItem value="fibra-500">Fibra 500MB</SelectItem>
                        <SelectItem value="gamer">Plano Gamer</SelectItem>
                        <SelectItem value="dedicado">Link Dedicado</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label htmlFor="owner">Vendedor Responsável</Label>
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
                <Label htmlFor="tags">Tags (separadas por vírgula)</Label>
                <Input id="tags" placeholder="prospect, vip, etc" />
            </div>
             <div className="space-y-2">
                <Label htmlFor="current-provider">Provedor Atual</Label>
                <Input id="current-provider" placeholder="Ex: Vivo, Claro" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost">Cancelar</Button>
          <Button type="submit">Salvar Contato</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
