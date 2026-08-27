import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Chat } from '@/lib/types';
import { useInboxStore } from '@/hooks/use-inbox-store';

vi.mock('@/lib/cache', () => ({
  cacheService: {
    setChats: vi.fn(async () => {}),
    setMessages: vi.fn(async () => {}),
    appendMessages: vi.fn(async () => {}),
  },
}));

const chat = (id: string, status: Chat['status'], updatedAt: string): Chat => ({
  id,
  status,
  updatedAt,
  workspace_id: 'workspace-1',
  contact: {
    id: `contact-${id}`,
    workspace_id: 'workspace-1',
    name: `Contato ${id}`,
  },
  messages: [],
});

function seed(chats: Chat[], selectedChatId: string | null = null) {
  useInboxStore.getState().setInitialData({
    chats,
    selectedChatId,
    messages: [],
    lastSyncChats: null,
    lastSyncMessageForSelected: null,
    oldestMessageDate: null,
    oldestMessageId: null,
    hasMoreHistory: false,
    hasMoreChats: true,
  });
}

describe('inbox status scope refresh', () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
  });

  it('replaces stale attending and closed pages without touching the shared queue', () => {
    seed([
      chat('queue', 'gerais', '2026-01-01T12:00:00Z'),
      chat('old-attending', 'atendimentos', '2026-01-01T11:00:00Z'),
      chat('old-closed', 'encerrados', '2026-01-01T10:00:00Z'),
    ]);

    useInboxStore.getState().replaceChatsForStatus('atendimentos', [
      chat('new-attending', 'atendimentos', '2026-01-02T12:00:00Z'),
    ]);
    useInboxStore.getState().replaceChatsForStatus('encerrados', [
      chat('new-closed', 'encerrados', '2026-01-02T11:00:00Z'),
    ]);

    expect(useInboxStore.getState().chats.map((item) => item.id)).toEqual([
      'new-attending',
      'new-closed',
      'queue',
    ]);
  });

  it('preserves the open thread while replacing the list scope', () => {
    seed([
      chat('queue', 'gerais', '2026-01-01T12:00:00Z'),
      chat('selected-closed', 'encerrados', '2025-01-01T10:00:00Z'),
    ], 'selected-closed');

    useInboxStore.getState().replaceChatsForStatus('encerrados', [
      chat('recent-closed', 'encerrados', '2026-01-02T11:00:00Z'),
    ]);

    expect(useInboxStore.getState().selectedChatId).toBe('selected-closed');
    expect(useInboxStore.getState().chats.map((item) => item.id)).toContain('selected-closed');
  });

  it('refreshes robot and queue independently without making the other disappear', () => {
    seed([
      { ...chat('robot-old', 'gerais', '2026-01-01T12:00:00Z'), tag: undefined },
      { ...chat('queue-old', 'gerais', '2026-01-01T11:00:00Z'), tag: 'Suporte' },
    ]);

    useInboxStore.getState().replaceChatsForQueueScope('robo', [
      { ...chat('robot-new', 'gerais', '2026-01-02T12:00:00Z'), tag: undefined },
    ]);

    expect(useInboxStore.getState().chats.map((item) => item.id)).toEqual([
      'robot-new',
      'queue-old',
    ]);

    useInboxStore.getState().replaceChatsForQueueScope('fila', [
      { ...chat('queue-new', 'gerais', '2026-01-03T12:00:00Z'), tag: 'Vendas' },
    ]);

    expect(useInboxStore.getState().chats.map((item) => item.id)).toEqual([
      'queue-new',
      'robot-new',
    ]);
  });

  it('tracks exhaustion independently for every status', () => {
    useInboxStore.getState().setChatPagination('encerrados', {
      hasMore: true,
      cursor: { lastActivityAt: '2026-01-01T10:00:00Z', id: 'closed-cursor' },
    });
    useInboxStore.getState().setChatPagination('atendimentos', {
      hasMore: false,
      cursor: null,
    });

    const state = useInboxStore.getState();
    expect(state.chatPagination.encerrados.hasMore).toBe(true);
    expect(state.chatPagination.atendimentos.hasMore).toBe(false);
    expect(state.hasMoreChats).toBe(true);
  });

  it('tracks robot and queue cursors independently even though both use gerais', () => {
    useInboxStore.getState().setChatPagination('robo', {
      hasMore: true,
      cursor: { lastActivityAt: '2026-01-03T10:00:00Z', id: 'robot-cursor' },
    });
    useInboxStore.getState().setChatPagination('gerais', {
      hasMore: false,
      cursor: { lastActivityAt: '2026-01-02T10:00:00Z', id: 'queue-cursor' },
    });

    const state = useInboxStore.getState();
    expect(state.chatPagination.robo.cursor?.id).toBe('robot-cursor');
    expect(state.chatPagination.gerais.cursor?.id).toBe('queue-cursor');
    expect(state.chatPagination.robo.hasMore).toBe(true);
    expect(state.chatPagination.gerais.hasMore).toBe(false);
  });
});
