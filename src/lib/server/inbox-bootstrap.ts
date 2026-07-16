'use server';

import { cache } from 'react';
import type { User } from '@/lib/types';
import { getCurrentUser } from '@/actions/user';
import { getChatMessagesWindow, getInitialChatsData, type InitialChatsPayload } from '@/actions/chats';

type InboxBootstrapPayload = {
  user: User | null;
  initialData: InitialChatsPayload | null;
};

/**
 * Server-only helper that bundles the authenticated user with the initial inbox payload.
 * It uses React cache to avoid duplicate Supabase/session lookups during a request.
 */
export const getInboxBootstrap = cache(async function getInboxBootstrap(chatId: string | null): Promise<InboxBootstrapPayload> {
  const user = await getCurrentUser();

  if (!user?.activeWorkspaceId) {
    return { user, initialData: null };
  }

  const [initialData, selectedMessageWindow] = await Promise.all([
    getInitialChatsData({
      workspaceId: user.activeWorkspaceId,
      selectedChatId: chatId,
      workspaceTimezone: user.activeWorkspaceTimezone,
    }),
    chatId
      ? getChatMessagesWindow({
          chatId,
          limit: 40,
          timezone: user.activeWorkspaceTimezone || 'America/Sao_Paulo',
        })
      : Promise.resolve(null),
  ]);

  if (selectedMessageWindow) {
    initialData.messages = selectedMessageWindow.messages;
    initialData.lastSyncMessageForSelected = selectedMessageWindow.lastSyncMessage;
    initialData.oldestMessageDate = selectedMessageWindow.oldestMessageDate;
    initialData.oldestMessageId = selectedMessageWindow.oldestMessageId;
    initialData.hasMoreHistory = selectedMessageWindow.hasMoreHistory;
    initialData.selectedMessageWindow = {
      messages: selectedMessageWindow.messages,
      oldestMessageDate: selectedMessageWindow.oldestMessageDate,
      oldestMessageId: selectedMessageWindow.oldestMessageId,
      hasMoreHistory: selectedMessageWindow.hasMoreHistory,
    };
  }

  return { user, initialData };
});
