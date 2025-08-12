
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

interface LogAttemptFormProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    contact: Contact;
}

export function LogAttemptForm({ isOpen, setIsOpen, contact }: LogAttemptFormProps) {
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Log attempt form submitted for contact:', contact.id);
    setIsOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar Tentativa de Contato</DialogTitle>
           <DialogDescription>
            Para {contact.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
            <div className="modal-body space-y-4 py-4">
                <div>
                <Label htmlFor="log-attempt-outcome">Resultado*</Label>
                <Select name="outcome" required defaultValue="nao-atendeu">
                     <SelectTrigger id="log-attempt-outcome">
                        <SelectValue placeholder="Selecione o resultado"/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="nao-atendeu">Não Atendeu</SelectItem>
                        <SelectItem value="atendeu">Atendeu</SelectItem>
                        <SelectItem value="caixa-postal">Caixa Postal</SelectItem>
                        <SelectItem value="numero-errado">Número Errado</SelectItem>
                        <SelectItem value="ocupado">Ocupado</SelectItem>
                    </SelectContent>
                </Select>
                </div>
                <div>
                    <Label htmlFor="log-attempt-notes">Notas</Label>
                    <Textarea id="log-attempt-notes" name="notes" rows={3} placeholder="Detalhes da tentativa..."/>
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                <Button type="submit">Registrar</Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
