import { describe, expect, it, vi } from 'vitest';

import { handoffAutopilotFailureToHuman } from '@/services/autopilot/runtime/failure-handoff';

function fakeDatabase(options: { updated?: boolean; failInsert?: boolean } = {}) {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(query: string) {
      statements.push(query);
      if (query.includes('UPDATE chats')) {
        return options.updated === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: 'chat-1' }], rowCount: 1 };
      }
      if (query.includes('INSERT INTO messages') && options.failInsert) {
        throw new Error('insert failed');
      }
      return { rows: [], rowCount: 1 };
    },
    release() {
      released = true;
    },
  };
  return {
    database: {
      async connect() {
        return client;
      },
    },
    state() {
      return { statements, released };
    },
  };
}

describe('autopilot required tool failure handoff', () => {
  it('atomically returns an unattended AI chat to the human queue', async () => {
    const fake = fakeDatabase();
    const broadcastChat = vi.fn().mockResolvedValue(undefined);

    const transferred = await handoffAutopilotFailureToHuman({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      systemAgentId: 'system-agent-1',
      sourceMessageId: 'message-1',
      failedToolNames: ['mcp:router:get_wifi_view'],
      reason: 'required_tool_failure',
      database: fake.database as any,
      broadcastChat,
    });

    expect(transferred).toBe(true);
    expect(fake.state().statements.some((query) => (
      query.includes('UPDATE chats')
      && query.includes(`status = 'gerais'`)
      && query.includes('is_autopilot_active = false')
    ))).toBe(true);
    expect(fake.state().statements.some((query) => (
      query.includes('INSERT INTO messages')
      && query.includes(`existing.metadata->>'event'`)
    ))).toBe(true);
    expect(fake.state().statements).toContain('COMMIT');
    expect(fake.state().released).toBe(true);
    expect(broadcastChat).toHaveBeenCalledWith('workspace-1', 'chat-1');
  });

  it('does not steal a chat that was already taken by a human', async () => {
    const fake = fakeDatabase({ updated: false });
    const broadcastChat = vi.fn();

    const transferred = await handoffAutopilotFailureToHuman({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      systemAgentId: 'system-agent-1',
      sourceMessageId: 'message-1',
      failedToolNames: ['mcp:router:get_wifi_view'],
      reason: 'required_tool_failure',
      database: fake.database as any,
      broadcastChat,
    });

    expect(transferred).toBe(false);
    expect(fake.state().statements.some((query) => query.includes('INSERT INTO messages'))).toBe(false);
    expect(broadcastChat).not.toHaveBeenCalled();
  });

  it('rolls back the chat transfer when the audit note cannot be persisted', async () => {
    const fake = fakeDatabase({ failInsert: true });

    await expect(handoffAutopilotFailureToHuman({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      systemAgentId: 'system-agent-1',
      sourceMessageId: 'message-1',
      failedToolNames: ['mcp:router:get_wifi_view'],
      reason: 'required_tool_failure',
      database: fake.database as any,
      broadcastChat: vi.fn(),
    })).rejects.toThrow('insert failed');

    expect(fake.state().statements).toContain('ROLLBACK');
    expect(fake.state().released).toBe(true);
  });
});
