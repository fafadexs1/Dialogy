import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import {
  calculateToolSelectionScore,
  loadLatestActiveToolSelectionScoreWeights,
  normalizeToolSelectionScoreWeights,
  recordAgentScoreHistory,
  suggestToolSelectionWeightsFromPattern,
} from '@/services/autopilot/score-history';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('autopilot score history', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('normalizes tool selection weights and calculates auditable scores', () => {
    const weights = normalizeToolSelectionScoreWeights({
      goalMatch: 3,
      procedureStepMatch: 2,
      requiredSlotsPresent: 1,
      policyAllowed: 0,
      toolEvidence: -1,
    });

    expect(weights).toEqual({
      goalMatch: 0.5,
      procedureStepMatch: 0.3333,
      requiredSlotsPresent: 0.1667,
      policyAllowed: 0,
      toolEvidence: 0,
    });
    const result = calculateToolSelectionScore({
      goalMatch: 1,
      procedureStepMatch: 1,
      requiredSlotsPresent: 0,
      policyAllowed: 1,
      toolEvidence: 1,
    }, weights);
    expect(result.score).toBe(0.83);
    expect(result.weights).toEqual(weights);
  });

  it('records normalized score history snapshots', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: 'history-1',
        workspace_id: 'workspace-1',
        agent_id: null,
        autopilot_config_id: 'config-1',
        weights_json: {
          goalMatch: 0.5,
          procedureStepMatch: 0.2,
          requiredSlotsPresent: 0.15,
          policyAllowed: 0.1,
          toolEvidence: 0.05,
        },
        source: 'suggestion',
        evidence_pattern_id: 'pattern-1',
        reason: 'score drift observado',
        applied_at: '2026-06-16T05:30:00.000Z',
      }],
    } as any);

    const entry = await recordAgentScoreHistory({
      workspaceId: 'workspace-1',
      autopilotConfigId: 'config-1',
      evidencePatternId: 'pattern-1',
      source: 'suggestion',
      reason: 'score drift observado',
      weights: {
        goalMatch: 5,
        procedureStepMatch: 2,
        requiredSlotsPresent: 1.5,
        policyAllowed: 1,
        toolEvidence: 0.5,
      },
    });

    const params = vi.mocked(db.query).mock.calls[0][1];
    expect(JSON.parse(String(params?.[3]))).toEqual({
      goalMatch: 0.5,
      procedureStepMatch: 0.2,
      requiredSlotsPresent: 0.15,
      policyAllowed: 0.1,
      toolEvidence: 0.05,
    });
    expect(entry).toMatchObject({
      id: 'history-1',
      source: 'suggestion',
      evidencePatternId: 'pattern-1',
    });
  });

  it('loads only applied score weights by default', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: 'history-2',
        workspace_id: 'workspace-1',
        agent_id: 'agent-1',
        autopilot_config_id: 'config-1',
        weights_json: {
          goalMatch: 0.24,
          procedureStepMatch: 0.2,
          requiredSlotsPresent: 0.3,
          policyAllowed: 0.21,
          toolEvidence: 0.05,
        },
        source: 'manual',
        evidence_pattern_id: 'pattern-1',
        reason: 'aplicado pelo usuario',
        applied_at: '2026-06-16T06:00:00.000Z',
      }],
    } as any);

    const entry = await loadLatestActiveToolSelectionScoreWeights({
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      autopilotConfigId: 'config-1',
    });

    const params = vi.mocked(db.query).mock.calls[0][1];
    expect(params?.[3]).toEqual(['manual', 'auto_tune']);
    expect(entry).toMatchObject({
      id: 'history-2',
      source: 'manual',
      weights: {
        requiredSlotsPresent: 0.3,
        policyAllowed: 0.21,
      },
    });
  });

  it('suggests conservative score weights for score drift patterns', () => {
    const suggestion = suggestToolSelectionWeightsFromPattern({
      patternType: 'score_drift',
      confidence: 0.82,
    });

    expect(suggestion).toMatchObject({
      weights: {
        requiredSlotsPresent: 0.32,
        policyAllowed: 0.23,
      },
    });
    expect(suggestion?.reason).toContain('drift');
  });
});
