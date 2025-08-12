

'use client';

import React, { useActionState, useEffect } from 'react';
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
import { addActivityAction } from '@/actions/crm';
import { useFormStatus } from 'react-dom';
import { Loader2, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';

interface LogAttemptFormProps {
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
            Registrar
        </Button>
    )
}

export function LogAttemptForm({ isOpen, setIsOpen, contact, onSave }: LogAttemptFormProps) {
  const [state, formAction] = useActionState(addActivityAction, { success: false, error: null });

  useEffect(() => {
    if (state.success) {
        toast({ title: "Tentativa de contato registrada!" });
        onSave();
    }
  }, [state, onSave]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar Tentativa de Contato</DialogTitle>
           <DialogDescription>
            Para {contact.name}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
             <input type="hidden" name="contactId" value={contact.id} />
             <input type="hidden" name="type" value="tentativa-contato" />
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
