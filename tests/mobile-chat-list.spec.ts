import { describe, expect, it } from 'vitest';
import type { Chat } from '../src/lib/types';
import { isChatInInboxQueueScope, type InboxTabId } from '../src/lib/inbox-pagination';

describe('User Story 4: Mobile Chat List, Search & Horizontal Tab Filtering', () => {
  const mockChats: Chat[] = [
    {
      id: 'chat-robo-1',
      workspace_id: 'ws-1',
      status: 'gerais',
      tag: '', // robo has empty tag
      contact: { id: 'c-1', workspace_id: 'ws-1', name: 'Ana Robô', phone: '+55 11 91111-1111' },
      messages: [{ id: 'm-1', chat_id: 'chat-robo-1', workspace_id: 'ws-1', content: 'Iniciando menu', type: 'text', status: 'default', timestamp: '10:00', formattedDate: 'Hoje', createdAt: '2026-09-14T10:00:00Z', transcription: null }],
      protocol: 'DLG-ROBO-01',
      unreadCount: 2,
    },
    {
      id: 'chat-fila-1',
      workspace_id: 'ws-1',
      status: 'gerais',
      tag: 'Suporte', // fila has tag
      contact: { id: 'c-2', workspace_id: 'ws-1', name: 'Bruno Fila', phone: '+55 11 92222-2222' },
      messages: [{ id: 'm-2', chat_id: 'chat-fila-1', workspace_id: 'ws-1', content: 'Aguardando atendente', type: 'text', status: 'default', timestamp: '10:05', formattedDate: 'Hoje', createdAt: '2026-09-14T10:05:00Z', transcription: null }],
      protocol: 'DLG-FILA-02',
      unreadCount: 1,
    },
    {
      id: 'chat-atendendo-1',
      workspace_id: 'ws-1',
      status: 'atendimentos',
      agentId: 'agent-1',
      agent: { id: 'agent-1', name: 'Atendente Carlos', firstName: 'Carlos', lastName: 'Silva' },
      contact: { id: 'c-3', workspace_id: 'ws-1', name: 'Carla Atendimento', phone: '+55 11 93333-3333' },
      messages: [{ id: 'm-3', chat_id: 'chat-atendendo-1', workspace_id: 'ws-1', content: 'Em atendimento', type: 'text', status: 'default', timestamp: '10:10', formattedDate: 'Hoje', createdAt: '2026-09-14T10:10:00Z', transcription: null }],
      protocol: 'DLG-ATEND-03',
      unreadCount: 0,
    },
    {
      id: 'chat-encerrado-1',
      workspace_id: 'ws-1',
      status: 'encerrados',
      contact: { id: 'c-4', workspace_id: 'ws-1', name: 'Daniel Encerrado', phone: '+55 11 94444-4444' },
      messages: [{ id: 'm-4', chat_id: 'chat-encerrado-1', workspace_id: 'ws-1', content: 'Atendimento finalizado', type: 'text', status: 'default', timestamp: '09:00', formattedDate: 'Hoje', createdAt: '2026-09-14T09:00:00Z', transcription: null }],
      protocol: 'DLG-ENC-04',
      unreadCount: 0,
    },
  ];

  const filterChatsByTab = (chats: Chat[], tab: InboxTabId): Chat[] => {
    return chats.filter((chat) => {
      if (tab === 'robo') {
        return chat.status === 'gerais' && isChatInInboxQueueScope(chat, 'robo');
      }
      if (tab === 'gerais') {
        return chat.status === 'gerais' && isChatInInboxQueueScope(chat, 'fila');
      }
      if (tab === 'atendimentos') {
        return chat.status === 'atendimentos';
      }
      if (tab === 'encerrados') {
        return chat.status === 'encerrados';
      }
      return false;
    });
  };

  const filterChatsByQuery = (chats: Chat[], query: string): Chat[] => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((chat) => {
      const name = chat.contact?.name?.toLowerCase() || '';
      const phone = chat.contact?.phone?.toLowerCase() || '';
      const protocol = chat.protocol?.toLowerCase() || '';
      return name.includes(q) || phone.includes(q) || protocol.includes(q);
    });
  };

  it('filters chats strictly according to horizontal tabs (Robo, Fila Geral, Atendendo, Encerrados)', () => {
    const roboChats = filterChatsByTab(mockChats, 'robo');
    expect(roboChats).toHaveLength(1);
    expect(roboChats[0].id).toBe('chat-robo-1');

    const filaChats = filterChatsByTab(mockChats, 'gerais');
    expect(filaChats).toHaveLength(1);
    expect(filaChats[0].id).toBe('chat-fila-1');

    const atendendoChats = filterChatsByTab(mockChats, 'atendimentos');
    expect(atendendoChats).toHaveLength(1);
    expect(atendendoChats[0].id).toBe('chat-atendendo-1');

    const encerradosChats = filterChatsByTab(mockChats, 'encerrados');
    expect(encerradosChats).toHaveLength(1);
    expect(encerradosChats[0].id).toBe('chat-encerrado-1');
  });

  it('filters chats in real-time by search query (name, phone, protocol)', () => {
    // Search by name
    const byName = filterChatsByQuery(mockChats, 'bruno');
    expect(byName).toHaveLength(1);
    expect(byName[0].id).toBe('chat-fila-1');

    // Search by phone digits
    const byPhone = filterChatsByQuery(mockChats, '93333');
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0].id).toBe('chat-atendendo-1');

    // Search by protocol
    const byProtocol = filterChatsByQuery(mockChats, 'DLG-ROBO');
    expect(byProtocol).toHaveLength(1);
    expect(byProtocol[0].id).toBe('chat-robo-1');

    // Empty query returns all
    expect(filterChatsByQuery(mockChats, '')).toHaveLength(4);
  });
});
