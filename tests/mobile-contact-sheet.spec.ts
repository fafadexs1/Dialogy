import { describe, expect, it, vi } from 'vitest';
import type { Chat, Tag, User } from '../src/lib/types';
import { closeChatSchema, transferChatSchema } from '../src/lib/validation/chat-schemas';

describe('User Story 3: Mobile Contact Sheet & Operations (Transfer & Close)', () => {
  const mockChat: Chat = {
    id: 'chat-uuid-123',
    workspace_id: 'workspace-uuid-1',
    contact: {
      id: 'contact-uuid-1',
      workspace_id: 'workspace-uuid-1',
      name: 'Maria Silva',
      phone: '+55 11 98888-7777',
      avatar_url: 'https://example.com/avatar.jpg',
      tags: [
        { id: 'tag-1', value: 'vip', label: 'VIP', color: '#10B981', is_close_reason: false },
      ],
    },
    messages: [],
    status: 'atendimentos',
    unreadCount: 0,
    protocol: 'DLG-998877',
    updatedAt: '2026-09-14T03:00:00.000Z',
  };

  const mockUser: User = {
    id: 'agent-uuid-1',
    name: 'Carlos Atendente',
    firstName: 'Carlos',
    lastName: 'Atendente',
    email: 'carlos@dialogy.com',
    role: { id: 'role-1', name: 'agent', description: '', permissions: [], is_default: false },
    activeWorkspaceId: 'workspace-uuid-1',
  };

  it('validates contact details extraction for display in bottom sheet', () => {
    expect(mockChat.contact.name).toBe('Maria Silva');
    expect(mockChat.contact.phone).toBe('+55 11 98888-7777');
    expect(mockChat.protocol).toBe('DLG-998877');
    expect(mockChat.contact.tags).toHaveLength(1);
    expect(mockChat.contact.tags?.[0].label).toBe('VIP');
  });

  it('validates transfer payload schema constraints', () => {
    const validTransfer = {
      chatId: mockChat.id,
      agentId: 'new-agent-uuid-2',
    };
    const parsed = transferChatSchema.safeParse(validTransfer);
    expect(parsed.success).toBe(true);

    const invalidTransfer = {
      chatId: '', // invalid empty UUID
    };
    const invalidParsed = transferChatSchema.safeParse(invalidTransfer);
    expect(invalidParsed.success).toBe(false);
  });

  it('validates close chat payload schema constraints with reason tag and notes', () => {
    const validClose = {
      chatId: mockChat.id,
      reasonTagId: 'reason-tag-1',
      notes: 'Cliente atendido e dúvida sobre faturas esclarecida.',
      sendCloseMessage: true,
      additionalMetadata: {},
    };
    const parsed = closeChatSchema.safeParse(validClose);
    expect(parsed.success).toBe(true);

    const invalidClose = {
      chatId: '', // empty chatId
      reasonTagId: null,
    };
    const invalidParsed = closeChatSchema.safeParse(invalidClose);
    expect(invalidParsed.success).toBe(false);
  });
});
