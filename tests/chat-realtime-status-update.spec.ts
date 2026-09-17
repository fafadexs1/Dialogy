import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { isChatVisibleForOwnership } from '@/lib/inbox-ownership';
import type { Chat } from '@/lib/types';

vi.mock('@/lib/cache', () => ({
  cacheService: {
    setChats: vi.fn(async () => {}),
    setMessages: vi.fn(async () => {}),
    appendMessages: vi.fn(async () => {}),
  },
}));

describe('Chat realtime status update and visibility', () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
  });

  it('updates selected chat status in store even when ownership filter would hide it', () => {
    const initialChat: Chat = {
      id: 'chat-robot-1',
      workspace_id: 'ws-1',
      status: 'gerais',
      agentId: null,
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente Teste' },
      messages: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Chat;

    useInboxStore.getState().setInitialData({
      chats: [initialChat],
      selectedChatId: initialChat.id,
      messages: [],
      lastSyncChats: null,
      lastSyncMessageForSelected: null,
      oldestMessageDate: null,
      oldestMessageId: null,
      hasMoreHistory: false,
      hasMoreChats: false,
    });

    expect(useInboxStore.getState().selectedChatId).toBe('chat-robot-1');
    expect(useInboxStore.getState().chats[0].status).toBe('gerais');

    // Simulate realtime incoming update: closed by another operator or automated robot
    const incomingStatus = 'encerrados';
    const closedAt = '2026-01-01T01:00:00.000Z';

    const isVisibleInMine = isChatVisibleForOwnership(
      {
        id: initialChat.id,
        status: incomingStatus,
        agent_id: null,
      },
      'mine',
      'current-user-id',
    );

    // Because it is now closed and has no assigned agent, it is no longer visible under 'mine' filter
    expect(isVisibleInMine).toBe(false);

    // Layout logic: if selectedChatId === newChatData.id, it is NOT removed and upsertChats applies
    const optimisticUpdate: Partial<Chat> = {
      ...initialChat,
      status: incomingStatus,
      closed_at: closedAt,
      updatedAt: closedAt,
    };

    useInboxStore.getState().upsertChats([optimisticUpdate as Chat]);

    const stateAfterUpdate = useInboxStore.getState();
    const updatedSelectedChat = stateAfterUpdate.chats.find((c) => c.id === initialChat.id);

    expect(updatedSelectedChat).toBeDefined();
    expect(updatedSelectedChat?.status).toBe('encerrados');
    expect(updatedSelectedChat?.closed_at).toBe(closedAt);
  });

  it('removes unselected chat from store when ownership visibility is lost', () => {
    const activeChat: Chat = {
      id: 'chat-active',
      workspace_id: 'ws-1',
      status: 'atendimentos',
      agentId: 'current-user-id',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente 1' },
      messages: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Chat;

    const robotChat: Chat = {
      id: 'chat-robot-2',
      workspace_id: 'ws-1',
      status: 'gerais',
      agentId: null,
      contact: { id: 'contact-2', workspace_id: 'ws-1', name: 'Cliente 2' },
      messages: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Chat;

    useInboxStore.getState().setInitialData({
      chats: [activeChat, robotChat],
      selectedChatId: activeChat.id, // Currently viewing chat-active, NOT robotChat
      messages: [],
      lastSyncChats: null,
      lastSyncMessageForSelected: null,
      oldestMessageDate: null,
      oldestMessageId: null,
      hasMoreHistory: false,
      hasMoreChats: false,
    });

    expect(useInboxStore.getState().chats).toHaveLength(2);

    // Robot chat is closed by someone else
    const isVisibleInMine = isChatVisibleForOwnership(
      {
        id: robotChat.id,
        status: 'encerrados',
        agent_id: null,
      },
      'mine',
      'current-user-id',
    );

    expect(isVisibleInMine).toBe(false);

    // Because snapshot.selectedChatId !== robotChat.id, removeChat is called
    useInboxStore.getState().removeChat(robotChat.id);

    const remainingChats = useInboxStore.getState().chats;
    expect(remainingChats).toHaveLength(1);
    expect(remainingChats[0].id).toBe('chat-active');
  });

  it('evaluates visibility correctly across tab transitions in mine and everyone modes', () => {
    // 1. In 'gerais' (Robô/Fila), chat is visible in both 'mine' and 'everyone' regardless of agent
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'gerais', agent_id: null }, 'mine', 'u1')).toBe(true);
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'gerais', agent_id: null }, 'everyone', 'u1')).toBe(true);

    // 2. In 'encerrados' without assigned agent:
    // Hidden in 'mine'
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'encerrados', agent_id: null }, 'mine', 'u1')).toBe(false);
    // Visible in 'everyone'
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'encerrados', agent_id: null }, 'everyone', 'u1')).toBe(true);

    // 3. In 'encerrados' assigned to another agent 'u2':
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'encerrados', agent_id: 'u2' }, 'mine', 'u1')).toBe(false);
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'encerrados', agent_id: 'u2' }, 'everyone', 'u1')).toBe(true);

    // 4. In 'encerrados' assigned to current agent 'u1':
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'encerrados', agent_id: 'u1' }, 'mine', 'u1')).toBe(true);
    expect(isChatVisibleForOwnership({ id: 'c1', status: 'encerrados', agent_id: 'u1' }, 'everyone', 'u1')).toBe(true);
  });
});
