import { describe, expect, it } from 'vitest';

import {
  buildAutopilotLearningTrend,
  type AutopilotLearningTrendDecision,
} from '@/services/autopilot/learning-trend';

function decision(input: {
  createdAt: string;
  resolved?: boolean;
  resolutionType?: 'automated' | 'human_handoff' | 'manual_close' | 'timeout' | 'open' | 'unknown';
  turns?: number;
  escalationNeeded?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
}): AutopilotLearningTrendDecision {
  return {
    createdAt: input.createdAt,
    outcome: {
      resolved: input.resolved ?? input.resolutionType !== 'human_handoff',
      resolutionType: input.resolutionType || 'automated',
      turnsToResolve: input.turns ?? 2,
      escalationNeeded: input.escalationNeeded ?? input.resolutionType === 'human_handoff',
      customerSentimentFinal: input.sentiment || 'neutral',
    },
  };
}

describe('autopilot learning trend', () => {
  it('detects global improvement over the previous window', () => {
    const trend = buildAutopilotLearningTrend([
      decision({ createdAt: '2026-04-20T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 6, sentiment: 'negative' }),
      decision({ createdAt: '2026-05-01T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 5, sentiment: 'neutral' }),
      decision({ createdAt: '2026-05-10T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 4, sentiment: 'neutral' }),
      decision({ createdAt: '2026-05-20T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 2, sentiment: 'positive' }),
      decision({ createdAt: '2026-06-05T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 2, sentiment: 'positive' }),
      decision({ createdAt: '2026-06-15T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 1, sentiment: 'positive' }),
    ], {
      now: new Date('2026-06-16T12:00:00.000Z'),
      minSamples: 3,
    });

    expect(trend.verdict).toBe('improved');
    expect(trend.currentSampleSize).toBe(3);
    expect(trend.previousSampleSize).toBe(3);
    expect(trend.resolvedRate.delta).toBe(0.667);
    expect(trend.handoffRate.delta).toBe(-0.667);
    expect(trend.averageTurnsToResolve.delta).toBeLessThan(0);
    expect(trend.positiveSentimentRate.delta).toBe(1);
    expect(trend.improvementScore).toBeGreaterThan(0);
  });

  it('detects regression over the previous window', () => {
    const trend = buildAutopilotLearningTrend([
      decision({ createdAt: '2026-04-20T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 1, sentiment: 'positive' }),
      decision({ createdAt: '2026-05-01T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 2, sentiment: 'positive' }),
      decision({ createdAt: '2026-05-10T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 2, sentiment: 'positive' }),
      decision({ createdAt: '2026-05-20T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 6, sentiment: 'negative' }),
      decision({ createdAt: '2026-06-05T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 5, sentiment: 'neutral' }),
      decision({ createdAt: '2026-06-15T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 4, sentiment: 'neutral' }),
    ], {
      now: new Date('2026-06-16T12:00:00.000Z'),
      minSamples: 3,
    });

    expect(trend.verdict).toBe('regressed');
    expect(trend.resolvedRate.delta).toBeLessThan(0);
    expect(trend.handoffRate.delta).toBeGreaterThan(0);
    expect(trend.positiveSentimentRate.delta).toBe(-1);
    expect(trend.improvementScore).toBeLessThan(0);
  });

  it('does not claim a trend without enough samples in both windows', () => {
    const trend = buildAutopilotLearningTrend([
      decision({ createdAt: '2026-05-10T12:00:00.000Z', resolved: true, resolutionType: 'automated' }),
      decision({ createdAt: '2026-06-15T12:00:00.000Z', resolved: true, resolutionType: 'automated' }),
    ], {
      now: new Date('2026-06-16T12:00:00.000Z'),
      minSamples: 3,
    });

    expect(trend.verdict).toBe('insufficient_data');
    expect(trend.improvementScore).toBeNull();
  });
});
