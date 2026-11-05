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
    onlineSince: null,
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

  it('uses workload even when a candidate has reached an old portfolio ceiling', () => {
    const selected = rankDistributionCandidates([
      candidate({ agentId: 'at-load-capacity', effectiveLoad: 6, capacity: 6 }),
      candidate({ agentId: 'at-portfolio-capacity', portfolioCount: 25, maxPortfolio: 25 }),
      candidate({ agentId: 'available', effectiveLoad: 5.9, portfolioCount: 24 }),
    ]);

    expect(selected?.agentId).toBe('at-portfolio-capacity');
    expect(selected?.maxPortfolio).toBeNull();
    expect(selected?.overflow).toBe(false);
  });

  it('overflows to the least occupied agent instead of reporting nobody available', () => {
    const selected = rankDistributionCandidates([
      candidate({ agentId: 'swamped', effectiveLoad: 11, capacity: 6, portfolioCount: 12 }),
      candidate({ agentId: 'busy', effectiveLoad: 7, capacity: 6, portfolioCount: 8 }),
    ]);

    expect(selected?.agentId).toBe('busy');
    expect(selected?.overflow).toBe(true);
  });

  it('overflows to the lowest load regardless of portfolio size or a saved ceiling', () => {
    const selected = rankDistributionCandidates([
      candidate({ agentId: 'full', effectiveLoad: 7, capacity: 6, portfolioCount: 25, maxPortfolio: 25 }),
      candidate({ agentId: 'also-full', effectiveLoad: 9, capacity: 6, portfolioCount: 30, maxPortfolio: 25 }),
    ]);

    expect(selected?.agentId).toBe('full');
    expect(selected?.overflow).toBe(true);
  });

  it('honours allowOverflow: false for callers that prefer queueing', () => {
    const selected = rankDistributionCandidates(
      [candidate({ agentId: 'busy', effectiveLoad: 7, capacity: 6 })],
      null,
      { allowOverflow: false }
    );

    expect(selected).toBeNull();
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

  it('uses history for nearby loads but protects a substantially less occupied agent', () => {
    const heavilyAssigned = candidate({ agentId: 'many', effectiveLoad: 1, fairnessScore: 100 });
    const lightlyAssigned = candidate({ agentId: 'few', effectiveLoad: 1.05, fairnessScore: 0 });
    expect(rankDistributionCandidates([heavilyAssigned, lightlyAssigned])?.agentId).toBe('few');
    expect(rankDistributionCandidates([
      heavilyAssigned,
      { ...lightlyAssigned, effectiveLoad: 3 },
    ])?.agentId).toBe('many');
  });

  it('anchors the load band to the minimum and makes selection independent of input order', () => {
    const agents = [
      candidate({ agentId: 'least-loaded', effectiveLoad: 1, fairnessScore: 100 }),
      candidate({ agentId: 'nearby', effectiveLoad: 1.5, fairnessScore: 10 }),
      candidate({ agentId: 'outside-band', effectiveLoad: 2, fairnessScore: 0 }),
    ];
    expect(rankDistributionCandidates(agents)?.agentId).toBe('nearby');
    expect(rankDistributionCandidates([...agents].reverse())?.agentId).toBe('nearby');
  });

  it('compares occupancy relative to each agent capacity', () => {
    expect(rankDistributionCandidates([
      candidate({ agentId: 'standard', effectiveLoad: 2, capacity: 6, fairnessScore: 10 }),
      candidate({ agentId: 'higher-capacity', effectiveLoad: 4, capacity: 12, fairnessScore: 0 }),
    ])?.agentId).toBe('higher-capacity');
  });

  it('paces a newcomer after the first assignment even with an almost empty portfolio', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    const incumbent = candidate({ agentId: 'incumbent', effectiveLoad: 5, fairnessScore: 10 });
    const newcomer = candidate({
      agentId: 'newcomer', onlineSince: now.toISOString(), fairnessScore: null,
    });
    const first = rankDistributionCandidates([incumbent, newcomer], null, { now });
    expect(first?.agentId).toBe('newcomer');
    const assigned = {
      ...newcomer, effectiveLoad: 1.25, portfolioCount: 1,
      fairnessScore: first!.fairnessScoreAfter, lastAssignedAt: now.toISOString(),
    };
    expect(rankDistributionCandidates([incumbent, assigned], null, {
      now: new Date(now.getTime() + 1_000),
    })?.agentId).toBe('incumbent');
    expect(rankDistributionCandidates([incumbent, assigned], null, {
      now: new Date(now.getTime() + 60_000),
    })?.agentId).toBe('newcomer');
  });

  it('ends entry pacing after five minutes and never makes the only available person unavailable', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    const newcomer = candidate({
      agentId: 'newcomer', onlineSince: now.toISOString(), lastAssignedAt: now.toISOString(),
    });
    expect(rankDistributionCandidates([newcomer], null, { now })?.agentId).toBe('newcomer');
    const incumbent = candidate({ agentId: 'incumbent', effectiveLoad: 5 });
    expect(rankDistributionCandidates([
      incumbent, { ...newcomer, onlineSince: '2026-10-23T11:55:00Z' },
    ], null, { now })?.agentId).toBe('newcomer');
    expect(rankDistributionCandidates([
      { ...incumbent, effectiveLoad: 6 }, newcomer,
    ], null, { now })?.agentId).toBe('newcomer');
  });

  it('locks the team and scopes workload by workspace before persisting the decision', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
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

    const { selection, reason } = await selectFairAgentForTeam({ query } as any, {
      workspaceId: 'workspace-1',
      teamId: 'team-1',
      chatId: 'chat-1',
      source: 'test',
    });

    expect(selection?.agentId).toBe('agent-a');
    expect(reason).toBe('available');
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[1][0]).toContain('FOR NO KEY UPDATE OF u');
    expect(query.mock.calls[1][1]).toEqual(['team-1', 'workspace-1']);
    expect(query.mock.calls[2][0]).toContain('assigned_chat.workspace_id = t.workspace_id');
    // Mesmo predicado de presenca da interface: is_online + last_seen OU
    // atividade recente. Divergir disso e o que fazia a tela mostrar agentes
    // que o balanceador nao enxergava.
    expect(query.mock.calls[2][0]).toContain('uwp.is_online = TRUE');
    expect(query.mock.calls[2][0]).toContain('uwp.recent_activity_at');
    expect(query.mock.calls[3][0]).toContain('team_agent_distribution_state');
    expect(query.mock.calls[4][0]).toContain('chat_assignment_events');
  });

  it('reports why the team had no candidates instead of a generic failure', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ members: 3, online: 0, accepting: 0 }] });

    const { selection, reason } = await selectFairAgentForTeam({ query } as any, {
      workspaceId: 'workspace-1',
      teamId: 'team-1',
      chatId: 'chat-1',
      source: 'test',
    });

    expect(selection).toBeNull();
    expect(reason).toBe('all_offline');
    expect(query.mock.calls[3][0]).toContain('accepting_assignments');
  });

  it('separates a paused team from an offline one', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ members: 2, online: 2, accepting: 0 }] });

    const { reason } = await selectFairAgentForTeam({ query } as any, {
      workspaceId: 'workspace-1',
      teamId: 'team-1',
      chatId: 'chat-1',
      source: 'test',
    });

    expect(reason).toBe('not_accepting');
  });

  it('waits for shared members before reading the workload', async () => {
    let releaseMembers!: () => void;
    const membersLocked = new Promise<void>((resolve) => { releaseMembers = resolve; });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR NO KEY UPDATE')) await membersLocked;
      if (sql.includes('AS members')) return { rows: [{ members: 0, online: 0, accepting: 0 }] };
      return { rows: [] };
    });
    const result = selectFairAgentForTeam({ query } as any, {
      workspaceId: 'workspace-1', teamId: 'team-1', chatId: 'chat-1', source: 'test',
    });
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls.some(([sql]) => sql.includes('AS effective_load'))).toBe(false);
    releaseMembers();
    await expect(result).resolves.toMatchObject({ selection: null, reason: 'no_members' });
    expect(query.mock.calls.some(([sql]) => sql.includes('AS effective_load'))).toBe(true);
  });
});

