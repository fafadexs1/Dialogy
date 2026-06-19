import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import {
  buildEcosystemPatternPromotion,
  importEcosystemPatternForWorkspace,
  promoteEcosystemPatterns,
  type LocalCausalPatternForEcosystem,
} from '@/services/autopilot/ecosystem-patterns';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

function localPattern(overrides: Partial<LocalCausalPatternForEcosystem> = {}): LocalCausalPatternForEcosystem {
  return {
    workspaceId: 'workspace-1',
    fingerprint: 'fp-switch-fallback',
    patternType: 'switch_fallback_hotspot',
    vertical: 'ISP',
    insight: 'Switch de Wi-Fi cai muito em fallback.',
    evidence: {
      sampleSize: 40,
      fallbackRate: 0.5,
    },
    suggestedFix: {
      type: 'improve_switch_routes',
      action: 'add_route_or_examples_for_recurring_fallbacks',
    },
    impact: {
      affectedConversations: 40,
    },
    confidence: 0.92,
    status: 'approved',
    ...overrides,
  };
}

describe('autopilot ecosystem patterns', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('promotes only abstract cross-workspace patterns with quorum and aggregate evidence', () => {
    const promotion = buildEcosystemPatternPromotion({
      patterns: [
        localPattern({ workspaceId: 'workspace-1', confidence: 0.93 }),
        localPattern({ workspaceId: 'workspace-2', confidence: 0.91, status: 'applied' }),
        localPattern({ workspaceId: 'workspace-3', confidence: 0.9 }),
      ],
    });

    expect(promotion.promoted).toHaveLength(1);
    expect(promotion.promoted[0]).toMatchObject({
      fingerprint: 'fp-switch-fallback',
      patternType: 'switch_fallback_hotspot',
      vertical: 'isp',
      sourceWorkspaceCount: 3,
      sampleSize: 120,
      confidence: 0.913,
      status: 'validated',
    });
    expect(promotion.promoted[0].evidence).toMatchObject({
      privacy: {
        containsRawConversationData: false,
        containsPersonalData: false,
      },
    });
  });

  it('skips ecosystem promotion when conflict, quorum, confidence, or sample rules fail', () => {
    const promotion = buildEcosystemPatternPromotion({
      patterns: [
        localPattern({ workspaceId: 'workspace-1', status: 'approved', confidence: 0.95 }),
        localPattern({ workspaceId: 'workspace-2', status: 'approved', confidence: 0.95 }),
        localPattern({ workspaceId: 'workspace-3', status: 'conflicted', confidence: 0.95 }),
        localPattern({ workspaceId: 'workspace-4', fingerprint: 'fp-low-confidence', confidence: 0.6 }),
        localPattern({ workspaceId: 'workspace-5', fingerprint: 'fp-low-confidence', confidence: 0.61 }),
        localPattern({ workspaceId: 'workspace-6', fingerprint: 'fp-low-confidence', confidence: 0.62 }),
      ],
    });

    expect(promotion.promoted).toEqual([]);
    expect(promotion.skipped.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'conflicting_local_patterns',
      'insufficient_average_confidence',
    ]));
  });

  it('persists validated ecosystem patterns without source workspace identifiers', async () => {
    const dbPattern = (pattern: LocalCausalPatternForEcosystem) => ({
      workspace_id: pattern.workspaceId,
      fingerprint: pattern.fingerprint,
      pattern_type: pattern.patternType,
      vertical: pattern.vertical,
      insight: pattern.insight,
      evidence_json: pattern.evidence,
      suggested_fix_json: pattern.suggestedFix,
      impact_json: pattern.impact,
      confidence: pattern.confidence,
      status: pattern.status,
    });
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [
          dbPattern(localPattern({ workspaceId: 'workspace-1', vertical: 'clinic', evidence: { sampleSize: 45 } })),
          dbPattern(localPattern({ workspaceId: 'workspace-2', vertical: 'clinic', evidence: { sampleSize: 35 }, confidence: 0.94 })),
          dbPattern(localPattern({ workspaceId: 'workspace-3', vertical: 'clinic', evidence: { sampleSize: 30 }, confidence: 0.91 })),
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const result = await promoteEcosystemPatterns({ vertical: 'clinic' });

    expect(result.promoted).toHaveLength(1);
    const upsertCall = vi.mocked(db.query).mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_ecosystem_patterns')
    ));
    expect(upsertCall).toBeTruthy();
    const evidence = JSON.parse(String(upsertCall?.[1]?.[4]));
    expect(evidence).toMatchObject({
      sourceWorkspaceCount: 3,
      sampleSize: 110,
      privacy: {
        containsPersonalData: false,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('workspace-1');
    expect(JSON.stringify(evidence)).not.toContain('workspace-2');
  });

  it('imports a validated ecosystem pattern as a pending local review item', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [{
          id: 'ecosystem-1',
          fingerprint: 'fp-switch-fallback',
          pattern_type: 'switch_fallback_hotspot',
          vertical: 'isp',
          insight: 'Switch de Wi-Fi cai muito em fallback.',
          evidence_json: {
            sourceWorkspaceCount: 3,
            sampleSize: 120,
            privacy: {
              containsPersonalData: false,
            },
          },
          suggested_fix_json: {
            type: 'improve_switch_routes',
            action: 'add_route_or_examples_for_recurring_fallbacks',
          },
          source_workspace_count: 3,
          sample_size: 120,
          confidence: 0.93,
          status: 'validated',
        }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 'local-pattern-1',
          fingerprint: 'fp-switch-fallback',
          status: 'pending',
          scope: 'ecosystem',
        }],
      } as any);

    const result = await importEcosystemPatternForWorkspace({
      workspaceId: 'workspace-9',
      ecosystemPatternId: 'ecosystem-1',
      vertical: 'ISP',
      importedByUserId: 'user-1',
    });

    expect(result.pattern).toMatchObject({
      id: 'local-pattern-1',
      status: 'pending',
      scope: 'ecosystem',
      ecosystemPatternId: 'ecosystem-1',
    });
    const insertCall = vi.mocked(db.query).mock.calls[1];
    expect(String(insertCall[0])).toContain('INSERT INTO agent_causal_patterns');
    const evidence = JSON.parse(String(insertCall[1]?.[4]));
    expect(evidence.ecosystem).toMatchObject({
      ecosystemPatternId: 'ecosystem-1',
      sourceWorkspaceCount: 3,
      sampleSize: 120,
      privacy: {
        containsRawConversationData: false,
        containsPersonalData: false,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('workspace-1');
  });
});
