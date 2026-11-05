import { describe, expect, it } from 'vitest';
import { resolveHandoffTeam } from '@/services/agent-tools/router';
import { isConversationCloseRequest, isPotentialConversationCloseRequest } from '@/services/autopilot/close-intent';
import { buildDecisionOutcome } from '@/services/autopilot/outcome-tracker';

describe('agent action reliability', () => {
  const teams = [{ id: 'sales', name: 'Comercial' }, { id: 'billing', name: 'Financeiro' }];

  it('honors the explicitly requested team before the inferred intent', () => {
    expect(resolveHandoffTeam({ intent: 'human_handoff', availableTeams: teams, customerMessage: 'Me transfira para o Financeiro' })?.id).toBe('billing');
  });

  it('does not pick the first team when no destination is unambiguous', () => {
    expect(resolveHandoffTeam({ intent: 'human_handoff', availableTeams: teams })).toBeNull();
    expect(resolveHandoffTeam({ intent: 'human_handoff', availableTeams: [{ id: 'support', name: 'Suporte' }], customerMessage: 'Me transfira para o Financeiro' })).toBeNull();
  });

  it('does not treat an ambiguous goodbye as permission to close a pending task', () => {
    expect(isConversationCloseRequest('só isso')).toBe(false);
    expect(isPotentialConversationCloseRequest('só isso')).toBe(true);
    expect(isConversationCloseRequest('pode encerrar o atendimento')).toBe(true);
  });

  it('keeps a queued handoff open instead of counting it as an assigned transfer', () => {
    const outcome = buildDecisionOutcome({ chatStatus: 'gerais', toolCalls: [
      { toolName: 'transfer_chat', status: 'success', output: { transferred: false, disposition: 'queued' } },
    ] });
    expect(outcome.resolutionType).toBe('open');
    expect(outcome.escalationNeeded).toBe(true);
  });
});
