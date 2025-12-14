'use server';

import { cache } from 'react';
import type { User } from '@/lib/types';
import { getCurrentUser } from '@/actions/user';
import { getInitialChatsData, type InitialChatsPayload } from '@/actions/chats';

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

  const initialData = await getInitialChatsData({
    workspaceId: user.activeWorkspaceId,
    selectedChatId: chatId,
    userIdOverride: user.id,
    workspaceTimezone: user.activeWorkspaceTimezone,
  });

  return { user, initialData };
});
