import type { Chat, Message } from '@/lib/types';

export function shouldMarkChatAsRead(
  chat: Chat | null | undefined,
  messages: Message[],
): boolean {
  if ((chat?.unreadCount || 0) > 0) return true;
  return messages.some((message) => !message.from_me && !message.is_read);
}
