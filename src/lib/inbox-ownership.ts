import type { Chat } from '@/lib/types';

type ChatLike = Pick<Chat, 'id' | 'status' | 'agentId'> & {
  agent?: { id?: string | null } | null;
  agent_id?: string | null;
};

export function resolveChatAgentId(chat: Partial<ChatLike> | null | undefined): string | null {
  if (!chat) return null;

  return chat.agentId ?? chat.agent?.id ?? chat.agent_id ?? null;
}

export function isChatVisibleForOwnership(
  chat: Partial<ChatLike> | null | undefined,
  ownership: 'mine' | 'everyone',
  currentUserId?: string | null,
  selectedChatId?: string | null
): boolean {
  if (!chat?.id) return false;

  if (ownership === 'everyone' || !currentUserId) {
    return true;
  }

  if (selectedChatId && chat.id === selectedChatId) {
    return true;
  }

  return chat.status === 'gerais' || resolveChatAgentId(chat) === currentUserId;
}

export function shouldAcceptAiSuggestion(
  currentChatId: string | null | undefined,
  payloadChatId: string | null | undefined
): boolean {
  return Boolean(currentChatId && payloadChatId && currentChatId === payloadChatId);
}
