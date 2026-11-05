import type { Chat } from '@/lib/types';

type ChatLike = Pick<Chat, 'id' | 'status' | 'agentId'> & {
  agent?: { id?: string | null } | null;
  agent_id?: string | null;
};

export function resolveChatAgentId(chat: Partial<ChatLike> | null | undefined): string | null {
  if (!chat) return null;

  return chat.agentId ?? chat.agent?.id ?? chat.agent_id ?? null;
}

/**
 * Used by the list refresh path to avoid replacing the Robô/Fila cache while
 * the ownership filter is toggled. It is not the ownership rule itself.
 */
export function isOwnershipScopedChat(chat: Partial<ChatLike> | null | undefined): boolean {
  return chat?.status === 'atendimentos' || chat?.status === 'encerrados';
}

export function isChatVisibleForOwnership(
  chat: Partial<ChatLike> | null | undefined,
  ownership: 'mine' | 'everyone',
  currentUserId?: string | null
): boolean {
  if (!chat?.id) return false;

  if (ownership === 'everyone') {
    return true;
  }

  // Robô e Fila são visões compartilhadas do workspace. O filtro de
  // responsável só se aplica a Atendendo e Encerrados.
  if (!isOwnershipScopedChat(chat)) {
    return true;
  }

  // Without the authenticated user's id there is no safe way to prove
  // ownership. Queue tabs are not rendered before a user is available.
  if (!currentUserId) return false;

  // Em Atendendo/Encerrados, apenas o responsável explícito estabelece posse.
  return resolveChatAgentId(chat) === currentUserId;
}

export function shouldClearSelectedChatOnOwnershipChange(
  chat: Partial<ChatLike> | null | undefined,
  ownership: 'mine' | 'everyone',
  currentUserId?: string | null
): boolean {
  if (ownership !== 'mine') return false;

  return !isChatVisibleForOwnership(chat, ownership, currentUserId);
}

export function shouldAcceptAiSuggestion(
  currentChatId: string | null | undefined,
  payloadChatId: string | null | undefined
): boolean {
  return Boolean(currentChatId && payloadChatId && currentChatId === payloadChatId);
}
