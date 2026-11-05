'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Search, X, Loader2, Bot, Users, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MobileChatCard } from './mobile-chat-card';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { isChatInInboxQueueScope, type InboxTabId } from '@/lib/inbox-pagination';
import { isChatVisibleForOwnership } from '@/lib/inbox-ownership';
import type { Chat, User } from '@/lib/types';
import type { MobileInboxTab, MobileChatListProps } from '@/types/mobile-chat';
import { cn } from '@/lib/utils';

interface TabConfig {
  id: MobileInboxTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabConfig[] = [
  { id: 'robo', label: 'Robô', icon: Bot },
  { id: 'gerais', label: 'Fila', icon: Users },
  { id: 'atendimentos', label: 'Atendendo', icon: MessageSquare },
  { id: 'encerrados', label: 'Encerrados', icon: CheckCircle2 },
];

export function MobileChatList({
  chats,
  selectedChatId,
  onSelectChat,
  currentUser,
  ownershipFilter,
  onOwnershipFilterChange,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  className,
}: MobileChatListProps) {
  const [activeTab, setActiveTab] = useState<MobileInboxTab>('atendimentos');
  const [searchQuery, setSearchQuery] = useState('');

  // Live queue counts from global Zustand store
  const inboxCounts = useInboxStore((state) => state.inboxCounts);

  // Filter chats by Tab, Search query, and Ownership
  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return chats.filter((chat) => {
      // 1. Tab filter
      let matchesTab = false;
      if (activeTab === 'robo') {
        matchesTab = chat.status === 'gerais' && isChatInInboxQueueScope(chat, 'robo');
      } else if (activeTab === 'gerais') {
        matchesTab = chat.status === 'gerais' && isChatInInboxQueueScope(chat, 'fila');
      } else if (activeTab === 'atendimentos') {
        matchesTab = chat.status === 'atendimentos';
      } else if (activeTab === 'encerrados') {
        matchesTab = chat.status === 'encerrados';
      }

      if (!matchesTab) return false;

      // 2. Ownership filter (only for Atendendo and Encerrados)
      if (activeTab === 'atendimentos' || activeTab === 'encerrados') {
        const isVisible = isChatVisibleForOwnership(
          {
            id: chat.id,
            status: chat.status,
            agent_id: chat.agentId || chat.agent?.id || null,
          },
          ownershipFilter,
          currentUser?.id
        );
        if (!isVisible) return false;
      }

      // 3. Search query filter
      if (q) {
        const name = chat.contact?.name?.toLowerCase() || '';
        const phone = chat.contact?.phone?.toLowerCase() || '';
        const protocol = chat.protocol?.toLowerCase() || '';
        if (!name.includes(q) && !phone.includes(q) && !protocol.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [activeTab, chats, currentUser?.id, ownershipFilter, searchQuery]);

  return (
    <div
      className={cn(
        'mobile-chat-screen flex h-[100dvh] w-full flex-col overflow-hidden bg-background',
        className
      )}
    >
      {/* Top Header & Search Area */}
      <header className="safe-area-top shrink-0 border-b border-border/80 bg-background/95 px-4 pt-3 pb-2.5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Conversas</h1>

          {/* Ownership Toggle (Meus vs Todos) */}
          <div className="flex items-center rounded-xl bg-muted/70 p-0.5 text-xs font-medium border border-border/60">
            <button
              type="button"
              onClick={() => onOwnershipFilterChange('mine')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition-all text-xs font-medium',
                ownershipFilter === 'mine'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Meus
            </button>
            <button
              type="button"
              onClick={() => onOwnershipFilterChange('everyone')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition-all text-xs font-medium',
                ownershipFilter === 'everyone'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Todos
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome, telefone..."
            className="h-10 pl-9 pr-9 rounded-xl bg-muted/50 border-border/70 text-sm placeholder:text-muted-foreground/70 focus-visible:bg-background"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      {/* Horizontal Queue Tabs */}
      <nav
        aria-label="Filas de atendimento"
        className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 border-b border-border/60 bg-muted/20 shrink-0 no-scrollbar"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = inboxCounts?.[tab.id] ?? 0;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all select-none active:scale-95',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                  : 'bg-background text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border/60'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
              <span>{tab.label}</span>
              {count > 0 ? (
                <span
                  className={cn(
                    'flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted-foreground/15 text-muted-foreground'
                  )}
                >
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Chat Cards List */}
      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-border/30">
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground h-64">
            <p className="text-sm font-medium">Nenhuma conversa encontrada.</p>
            <p className="text-xs mt-1 text-muted-foreground/80">
              {searchQuery ? 'Tente buscar com outro termo.' : 'Esta fila está sem atendimentos no momento.'}
            </p>
          </div>
        ) : (
          filteredChats.map((chat) => (
            <MobileChatCard
              key={chat.id}
              chat={chat}
              isSelected={chat.id === selectedChatId}
              onClick={() => onSelectChat(chat.id)}
            />
          ))
        )}

        {/* Load More Trigger */}
        {hasMore && onLoadMore ? (
          <div className="flex justify-center p-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="rounded-xl text-xs"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Carregando...
                </>
              ) : (
                'Carregar mais conversas'
              )}
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
