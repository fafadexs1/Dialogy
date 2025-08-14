'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getTags } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Check, Loader2, Search } from 'lucide-react';
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
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

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
    }
  }, [isOpen, fetchTags]);
  
  const handleSelectTag = async (tagId: string) => {
    setIsSubmitting(tagId);
    const result = await updateChatTagAction(chat.id, tagId);
    if(result.success) {
        toast({ title: 'Tag atualizada!'})
        onUpdate();
        setIsOpen(false);
    } else {
        toast({ title: 'Erro ao atualizar tag', description: result.error, variant: 'destructive'})
    }
    setIsSubmitting(null);
  }

  const filteredTags = useMemo(() => 
    availableTags.filter(tag => 
      tag.label.toLowerCase().includes(searchTerm.toLowerCase())
    ), [availableTags, searchTerm]
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir Etiqueta (Tag)</DialogTitle>
          <DialogDescription>
            Selecione uma etiqueta para organizar a conversa com {chat.contact.name}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar etiqueta..." 
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <ScrollArea className="h-48">
          <div className="space-y-2 p-1">
          {loading ? (
              <div className='flex justify-center items-center h-24'><Loader2 className="h-6 w-6 animate-spin"/></div>
          ) : filteredTags.length > 0 ? (
              filteredTags.map((tag) => (
                  <Button
                      key={tag.id}
                      variant={chat.tag === tag.label ? "secondary" : "ghost"}
                      className="w-full justify-start gap-2"
                      onClick={() => handleSelectTag(tag.id)}
                      disabled={!!isSubmitting}
                  >
                      {isSubmitting === tag.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      )}
                      {tag.label}
                      {chat.tag === tag.label && <Check className="h-4 w-4 ml-auto" />}
                  </Button>
              ))
            ) : (
                <div className='p-4 text-center'>
                    <p className='text-sm text-muted-foreground'>Nenhuma etiqueta encontrada.</p>
                    <p className='text-xs text-muted-foreground mt-1'>Crie novas etiquetas nas configurações do CRM.</p>
                </div>
            )}
          </div>
        </ScrollArea>
        
        <DialogFooter className="sm:justify-start mt-4">
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}