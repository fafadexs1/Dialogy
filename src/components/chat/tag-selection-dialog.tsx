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
import { getTags } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Check, Loader2 } from 'lucide-react';
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
  const inputRef = React.useRef<HTMLInputElement>(null);

  const fetchTags = React.useCallback(async () => {
    if (user?.activeWorkspaceId) {
      setLoading(true);
      const tagsResult = await getTags(user.activeWorkspaceId);
      if (tagsResult.tags) {
        setAvailableTags(tagsResult.tags.filter(t => !t.is_close_reason));
      }
      setLoading(false);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (isOpen) {
      fetchTags();
      // Focus the input when the dialog opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
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
          <CommandInput 
            ref={inputRef}
            placeholder="Buscar etiqueta..." 
          />
          <CommandList>
            {loading ? (
                <div className='flex justify-center items-center h-24'><Loader2 className="h-6 w-6 animate-spin"/></div>
            ) : (
                <>
                <CommandEmpty>
                    <div className='p-4 text-center'>
                        <p className='text-sm text-muted-foreground'>Nenhuma etiqueta encontrada.</p>
                        <p className='text-xs text-muted-foreground mt-1'>Crie novas etiquetas nas configurações do CRM.</p>
                    </div>
                </CommandEmpty>
                <CommandGroup>
                {availableTags.map((tag) => (
                    <CommandItem
                        key={tag.id}
                        value={tag.label}
                        onSelect={(currentValue) => {
                            const selectedTag = availableTags.find(t => t.label.toLowerCase() === currentValue);
                            if (selectedTag) {
                                handleSelectTag(selectedTag.id);
                            }
                        }}
                        className="flex justify-between items-center cursor-pointer"
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
        
        <DialogFooter className="sm:justify-start mt-4">
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
