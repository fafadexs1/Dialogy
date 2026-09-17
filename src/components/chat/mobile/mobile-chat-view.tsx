'use client';

import React, { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { MobileChatHeader } from './mobile-chat-header';
import { MobileMessageList } from './mobile-message-list';
import { MobileMessageInput } from './mobile-message-input';
import { MobileContactSheet } from './mobile-contact-sheet';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { guardedSendAgentMessage } from '@/actions/chat-guards';
import { toast } from '@/hooks/use-toast';
import type { Chat, User, Tag, Message } from '@/lib/types';

export interface MobileChatViewProps {
  chat: Chat;
  currentUser: User;
  onBack: () => void;
  onActionSuccess?: () => void;
  closeReasons?: Tag[];
  workspaceTimezone?: string;
  renderInput?: (chat: Chat) => React.ReactNode;
  renderContactSheet?: (props: {
    isOpen: boolean;
    onClose: () => void;
    chat: Chat;
  }) => React.ReactNode;
}

export function MobileChatView({
  chat,
  currentUser,
  onBack,
  onActionSuccess,
  closeReasons = [],
  workspaceTimezone,
  renderInput,
  renderContactSheet,
}: MobileChatViewProps) {
  const [isContactSheetOpen, setIsContactSheetOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const appendMessagesToChat = useInboxStore((state) => state.appendMessagesToChat);
  const replaceOptimisticMessage = useInboxStore((state) => state.replaceOptimisticMessage);

  // Read synchronized real-time messages from useInboxStore, falling back to chat.messages
  const storeMessages = useInboxStore((state) => state.messagesByChat[chat.id]);
  const messages = storeMessages && storeMessages.length > 0 ? storeMessages : (chat.messages || []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      const messageId = uuidv4();
      const now = new Date();
      const isoNow = now.toISOString();

      const optimisticMessage: Message = {
        id: messageId,
        chat_id: chat.id,
        workspace_id: chat.workspace_id,
        content,
        type: 'text',
        status: 'default',
        api_message_status: 'PENDING',
        from_me: true,
        sender: {
          id: currentUser.id,
          name: currentUser.name,
          avatar: currentUser.avatar || currentUser.avatar_url,
          type: 'user',
        },
        timestamp: format(now, 'HH:mm'),
        createdAt: isoNow,
        formattedDate: format(now, 'dd/MM/yyyy'),
        transcription: null,
        optimistic: true,
      };

      // 1. Optimistic append
      appendMessagesToChat(chat.id, [optimisticMessage]);

      // 2. Dispatch via guarded action
      setIsSending(true);
      try {
        const result = await guardedSendAgentMessage(chat.id, content, null, messageId);

        if (!result.success) {
          toast({
            title: 'Falha ao enviar mensagem',
            description: result.error || 'Ocorreu um erro no envio.',
            variant: 'destructive',
          });
          return;
        }

        if (result.message) {
          replaceOptimisticMessage(chat.id, messageId, result.message as Message);
        }

        onActionSuccess?.();
      } catch (err: any) {
        console.error('[MobileChatView] Error dispatching message:', err);
        toast({
          title: 'Erro inesperado',
          description: err.message || 'Não foi possível enviar a mensagem.',
          variant: 'destructive',
        });
      } finally {
        setIsSending(false);
      }
    },
    [appendMessagesToChat, chat.id, chat.workspace_id, currentUser, onActionSuccess, replaceOptimisticMessage]
  );

  return (
    <div className="mobile-chat-screen relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      {/* Header with back button and contact drawer trigger */}
      <MobileChatHeader
        chat={chat}
        onBack={onBack}
        onOpenContactSheet={() => setIsContactSheetOpen(true)}
      />

      {/* Messages List Area */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        <MobileMessageList messages={messages} />
      </main>

      {/* Bottom Message Input Area */}
      {renderInput ? (
        renderInput(chat)
      ) : (
        <MobileMessageInput
          chatId={chat.id}
          onSend={handleSendMessage}
          isSending={isSending}
        />
      )}

      {/* Contact Details & Actions Drawer */}
      {renderContactSheet ? (
        renderContactSheet({
          isOpen: isContactSheetOpen,
          onClose: () => setIsContactSheetOpen(false),
          chat,
        })
      ) : (
        <MobileContactSheet
          isOpen={isContactSheetOpen}
          onClose={() => setIsContactSheetOpen(false)}
          chat={chat}
          currentUser={currentUser}
          closeReasons={closeReasons}
          onTransferSuccess={onActionSuccess}
          onCloseSuccess={() => {
            onActionSuccess?.();
            onBack();
          }}
        />
      )}
    </div>
  );
}
