import { describe, expect, it } from 'vitest';

import type { Message } from '@/lib/types';
import { isMarketingMessage, matchesChatTeamFilter } from '@/components/chat/chat-list-visibility';

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
