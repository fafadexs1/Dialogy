import { describe, expect, it } from 'vitest';

import { isExplicitAffirmativeMessage, resolveConfirmedPendingAction } from '@/services/autopilot/flow-state-store';

describe('autopilot persisted confirmation', () => {
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
});
