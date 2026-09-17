import { describe, expect, it } from 'vitest';

import type { Message } from '@/lib/types';
import { isMarketingMessage, matchesChatTeamFilter } from '@/components/chat/chat-list-visibility';
import { isChatInInboxQueueScope } from '@/lib/inbox-pagination';

describe('chat list team visibility', () => {
  const teams = [
    { id: 'team-sales', tagLabel: 'Vendas' },
    { id: 'team-support', tagLabel: 'Suporte' },
  ];

  it('matches assigned chats by the responsible agent team', () => {
    expect(matchesChatTeamFilter(
      { team_id: 'team-sales' },
      teams,
      ['team-sales']
    )).toBe(true);
  });

  it('matches unassigned queue chats by the queue tag linked to the team', () => {
    expect(matchesChatTeamFilter(
      { tag: 'Suporte' },
      teams,
      ['team-support']
    )).toBe(true);
  });

  it('does not leak chats from another team or queue', () => {
    expect(matchesChatTeamFilter(
      { team_id: 'team-sales', tag: 'Vendas' },
      teams,
      ['team-support']
    )).toBe(false);
  });

  it('does not use a stale tag to leak an explicitly transferred chat', () => {
    expect(matchesChatTeamFilter(
      { team_id: 'team-sales', tag: 'Suporte' },
      teams,
      ['team-support']
    )).toBe(false);
  });
});

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
});

describe('isChatInInboxQueueScope', () => {
  it('prevents chats in attendance from entering robo or fila', () => {
    const chat = {
      status: 'atendimentos' as const,
      agentId: 'user-123',
      team_id: 'team-comercial',
      tag: 'Comercial',
    };

    expect(isChatInInboxQueueScope(chat, 'robo')).toBe(false);
    expect(isChatInInboxQueueScope(chat, 'fila')).toBe(false);
  });

  it('prevents closed chats from entering robo or fila', () => {
    const chat = {
      status: 'encerrados' as const,
      agentId: 'user-123',
      tag: 'Inviabilidade técnica',
    };

    expect(isChatInInboxQueueScope(chat, 'robo')).toBe(false);
    expect(isChatInInboxQueueScope(chat, 'fila')).toBe(false);
  });

  it('prevents chats with human agent assigned from entering robo or fila even if status is gerais', () => {
    expect(
      isChatInInboxQueueScope(
        {
          status: 'gerais',
          agentId: 'user-123',
        },
        'robo'
      )
    ).toBe(false);

    expect(
      isChatInInboxQueueScope(
        {
          status: 'gerais',
          agent_id: 'user-123',
        },
        'robo'
      )
    ).toBe(false);

    expect(
      isChatInInboxQueueScope(
        {
          status: 'gerais',
          agent: { id: 'user-123' },
        },
        'robo'
      )
    ).toBe(false);
  });

  it('routes chats with team_id to fila and NOT robo, even if tag is missing or null', () => {
    const chat = {
      status: 'gerais' as const,
      team_id: 'team-support',
      tag: null,
    };

    expect(isChatInInboxQueueScope(chat, 'robo')).toBe(false);
    expect(isChatInInboxQueueScope(chat, 'fila')).toBe(true);
  });

  it('routes chats with teamName to fila and NOT robo', () => {
    const chat = {
      status: 'gerais' as const,
      teamName: 'Suporte Técnico',
      tag: '',
    };

    expect(isChatInInboxQueueScope(chat, 'robo')).toBe(false);
    expect(isChatInInboxQueueScope(chat, 'fila')).toBe(true);
  });

  it('routes chats with tag to fila and NOT robo', () => {
    const chat = {
      status: 'gerais' as const,
      tag: 'Comercial',
    };

    expect(isChatInInboxQueueScope(chat, 'robo')).toBe(false);
    expect(isChatInInboxQueueScope(chat, 'fila')).toBe(true);
  });

  it('routes unassigned chats without team/tag to robo and NOT fila', () => {
    const chat = {
      status: 'gerais' as const,
      tag: '',
      team_id: undefined,
      teamName: undefined,
      agentId: undefined,
    };

    expect(isChatInInboxQueueScope(chat, 'robo')).toBe(true);
    expect(isChatInInboxQueueScope(chat, 'fila')).toBe(false);
  });
});

