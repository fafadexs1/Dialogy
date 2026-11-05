'use client';

import React from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Chat } from '@/lib/types';
import { isChatInInboxQueueScope } from '@/lib/inbox-pagination';
import { cn } from '@/lib/utils';

export interface MobileChatHeaderProps {
  chat: Chat;
  onBack: () => void;
  onOpenContactSheet?: () => void;
  className?: string;
}

export function MobileChatHeader({
  chat,
  onBack,
  onOpenContactSheet,
  className,
}: MobileChatHeaderProps) {
  const contactName = chat.contact?.name || 'Cliente';
  const contactPhone = chat.contact?.phone || '';
  const avatarUrl = chat.contact?.avatar_url || undefined;

  const initials = contactName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'C';

  const isRobo = isChatInInboxQueueScope(chat, 'robo');
  const statusLabel =
    chat.status === 'atendimentos'
      ? 'Em Atendimento'
      : chat.status === 'encerrados'
      ? 'Encerrado'
      : isRobo
      ? 'Robô'
      : 'Fila Geral';

  const statusColor =
    chat.status === 'atendimentos'
      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200'
      : chat.status === 'encerrados'
      ? 'bg-muted text-muted-foreground border-border'
      : isRobo
      ? 'bg-purple-500/10 text-purple-600 border-purple-200'
      : 'bg-amber-500/10 text-amber-600 border-amber-200';

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex items-center justify-between border-b border-border/80 bg-background/95 px-2 py-2 backdrop-blur-md safe-area-top min-h-[56px]',
        className
      )}
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {/* Back Button (min 44x44px touch target) */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Voltar para a lista de conversas"
          className="h-11 w-11 shrink-0 rounded-full text-foreground hover:bg-muted/80 active:scale-95 transition-transform"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Contact info trigger area */}
        <button
          type="button"
          onClick={onOpenContactSheet}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left py-1 px-1.5 rounded-xl hover:bg-muted/50 active:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-10 w-10 shrink-0 border border-border/60">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={contactName} /> : null}
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm text-foreground truncate max-w-[180px] sm:max-w-[240px]">
                {contactName}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate max-w-[120px]">{contactPhone || chat.protocol}</span>
              <span className="text-[10px] opacity-40">•</span>
              <span className={cn('text-[10px] font-medium px-1.5 py-0.2 rounded-full border', statusColor)}>
                {statusLabel}
              </span>
            </div>
          </div>
        </button>
      </div>

      {/* Info / Action Button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onOpenContactSheet}
        aria-label="Ver detalhes e ações do contato"
        className="h-11 w-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95"
      >
        <Info className="h-5 w-5" />
      </Button>
    </header>
  );
}
