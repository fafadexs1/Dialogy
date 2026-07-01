import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from '@/lib/db';
import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';
import {
  consumeConfirmedPendingAction,
  consumePendingActionCancellation,
  consumeSupersededPendingAction,
  isExplicitAffirmativeMessage,
  resolveConfirmedPendingAction,
} from '@/services/autopilot/flow-state-store';

describe('autopilot persisted confirmation', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('recognizes a short explicit affirmative response', () => {
    expect(isExplicitAffirmativeMessage('Sim')).toBe(true);
    expect(isExplicitAffirmativeMessage('quero saber mais')).toBe(false);
  });

  it('returns the exact pending action only while it remains allowed', () => {
    const action = { type: 'close_chat' as const };
    const state = {
      chatId: 'chat',
      workspaceId: 'workspace',
      autopilotConfigId: 'config',
      activeNodeId: 'node',
      pendingConfirmation: { action, requestedAt: new Date().toISOString() },
      lastAction: null,
      repetitionCount: 0,
    };

    expect(resolveConfirmedPendingAction({ state, message: 'sim', allowedToolNames: ['close_chat'] })).toEqual(action);
    expect(resolveConfirmedPendingAction({ state, message: 'sim', allowedToolNames: [] })).toBeNull();
  });

  it('matches pending MCP confirmations by qualified tool name', () => {
    const action = {
      type: 'mcp_call_tool' as const,
      reason: 'Reiniciar roteador apos confirmacao.',
      payload: {
        toolName: 'mcp:router:reboot_router',
        arguments: { contract_id: '123' },
      },
    };
    const state = {
      chatId: 'chat',
      workspaceId: 'workspace',
      autopilotConfigId: 'config',
      activeNodeId: 'node',
      pendingConfirmation: { action, requestedAt: new Date().toISOString() },
      lastAction: null,
      repetitionCount: 0,
    };

    expect(resolveConfirmedPendingAction({
      state,
      message: 'pode sim',
      allowedToolNames: ['mcp:router:reboot_router'],
    })).toEqual(action);
    expect(resolveConfirmedPendingAction({
      state,
      message: 'pode sim',
      allowedToolNames: ['mcp:router:other_tool'],
    })).toBeNull();
  });

  it('rejects a pending action whose fingerprint no longer matches its arguments', () => {
    const action = {
      type: 'mcp_call_tool' as const,
      payload: {
        toolName: 'mcp:commerce:cancel_order',
        arguments: { order_id: 'ORD-10' },
      },
    };
    const state = {
      chatId: 'chat',
      workspaceId: 'workspace',
      autopilotConfigId: 'config',
      activeNodeId: 'node',
      pendingConfirmation: {
        action,
        requestedAt: new Date().toISOString(),
        actionFingerprint: fingerprintToolAction({
          ...action,
          payload: { ...action.payload, arguments: { order_id: 'ORD-99' } },
        }),
      },
      lastAction: null,
      repetitionCount: 0,
    };

    expect(resolveConfirmedPendingAction({
      state,
      message: 'confirmo',
      allowedToolNames: ['mcp:commerce:cancel_order'],
    })).toBeNull();
  });

  it('atomically consumes a confirmation only once and records the exact action', async () => {
    const action = {
      type: 'mcp_call_tool' as const,
      payload: {
        toolName: 'mcp:clinic:book_appointment',
        arguments: { date: '2026-07-01', time: '14:00' },
      },
    };
    const state = {
      chatId: 'chat',
      workspaceId: 'workspace',
      autopilotConfigId: 'config',
      activeNodeId: 'node',
      pendingConfirmation: {
        action,
        requestedAt: new Date().toISOString(),
        actionFingerprint: fingerprintToolAction(action),
      },
      lastAction: null,
      repetitionCount: 0,
    };
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ chat_id: 'chat' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await expect(consumeConfirmedPendingAction({
      state,
      message: 'sim, confirmo',
      allowedToolNames: ['mcp:clinic:book_appointment'],
    })).resolves.toEqual(action);
    await expect(consumeConfirmedPendingAction({
      state,
      message: 'sim, confirmo',
      allowedToolNames: ['mcp:clinic:book_appointment'],
    })).resolves.toBeNull();

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    expect(query).toContain("pending_confirmation->'action' = $2::jsonb");
    expect(query).toContain('RETURNING chat_id');
    expect(params).toEqual(['chat', JSON.stringify(action), true]);
  });

  it('consumes cancellation or a new request so stale confirmations cannot execute later', async () => {
    const action = {
      type: 'mcp_call_tool' as const,
      payload: { toolName: 'mcp:commerce:cancel_order', arguments: { order_id: 'ORD-10' } },
    };
    const state = {
      chatId: 'chat',
      workspaceId: 'workspace',
      autopilotConfigId: 'config',
      activeNodeId: 'node',
      pendingConfirmation: { action, requestedAt: new Date().toISOString() },
      lastAction: null,
      repetitionCount: 0,
    };
    vi.mocked(db.query).mockResolvedValue({ rows: [{ chat_id: 'chat' }] } as any);

    await expect(consumePendingActionCancellation({ state, message: 'melhor nao' })).resolves.toBe(true);
    await expect(consumeSupersededPendingAction({ state, message: 'Antes disso, qual o preco do plano?' })).resolves.toBe(true);
    await expect(consumeSupersededPendingAction({ state, message: 'confirmo' })).resolves.toBe(false);
  });
});
