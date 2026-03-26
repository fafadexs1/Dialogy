'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { type Chat, type Tag, User } from '@/lib/types';
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
import { toast } from '@/hooks/use-toast';
import { Check, Loader2, Search } from 'lucide-react';
import { updateChatTagAction } from '@/actions/chats';
import { cn } from '@/lib/utils';

interface TagSelectionDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  chat: Chat;
  onUpdate: () => void;
  user: User | null;
}

export function TagSelectionDialog({ isOpen, setIsOpen, chat, onUpdate, user }: TagSelectionDialogProps) {
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

  const fetchTags = React.useCallback(async () => {
    if (!user?.activeWorkspaceId) return;

    setLoading(true);
    const tagsResult = await getTags(user.activeWorkspaceId);
    if (tagsResult.tags) {
      setAvailableTags(tagsResult.tags.filter((tag) => !tag.is_close_reason));
    }
    setLoading(false);
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (isOpen) {
      fetchTags();
    }
  }, [fetchTags, isOpen]);

  const handleSelectTag = async (tagId: string) => {
    setIsSubmitting(tagId);
    const result = await updateChatTagAction(chat.id, tagId);

    if (result.success) {
      toast({ title: 'Tag atualizada!' });
      onUpdate();
      setIsOpen(false);
    } else {
      toast({ title: 'Erro ao atualizar tag', description: result.error, variant: 'destructive' });
    }

    setIsSubmitting(null);
  };

  const filteredTags = useMemo(
    () => availableTags.filter((tag) => tag.label.toLowerCase().includes(searchTerm.toLowerCase())),
    [availableTags, searchTerm]
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md border-slate-200/80 bg-white text-slate-900 shadow-[0_28px_80px_-55px_rgba(15,23,42,0.3)] dark:border-white/10 dark:bg-zinc-950 dark:text-white dark:shadow-[0_28px_80px_-55px_rgba(0,0,0,0.9)]">
        <DialogHeader>
          <DialogTitle>Atribuir etiqueta</DialogTitle>
          <DialogDescription className="text-slate-500 dark:text-zinc-400">
            Selecione uma etiqueta para organizar a conversa com {chat.contact.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
          <Input
            placeholder="Buscar etiqueta..."
            className="border-slate-200 bg-slate-50 pl-9 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500/30 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-500"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <ScrollArea className="h-48">
          <div className="space-y-2 p-1">
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              </div>
            ) : filteredTags.length > 0 ? (
              filteredTags.map((tag) => (
                <Button
                  key={tag.id}
                  variant="ghost"
                  className={cn(
                    'w-full justify-start gap-2 text-slate-900 hover:bg-slate-100 dark:text-white dark:hover:bg-white/5',
                    chat.tag === tag.label && 'bg-slate-100 dark:bg-white/5'
                  )}
                  onClick={() => handleSelectTag(tag.id)}
                  disabled={Boolean(isSubmitting)}
                >
                  {isSubmitting === tag.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                  )}
                  {tag.label}
                  {chat.tag === tag.label && <Check className="ml-auto h-4 w-4" />}
                </Button>
              ))
            ) : (
              <div className="p-4 text-center">
                <p className="text-sm text-slate-500 dark:text-zinc-400">Nenhuma etiqueta encontrada.</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">Crie novas etiquetas nas configuracoes do CRM.</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4 sm:justify-start">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsOpen(false)}
            className="border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
