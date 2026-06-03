import { afterEach, describe, expect, it, vi } from 'vitest';

import { persistChatRead } from '@/lib/inbox-mark-as-read';
import { shouldMarkChatAsRead } from '@/lib/inbox-read-state';
import type { Chat, Message } from '@/lib/types';

const chat = (unreadCount: number): Chat => ({
  id: 'chat-1',
  workspace_id: 'ws-1',
  status: 'atendimentos',
  contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Contato' },
  messages: [],
  unreadCount,
});

const unreadMessage = {
  id: 'message-1',
  chat_id: 'chat-1',
  workspace_id: 'ws-1',
  content: 'Oi',
  type: 'text',
  status: 'default',
  transcription: null,
  timestamp: '12:00',
  createdAt: '2026-06-01T12:00:00Z',
  formattedDate: 'Hoje',
  from_me: false,
  is_read: false,
} as Message;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inbox read state', () => {
  it('persists read state when the chat list has a badge but the thread is still empty', () => {
    expect(shouldMarkChatAsRead(chat(5), [])).toBe(true);
  });

  it('persists read state when an unread inbound message exists without a list badge', () => {
    expect(shouldMarkChatAsRead(chat(0), [unreadMessage])).toBe(true);
  });

  it('persists read state when the thread arrives before the chat list entry', () => {
    expect(shouldMarkChatAsRead(null, [unreadMessage])).toBe(true);
  });

  it('retries a transient mark-as-read failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(persistChatRead('chat-1', [0, 0])).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
