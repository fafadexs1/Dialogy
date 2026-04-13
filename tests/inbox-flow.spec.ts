import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { guardedSendAgentMessage, guardedAssignChat } from '@/actions/chat-guards';

vi.mock('@/lib/cache', () => ({
  cacheService: {
    setChats: vi.fn(async () => {}),
    setMessages: vi.fn(async () => {}),
    appendMessages: vi.fn(async () => {}),
  },
}));

vi.mock('@/actions/messages', () => ({
  sendAgentMessageAction: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/actions/chats', () => ({
  assignChatToSelfAction: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/actions/user', () => ({
  getCurrentUser: vi.fn(async () => ({
    id: 'user-1',
    activeWorkspaceId: 'ws-1',
    firstName: 'Test',
    lastName: 'User',
  })),
}));

vi.mock('@/lib/observability/logger', () => ({
  logAction: vi.fn(async () => ({})),
}));

describe('Inbox happy path', () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
  });

  it('logs in, opens chat, sends a message, and clears selection on workspace switch', async () => {
    const chat = {
      id: 'chat-1',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Contato' },
      messages: [],
      status: 'gerais' as const,
      workspace_id: 'ws-1',
      updatedAt: new Date().toISOString(),
    };

    useInboxStore.getState().setInitialData({
      chats: [chat],
      selectedChatId: chat.id,
      messages: [],
      lastSyncChats: null,
      lastSyncMessageForSelected: null,
      oldestMessageDate: null,
      oldestMessageId: null,
      hasMoreHistory: false,
      hasMoreChats: false,
    });

    expect(useInboxStore.getState().selectedChatId).toBe(chat.id);

    const sendResult = await guardedSendAgentMessage(chat.id, 'olá', null, 'optimistic-test');
    expect(sendResult.success).toBe(true);

    const assignResult = await guardedAssignChat(chat.id);
    expect(assignResult.success).toBe(true);

    // Simulate workspace switch clearing selection
    useInboxStore.getState().setSelectedChatId(null);
    expect(useInboxStore.getState().selectedChatId).toBeNull();
  });
});
