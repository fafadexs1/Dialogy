'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Phone,
  Mail,
  Hash,
  ArrowRightLeft,
  MessageSquarePlus,
  Copy,
  ExternalLink,
  Clock,
  Shield,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TransferChatDialog, ResumeConversationDialog } from '../contact-panel';
import { CloseChatDialog } from '../chat-panel';
import { toast } from '@/hooks/use-toast';
import type { Chat, User, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface MobileContactSheetProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  currentUser: User;
  closeReasons?: Tag[];
  onTransferSuccess?: () => void;
  onCloseSuccess?: () => void;
}

export function MobileContactSheet({
  isOpen,
  onClose,
  chat,
  currentUser,
  closeReasons = [],
  onTransferSuccess,
  onCloseSuccess,
}: MobileContactSheetProps) {
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);

  const contact = chat.contact;
  if (!contact) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copiado!', description: `${label} copiado para a área de transferência.` });
  };

  const isChatOpen = chat.status === 'atendimentos' || chat.status === 'gerais';

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="bottom"
          className="flex h-[88vh] flex-col gap-0 overflow-hidden rounded-t-[28px] border-t border-border bg-background p-0 pb-[env(safe-area-inset-bottom,0px)]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Detalhes e Gestão do Contato</SheetTitle>
            <SheetDescription>Ações de transferência, encerramento e dados cadastrais</SheetDescription>
          </SheetHeader>

          {/* Drag Handle Bar */}
          <div className="w-full h-6 flex items-center justify-center pt-2.5 shrink-0">
            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/20" />
          </div>

          {/* Contact Hero */}
          <div className="flex flex-col items-center px-6 pb-6 pt-2 shrink-0">
            <Avatar className="h-20 w-20 border-2 border-border shadow-xs mb-3">
              {contact.avatar_url ? <AvatarImage src={contact.avatar_url} alt={contact.name} /> : null}
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">
                {contact.name?.substring(0, 2).toUpperCase() || 'C'}
              </AvatarFallback>
            </Avatar>

            <h2 className="text-xl font-bold tracking-tight text-foreground text-center line-clamp-1">
              {contact.name || contact.phone || 'Contato Desconhecido'}
            </h2>

            {contact.email ? (
              <p className="text-xs text-muted-foreground mt-0.5">{contact.email}</p>
            ) : null}

            {/* Quick Operational Actions (1 to 2 taps) */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs mt-5">
              {/* Transfer Action */}
              <TransferChatDialog
                chat={chat}
                currentUser={currentUser}
                onTransferSuccess={() => {
                  onTransferSuccess?.();
                  onClose();
                }}
                disabled={chat.status === 'encerrados'}
                trigger={
                  <Button
                    variant="outline"
                    className="flex h-13 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card hover:bg-muted active:scale-95 transition-all shadow-xs"
                  >
                    <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                    <span className="text-[11px] font-medium text-foreground">Transferir</span>
                  </Button>
                }
              />

              {/* Close Action (if open) or Reopen (if closed) */}
              {isChatOpen ? (
                <Button
                  variant="outline"
                  onClick={() => setIsCloseDialogOpen(true)}
                  className="flex h-13 flex-col items-center justify-center gap-1 rounded-2xl border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-destructive active:scale-95 transition-all shadow-xs"
                >
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-[11px] font-medium text-destructive">Encerrar</span>
                </Button>
              ) : (
                <ResumeConversationDialog
                  chat={chat}
                  currentUser={currentUser}
                  onSuccess={() => {
                    onTransferSuccess?.();
                    onClose();
                  }}
                  trigger={
                    <Button
                      variant="outline"
                      className="flex h-13 flex-col items-center justify-center gap-1 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-600 active:scale-95 transition-all shadow-xs"
                    >
                      <MessageSquarePlus className="h-4 w-4 text-emerald-500" />
                      <span className="text-[11px] font-medium text-emerald-600">Reabrir</span>
                    </Button>
                  }
                />
              )}
            </div>
          </div>

          {/* Scrollable Information Body */}
          <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-5">
            {/* Tags Section */}
            {contact.tags && contact.tags.length > 0 ? (
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Etiquetas
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {contact.tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="border border-border/80 bg-muted/60 px-2.5 py-0.5 text-xs font-normal"
                      style={{ borderLeft: `3px solid ${tag.color || '#3b82f6'}` }}
                    >
                      {tag.label}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Contact Details Section */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Dados do Atendimento
              </span>
              <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-3 shadow-xs">
                {/* Protocol */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-7 w-7 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
                      <Hash className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-muted-foreground">Protocolo</span>
                      <span className="text-xs font-semibold text-foreground truncate">
                        {chat.protocol || 'N/A'}
                      </span>
                    </div>
                  </div>
                  {chat.protocol ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => copyToClipboard(chat.protocol!, 'Protocolo')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>

                <div className="h-px bg-border/60" />

                {/* Phone */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                      <Phone className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-muted-foreground">Telefone</span>
                      <span className="text-xs font-semibold text-foreground truncate">
                        {contact.phone || 'N/A'}
                      </span>
                    </div>
                  </div>
                  {contact.phone ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => copyToClipboard(contact.phone!, 'Telefone')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>

                {/* Activity Timestamp */}
                {chat.updatedAt ? (
                  <>
                    <div className="h-px bg-border/60" />
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                        <Clock className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground">Última Atividade</span>
                        <span className="text-xs font-semibold text-foreground">
                          {format(new Date(chat.updatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Close Conversation Dialog Triggered From Sheet */}
      <CloseChatDialog
        chat={chat}
        onActionSuccess={() => {
          setIsCloseDialogOpen(false);
          onClose();
          onCloseSuccess?.();
        }}
        reasons={closeReasons}
        isOpen={isCloseDialogOpen}
        onOpenChange={setIsCloseDialogOpen}
      />
    </>
  );
}
