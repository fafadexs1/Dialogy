import { describe, expect, it } from 'vitest';

import { scopeMessagesToChatThread } from '@/lib/chat-thread-messages';
import type { Message } from '@/lib/types';

const message = (id: string, chatId: string): Message => ({
  id,
  chat_id: chatId,
  workspace_id: 'workspace-1',
  content: id,
  type: 'text',
  status: 'default',
  transcription: null,
  timestamp: '10:00',
  createdAt: '2026-07-29T10:00:00.000Z',
  formattedDate: 'Hoje',
});

describe('chat thread history', () => {
  it('keeps previous protocols in the selected timeline without losing their source', () => {
    const scoped = scopeMessagesToChatThread('chat-today', [
      message('older', 'chat-previous'),
      message('today', 'chat-today'),
    ]);

    expect(scoped.map((item) => item.chat_id)).toEqual(['chat-today', 'chat-today']);
    expect(scoped[0].metadata?.sourceChatId).toBe('chat-previous');
    expect(scoped[1].metadata?.sourceChatId).toBeUndefined();
  });
});
