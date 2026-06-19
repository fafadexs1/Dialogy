import { db } from '@/lib/db';
import { detectAndPersistCausalPatternsForWorkspace } from '@/services/autopilot/causal-patterns';
import {
  promoteEcosystemPatterns,
  type EcosystemPatternPromotionResult,
} from '@/services/autopilot/ecosystem-patterns';
import {
  recordAgentScoreHistory,
  suggestToolSelectionWeightsFromPattern,
} from '@/services/autopilot/score-history';

export type AutopilotLearningCycleWorkspaceResult = {
  workspaceId: string;
  decisionCount: number | null;
  detectedPatterns: number;
  scoreSuggestionsCreated: number;
  skipped: boolean;
  error?: string;
};

export type AutopilotLearningCycleResult = {
  workspaceCount: number;
  sinceDays: number;
  dryRun: boolean;
  results: AutopilotLearningCycleWorkspaceResult[];
  ecosystemPromotion: EcosystemPatternPromotionResult | null;
};

type WorkspaceCandidate = {
  workspaceId: string;
  decisionCount: number | null;
  vertical: string | null;
};

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(1, Math.min(max, Math.round(numberValue)));
}

async function listWorkspaceCandidates(input: {
  workspaceId?: string | null;
  sinceDays: number;
  limit: number;
  vertical?: string | null;
}): Promise<WorkspaceCandidate[]> {
  if (input.workspaceId) {
    return [{ workspaceId: input.workspaceId, decisionCount: null, vertical: input.vertical || null }];
  }

  const { rows } = await db.query(
    `SELECT l.workspace_id, w.vertical, COUNT(*)::int AS decision_count
     FROM agent_decision_ledger l
     LEFT JOIN workspaces w ON w.id = l.workspace_id
     WHERE l.outcome_json IS NOT NULL
       AND l.created_at >= clock_timestamp() - ($1::int * interval '1 day')
     GROUP BY l.workspace_id, w.vertical
     ORDER BY decision_count DESC
     LIMIT $2`,
    [input.sinceDays, input.limit],
  );

  return rows
    .map((row): WorkspaceCandidate | null => {
      const workspaceId = typeof row.workspace_id === 'string' ? row.workspace_id : null;
      if (!workspaceId) return null;
      const decisionCount = Number(row.decision_count);
      return {
        workspaceId,
        decisionCount: Number.isFinite(decisionCount) ? decisionCount : null,
        vertical: typeof row.vertical === 'string' && row.vertical.trim().length > 0 ? row.vertical : null,
      };
    })
    .filter((candidate): candidate is WorkspaceCandidate => candidate !== null);
}

export async function runAutopilotLearningCycle(input: {
  workspaceId?: string | null;
  vertical?: string | null;
  sinceDays?: number;
  limit?: number;
  dryRun?: boolean;
  promoteEcosystem?: boolean;
  createScoreSuggestions?: boolean;
} = {}): Promise<AutopilotLearningCycleResult> {
  const sinceDays = normalizePositiveInteger(input.sinceDays, 30, 365);
  const limit = normalizePositiveInteger(input.limit, input.workspaceId ? 1 : 50, 500);
  const dryRun = Boolean(input.dryRun);
  const candidates = await listWorkspaceCandidates({
    workspaceId: input.workspaceId,
    vertical: input.vertical,
    sinceDays,
    limit,
  });

  const results: AutopilotLearningCycleWorkspaceResult[] = [];
  for (const candidate of candidates) {
    if (dryRun) {
      results.push({
        workspaceId: candidate.workspaceId,
        decisionCount: candidate.decisionCount,
        detectedPatterns: 0,
        scoreSuggestionsCreated: 0,
        skipped: true,
      });
      continue;
    }

    try {
      const patterns = await detectAndPersistCausalPatternsForWorkspace({
        workspaceId: candidate.workspaceId,
        vertical: candidate.vertical,
        sinceDays,
      });
      let scoreSuggestionsCreated = 0;
      if (input.createScoreSuggestions !== false) {
        for (const pattern of patterns.slice(0, 5)) {
          const suggestion = suggestToolSelectionWeightsFromPattern(pattern);
          if (!suggestion) continue;
          await recordAgentScoreHistory({
            workspaceId: candidate.workspaceId,
            weights: suggestion.weights,
            source: 'suggestion',
            reason: suggestion.reason,
          });
          scoreSuggestionsCreated += 1;
        }
      }
      results.push({
        workspaceId: candidate.workspaceId,
        decisionCount: candidate.decisionCount,
        detectedPatterns: patterns.length,
        scoreSuggestionsCreated,
        skipped: false,
      });
    } catch (error) {
      results.push({
        workspaceId: candidate.workspaceId,
        decisionCount: candidate.decisionCount,
        detectedPatterns: 0,
        scoreSuggestionsCreated: 0,
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ecosystemPromotion = dryRun || input.promoteEcosystem === false
    ? null
    : await promoteEcosystemPatterns({
      vertical: input.vertical || null,
    });

  return {
    workspaceCount: candidates.length,
    sinceDays,
    dryRun,
    results,
    ecosystemPromotion,
  };
}
