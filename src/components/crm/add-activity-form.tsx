

'use client';

import React, { useEffect, useActionState } from 'react';
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
import { useFormStatus } from 'react-dom';
import { Loader2, Save } from 'lucide-react';
import { addActivityAction } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';

interface AddActivityFormProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    contact: Contact;
    onSave: () => void;
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Salvar Atividade
        </Button>
    )
}

export function AddActivityForm({ isOpen, setIsOpen, contact, onSave }: AddActivityFormProps) {
  const [state, formAction] = useActionState(addActivityAction, { success: false, error: null });

  useEffect(() => {
    if (state.success) {
        toast({ title: "Atividade registrada com sucesso!" });
        onSave();
    }
  }, [state, onSave]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Atividade para {contact.name}</DialogTitle>
          <DialogDescription>
            Registre uma nova interação ou nota para este contato.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
            <input type="hidden" name="contactId" value={contact.id} />
            <div className="modal-body space-y-4 py-4">
                <div>
                <Label htmlFor="activity-type">Tipo de Atividade*</Label>
                <Select name="type" required defaultValue="nota">
                    <SelectTrigger id="activity-type">
                        <SelectValue placeholder="Selecione o tipo"/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ligacao">Ligação</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="visita">Visita Técnica/Comercial</SelectItem>
                        <SelectItem value="viabilidade">Verificação Viabilidade</SelectItem>
                        <SelectItem value="contrato">Envio Contrato</SelectItem>
                        <SelectItem value="agendamento">Agendamento Instalação</SelectItem>
                        <SelectItem value="tentativa-contato">Tentativa de Contato</SelectItem>
                        <SelectItem value="nota">Nota Interna</SelectItem>
                    </SelectContent>
                </Select>
                </div>
                <div>
                    <Label htmlFor="activity-notes">Notas*</Label>
                    <Textarea id="activity-notes" name="notes" rows={4} required placeholder="Detalhes da atividade..."/>
                </div>
                 {state.error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro</AlertTitle>
                        <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                )}
            </div>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                <SubmitButton />
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
