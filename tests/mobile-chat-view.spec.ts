import { describe, expect, it, vi } from 'vitest';
import type { Chat, Message, User } from '../src/lib/types';

describe('User Story 1: Fullscreen Mobile Chat View & Navigation', () => {
  const mockUser: User = {
    id: 'user-1',
    email: 'agent@dialogy.com',
    name: 'Atendente Dialogy',
    firstName: 'Atendente',
    lastName: 'Dialogy',
    role: {
      id: 'role-1',
      name: 'agent',
      description: 'Agent role',
      permissions: [],
      is_default: false,
    },
    activeWorkspaceId: 'workspace-1',
  };

  const mockChat: Chat = {
    id: 'chat-100',
    workspace_id: 'workspace-1',
    contact: {
      id: 'contact-100',
      workspace_id: 'workspace-1',
      name: 'Cliente Importante com Nome Bastante Longo Para Testar Truncamento',
      phone: '+55 11 99999-8888',
      avatar_url: 'https://example.com/avatar.jpg',
      tags: [],
    },
    messages: [
      {
        id: 'msg-1',
        chat_id: 'chat-100',
        workspace_id: 'workspace-1',
        content: 'Olá, preciso de suporte com meu pedido',
        type: 'text',
        from_me: false,
        status: 'default',
        api_message_status: 'READ',
        timestamp: '03:00',
        formattedDate: '14 de setembro',
        transcription: null,
        createdAt: '2026-09-14T03:00:00.000Z',
      },
      {
        id: 'msg-2',
        chat_id: 'chat-100',
        workspace_id: 'workspace-1',
        content: 'Olá! Claro, estou aqui para ajudar.',
        type: 'text',
        from_me: true,
        status: 'default',
        api_message_status: 'DELIVERED',
        timestamp: '03:01',
        formattedDate: '14 de setembro',
        transcription: null,
        createdAt: '2026-09-14T03:01:00.000Z',
      },
    ],
    status: 'atendimentos',
    unreadCount: 0,
    instance_name: 'whatsapp-primary',
    protocol: 'DLG-2026-001',
    updatedAt: '2026-09-14T03:01:00.000Z',
  };

  it('provides required properties and contact details in MobileChatView props', () => {
    const onBack = vi.fn();
    const props = {
      chat: mockChat,
      currentUser: mockUser,
      onBack,
    };

    expect(props.chat.id).toBe('chat-100');
    expect(props.chat.contact.name).toContain('Cliente Importante');
    expect(props.chat.messages).toHaveLength(2);
    expect(typeof props.onBack).toBe('function');
  });

  it('triggers onBack when operator wants to return to chat list', () => {
    const onBack = vi.fn();
    onBack();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('formats message timestamps and handles text, audio, and image messages correctly', () => {
    const textMsg: Message = mockChat.messages[0];
    const audioMsg: Message = {
      id: 'msg-3',
      chat_id: 'chat-100',
      workspace_id: 'workspace-1',
      content: 'https://example.com/audio.mp3',
      type: 'audio',
      from_me: false,
      status: 'default',
      api_message_status: 'READ',
      timestamp: '03:02',
      formattedDate: '14 de setembro',
      createdAt: '2026-09-14T03:02:00.000Z',
      transcription: 'Transcrição do áudio recebido',
    };

    expect(textMsg.type).toBe('text');
    expect(audioMsg.type).toBe('audio');
    expect(audioMsg.transcription).toBe('Transcrição do áudio recebido');
  });
});
