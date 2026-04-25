import { describe, expect, it } from 'vitest';

import { resolveRealtimeSender } from '@/lib/realtime-message-sender';
import type { Chat, User } from '@/lib/types';

describe('resolveRealtimeSender', () => {
  it('uses metadata author identity for transferred outbound messages from a different agent', () => {
    const currentUser = {
      id: 'target-agent',
      name: 'FABRICIO SOARES',
      avatar: 'https://example.com/fabricio.png',
    } as User;

    const chat = {
      id: 'chat-1',
      workspace_id: 'workspace-1',
      status: 'atendimentos',
      contact: { id: 'contact-1', workspace_id: 'workspace-1', name: 'Cliente' },
      agent: {
        id: 'target-agent',
        name: 'FABRICIO SOARES',
        avatar: 'https://example.com/fabricio.png',
      },
      messages: [],
    } as unknown as Chat;

    const sender = resolveRealtimeSender({
      data: {
        from_me: true,
        sender_user_id: 'source-agent',
      },
      metadata: {
        event: 'transfer_notice',
        authored_by: 'source-agent',
        authored_by_name: 'Daniel Dias',
        authored_by_avatar_url: 'https://example.com/daniel.png',
      },
      chat,
      currentUser,
    });

    expect(sender).toMatchObject({
      id: 'source-agent',
      name: 'Daniel Dias',
      avatar: 'https://example.com/daniel.png',
      type: 'user',
    });
  });
});
