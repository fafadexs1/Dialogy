import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { detectAndPersistCausalPatternsForWorkspace } from '@/services/autopilot/causal-patterns';
import { promoteEcosystemPatterns } from '@/services/autopilot/ecosystem-patterns';
import { runAutopilotLearningCycle } from '@/services/autopilot/learning-cycle';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

vi.mock('@/services/autopilot/causal-patterns', () => ({
  detectAndPersistCausalPatternsForWorkspace: vi.fn(),
}));

vi.mock('@/services/autopilot/ecosystem-patterns', () => ({
  promoteEcosystemPatterns: vi.fn(),
}));

describe('autopilot learning cycle', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    vi.mocked(detectAndPersistCausalPatternsForWorkspace).mockReset();
    vi.mocked(promoteEcosystemPatterns).mockReset();
    vi.mocked(promoteEcosystemPatterns).mockResolvedValue({
      candidates: [],
      promoted: [],
      skipped: [],
    });
  });

  it('discovers workspaces with recent outcomes and persists causal patterns', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        { workspace_id: 'workspace-1', vertical: 'isp', decision_count: 12 },
        { workspace_id: 'workspace-2', vertical: 'clinic', decision_count: '7' },
      ],
    } as any);
    vi.mocked(detectAndPersistCausalPatternsForWorkspace)
      .mockResolvedValueOnce([{ fingerprint: 'pattern-1' }] as any)
      .mockResolvedValueOnce([] as any);

    const result = await runAutopilotLearningCycle({
      sinceDays: 14,
      limit: 2,
    });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM agent_decision_ledger'), [14, 2]);
    expect(detectAndPersistCausalPatternsForWorkspace).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-1',
      vertical: 'isp',
      sinceDays: 14,
    });
    expect(detectAndPersistCausalPatternsForWorkspace).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-2',
      vertical: 'clinic',
      sinceDays: 14,
    });
    expect(promoteEcosystemPatterns).toHaveBeenCalledWith({ vertical: null });
    expect(result).toEqual({
      workspaceCount: 2,
      sinceDays: 14,
      dryRun: false,
      ecosystemPromotion: {
        candidates: [],
        promoted: [],
        skipped: [],
      },
      results: [
        {
          workspaceId: 'workspace-1',
          decisionCount: 12,
          detectedPatterns: 1,
          scoreSuggestionsCreated: 0,
          skipped: false,
        },
        {
          workspaceId: 'workspace-2',
          decisionCount: 7,
          detectedPatterns: 0,
          scoreSuggestionsCreated: 0,
          skipped: false,
        },
      ],
    });
  });

  it('runs a dry-run for a specific workspace without mutating patterns', async () => {
    const result = await runAutopilotLearningCycle({
      workspaceId: 'workspace-1',
      sinceDays: 0,
      dryRun: true,
    });

    expect(db.query).not.toHaveBeenCalled();
    expect(detectAndPersistCausalPatternsForWorkspace).not.toHaveBeenCalled();
    expect(promoteEcosystemPatterns).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      workspaceCount: 1,
      sinceDays: 1,
      dryRun: true,
      ecosystemPromotion: null,
      results: [
        {
          workspaceId: 'workspace-1',
          decisionCount: null,
          detectedPatterns: 0,
          scoreSuggestionsCreated: 0,
          skipped: true,
        },
      ],
    });
  });

  it('records conservative score suggestions for high-confidence tool failure patterns', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [{ workspace_id: 'workspace-1', vertical: 'isp', decision_count: 20 }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 'history-1',
          workspace_id: 'workspace-1',
          agent_id: null,
          autopilot_config_id: null,
          weights_json: {
            goalMatch: 0.24,
            procedureStepMatch: 0.2,
            requiredSlotsPresent: 0.3,
            policyAllowed: 0.21,
            toolEvidence: 0.05,
          },
          source: 'suggestion',
          evidence_pattern_id: null,
          reason: 'Sugestao conservadora',
          applied_at: '2026-06-16T05:40:00.000Z',
        }],
      } as any);
    vi.mocked(detectAndPersistCausalPatternsForWorkspace).mockResolvedValueOnce([
      {
        fingerprint: 'fp-tool',
        patternType: 'tool_failure_hotspot',
        toolName: 'sgp_fetch_contact_panel_data',
        insight: 'Tool falhando',
        evidence: { sampleSize: 20 },
        suggestedFix: {},
        impact: {},
        confidence: 0.86,
        scope: 'local',
      },
    ] as any);

    const result = await runAutopilotLearningCycle({ sinceDays: 30, limit: 1, promoteEcosystem: false });

    expect(result.results[0]).toMatchObject({
      workspaceId: 'workspace-1',
      detectedPatterns: 1,
      scoreSuggestionsCreated: 1,
    });
    const scoreHistoryCall = vi.mocked(db.query).mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_score_history')
    ));
    expect(scoreHistoryCall).toBeTruthy();
  });
});
