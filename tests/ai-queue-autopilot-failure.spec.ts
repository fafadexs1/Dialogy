import { describe, expect, it, vi } from 'vitest';

import {
  handleAiQueueJobFailure,
  isFinalAiQueueAttempt,
} from '@/lib/queue/ai-handlers';
import type { QueueJobRecord } from '@/lib/queue/types';

function autopilotJob(overrides: Partial<QueueJobRecord> = {}): QueueJobRecord {
  return {
    id: 'ai-job-1',
    type: 'ai_autopilot_process',
    status: 'active',
    payload: {
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      instanceName: 'instance-1',
      lastMessageContent: 'Preciso de ajuda',
    },
    attempts: 3,
    max_attempts: 3,
    run_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function fakeFailureDatabase(input: {
  sourceExists?: boolean;
  superseded?: boolean;
  completed?: boolean;
  systemAgentId?: string | null;
} = {}) {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(query: string) {
      statements.push(query);
      if (query.includes('WITH source_message AS')) {
        return {
          rows: [{
            source_exists: input.sourceExists ?? true,
            superseded: input.superseded ?? false,
            completed: input.completed ?? false,
          }],
          rowCount: 1,
        };
      }
      if (query.includes('SELECT assigned_system_agent_id')) {
        const systemAgentId = input.systemAgentId === undefined
          ? 'system-agent-1'
          : input.systemAgentId;
        return {
          rows: systemAgentId ? [{ assigned_system_agent_id: systemAgentId }] : [],
          rowCount: systemAgentId ? 1 : 0,
        };
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

describe('AI queue terminal autopilot failure', () => {
  it('recognizes only the exhausted queue attempt as terminal', () => {
    expect(isFinalAiQueueAttempt(autopilotJob({ attempts: 2 }))).toBe(false);
    expect(isFinalAiQueueAttempt(autopilotJob({ attempts: 3 }))).toBe(true);
  });

  it('does nothing before the final attempt', async () => {
    const connect = vi.fn();
    await handleAiQueueJobFailure(
      autopilotJob({ attempts: 2 }),
      new Error('temporary failure'),
      {
        database: { connect } as any,
        broadcastChat: vi.fn(),
      },
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not escalate an older message superseded by a newer customer turn', async () => {
    const fake = fakeFailureDatabase({ superseded: true });
    const broadcastChat = vi.fn();

    await handleAiQueueJobFailure(
      autopilotJob(),
      new Error('provider unavailable'),
      {
        database: fake.database as any,
        broadcastChat,
      },
    );

    expect(fake.state().statements.some((query) => query.includes('UPDATE chats'))).toBe(false);
    expect(fake.state().statements).toContain('COMMIT');
    expect(fake.state().released).toBe(true);
    expect(broadcastChat).not.toHaveBeenCalled();
  });

  it('returns the latest unresolved chat to the human queue exactly on terminal failure', async () => {
    const fake = fakeFailureDatabase();
    const broadcastChat = vi.fn().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleAiQueueJobFailure(
      autopilotJob(),
      new Error('provider unavailable'),
      {
        database: fake.database as any,
        broadcastChat,
      },
    );

    expect(fake.state().statements.some((query) => (
      query.includes('UPDATE chats')
      && query.includes(`status = 'gerais'`)
      && query.includes('is_autopilot_active = false')
    ))).toBe(true);
    expect(fake.state().statements.some((query) => (
      query.includes('INSERT INTO messages')
      && query.includes('autopilot_dead_letter')
    ))).toBe(true);
    expect(fake.state().statements).toContain('COMMIT');
    expect(fake.state().released).toBe(true);
    expect(broadcastChat).toHaveBeenCalledWith('workspace-1', 'chat-1');
    consoleError.mockRestore();
  });
});
