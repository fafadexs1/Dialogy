import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cache', () => ({
  cacheService: {
    setChats: vi.fn(async () => {}),
    setMessages: vi.fn(async () => {}),
    appendMessages: vi.fn(async () => {}),
  },
}));

import { useInboxStore } from '@/hooks/use-inbox-store';
import type { Message } from '@/lib/types';

function buildMessage(chatId: string, index: number): Message {
  return {
    id: `message-${index}`,
    chat_id: chatId,
    workspace_id: 'ws-1',
    content: `Mensagem ${index}`,
    type: 'text',
    status: 'default',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
    timestamp: '00:00',
    formattedDate: '01/01/2026',
    from_me: false,
    optimistic: false,
  } as Message;
}

describe('Inbox memory pruning', () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
  });

  it('keeps only the most recent message threads in memory', () => {
    for (let index = 1; index <= 14; index += 1) {
      const chatId = `chat-${index}`;
      useInboxStore.getState().setSelectedChatId(chatId);
      useInboxStore.getState().setMessagesForChat(chatId, [buildMessage(chatId, index)]);
    }

    const state = useInboxStore.getState();
    const retainedChatIds = Object.keys(state.messagesByChat).sort();

    expect(retainedChatIds).toHaveLength(12);
    expect(retainedChatIds).not.toContain('chat-1');
    expect(retainedChatIds).not.toContain('chat-2');
    expect(retainedChatIds).toContain('chat-14');
    expect(state.selectedChatId).toBe('chat-14');
  });
});
