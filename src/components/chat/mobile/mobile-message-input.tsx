'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Plus, Paperclip, Mic, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { cn } from '@/lib/utils';

export interface MobileMessageInputProps {
  chatId: string;
  onSend: (content: string) => Promise<void> | void;
  isSending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function MobileMessageInput({
  chatId,
  onSend,
  isSending = false,
  disabled = false,
  placeholder = 'Mensagem...',
  className,
}: MobileMessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { isOpen: isKeyboardOpen, keyboardHeight } = useVisualViewport();

  // Reset text when switching chats
  useEffect(() => {
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, [chatId]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      // Clamp height between 40px (1 line) and 120px (~4 lines)
      const clampedHeight = Math.min(Math.max(scrollH, 40), 120);
      textareaRef.current.style.height = `${clampedHeight}px`;
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending || disabled) return;

    try {
      await onSend(trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
        textareaRef.current.focus();
      }
    } catch (err) {
      console.error('[MobileMessageInput] Error sending message:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop convenience: Ctrl+Enter or Cmd+Enter sends
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSend();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 w-full border-t border-border/70 bg-background/95 backdrop-blur-md transition-all duration-150',
        className
      )}
      style={{
        paddingBottom: isKeyboardOpen && keyboardHeight > 0
          ? '0.5rem'
          : 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
      }}
    >
      <div className="flex items-end gap-1.5 px-3 pt-2">
        {/* Attachment / Plus Action (44x44px touch target) */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Adicionar anexo"
          className="h-11 w-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </Button>

        {/* Text input with 16px font size to strictly prevent iOS auto-zoom */}
        <div className="flex-1 min-w-0 rounded-2xl bg-muted/50 border border-border/80 px-3.5 py-1.5 focus-within:border-primary/60 focus-within:bg-background transition-colors">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled || isSending}
            placeholder={placeholder}
            className="w-full resize-none bg-transparent text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none leading-relaxed max-h-[120px]"
            style={{ fontSize: '16px' }}
          />
        </div>

        {/* Dynamic Action Button: Send when text exists, Mic when empty */}
        {hasText ? (
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={disabled || isSending}
            aria-label="Enviar mensagem"
            className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-transform shadow-xs"
          >
            <Send className="h-5 w-5" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Gravar áudio"
            className="h-11 w-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95"
          >
            <Mic className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
