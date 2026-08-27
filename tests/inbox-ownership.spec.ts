import { describe, expect, it } from 'vitest';

import type { Chat } from '@/lib/types';
import {
  isChatVisibleForOwnership,
  isOwnershipScopedChat,
  resolveChatAgentId,
  shouldClearSelectedChatOnOwnershipChange,
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
    expect(isOwnershipScopedChat(chat)).toBe(false);
  });

  it('keeps queue chats visible regardless of their stored agent', () => {
    const chat = {
      id: 'chat-queue-with-agent',
      status: 'gerais',
      agentId: 'agent-2',
    } as Partial<Chat>;

    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1')).toBe(true);
    expect(isOwnershipScopedChat(chat)).toBe(false);
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
    expect(isOwnershipScopedChat(chat)).toBe(true);
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

  it('does not infer ownership before the current user is known', () => {
    const chat = {
      id: 'chat-without-current-user',
      status: 'atendimentos',
      agentId: 'agent-1',
    } as Partial<Chat>;

    expect(isChatVisibleForOwnership(chat, 'mine')).toBe(false);
  });

  it('applies the ownership filter to closed conversations as well', () => {
    const chat = {
      id: 'chat-closed-other-agent',
      status: 'encerrados',
      agentId: 'agent-2',
    } as Partial<Chat>;

    expect(isOwnershipScopedChat(chat)).toBe(true);
    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1')).toBe(false);
    expect(isChatVisibleForOwnership(chat, 'everyone', 'agent-1')).toBe(true);
  });

  it('hides a transferred chat even while its thread remains selected', () => {
    const chat = {
      id: 'chat-4',
      status: 'atendimentos',
      workspace_id: 'ws-1',
      agentId: 'agent-2',
      contact: { id: 'contact-1', workspace_id: 'ws-1', name: 'Cliente' },
      messages: [],
    } as Chat;

    expect(isChatVisibleForOwnership(chat, 'mine', 'agent-1')).toBe(false);
  });

  it('clears an existing selection when mine view excludes its chat', () => {
    const chat = {
      id: 'chat-4b',
      status: 'atendimentos',
      agentId: 'agent-2',
    } as Partial<Chat>;

    expect(shouldClearSelectedChatOnOwnershipChange(chat, 'mine', 'agent-1')).toBe(true);
    expect(shouldClearSelectedChatOnOwnershipChange(chat, 'mine', 'agent-2')).toBe(false);
    expect(shouldClearSelectedChatOnOwnershipChange(chat, 'everyone', 'agent-1')).toBe(false);
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
