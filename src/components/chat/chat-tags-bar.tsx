'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Loader2, Plus, Search, Tags } from 'lucide-react';

import { toggleChatTagAction } from '@/actions/chats';
import { createTag, getTags } from '@/actions/crm';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import type { Chat, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';

const MAX_VISIBLE_TAGS = 5;

function tagStyle(tag: Tag) {
  const color = /^#[0-9a-f]{6}$/i.test(tag.color || '') ? tag.color : '#64748b';
  return { borderColor: `${color}24`, backgroundColor: `${color}0d` };
}

function isTagFromCurrentTeam(tag: Tag, teamId?: string) {
  return Boolean(teamId && tag.team_ids?.includes(teamId));
}

export function ChatTagsBar({ chat, onUpdate }: { chat: Chat; onUpdate: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>(
    (chat.tags || []).filter((tag) => !isTagFromCurrentTeam(tag, chat.team_id))
  );
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  useEffect(
    () => setSelectedTags((chat.tags || []).filter((tag) => !isTagFromCurrentTeam(tag, chat.team_id))),
    [chat.id, chat.tags, chat.team_id]
  );

  useEffect(() => {
    if (!open || availableTags.length > 0) return;
    let active = true;
    setLoading(true);
    void getTags(chat.workspace_id).then((result) => {
      if (!active) return;
      if (result.tags) setAvailableTags(result.tags.filter((tag) => !tag.is_close_reason && !isTagFromCurrentTeam(tag, chat.team_id)));
      else if (result.error) toast({ title: 'Não foi possível carregar as etiquetas', description: result.error, variant: 'destructive' });
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [availableTags.length, chat.team_id, chat.workspace_id, open, toast]);

  const selectedIds = useMemo(() => new Set(selectedTags.map((tag) => tag.id)), [selectedTags]);
  const filteredTags = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return term ? availableTags.filter((tag) => tag.label.toLocaleLowerCase('pt-BR').includes(term)) : availableTags;
  }, [availableTags, search]);
  const visibleTags = selectedTags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenCount = Math.max(0, selectedTags.length - visibleTags.length);

  const toggleTag = async (tag: Tag) => {
    if (pendingTagId) return;
    setPendingTagId(tag.id);
    const result = await toggleChatTagAction(chat.id, tag.id, !selectedIds.has(tag.id));
    setPendingTagId(null);
    if (!result.success || !result.tags) {
      toast({ title: 'Não foi possível atualizar as etiquetas', description: result.error, variant: 'destructive' });
      return;
    }
    setSelectedTags(result.tags.filter((item) => !isTagFromCurrentTeam(item, chat.team_id)));
    startRefresh(() => onUpdate());
  };

  const handleCreateTag = async () => {
    const label = newTagLabel.trim();
    if (!label || isCreatingTag) return;
    setIsCreatingTag(true);
    const result = await createTag(chat.workspace_id, label, '#2563eb', false, []);
    if (!result.success) {
      toast({ title: 'Não foi possível criar a tag', description: result.error, variant: 'destructive' });
      setIsCreatingTag(false);
      return;
    }
    const refreshed = await getTags(chat.workspace_id);
    setAvailableTags((refreshed.tags || []).filter((tag) => !tag.is_close_reason && !isTagFromCurrentTeam(tag, chat.team_id)));
    setNewTagLabel('');
    setCreatingTag(false);
    setIsCreatingTag(false);
  };

  const orderedTags = useMemo(() => {
    return [...filteredTags].sort((left, right) => Number(selectedIds.has(right.id)) - Number(selectedIds.has(left.id)));
  }, [filteredTags, selectedIds]);

  return (
    <div data-chat-tags-bar className="z-[19] flex h-[58px] shrink-0 items-center overflow-hidden border-b border-slate-200 bg-white px-3 md:px-[clamp(18px,2vw,30px)] dark:border-white/10 dark:bg-[#050507]">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mr-1 flex h-9 shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
          <Tags className="h-3.5 w-3.5" />
          <span>Classificação</span>
        </div>
        {visibleTags.map((tag) => (
          <div key={tag.id} className="flex h-9 max-w-[190px] shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-medium text-slate-700 dark:text-zinc-100" style={tagStyle(tag)} title={tag.label}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
            <span className="truncate">{tag.label}</span>
          </div>
        ))}
        {hiddenCount > 0 && <span className="flex h-9 shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-400">+{hiddenCount}</span>}

        <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setCreatingTag(false); }}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Adicionar tags" className="h-9 w-9 shrink-0 rounded-xl border-blue-500 bg-white text-slate-700 shadow-[0_0_0_1px_rgba(37,99,235,0.15)] hover:border-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:bg-transparent dark:text-white dark:hover:bg-blue-500/10">
              <Plus className="h-[18px] w-[18px]" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-[310px] overflow-hidden rounded-xl border-slate-200 bg-white p-0 shadow-[0_18px_45px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-zinc-950">
            <div className="px-5 pb-3 pt-4">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Adicionar tags</p>
            </div>
            <div className="px-5 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tags..." className="h-11 rounded-lg border-slate-200 bg-white pl-9 text-sm shadow-none placeholder:text-slate-400 dark:bg-white/[0.04]" />
            </div>
            <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Usadas recentemente</p>
            <ScrollArea className="h-[210px]">
              <div className="space-y-0.5 pr-1">
                {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div> : orderedTags.length ? orderedTags.map((tag) => {
                  const selected = selectedIds.has(tag.id);
                  return (
                    <label key={tag.id} htmlFor={`chat-tag-${tag.id}`} className={cn('flex h-8 w-full cursor-pointer items-center gap-3 rounded-md px-0.5 text-left text-[13px] transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]', pendingTagId && 'pointer-events-none opacity-60')}>
                      {pendingTagId === tag.id ? <span className="flex h-4 w-4 items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /></span> : <Checkbox id={`chat-tag-${tag.id}`} checked={selected} disabled={Boolean(pendingTagId)} onCheckedChange={() => void toggleTag(tag)} className="h-4 w-4 rounded-[3px] border-slate-300 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600" />}
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-zinc-200">{tag.label}</span>
                    </label>
                  );
                }) : <p className="py-8 text-center text-xs text-slate-400">Nenhuma etiqueta encontrada.</p>}
              </div>
            </ScrollArea>
          </div>
            <div className="border-t border-slate-100 px-4 py-3 dark:border-white/10">
              {creatingTag ? (
                <div className="flex items-center gap-2">
                  <Input autoFocus value={newTagLabel} onChange={(event) => setNewTagLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateTag(); if (event.key === 'Escape') setCreatingTag(false); }} placeholder="Nome da nova tag" className="h-9 text-xs" />
                  <Button type="button" size="sm" disabled={!newTagLabel.trim() || isCreatingTag} onClick={() => void handleCreateTag()} className="h-9 px-3 text-xs">
                    {isCreatingTag ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Criar'}
                  </Button>
                </div>
              ) : (
                <button type="button" onClick={() => setCreatingTag(true)} className="flex h-8 items-center gap-2 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-50"><Plus className="h-3.5 w-3.5" /></span>
                  Criar nova tag
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {isRefreshing && <span className="sr-only" role="status">Atualizando atendimento</span>}
    </div>
  );
}
