import { describe, expect, it } from 'vitest';

import { appendNewChatsById, mergeChatsById, sortChatsByActivity } from '@/hooks/inbox-store/chat-list-slice';
import { dedupeMessages, removeReplacedOptimisticMessages } from '@/hooks/inbox-store/message-thread-slice';
import type { Chat, Message } from '@/lib/types';

const chat = (id: string, updatedAt: string): Chat => ({
  id,
  workspace_id: 'ws-1',
  status: 'gerais',
  contact: { id: `contact-${id}`, workspace_id: 'ws-1', name: `Contact ${id}` },
  messages: [],
  updatedAt,
});

const message = (input: Partial<Message> & Pick<Message, 'id' | 'chat_id' | 'createdAt'>): Message => ({
  workspace_id: 'ws-1',
  content: input.content || 'Mensagem',
  type: 'text',
  status: 'default',
  metadata: input.metadata || {},
  transcription: null,
  timestamp: '12:00',
  formattedDate: 'Hoje',
  from_me: true,
  ...input,
});

describe('inbox store slices', () => {
  it('sorts chats by latest activity without mutating the original array', () => {
    const original = [
      chat('old', '2024-01-01T10:00:00Z'),
      chat('new', '2024-01-01T11:00:00Z'),
    ];

    const sorted = sortChatsByActivity(original);

    expect(sorted.map((item) => item.id)).toEqual(['new', 'old']);
    expect(original.map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('merges incoming chats while preserving existing messages when the incoming preview is empty', () => {
    const existingMessage = message({
      id: 'm-1',
      chat_id: 'chat-1',
      createdAt: '2024-01-01T10:00:00Z',
    });

    const merged = mergeChatsById(
      [{ ...chat('chat-1', '2024-01-01T10:00:00Z'), messages: [existingMessage] }],
      [{ ...chat('chat-1', '2024-01-01T11:00:00Z'), messages: [] }]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].updatedAt).toBe('2024-01-01T11:00:00Z');
    expect(merged[0].messages).toEqual([existingMessage]);
  });

  it('clears stale human agent when incoming chat is assigned to an AI agent', () => {
    const existing = {
      ...chat('chat-1', '2024-01-01T10:00:00Z'),
      agentId: 'agent-1',
      agent: { id: 'agent-1', name: 'Humano' } as any,
    };
    const incoming = {
      ...chat('chat-1', '2024-01-01T11:00:00Z'),
      agentId: undefined,
      agent: undefined,
      assigned_system_agent_id: 'system-agent-1',
      assignedSystemAgent: {
        id: 'system-agent-1',
        name: 'IA Suporte',
        type: 'intelligent_attendant',
      },
    } as Chat;

    const merged = mergeChatsById([existing], [incoming]);

    expect(merged[0].agent).toBeUndefined();
    expect(merged[0].agentId).toBeUndefined();
    expect(merged[0].assignedSystemAgent?.name).toBe('IA Suporte');
  });

  it('appends only new chats by id', () => {
    const appended = appendNewChatsById(
      [chat('chat-1', '2024-01-01T10:00:00Z')],
      [
        chat('chat-1', '2024-01-01T11:00:00Z'),
        chat('chat-2', '2024-01-01T12:00:00Z'),
      ]
    );

    expect(appended.map((item) => item.id)).toEqual(['chat-2', 'chat-1']);
  });

  it('deduplicates messages by id and keeps chronological order', () => {
    const deduped = dedupeMessages([
      message({ id: 'm-2', chat_id: 'chat-1', createdAt: '2024-01-01T11:00:00Z' }),
      message({ id: 'm-1', chat_id: 'chat-1', createdAt: '2024-01-01T10:00:00Z' }),
      message({ id: 'm-2', chat_id: 'chat-1', createdAt: '2024-01-01T11:00:00Z', content: 'Atualizada' }),
    ]);

    expect(deduped.map((item) => item.id)).toEqual(['m-1', 'm-2']);
    expect(deduped[1].content).toBe('Atualizada');
  });

  it('removes the matching optimistic message when the server message arrives', () => {
    const current = [
      message({
        id: 'optimistic-1',
        chat_id: 'chat-1',
        createdAt: '2024-01-01T10:00:00Z',
        content: 'Oi',
        optimistic: true,
        sentByTab: 'tab-1',
      }),
      message({
        id: 'other-optimistic',
        chat_id: 'chat-1',
        createdAt: '2024-01-01T10:01:00Z',
        content: 'Outra',
        optimistic: true,
        sentByTab: 'tab-1',
      }),
    ];

    const incoming = [
      message({
        id: 'server-1',
        chat_id: 'chat-1',
        createdAt: '2024-01-01T10:02:00Z',
        content: 'Oi',
        sentByTab: 'tab-1',
        metadata: { optimisticId: 'optimistic-1' },
      }),
    ];

    const cleaned = removeReplacedOptimisticMessages(current, incoming);

    expect(cleaned.map((item) => item.id)).toEqual(['other-optimistic']);
  });
});
