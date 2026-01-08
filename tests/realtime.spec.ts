import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildChatMessageChannelName,
  subscribeToChatMessages,
  subscribeToWorkspaceChatUpdates,
  teardownChannel,
} from '@/lib/realtime/chat-subscriptions';
import { useInboxStore } from '@/hooks/use-inbox-store';
import type { Chat, Message } from '@/lib/types';

const WORKSPACE_ID = 'ws-1';

function createSupabaseMock() {
  const onCalls: Array<{ event: string; config: any }> = [];
  const channel = {
    topic: '',
    on: vi.fn(function on(event, config, cb) {
      onCalls.push({ event, config });
      // Immediately register callback for manual trigger in tests if needed
      (channel as any)._callbacks = (channel as any)._callbacks || [];
      (channel as any)._callbacks.push(cb);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };

  const client = {
    channel: vi.fn((name: string) => {
      channel.topic = name;
      return channel;
    }),
    removeChannel: vi.fn(),
  };

  return { client, channel, onCalls };
}

const createChat = (id: string, status: Chat['status'] = 'gerais'): Chat => ({
  id,
  contact: { id: `contact-${id}`, workspace_id: WORKSPACE_ID, name: `Contact ${id}` },
  messages: [],
  status,
  workspace_id: WORKSPACE_ID,
  updatedAt: new Date('2024-01-01T12:00:00Z').toISOString(),
});

const createMessage = (id: string, chatId: string, createdAt: string): Message => ({
  id,
  chat_id: chatId,
  workspace_id: WORKSPACE_ID,
  content: `Message ${id}`,
  type: 'text',
  status: 'default',
  metadata: {},
  transcription: null,
  timestamp: '12:00',
  createdAt,
  formattedDate: 'Hoje',
});

describe('Realtime subscriptions', () => {
  it('subscribes to a chat-specific messages channel and cleans up', () => {
    const { client, channel, onCalls } = createSupabaseMock();
    const handler = vi.fn();

    const subscription = subscribeToChatMessages({
      client: client as any,
      workspaceId: WORKSPACE_ID,
      chatId: 'chat-123',
      onMessage: handler,
    });

    expect(client.channel).toHaveBeenCalledWith(buildChatMessageChannelName(WORKSPACE_ID, 'chat-123'));
    expect(channel.subscribe).toHaveBeenCalled();
    expect(onCalls).toHaveLength(1);
    expect(onCalls.every((call) => call.config.filter === 'chat_id=eq.chat-123')).toBe(true);

    teardownChannel(client as any, subscription as any);
    expect(client.removeChannel).toHaveBeenCalledWith(subscription);
  });

  it('subscribes to workspace chat updates and supports cleanup', () => {
    const { client, channel, onCalls } = createSupabaseMock();
    const handler = vi.fn();

    const subscription = subscribeToWorkspaceChatUpdates({
      client: client as any,
      workspaceId: WORKSPACE_ID,
      onChatUpdate: handler,
    });

    expect(client.channel).toHaveBeenCalled();
    expect(channel.subscribe).toHaveBeenCalled();
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].config.filter).toBe(`workspace_id=eq.${WORKSPACE_ID}`);

    teardownChannel(client as any, subscription as any);
    expect(client.removeChannel).toHaveBeenCalledWith(subscription);
  });
});

describe('Inbox store realtime flow', () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
  });

  it('keeps realtime messages when fetch finishes later', () => {
    const chatA = createChat('chat-A');
    const initialMessage = createMessage('m-1', chatA.id, '2024-01-01T12:00:00Z');
    const realtimeMessage = createMessage('m-rt', chatA.id, '2024-01-01T12:01:00Z');
    const fetchedOlder = createMessage('m-old', chatA.id, '2024-01-01T11:59:00Z');

    useInboxStore.getState().setInitialData({
      chats: [chatA],
      selectedChatId: chatA.id,
      messages: [initialMessage],
      lastSyncChats: null,
      lastSyncMessageForSelected: initialMessage.createdAt,
      oldestMessageDate: initialMessage.createdAt,
      oldestMessageId: null,
      hasMoreHistory: false,
      hasMoreChats: false,
    });

    useInboxStore.getState().appendMessagesToChat(chatA.id, [realtimeMessage], realtimeMessage.createdAt);
    useInboxStore.getState().setMessagesForChat(
      chatA.id,
      [fetchedOlder, initialMessage],
      realtimeMessage.createdAt,
      fetchedOlder.createdAt,
      null,
    );

    const messages = useInboxStore.getState().messagesByChat[chatA.id];
    expect(messages.map((m) => m.id)).toEqual(['m-old', 'm-1', 'm-rt']);
  });

  it('does not bleed messages between chats when switching', () => {
    const chatA = createChat('chat-A', 'gerais');
    const chatB = createChat('chat-B', 'atendimentos');
    const msgA1 = createMessage('a-1', chatA.id, '2024-01-01T12:00:00Z');
    const msgB1 = createMessage('b-1', chatB.id, '2024-01-01T12:05:00Z');

    useInboxStore.getState().setInitialData({
      chats: [chatA, chatB],
      selectedChatId: chatA.id,
      messages: [msgA1],
      lastSyncChats: null,
      lastSyncMessageForSelected: msgA1.createdAt,
      oldestMessageDate: msgA1.createdAt,
      oldestMessageId: null,
      hasMoreHistory: false,
      hasMoreChats: false,
    });

    useInboxStore.getState().setMessagesForChat(chatB.id, [msgB1], msgB1.createdAt, msgB1.createdAt, null);
    useInboxStore.getState().setSelectedChatId(chatB.id);

    const msgA2 = createMessage('a-2', chatA.id, '2024-01-01T12:06:00Z');
    useInboxStore.getState().appendMessagesToChat(chatA.id, [msgA2], msgA2.createdAt);

    const state = useInboxStore.getState();
    expect(state.messagesByChat[chatB.id].map((m) => m.id)).toEqual(['b-1']);
    expect(state.messagesByChat[chatA.id].map((m) => m.id)).toEqual(['a-1', 'a-2']);
  });

  it('handles rapid bursts of realtime messages without dropping any', () => {
    const chatB = createChat('chat-B');
    const initial = createMessage('seed', chatB.id, '2024-01-01T12:00:00Z');

    useInboxStore.getState().setInitialData({
      chats: [chatB],
      selectedChatId: chatB.id,
      messages: [initial],
      lastSyncChats: null,
      lastSyncMessageForSelected: initial.createdAt,
      oldestMessageDate: initial.createdAt,
      oldestMessageId: null,
      hasMoreHistory: false,
      hasMoreChats: false,
    });

    const burst = Array.from({ length: 5 }).map((_, idx) =>
      createMessage(`burst-${idx + 1}`, chatB.id, `2024-01-01T12:0${idx + 1}:00Z`),
    );

    burst.forEach((m) => {
      useInboxStore.getState().appendMessagesToChat(chatB.id, [m], m.createdAt);
    });

    const messages = useInboxStore.getState().messagesByChat[chatB.id];
    expect(messages.filter((m) => m.id.startsWith('burst-')).length).toBe(5);
    expect(messages.slice(-5).map((m) => m.id)).toEqual(burst.map((m) => m.id));
  });
});
