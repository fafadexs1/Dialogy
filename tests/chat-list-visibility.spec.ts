import { describe, expect, it } from 'vitest';

import type { Chat, Message } from '@/lib/types';
import { isMarketingMessage, shouldKeepMarketingOnlyChatVisible } from '@/components/chat/chat-list-visibility';

describe('chat list marketing visibility', () => {
  it('detects marketing messages by metadata flag', () => {
    const message = {
      id: 'msg-1',
      chat_id: 'chat-1',
      workspace_id: 'ws-1',
      content: 'Contrato enviado',
      type: 'text',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      metadata: { isMarketing: true },
      from_me: true,
      is_read: true,
    } as Message;

    expect(isMarketingMessage(message)).toBe(true);
  });

  it('keeps selected chats visible even when only marketing messages are hidden', () => {
    const chat = {
      id: 'chat-1',
      status: 'gerais',
      workspace_id: 'ws-1',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
      unreadCount: 0,
    } as Chat;

    expect(shouldKeepMarketingOnlyChatVisible(chat, 'chat-1')).toBe(true);
  });

  it('keeps handed off chats visible even when only marketing messages are hidden', () => {
    const chat = {
      id: 'chat-2',
      status: 'atendimentos',
      workspace_id: 'ws-1',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      agentId: 'agent-1',
      messages: [],
      unreadCount: 0,
    } as Chat;

    expect(shouldKeepMarketingOnlyChatVisible(chat, null)).toBe(true);
  });

  it('still allows hiding untouched queue chats that only contain marketing messages', () => {
    const chat = {
      id: 'chat-3',
      status: 'gerais',
      workspace_id: 'ws-1',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
      unreadCount: 0,
    } as Chat;

    expect(shouldKeepMarketingOnlyChatVisible(chat, null)).toBe(false);
  });
});
