import { describe, expect, it } from 'vitest';

import {
  acquireAutopilotChatLease,
  hasCompletedAutopilotSourceMessage,
} from '@/services/autopilot/runtime/chat-lease';

function fakeLeaseDatabase() {
  let owner: string | null = null;
  let superseded = false;
  let completed = false;
  return {
    setSuperseded(value: boolean) {
      superseded = value;
    },
    setCompleted(value: boolean) {
      completed = value;
    },
    async query(query: string, params: unknown[] = []) {
      if (query.includes('INSERT INTO autopilot_chat_leases')) {
        const requestedOwner = String(params[2]);
        if (!owner) {
          owner = requestedOwner;
          return { rows: [{ owner_token: requestedOwner }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (query.includes('DELETE FROM autopilot_chat_leases')) {
        if (owner === String(params[1])) owner = null;
        return { rows: [], rowCount: 1 };
      }
      if (query.includes('UPDATE autopilot_chat_leases')) {
        return { rows: [], rowCount: owner === String(params[1]) ? 1 : 0 };
      }
      if (query.includes('AS superseded')) {
        return { rows: [{ superseded }], rowCount: 1 };
      }
      if (query.includes('FROM orchestrator_runs')) {
        return { rows: completed ? [{ '?column?': 1 }] : [], rowCount: completed ? 1 : 0 };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
}

describe('autopilot distributed chat lease', () => {
  it('serializes two workers for the same chat and lets the waiter acquire after release', async () => {
    const database = fakeLeaseDatabase();
    const first = await acquireAutopilotChatLease({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database,
      leaseMs: 30_000,
      waitMs: 200,
      pollMs: 10,
    });
    const secondPromise = acquireAutopilotChatLease({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-2',
      database,
      leaseMs: 30_000,
      waitMs: 200,
      pollMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await first.release();
    const second = await secondPromise;

    expect(first.status).toBe('acquired');
    expect(second.status).toBe('acquired');
    expect(second.waitedMs).toBeGreaterThanOrEqual(20);
    await second.release();
  });

  it('drops an older waiting message when a newer customer message supersedes it', async () => {
    const database = fakeLeaseDatabase();
    const first = await acquireAutopilotChatLease({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database,
      leaseMs: 30_000,
    });
    database.setSuperseded(true);

    const stale = await acquireAutopilotChatLease({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-old',
      database,
      leaseMs: 30_000,
      waitMs: 200,
      pollMs: 10,
    });

    expect(stale.status).toBe('superseded');
    await first.release();
  });

  it('detects a source message that already produced a persisted response', async () => {
    const database = fakeLeaseDatabase();
    database.setCompleted(true);

    await expect(hasCompletedAutopilotSourceMessage({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database,
    })).resolves.toBe(true);
  });

  it('returns a retryable timeout instead of stealing a live lease', async () => {
    const database = fakeLeaseDatabase();
    const first = await acquireAutopilotChatLease({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database,
      leaseMs: 30_000,
    });
    const blocked = await acquireAutopilotChatLease({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database,
      leaseMs: 30_000,
      waitMs: 20,
      pollMs: 10,
    });

    expect(blocked.status).toBe('timeout');
    expect(blocked.ownerToken).toBeNull();
    await first.release();
  });
});
