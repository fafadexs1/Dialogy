import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queries: [] as string[],
  recentMessages: [] as Array<Record<string, unknown>>,
  released: false,
  broadcastHydratedChatUpdate: vi.fn(async () => undefined),
  enqueueAiCaseMemoryRefresh: vi.fn(async () => undefined),
}));

vi.mock('@/lib/realtime/chat-broadcast', () => ({
  broadcastHydratedChatUpdate: mocks.broadcastHydratedChatUpdate,
}));

vi.mock('@/lib/queue', () => ({
  enqueueAiCaseMemoryRefresh: mocks.enqueueAiCaseMemoryRefresh,
  shouldEnqueueJob: vi.fn(() => false),
}));

vi.mock('@/lib/db', () => ({
  db: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (query: string) => {
        mocks.queries.push(query);
        if (query.includes('SELECT status, agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              status: 'gerais',
              agent_id: null,
              assigned_system_agent_id: 'system-agent-1',
              autopilot_config_id: 'config-1',
              is_autopilot_active: true,
              closed_at: null,
            }],
          };
        }
        if (query.includes('created_at >')) {
          return { rowCount: 0, rows: [] };
        }
        if (query.includes('SELECT from_me, sender_system_agent_id, content')) {
          return { rowCount: mocks.recentMessages.length, rows: mocks.recentMessages };
        }
        if (query.includes("SET status = 'gerais'")) {
          return { rowCount: 1, rows: [{ id: 'chat-1' }] };
        }
        if (query.includes("SET status = 'encerrados'")) {
          return { rowCount: 1, rows: [{ closed_at: new Date('2026-07-08T12:00:00.000Z') }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(() => {
        mocks.released = true;
      }),
    })),
  },
}));

import { executeAutopilotInactivityClose } from '@/services/autopilot/runtime/inactivity-close';

describe('autopilot inactivity timeout', () => {
  beforeEach(() => {
    mocks.queries = [];
    mocks.recentMessages = [];
    mocks.released = false;
    mocks.broadcastHydratedChatUpdate.mockClear();
    mocks.enqueueAiCaseMemoryRefresh.mockClear();
  });

  it('returns the chat to the human queue when the AI is waiting for customer data', async () => {
    mocks.recentMessages = [{
      from_me: true,
      sender_system_agent_id: 'system-agent-1',
      content: 'Para continuar, me informe o endereco completo.',
    }];

    await executeAutopilotInactivityClose({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      systemAgentId: 'system-agent-1',
      timeoutSeconds: 60,
      anchorAt: new Date('2026-07-08T11:00:00.000Z'),
      sourceMessageId: 'message-1',
      orchestratorRunId: 'run-1',
    });

    expect(mocks.queries.some((query) => query.includes("SET status = 'gerais'"))).toBe(true);
    expect(mocks.queries.some((query) => query.includes("SET status = 'encerrados'"))).toBe(false);
    expect(mocks.queries.some((query) => query.includes('INSERT INTO messages'))).toBe(true);
    expect(mocks.broadcastHydratedChatUpdate).toHaveBeenCalledWith('workspace-1', 'chat-1');
    expect(mocks.released).toBe(true);
  });

  it('closes only when the last AI message is clearly terminal', async () => {
    mocks.recentMessages = [{
      from_me: true,
      sender_system_agent_id: 'system-agent-1',
      content: 'Obrigado pelo contato. Vou encerrar o atendimento por aqui.',
    }];

    await executeAutopilotInactivityClose({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      systemAgentId: 'system-agent-1',
      timeoutSeconds: 60,
      anchorAt: new Date('2026-07-08T11:00:00.000Z'),
      sourceMessageId: 'message-1',
      orchestratorRunId: 'run-1',
    });

    expect(mocks.queries.some((query) => query.includes("SET status = 'encerrados'"))).toBe(true);
    expect(mocks.queries.some((query) => query.includes("SET status = 'gerais'"))).toBe(false);
    expect(mocks.broadcastHydratedChatUpdate).not.toHaveBeenCalled();
    expect(mocks.released).toBe(true);
  });
});
