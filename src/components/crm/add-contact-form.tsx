
'use client';

import React, { useState, useEffect } from 'react';
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
import { agents } from '@/lib/mock-data';
import type { Contact } from '@/lib/types';

interface AddContactFormProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    onSave: (contact: Contact) => void;
    contact: Contact | null;
}

export function AddContactForm({ isOpen, setIsOpen, onSave, contact }: AddContactFormProps) {
  const [formData, setFormData] = useState<Partial<Contact>>({});

  useEffect(() => {
    if (contact) {
      setFormData(contact);
    } else {
      setFormData({});
    }
  }, [contact, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

   const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, businessProfile: { ...(prev.businessProfile || {}), [name]: value } as any }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newContactData: Contact = {
        id: contact?.id || `CRM${Date.now()}`,
        workspace_id: contact?.workspace_id || '', 
        name: formData.name || '',
        firstName: (formData.name || '').split(' ')[0],
        lastName: (formData.name || '').split(' ').slice(1).join(' '),
        avatar: contact?.avatar || `https://placehold.co/40x40.png?text=${((formData.name || '?').charAt(0)).toUpperCase()}`,
        email: formData.email,
        phone: formData.phone,
        phone_number_jid: contact?.phone_number_jid,
        businessProfile: {
            ...contact?.businessProfile,
            companyName: formData.businessProfile?.companyName,
            ownerId: formData.businessProfile?.ownerId,
            serviceInterest: formData.businessProfile?.serviceInterest,
            currentProvider: formData.businessProfile?.currentProvider,
            tags: formData.businessProfile?.tags || [],
            deals: contact?.businessProfile?.deals || [],
            tasks: contact?.businessİnterest?.tasks || [],
            activities: contact?.businessProfile?.activities || [],
        },
    };
    onSave(newContactData);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contact ? 'Editar Contato' : 'Criar Novo Contato'}</DialogTitle>
          <DialogDescription>
            Preencha os detalhes abaixo para adicionar um novo contato ao seu CRM.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
            <div className="grid max-h-[70vh] grid-cols-1 gap-8 overflow-y-auto p-1 md:grid-cols-2">
            {/* Coluna da Esquerda */}
            <div className="space-y-4">
                <div className="space-y-2">
                <Label htmlFor="name">Nome Completo*</Label>
                <Input id="name" name="name" placeholder="João da Silva" required value={formData.name || ''} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" placeholder="joao.silva@email.com" value={formData.email || ''} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                <Label htmlFor="phone">Telefone*</Label>
                <Input id="phone" name="phone" type="tel" placeholder="+55 11 98765-4321" required value={formData.phone || ''} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                <Label htmlFor="companyName">Empresa (Opcional)</Label>
                <Input id="companyName" name="companyName" placeholder="InnovateTech Soluções" value={formData.businessProfile?.companyName || ''} onChange={(e) => setFormData(p => ({...p, businessProfile: {...p.businessProfile, companyName: e.target.value} as any}))} />
                </div>
            </div>
            
            {/* Coluna da Direita */}
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="serviceInterest">Plano de Interesse</Label>
                    <Select name="serviceInterest" value={formData.businessProfile?.serviceInterest || 'none'} onValueChange={(val) => handleSelectChange('serviceInterest', val)}>
                        <SelectTrigger id="serviceInterest"><SelectValue placeholder="Selecione um plano" /></SelectTrigger>
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
                    <Label htmlFor="currentProvider">Provedor Atual</Label>
                    <Input id="currentProvider" name="currentProvider" placeholder="Ex: Vivo, Claro" value={formData.businessProfile?.currentProvider || ''} onChange={(e) => setFormData(p => ({...p, businessProfile: {...p.businessProfile, currentProvider: e.target.value} as any}))}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="ownerId">Vendedor Responsável</Label>
                    <Select name="ownerId" value={formData.businessProfile?.ownerId || ''} onValueChange={(val) => handleSelectChange('ownerId', val)}>
                        <SelectTrigger id="ownerId"><SelectValue placeholder="Selecione um proprietário" /></SelectTrigger>
                        <SelectContent>
                            {agents.map(owner => (<SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            </div>
            <DialogFooter className="pt-6">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
            <Button type="submit">Salvar Contato</Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
