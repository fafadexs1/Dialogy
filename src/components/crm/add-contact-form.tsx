

'use client';

import React, { useState, useEffect, useActionState, useCallback } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { Contact, User, Tag, CustomFieldDefinition } from '@/lib/types';
import { useFormStatus } from 'react-dom';
import { Loader2, Save, Check, ChevronsUpDown, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';
import { saveContactAction } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';
import { getTags, getCustomFieldDefinitions } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '../ui/badge';

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

function MultiSelectTags({ availableTags, initialSelectedTags }: { availableTags: Tag[], initialSelectedTags?: Tag[]}) {
    const [open, setOpen] = useState(false);
    const [selectedTags, setSelectedTags] = useState<Tag[]>(initialSelectedTags || []);

    const toggleTag = (tag: Tag) => {
        setSelectedTags(prev => 
            prev.some(t => t.id === tag.id) 
                ? prev.filter(t => t.id !== tag.id) 
                : [...prev, tag]
        );
    }
    
    return (
         <Popover open={open} onOpenChange={setOpen}>
            {/* Hidden inputs to pass tag IDs to form action */}
            {selectedTags.map(tag => (
                <input key={tag.id} type="hidden" name="tags" value={tag.id} />
            ))}

            <PopoverTrigger asChild>
                <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between h-auto min-h-10"
                >
                <div className="flex flex-wrap gap-1">
                    {selectedTags.length > 0 ? selectedTags.map(tag => (
                        <Badge key={tag.id} style={{backgroundColor: tag.color, color: tag.color.startsWith('#FEE') ? '#000' : '#fff'}} className="border-transparent" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); toggleTag(tag); }}>
                            {tag.label}
                            <X className="ml-1 h-3 w-3" />
                        </Badge>
                    )) : "Selecione as etiquetas..."}
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Buscar etiqueta..." />
                    <CommandList>
                        <CommandEmpty>Nenhuma etiqueta encontrada.</CommandEmpty>
                        <CommandGroup>
                        {availableTags.map((tag) => (
                            <CommandItem
                                key={tag.id}
                                value={tag.label}
                                onSelect={() => toggleTag(tag)}
                            >
                            <Check
                                className={`mr-2 h-4 w-4 ${selectedTags.some(t => t.id === tag.id) ? "opacity-100" : "opacity-0"}`}
                            />
                            {tag.label}
                            </CommandItem>
                        ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

export function AddContactForm({ isOpen, setIsOpen, onSave, contact, workspaceId, agents }: AddContactFormProps) {
  const user = useAuth();
  const [state, formAction] = useActionState(saveContactAction, { success: false, error: null });
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  
  const fetchDropdownData = useCallback(async () => {
      if(isOpen && user?.activeWorkspaceId) {
        getTags(user.activeWorkspaceId).then(res => {
            if (!res.error) setAvailableTags(res.tags || []);
        });
        getCustomFieldDefinitions(user.activeWorkspaceId).then(res => {
            if (!res.error) setCustomFields(res.fields || []);
        });
    }
  }, [isOpen, user?.activeWorkspaceId]);

  useEffect(() => {
    fetchDropdownData();
  }, [fetchDropdownData]);


  useEffect(() => {
    if (state.success) {
        toast({ title: "Contato salvo!", description: "As informações do contato foram salvas com sucesso." });
        onSave();
    }
  }, [state, onSave]);
  
  const renderCustomField = (field: CustomFieldDefinition) => {
    const fieldName = `custom_field_${field.id}`;
    const defaultValue = contact?.custom_fields?.[field.id] || '';

    switch(field.type) {
      case 'select':
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={fieldName}>{field.label}</Label>
            <Select name={fieldName} defaultValue={defaultValue}>
              <SelectTrigger id={fieldName}><SelectValue placeholder={field.placeholder || 'Selecione...'} /></SelectTrigger>
              <SelectContent>
                {field.options?.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      default:
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={fieldName}>{field.label}</Label>
            <Input id={fieldName} name={fieldName} type={field.type} placeholder={field.placeholder} defaultValue={defaultValue} />
          </div>
        )
    }
  }


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
                    <Label htmlFor="phone_number_jid">JID do WhatsApp</Label>
                    <Input id="phone_number_jid" name="phone_number_jid" type="text" placeholder="5511987654321@s.whatsapp.net" defaultValue={contact?.phone_number_jid || ''}/>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input id="email" name="email" type="email" placeholder="joao.silva@email.com" defaultValue={contact?.email || ''}/>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="address">Endereço Completo</Label>
                    <Input id="address" name="address" placeholder="Rua, Número, Bairro, Cidade" defaultValue={contact?.address || ''}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="avatar_url">URL do Avatar</Label>
                    <Input id="avatar_url" name="avatar_url" type="url" placeholder="https://exemplo.com/avatar.png" defaultValue={contact?.avatar_url || ''}/>
                </div>
            </div>
            
            {/* Coluna da Direita */}
            <div className="space-y-4">
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
                 <div className="space-y-2">
                    <Label>Etiquetas (Tags)</Label>
                    <MultiSelectTags availableTags={availableTags} initialSelectedTags={contact?.tags} />
                </div>
                {/* Custom Fields Section */}
                {customFields.length > 0 && (
                    <div className="space-y-4 pt-4 border-t">
                        <h3 className="font-medium text-muted-foreground">Informações Adicionais</h3>
                        <div className="grid grid-cols-1 gap-4">
                            {customFields.map(renderCustomField)}
                        </div>
                    </div>
                )}
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
