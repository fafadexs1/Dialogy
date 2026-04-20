import { describe, expect, it } from 'vitest';

import type { Chat } from '@/lib/types';
import {
  isChatVisibleForOwnership,
  resolveChatAgentId,
  shouldAcceptAiSuggestion,
} from '@/lib/inbox-ownership';

describe('inbox ownership', () => {
  it('keeps queue chats visible in mine view', () => {
    const chat = {
      id: 'chat-1',
      status: 'gerais',
      workspace_id: 'ws-1',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
    } as Chat;

    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1')).toBe(true);
  });

  it('keeps my assigned chats visible in mine view', () => {
    const chat = {
      id: 'chat-2',
      status: 'atendimentos',
      workspace_id: 'ws-1',
      agentId: 'agent-1',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
    } as Chat;

    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1')).toBe(true);
  });

  it('hides other agents chats in mine view', () => {
    const chat = {
      id: 'chat-3',
      status: 'atendimentos',
      workspace_id: 'ws-1',
      agentId: 'agent-2',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
    } as Chat;

    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1')).toBe(false);
  });

  it('keeps the selected chat visible even after leaving mine view scope', () => {
    const chat = {
      id: 'chat-4',
      status: 'atendimentos',
      workspace_id: 'ws-1',
      agentId: 'agent-2',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
    } as Chat;

    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1', 'chat-4')).toBe(true);
  });

  it('allows every chat in everyone view', () => {
    const chat = {
      id: 'chat-5',
      status: 'encerrados',
      workspace_id: 'ws-1',
      agentId: 'agent-2',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
    } as Chat;

    expect(isChatVisibleForOwnership(chat, 'everyone', 'agent-1')).toBe(true);
  });

  it('resolves agent id from either camelCase or snake_case payloads', () => {
    expect(resolveChatAgentId({ agentId: 'agent-1' } as Partial<Chat>)).toBe('agent-1');
    expect(resolveChatAgentId({ agent_id: 'agent-2' } as any)).toBe('agent-2');
  });
});

describe('ai suggestion targeting', () => {
  it('accepts only suggestions that match the current chat id', () => {
    expect(shouldAcceptAiSuggestion('chat-1', 'chat-1')).toBe(true);
    expect(shouldAcceptAiSuggestion('chat-1', 'chat-2')).toBe(false);
    expect(shouldAcceptAiSuggestion('chat-1', null)).toBe(false);
  });
});
