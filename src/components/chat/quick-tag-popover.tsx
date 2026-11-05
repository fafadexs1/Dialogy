'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Tags } from 'lucide-react';

import { toggleChatTagAction } from '@/actions/chats';
import { getTags } from '@/actions/crm';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { toast } from '@/hooks/use-toast';
import type { Chat, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';

// Cache por workspace: o popover abre instantaneamente a partir do 2º uso.
const tagsCache = new Map<string, Tag[]>();

const isTeamTag = (tag: Tag, teamId?: string | null) => Boolean(teamId && tag.team_ids?.includes(teamId));

/**
 * Classificação em 2 cliques direto no item da lista: clique no ícone e escolha a tag.
 * Não navega, não seleciona a conversa e não recarrega a página; só o cliente muda de lugar.
 */
export function QuickTagPopover({ chat, onUpdate }: { chat: Chat; onUpdate: () => void }) {
  const updateChat = useInboxStore((state) => state.updateChat);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>(() => tagsCache.get(chat.workspace_id) ?? []);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || tags.length > 0) return;
    let active = true;
    setLoading(true);
    void getTags(chat.workspace_id)
      .then((result) => {
        if (!active) return;
        const list = (result.tags || []).filter((tag) => !tag.is_close_reason);
        tagsCache.set(chat.workspace_id, list);
        setTags(list);
        if (result.error) toast({ title: 'Não foi possível carregar as etiquetas', description: result.error, variant: 'destructive' });
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, tags.length, chat.workspace_id]);

  const selectedIds = useMemo(() => new Set((chat.tags || []).map((tag) => tag.id)), [chat.tags]);
  const available = useMemo(() => tags.filter((tag) => !isTeamTag(tag, chat.team_id)), [tags, chat.team_id]);

  const toggle = async (tag: Tag) => {
    if (pendingId) return;
    setPendingId(tag.id);
    const result = await toggleChatTagAction(chat.id, tag.id, !selectedIds.has(tag.id));
    setPendingId(null);
    if (!result.success || !result.tags) {
      toast({ title: 'Não foi possível classificar', description: result.error, variant: 'destructive' });
      return;
    }
    updateChat(chat.id, { tags: result.tags });
    setOpen(false);
    onUpdate();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Classificar contato"
          title="Classificar"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-white/10"
        >
          <Tags className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        onClick={(event) => event.stopPropagation()}
        className="w-60 p-1"
      >
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-blue-500" /></div>
          ) : available.length ? available.map((tag) => {
            const selected = selectedIds.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                disabled={Boolean(pendingId)}
                onClick={() => void toggle(tag)}
                className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-slate-50 dark:hover:bg-white/[0.06]', pendingId && 'opacity-60')}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                {pendingId === tag.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selected && <Check className="h-3.5 w-3.5 text-blue-600" />}
              </button>
            );
          }) : <p className="py-6 text-center text-xs text-slate-400">Nenhuma etiqueta encontrada.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
