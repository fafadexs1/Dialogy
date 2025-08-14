
'use client';

import React, { useState, useEffect } from 'react';
import { type Chat, type Tag } from '@/lib/types';
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { createTag, getTags, updateTag } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Check, Loader2, Palette, Plus } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { updateChatTagAction } from '@/actions/chats';

interface TagSelectionDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  chat: Chat;
  onUpdate: () => void;
}

export function TagSelectionDialog({ isOpen, setIsOpen, chat, onUpdate }: TagSelectionDialogProps) {
  const user = useAuth();
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#cccccc');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchTags = React.useCallback(async () => {
    if (user?.activeWorkspaceId) {
      setLoading(true);
      const tagsResult = await getTags(user.activeWorkspaceId);
      if (tagsResult.tags) {
        setAvailableTags(tagsResult.tags);
      }
      setLoading(false);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (isOpen) {
      fetchTags();
    }
  }, [isOpen, fetchTags]);
  
  const handleSelectTag = async (tagId: string) => {
    const result = await updateChatTagAction(chat.id, tagId);
    if(result.success) {
        toast({ title: 'Tag atualizada!'})
        onUpdate();
        setIsOpen(false);
    } else {
        toast({ title: 'Erro ao atualizar tag', description: result.error, variant: 'destructive'})
    }
  }

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagLabel.trim() || !user?.activeWorkspaceId) return;

    setIsSubmitting(true);
    const result = await createTag(user.activeWorkspaceId, newTagLabel, newTagColor, false);
    if (result.success) {
      toast({ title: 'Nova tag criada!' });
      setNewTagLabel('');
      setNewTagColor('#cccccc');
      setShowNewTagForm(false);
      fetchTags(); // Refresh the list
    } else {
      toast({ title: 'Erro ao criar tag', description: result.error, variant: 'destructive' });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir Etiqueta (Tag)</DialogTitle>
          <DialogDescription>
            Selecione uma etiqueta para organizar a conversa com {chat.contact.name}.
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Buscar etiqueta..." />
          <CommandList>
            {loading ? (
                <div className='flex justify-center items-center h-24'><Loader2 className="h-6 w-6 animate-spin"/></div>
            ) : (
                <>
                <CommandEmpty>
                    <div className='p-4 text-center'>
                    <p className='text-sm text-muted-foreground'>Nenhuma etiqueta encontrada.</p>
                     <Button variant="link" onClick={() => setShowNewTagForm(true)}>Criar uma nova</Button>
                    </div>
                </CommandEmpty>
                <CommandGroup>
                {availableTags.map((tag) => (
                    <CommandItem
                        key={tag.id}
                        value={tag.label}
                        onSelect={() => handleSelectTag(tag.id)}
                        className="flex justify-between items-center"
                    >
                    <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                        {tag.label}
                    </div>
                    {chat.tag === tag.label && <Check className="h-4 w-4" />}
                    </CommandItem>
                ))}
                </CommandGroup>
                </>
            )}
          </CommandList>
        </Command>

        {!showNewTagForm ? (
            <Button variant="ghost" onClick={() => setShowNewTagForm(true)} className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> Criar nova etiqueta
            </Button>
        ) : (
            <form onSubmit={handleCreateTag} className="mt-4 p-4 border rounded-lg bg-secondary/50 animate-in fade-in-50 space-y-4">
                <p className='text-sm font-medium'>Nova Etiqueta</p>
                <div className="flex items-end gap-2">
                    <div className='flex-1'>
                        <Label htmlFor="new-tag-label" className='text-xs'>Nome</Label>
                        <Input
                            id="new-tag-label"
                            placeholder="Ex: Comercial, Suporte N2"
                            value={newTagLabel}
                            onChange={(e) => setNewTagLabel(e.target.value)}
                            className='h-9 bg-background'
                        />
                    </div>
                    <div>
                        <Label htmlFor="new-tag-color" className='text-xs'>Cor</Label>
                        <div className="flex items-center gap-2 border rounded-md h-9 px-2 bg-background">
                            <Palette className="h-4 w-4 text-muted-foreground"/>
                            <input
                                id="new-tag-color"
                                type="color"
                                value={newTagColor}
                                onChange={(e) => setNewTagColor(e.target.value)}
                                className="w-5 h-5 p-0 border-none bg-transparent"
                            />
                        </div>
                    </div>
                </div>
                 <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewTagForm(false)}>Cancelar</Button>
                    <Button type="submit" size="sm" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar
                    </Button>
                </div>
            </form>
        )}

        <DialogFooter className="sm:justify-start mt-4">
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
