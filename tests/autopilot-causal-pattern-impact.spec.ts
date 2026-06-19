import { describe, expect, it } from 'vitest';

import {
  buildCausalPatternImpactReport,
  decisionMatchesCausalPatternScope,
  type CausalPatternImpactDecision,
} from '@/services/autopilot/causal-pattern-impact';

function decision(input: Partial<CausalPatternImpactDecision> & {
  createdAt: string;
  resolved?: boolean;
  resolutionType?: 'automated' | 'human_handoff' | 'manual_close' | 'timeout' | 'open' | 'unknown';
  turns?: number;
  toolsFailed?: string[];
}): CausalPatternImpactDecision {
  return {
    createdAt: input.createdAt,
    decisionType: input.decisionType || 'answer',
    procedureId: input.procedureId || 'proc-wifi',
    stepId: input.stepId || 'step-diagnose',
    selectedTool: input.selectedTool || null,
    selectedTools: input.selectedTools || [],
    metadata: input.metadata || null,
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

describe('causal pattern impact', () => {
  it('measures improvement for the same procedure step before and after application', () => {
    const report = buildCausalPatternImpactReport({
      id: 'pattern-1',
      patternType: 'confusing_step',
      procedureId: 'proc-wifi',
      stepId: 'step-diagnose',
      appliedAt: '2026-06-10T12:00:00.000Z',
      applicationStatus: 'published',
    }, [
      decision({ createdAt: '2026-06-07T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 6 }),
      decision({ createdAt: '2026-06-08T12:00:00.000Z', resolved: false, resolutionType: 'human_handoff', turns: 5 }),
      decision({ createdAt: '2026-06-09T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 4 }),
      decision({ createdAt: '2026-06-11T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 2 }),
      decision({ createdAt: '2026-06-12T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 2 }),
      decision({ createdAt: '2026-06-13T12:00:00.000Z', resolved: true, resolutionType: 'automated', turns: 1 }),
    ]);

    expect(report.status).toBe('measured');
    expect(report.direction).toBe('improved');
    expect(report.baseline.sampleSize).toBe(3);
    expect(report.after.sampleSize).toBe(3);
    expect(report.deltas.resolvedRate).toBeGreaterThan(0);
    expect(report.deltas.handoffRate).toBeLessThan(0);
    expect(report.deltas.averageTurnsToResolve).toBeLessThan(0);
  });

  it('matches switch route scoped decisions through metadata', () => {
    const pattern = {
      id: 'pattern-switch',
      patternType: 'switch_route_low_confidence',
      switchNodeId: 'switch-wifi',
      switchRouteId: 'lentidao_wifi',
    };

    expect(decisionMatchesCausalPatternScope(pattern, decision({
      createdAt: '2026-06-11T12:00:00.000Z',
      metadata: { switchResolution: { switchNodeId: 'switch-wifi', routeId: 'lentidao_wifi' } },
    }))).toBe(true);
    expect(decisionMatchesCausalPatternScope(pattern, decision({
      createdAt: '2026-06-11T12:00:00.000Z',
      metadata: { switchResolution: { switchNodeId: 'switch-wifi', routeId: 'trocar_senha' } },
    }))).toBe(false);
  });

  it('does not claim impact when samples are below the minimum', () => {
    const report = buildCausalPatternImpactReport({
      id: 'pattern-1',
      patternType: 'tool_failure_hotspot',
      toolName: 'crm_update_contact_custom_fields',
      appliedAt: '2026-06-10T12:00:00.000Z',
      applicationStatus: 'drafted',
    }, [
      decision({
        createdAt: '2026-06-09T12:00:00.000Z',
        selectedTool: 'crm_update_contact_custom_fields',
        toolsFailed: ['crm_update_contact_custom_fields'],
      }),
      decision({
        createdAt: '2026-06-11T12:00:00.000Z',
        selectedTool: 'crm_update_contact_custom_fields',
      }),
    ]);

    expect(report.status).toBe('insufficient_data');
    expect(report.direction).toBe('unknown');
    expect(report.deltas.improvementScore).toBeNull();
  });
});
