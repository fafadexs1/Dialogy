import { describe, expect, it, vi } from 'vitest';

import {
  rankDistributionCandidates,
  selectFairAgentForTeam,
  type DistributionCandidate,
} from '@/services/chat-distribution/fair-distribution';

function candidate(overrides: Partial<DistributionCandidate> = {}): DistributionCandidate {
  return {
    agentId: 'agent-a',
    agentName: 'Agent A',
    teamId: 'team-1',
    teamName: 'Support',
    capacity: 6,
    maxPortfolio: 25,
    portfolioCount: 0,
    effectiveLoad: 0,
    fairnessScore: 0,
    lastAssignedAt: null,
    ...overrides,
  };
}

describe('fair chat distribution', () => {
  it('prefers effective conversational load over raw portfolio size', () => {
    const selected = rankDistributionCandidates([
      candidate({
        agentId: 'ten-mostly-idle',
        portfolioCount: 10,
        effectiveLoad: 2.35,
      }),
      candidate({
        agentId: 'four-demanding',
        portfolioCount: 4,
        effectiveLoad: 5,
      }),
    ]);

    expect(selected?.agentId).toBe('ten-mostly-idle');
  });

  it('gives late arrivals a neutral median score instead of a zero-score burst', () => {
    const selected = rankDistributionCandidates([
      candidate({ agentId: 'early-a', fairnessScore: 10, lastAssignedAt: '2026-07-13T10:00:00Z' }),
      candidate({ agentId: 'early-b', fairnessScore: 20, lastAssignedAt: '2026-07-13T11:00:00Z' }),
      candidate({ agentId: 'late', fairnessScore: null, lastAssignedAt: null }),
    ]);

    expect(selected?.agentId).toBe('early-a');
    const late = rankDistributionCandidates([
      candidate({ agentId: 'late', fairnessScore: null }),
      candidate({ agentId: 'baseline-a', fairnessScore: 10, effectiveLoad: 1 }),
      candidate({ agentId: 'baseline-b', fairnessScore: 20, effectiveLoad: 1 }),
    ]);
    expect(late?.fairnessScoreBefore).toBe(15);
  });

  it('enforces simultaneous capacity and total portfolio limits independently', () => {
    const selected = rankDistributionCandidates([
      candidate({ agentId: 'at-load-capacity', effectiveLoad: 6, capacity: 6 }),
      candidate({ agentId: 'at-portfolio-capacity', portfolioCount: 25, maxPortfolio: 25 }),
      candidate({ agentId: 'available', effectiveLoad: 5.9, portfolioCount: 24 }),
    ]);

    expect(selected?.agentId).toBe('available');
  });

  it('avoids the transferring agent when possible but permits the only eligible member', () => {
    const withAlternative = rankDistributionCandidates([
      candidate({ agentId: 'sender', effectiveLoad: 0 }),
      candidate({ agentId: 'other', effectiveLoad: 1 }),
    ], 'sender');
    expect(withAlternative?.agentId).toBe('other');

    const onlyMember = rankDistributionCandidates([
      candidate({ agentId: 'sender' }),
    ], 'sender');
    expect(onlyMember?.agentId).toBe('sender');
  });

  it('uses fairness and idle time as deterministic tie breakers', () => {
    const fairer = rankDistributionCandidates([
      candidate({ agentId: 'higher-score', fairnessScore: 4 }),
      candidate({ agentId: 'lower-score', fairnessScore: 2 }),
    ]);
    expect(fairer?.agentId).toBe('lower-score');

    const longerIdle = rankDistributionCandidates([
      candidate({ agentId: 'recent', lastAssignedAt: '2026-07-13T12:00:00Z' }),
      candidate({ agentId: 'older', lastAssignedAt: '2026-07-13T09:00:00Z' }),
    ]);
    expect(longerIdle?.agentId).toBe('older');
  });

  it('locks the team and scopes workload by workspace before persisting the decision', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          agent_id: 'agent-a',
          agent_name: 'Agent A',
          team_id: 'team-1',
          team_name: 'Support',
          capacity: 6,
          max_portfolio: 25,
          portfolio_count: 1,
          effective_load: 0.25,
          fairness_score: null,
          last_assigned_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const selected = await selectFairAgentForTeam({ query } as any, {
      workspaceId: 'workspace-1',
      teamId: 'team-1',
      chatId: 'chat-1',
      source: 'test',
    });

    expect(selected?.agentId).toBe('agent-a');
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[1][0]).toContain('assigned_chat.workspace_id = t.workspace_id');
    expect(query.mock.calls[1][0]).toContain('uwp.is_online = TRUE');
    expect(query.mock.calls[2][0]).toContain('team_agent_distribution_state');
    expect(query.mock.calls[3][0]).toContain('chat_assignment_events');
  });
});

