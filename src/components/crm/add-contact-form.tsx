

'use client';

import React, { useState, useEffect, useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { Contact, User } from '@/lib/types';
import { useFormStatus } from 'react-dom';
import { Loader2, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';
import { saveContactAction } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';

interface AddContactFormProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    onSave: () => void;
    contact: Contact | null;
    workspaceId: string;
    agents: User[];
}

function SaveButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Salvar Contato
        </Button>
    )
}

export function AddContactForm({ isOpen, setIsOpen, onSave, contact, workspaceId, agents }: AddContactFormProps) {
  const [state, formAction] = useActionState(saveContactAction, { success: false, error: null });

  useEffect(() => {
    if (state.success) {
        toast({ title: "Contato salvo!", description: "As informações do contato foram salvas com sucesso." });
        onSave();
    }
  }, [state, onSave]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contact ? 'Editar Contato' : 'Criar Novo Contato'}</DialogTitle>
          <DialogDescription>
            Preencha os detalhes abaixo para adicionar ou atualizar um contato no seu CRM.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
            <input type="hidden" name="id" value={contact?.id || ''} />
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="grid max-h-[70vh] grid-cols-1 gap-8 overflow-y-auto p-1 md:grid-cols-2">
            {/* Coluna da Esquerda */}
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Nome Completo*</Label>
                    <Input id="name" name="name" placeholder="João da Silva" required defaultValue={contact?.name || ''} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input id="email" name="email" type="email" placeholder="joao.silva@email.com" defaultValue={contact?.email || ''}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="phone">Telefone*</Label>
                    <Input id="phone" name="phone" type="tel" placeholder="+55 11 98765-4321" required defaultValue={contact?.phone || ''}/>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="address">Endereço Completo</Label>
                    <Input id="address" name="address" placeholder="Rua, Número, Bairro, Cidade" defaultValue={contact?.address || ''}/>
                </div>
            </div>
            
            {/* Coluna da Direita */}
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="service_interest">Plano de Interesse</Label>
                    <Select name="service_interest" defaultValue={contact?.service_interest || 'none'}>
                        <SelectTrigger id="service_interest"><SelectValue placeholder="Selecione um plano" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            <SelectItem value="Fibra 100MB">Fibra 100MB</SelectItem>
                            <SelectItem value="Fibra 300MB">Fibra 300MB</SelectItem>
                            <SelectItem value="Fibra 500MB">Fibra 500MB</SelectItem>
                            <SelectItem value="Plano Gamer">Plano Gamer</SelectItem>
                            <SelectItem value="Link Dedicado">Link Dedicado</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="current_provider">Provedor Atual</Label>
                    <Input id="current_provider" name="current_provider" placeholder="Ex: Vivo, Claro" defaultValue={contact?.current_provider || ''} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="owner_id">Vendedor Responsável</Label>
                    <Select name="owner_id" defaultValue={contact?.owner_id || 'unassigned'}>
                        <SelectTrigger id="owner_id"><SelectValue placeholder="Selecione um proprietário" /></SelectTrigger>
                        <SelectContent>
                             <SelectItem value="unassigned">Nenhum</SelectItem>
                            {agents.map(owner => (<SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            </div>
             {state.error && (
                <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Erro ao Salvar</AlertTitle>
                    <AlertDescription>{state.error}</AlertDescription>
                </Alert>
            )}
            <DialogFooter className="pt-6">
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                <SaveButton />
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
