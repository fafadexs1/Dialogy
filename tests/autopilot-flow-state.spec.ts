import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from '@/lib/db';
import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';
import {
  claimAutopilotCollectionCompletion,
  clearAutopilotCollectionCompletion,
  consumeConfirmedPendingAction,
  consumePendingActionCancellation,
  consumeSupersededPendingAction,
  isExplicitAffirmativeMessage,
  loadAutopilotContactMemory,
  resolveConfirmedPendingAction,
  saveAutopilotSlotMemory,
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

  it('hydrates stable contact facts across chats and keeps current-chat facts newer', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        {
          chat_id: 'chat-current',
          metadata: {
            conversationSlots: { address: 'CEP 72800-123; Bloco B, apto 12' },
            stableSlots: { address: 'CEP 72800-123' },
            nativeState: { pendingFieldIds: [] },
          },
          updated_at: '2026-07-13T12:00:00.000Z',
        },
        {
          chat_id: 'chat-previous',
          metadata: {
            stableSlots: { name: 'João da Silva', phone: '61999991111' },
          },
          updated_at: '2026-07-10T12:00:00.000Z',
        },
      ],
    } as any);

    const memory = await loadAutopilotContactMemory({
      workspaceId: 'workspace',
      contactId: 'contact',
      chatId: 'chat-current',
      maxAgeDays: 180,
    });

    expect(memory.slots).toEqual({
      address: 'CEP 72800-123; Bloco B, apto 12',
      name: 'João da Silva',
      phone: '61999991111',
    });
    expect(memory.nativeState).toEqual({ pendingFieldIds: [] });
  });

  it('orders stable facts by slot evidence time instead of unrelated state updates', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        {
          chat_id: 'chat-current',
          metadata: {
            conversationSlots: { name: 'Nome Antigo' },
            stableSlots: { name: 'Nome Antigo' },
            stableSlotUpdatedAt: { name: '2026-06-01T12:00:00.000Z' },
            slotMemoryUpdatedAt: '2026-06-01T12:00:00.000Z',
          },
          slot_memory_updated_at: '2026-06-01T12:00:00.000Z',
          updated_at: '2026-07-13T12:00:00.000Z',
        },
        {
          chat_id: 'chat-newer-fact',
          metadata: {
            stableSlots: { name: 'Nome Corrigido' },
            stableSlotUpdatedAt: { name: '2026-07-10T12:00:00.000Z' },
            slotMemoryUpdatedAt: '2026-07-10T12:00:00.000Z',
          },
          slot_memory_updated_at: '2026-07-10T12:00:00.000Z',
          updated_at: '2026-07-10T12:00:00.000Z',
        },
      ],
    } as any);

    const memory = await loadAutopilotContactMemory({
      workspaceId: 'workspace',
      contactId: 'contact',
      chatId: 'chat-current',
    });

    expect(memory.slots.name).toBe('Nome Corrigido');
    expect(vi.mocked(db.query).mock.calls[0]?.[0]).toContain("metadata->>'slotMemoryUpdatedAt'");
  });

  it('stores per-field timestamps when stable facts are updated', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any);

    await saveAutopilotSlotMemory({
      chatId: 'chat',
      workspaceId: 'workspace',
      slots: { name: 'Nome Corrigido', address: 'CEP 01310-100' },
    });

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    expect(query).toContain('stableSlotUpdatedAt');
    expect(JSON.parse(String(params?.[5]))).toMatchObject({
      name: expect.any(String),
      address: expect.any(String),
    });
  });

  it('claims a collection checkpoint exactly once by its server fingerprint', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ chat_id: 'chat' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const input = {
      chatId: 'chat',
      workspaceId: 'workspace',
      checkpointFingerprint: 'checkpoint-hash',
      completionExecutionId: 'execution-current',
    };
    await expect(claimAutopilotCollectionCompletion(input)).resolves.toBe(true);
    await expect(claimAutopilotCollectionCompletion(input)).resolves.toBe(false);

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    const queryParams = params as unknown[];
    expect(query).toContain("collectionCompletionV1,status}' = 'awaiting_fields'");
    expect(query).toContain("collectionCompletionV1,status}' = 'closing'");
    expect(query).toContain('closingClaimedAt');
    expect(query).toContain('checkpointFingerprint');
    expect(query).toContain("to_jsonb('closing'::text)");
    expect(queryParams.slice(0, 4)).toEqual(['chat', 'workspace', 'checkpoint-hash', 'execution-current']);
    expect(new Date(String(queryParams[4])).toISOString()).toBe(queryParams[4]);
    expect(new Date(String(queryParams[5])).toISOString()).toBe(queryParams[5]);
  });

  it('clears only the matching collection checkpoint', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ chat_id: 'chat' }] } as any);

    await expect(clearAutopilotCollectionCompletion({
      chatId: 'chat',
      workspaceId: 'workspace',
      checkpointFingerprint: 'checkpoint-hash',
    })).resolves.toBe(true);

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    expect(query).toContain("- 'collectionCompletionV1'");
    expect(params).toEqual(['chat', 'workspace', 'checkpoint-hash']);
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
