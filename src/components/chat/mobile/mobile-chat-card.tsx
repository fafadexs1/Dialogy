'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { MessageSquare } from 'lucide-react';
import type { Chat } from '@/lib/types';
import { cn, formatMessageDate } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export interface MobileChatCardProps {
  chat: Chat;
  isSelected?: boolean;
  onClick: () => void;
  className?: string;
}

export function formatCardTimestamp(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday ? format(d, 'HH:mm', { locale: ptBR }) : format(d, 'dd/MM', { locale: ptBR });
  } catch {
    return '';
  }
}

export function ChannelIcon({ instanceType, source }: { instanceType?: string; source?: string }) {
  const channel = (source || instanceType || '').toLowerCase();
  if (channel.includes('instagram')) {
    return <FaInstagram className="h-3.5 w-3.5 text-pink-500 shrink-0" />;
  }
  if (channel.includes('messenger') || channel.includes('facebook')) {
    return <FaFacebookMessenger className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
  }
  if (channel.includes('telegram')) {
    return <FaTelegram className="h-3.5 w-3.5 text-sky-500 shrink-0" />;
  }
  return <FaWhatsapp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
}

export function MobileChatCard({
  chat,
  isSelected = false,
  onClick,
  className,
}: MobileChatCardProps) {
  const contact = chat.contact;
  const name = contact?.name || contact?.phone || 'Contato sem nome';
  const avatarUrl = contact?.avatar_url;
  const unreadCount = chat.unreadCount || 0;

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'C';

  const lastMessage = chat.messages?.[chat.messages.length - 1];
  const previewText = lastMessage
    ? lastMessage.type === 'audio'
      ? '🎤 Áudio'
      : lastMessage.type === 'image'
      ? '📷 Imagem'
      : lastMessage.type === 'document'
      ? '📄 Documento'
      : lastMessage.content
    : 'Nenhuma mensagem recente';

  const timestamp = formatCardTimestamp(lastMessage?.createdAt || chat.updatedAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors select-none active:bg-muted/70 hover:bg-muted/40 cursor-pointer min-h-[72px] border-b border-border/40',
        isSelected ? 'bg-muted/60' : 'bg-background',
        className
      )}
    >
      {/* Avatar with unread indicator dot */}
      <div className="relative shrink-0">
        <Avatar className="h-12 w-12 border border-border/60">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-0.5 shadow-xs">
          <ChannelIcon instanceType={chat.instance_type} source={chat.source} />
        </div>
      </div>

      {/* Center Details: Name + Message Preview */}
      <div className="flex flex-1 flex-col min-w-0 justify-center">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-semibold text-[14.5px] text-foreground truncate max-w-[200px] sm:max-w-[280px]">
            {name}
          </span>
          <span className={cn('text-[11px] shrink-0', unreadCount > 0 ? 'text-primary font-medium' : 'text-muted-foreground')}>
            {timestamp}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground truncate line-clamp-1 flex-1 leading-snug">
            {previewText}
          </p>

          {/* Unread Pill Badge */}
          {unreadCount > 0 ? (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground shadow-xs shrink-0">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
