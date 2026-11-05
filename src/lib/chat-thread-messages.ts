import type { Message } from '@/lib/types';

/**
 * The inbox presents previous protocols for the same contact as one continuous
 * timeline. Store that timeline under the currently opened chat while retaining
 * the source protocol for diagnostics and protocol-aware actions.
 */
export function scopeMessagesToChatThread(chatId: string, messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.chat_id === chatId) return message;

    return {
      ...message,
      chat_id: chatId,
      metadata: {
        ...message.metadata,
        sourceChatId: message.chat_id,
      },
    };
  });
}
