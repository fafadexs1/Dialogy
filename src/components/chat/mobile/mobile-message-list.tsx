'use client';

import React, { useEffect, useRef } from 'react';
import { Check, CheckCheck, Clock, AlertCircle, Play, Pause, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Message } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface MobileMessageListProps {
  messages: Message[];
  isLoading?: boolean;
  className?: string;
}

export function formatTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return format(d, 'HH:mm', { locale: ptBR });
  } catch {
    return '';
  }
}

export function MobileMessageStatusIcon({ message }: { message: Message }) {
  const apiStatus = message.api_message_status?.toUpperCase();

  if (apiStatus === 'READ') {
    return <CheckCheck className="h-3.5 w-3.5 text-blue-500" />;
  }
  if (apiStatus === 'DELIVERED') {
    return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (apiStatus === 'SENT' || message.status === 'default') {
    return <Check className="h-3 w-3 text-muted-foreground" />;
  }
  if (apiStatus === 'FAILED' || message.status === 'deleted') {
    return <AlertCircle className="h-3 w-3 text-destructive" />;
  }
  return <Clock className="h-3 w-3 text-muted-foreground" />;
}

export function MobileAudioPlayer({ url, transcription }: { url: string; transcription?: string | null }) {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 py-1 min-w-[200px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className="h-9 w-9 shrink-0 rounded-full bg-primary/20 text-primary flex items-center justify-center hover:bg-primary/30 active:scale-95 transition-transform"
          aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>
        <audio
          ref={audioRef}
          src={url}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          preload="metadata"
        />
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={cn('h-full bg-primary transition-all duration-300', isPlaying ? 'w-2/3 animate-pulse' : 'w-0')} />
        </div>
      </div>
      {transcription ? (
        <p className="text-xs text-muted-foreground italic bg-background/40 p-1.5 rounded-md border border-border/40">
          &ldquo;{transcription}&rdquo;
        </p>
      ) : null}
    </div>
  );
}

export function MobileMessageBubble({ message }: { message: Message }) {
  const isFromMe = Boolean(message.from_me);
  const isSystem = message.type === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2 px-4">
        <span className="text-[11px] font-medium bg-muted/80 text-muted-foreground px-3 py-1 rounded-full text-center max-w-[85%] border border-border/40">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex w-full my-1 px-3',
        isFromMe ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'relative max-w-[82%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 shadow-xs transition-colors',
          isFromMe
            ? 'bg-primary text-primary-foreground rounded-br-xs'
            : 'bg-card text-card-foreground border border-border/60 rounded-bl-xs'
        )}
      >
        {/* Content based on type */}
        {message.type === 'image' ? (
          <div className="mb-1 overflow-hidden rounded-xl">
            <img
              src={message.content}
              alt="Anexo de imagem"
              className="max-h-60 w-auto rounded-xl object-cover"
              loading="lazy"
            />
          </div>
        ) : message.type === 'audio' ? (
          <MobileAudioPlayer url={message.content} transcription={message.transcription} />
        ) : message.type === 'document' ? (
          <div className="flex items-center gap-2 py-1">
            <FileText className="h-6 w-6 shrink-0 opacity-80" />
            <span className="text-xs font-medium truncate max-w-[180px]">{message.content}</span>
          </div>
        ) : (
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text">
            {message.content}
          </p>
        )}

        {/* Footer info: time + delivery status */}
        <div
          className={cn(
            'flex items-center justify-end gap-1 mt-0.5 select-none text-[10px]',
            isFromMe ? 'text-primary-foreground/75' : 'text-muted-foreground'
          )}
        >
          <span>{formatTime(message.createdAt)}</span>
          {isFromMe ? <MobileMessageStatusIcon message={message} /> : null}
        </div>
      </div>
    </div>
  );
}

export function MobileMessageList({ messages, isLoading, className }: MobileMessageListProps) {
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  return (
    <div
      className={cn(
        'flex-1 min-h-0 overflow-y-auto overscroll-contain py-2 px-1 flex flex-col',
        className
      )}
    >
      {isLoading ? (
        <div className="flex justify-center py-4">
          <span className="text-xs text-muted-foreground animate-pulse">Carregando mensagens...</span>
        </div>
      ) : null}

      {messages.length === 0 && !isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
          <p className="text-sm font-medium">Nenhuma mensagem nesta conversa.</p>
          <p className="text-xs mt-1">Envie uma mensagem abaixo para iniciar o diálogo.</p>
        </div>
      ) : null}

      {messages.map((msg) => (
        <MobileMessageBubble key={msg.id} message={msg} />
      ))}

      <div ref={bottomAnchorRef} className="h-2 shrink-0" />
    </div>
  );
}
