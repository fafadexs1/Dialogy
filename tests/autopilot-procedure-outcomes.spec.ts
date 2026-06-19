import { describe, expect, it } from 'vitest';

import {
  buildAutopilotProcedureOutcomeInsights,
} from '@/services/autopilot/procedure-outcomes';
import type { CausalPatternImpactDecision } from '@/services/autopilot/causal-pattern-impact';

function decision(input: {
  procedureId?: string | null;
  createdAt: string;
  resolved?: boolean;
  resolutionType?: 'automated' | 'human_handoff' | 'manual_close' | 'timeout' | 'open' | 'unknown';
  turns?: number;
  toolsFailed?: string[];
}): CausalPatternImpactDecision {
  return {
    createdAt: input.createdAt,
    decisionType: 'answer',
    procedureId: input.procedureId === undefined ? 'proc-wifi' : input.procedureId,
    stepId: null,
    selectedTool: null,
    selectedTools: [],
    metadata: {},
    outcome: {
      resolved: input.resolved ?? true,
      resolutionType: input.resolutionType || 'automated',
      turnsToResolve: input.turns ?? 2,
      timeToResolutionSeconds: null,
      customerAskedForHuman: false,
      customerSentimentFinal: 'neutral',
      toolsExecuted: [],
      toolsFailed: input.toolsFailed || [],
      escalationNeeded: input.resolutionType === 'human_handoff',
      closedBy: input.resolutionType === 'automated' ? 'agent' : null,
      chatStatus: 'encerrados',
      stepOutcomes: [],
    },
  };
}

describe('autopilot procedure outcomes', () => {
  it('aggregates outcome quality by procedure', () => {
    const insights = buildAutopilotProcedureOutcomeInsights([
      decision({ procedureId: 'proc-wifi', createdAt: '2026-06-01T12:00:00.000Z', turns: 2 }),
      decision({ procedureId: 'proc-wifi', createdAt: '2026-06-02T12:00:00.000Z', turns: 4, toolsFailed: ['router_lookup'] }),
      decision({ procedureId: 'proc-wifi', createdAt: '2026-06-03T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 6 }),
      decision({ procedureId: 'proc-billing', createdAt: '2026-06-04T12:00:00.000Z', turns: 1 }),
      decision({ procedureId: null, createdAt: '2026-06-05T12:00:00.000Z', turns: 1 }),
    ]);

    expect(insights[0]).toMatchObject({
      procedureId: 'proc-wifi',
      sampleSize: 3,
      resolvedCount: 2,
      handoffCount: 1,
      automatedCount: 2,
      resolvedRate: 0.667,
      handoffRate: 0.333,
      averageTurnsToResolve: 4,
      toolFailureRate: 0.333,
      lastDecisionAt: '2026-06-03T12:00:00.000Z',
    });
    expect(insights.map((item) => item.procedureId)).toEqual(['proc-wifi', 'proc-billing']);
  });

  it('respects the requested limit after sorting by sample size', () => {
    const insights = buildAutopilotProcedureOutcomeInsights([
      decision({ procedureId: 'proc-a', createdAt: '2026-06-01T12:00:00.000Z' }),
      decision({ procedureId: 'proc-a', createdAt: '2026-06-02T12:00:00.000Z' }),
      decision({ procedureId: 'proc-b', createdAt: '2026-06-03T12:00:00.000Z' }),
    ], 1);

    expect(insights).toHaveLength(1);
    expect(insights[0].procedureId).toBe('proc-a');
  });
});
