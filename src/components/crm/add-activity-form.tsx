
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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import type { Contact } from '@/lib/types';

interface AddActivityFormProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    contact: Contact;
}

export function AddActivityForm({ isOpen, setIsOpen, contact }: AddActivityFormProps) {
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Here you would typically call a server action to save the activity
    console.log('Activity form submitted for contact:', contact.id);
    setIsOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Atividade para {contact.name}</DialogTitle>
          <DialogDescription>
            Registre uma nova interação ou nota para este contato.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
            <div className="modal-body space-y-4 py-4">
                <div>
                <Label htmlFor="activity-type">Tipo de Atividade*</Label>
                <Select name="activityType" required defaultValue="nota">
                    <SelectTrigger id="activity-type">
                        <SelectValue placeholder="Selecione o tipo"/>
                    </SelectTrigger>
                    <SelectContent>
                        <option value="ligacao">Ligação</option>
                        <option value="email">Email</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="visita">Visita Técnica/Comercial</option>
                        <option value="viabilidade">Verificação Viabilidade</option>
                        <option value="contrato">Envio Contrato</option>
                        <option value="agendamento">Agendamento Instalação</option>
                        <option value="tentativa-contato">Tentativa de Contato</option>
                        <option value="nota">Nota Interna</option>
                    </SelectContent>
                </Select>
                </div>
                <div>
                    <Label htmlFor="activity-notes">Notas*</Label>
                    <Textarea id="activity-notes" name="notes" rows={4} required placeholder="Detalhes da atividade..."/>
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                <Button type="submit">Salvar Atividade</Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
