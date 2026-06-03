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
});
