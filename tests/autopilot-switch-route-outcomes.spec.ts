import { describe, expect, it } from 'vitest';

import {
  buildAutopilotSwitchRouteOutcomeInsights,
} from '@/services/autopilot/switch-route-outcomes';
import type { CausalPatternImpactDecision } from '@/services/autopilot/causal-pattern-impact';

function decision(input: {
  switchNodeId?: string | null;
  routeId?: string | null;
  routeLabel?: string | null;
  targetNodeId?: string | null;
  confidence?: number;
  fallbackUsed?: boolean;
  decisionType?: string;
  createdAt: string;
  resolved?: boolean;
  resolutionType?: 'automated' | 'human_handoff' | 'manual_close' | 'timeout' | 'open' | 'unknown';
  turns?: number;
  toolsFailed?: string[];
}): CausalPatternImpactDecision {
  const hasSwitch = input.switchNodeId !== null && input.routeId !== null;
  return {
    createdAt: input.createdAt,
    decisionType: input.decisionType || 'answer',
    procedureId: null,
    stepId: null,
    selectedTool: null,
    selectedTools: [],
    metadata: hasSwitch ? {
      switchResolution: {
        switchNodeId: input.switchNodeId || 'switch-wifi',
        routeId: input.routeId || 'lentidao_wifi',
        routeLabel: input.routeLabel || 'Lentidao Wi-Fi',
        targetNodeId: input.targetNodeId || 'diagnostico',
        confidence: input.confidence ?? 0.9,
        fallbackUsed: Boolean(input.fallbackUsed),
      },
    } : {},
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

describe('autopilot switch route outcomes', () => {
  it('aggregates outcome quality by switch route', () => {
    const insights = buildAutopilotSwitchRouteOutcomeInsights([
      decision({ routeId: 'lentidao_wifi', createdAt: '2026-06-01T12:00:00.000Z', turns: 2, confidence: 0.8 }),
      decision({ routeId: 'lentidao_wifi', createdAt: '2026-06-02T12:00:00.000Z', turns: 4, confidence: 0.7, fallbackUsed: true, toolsFailed: ['router_lookup'] }),
      decision({ routeId: 'lentidao_wifi', createdAt: '2026-06-03T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 6, confidence: 0.6 }),
      decision({ routeId: 'alterar_wifi', routeLabel: 'Alterar Wi-Fi', createdAt: '2026-06-04T12:00:00.000Z', turns: 1 }),
      decision({ switchNodeId: null, routeId: null, createdAt: '2026-06-05T12:00:00.000Z' }),
    ]);

    expect(insights[0]).toMatchObject({
      switchNodeId: 'switch-wifi',
      routeId: 'lentidao_wifi',
      routeLabel: 'Lentidao Wi-Fi',
      targetNodeId: 'diagnostico',
      sampleSize: 3,
      resolvedCount: 2,
      handoffCount: 1,
      automatedCount: 2,
      fallbackCount: 1,
      resolvedRate: 0.667,
      handoffRate: 0.333,
      fallbackRate: 0.333,
      averageTurnsToResolve: 4,
      averageConfidence: 0.7,
      toolFailureRate: 0.333,
      lastDecisionAt: '2026-06-03T12:00:00.000Z',
    });
    expect(insights.map((item) => item.routeId)).toEqual(['lentidao_wifi', 'alterar_wifi']);
  });

  it('respects the requested limit after sorting by sample size', () => {
    const insights = buildAutopilotSwitchRouteOutcomeInsights([
      decision({ routeId: 'a', createdAt: '2026-06-01T12:00:00.000Z' }),
      decision({ routeId: 'a', createdAt: '2026-06-02T12:00:00.000Z' }),
      decision({ routeId: 'b', createdAt: '2026-06-03T12:00:00.000Z' }),
    ], 1);

    expect(insights).toHaveLength(1);
    expect(insights[0].routeId).toBe('a');
  });
});
