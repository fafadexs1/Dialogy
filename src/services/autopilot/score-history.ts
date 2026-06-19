import { db } from '@/lib/db';

export type ToolSelectionScoreWeights = {
  goalMatch: number;
  procedureStepMatch: number;
  requiredSlotsPresent: number;
  policyAllowed: number;
  toolEvidence: number;
};

export type ToolSelectionScoreInputs = ToolSelectionScoreWeights;

export type AgentScoreHistorySource = 'manual' | 'auto_tune' | 'suggestion';

export type AgentScoreHistoryEntry = {
  id: string;
  workspaceId: string;
  agentId: string | null;
  autopilotConfigId: string | null;
  weights: ToolSelectionScoreWeights;
  source: AgentScoreHistorySource;
  evidencePatternId: string | null;
  reason: string | null;
  appliedAt: string;
};

export type ScoreSuggestionPatternLike = {
  patternType?: string;
  confidence?: number;
  toolName?: string | null;
};

export const DEFAULT_TOOL_SELECTION_SCORE_WEIGHTS: ToolSelectionScoreWeights = {
  goalMatch: 0.3,
  procedureStepMatch: 0.25,
  requiredSlotsPresent: 0.2,
  policyAllowed: 0.15,
  toolEvidence: 0.1,
};

const WEIGHT_KEYS: Array<keyof ToolSelectionScoreWeights> = [
  'goalMatch',
  'procedureStepMatch',
  'requiredSlotsPresent',
  'policyAllowed',
  'toolEvidence',
];

function mapAgentScoreHistoryRow(row: any): AgentScoreHistoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id || null,
    autopilotConfigId: row.autopilot_config_id || null,
    weights: normalizeToolSelectionScoreWeights(row.weights_json),
    source: row.source as AgentScoreHistorySource,
    evidencePatternId: row.evidence_pattern_id || null,
    reason: row.reason || null,
    appliedAt: new Date(row.applied_at).toISOString(),
  };
}

function clampWeight(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

function clampMetric(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

export function normalizeToolSelectionScoreWeights(input?: Partial<ToolSelectionScoreWeights> | null): ToolSelectionScoreWeights {
  const raw = {
    ...DEFAULT_TOOL_SELECTION_SCORE_WEIGHTS,
    ...(input || {}),
  };
  const clamped = WEIGHT_KEYS.reduce<ToolSelectionScoreWeights>((acc, key) => {
    acc[key] = clampWeight(raw[key]);
    return acc;
  }, { ...DEFAULT_TOOL_SELECTION_SCORE_WEIGHTS });
  const total = WEIGHT_KEYS.reduce((sum, key) => sum + clamped[key], 0);
  if (total <= 0) return DEFAULT_TOOL_SELECTION_SCORE_WEIGHTS;

  return WEIGHT_KEYS.reduce<ToolSelectionScoreWeights>((acc, key) => {
    acc[key] = round(clamped[key] / total);
    return acc;
  }, { ...DEFAULT_TOOL_SELECTION_SCORE_WEIGHTS });
}

export function calculateToolSelectionScore(
  inputs: ToolSelectionScoreInputs,
  weights?: Partial<ToolSelectionScoreWeights> | null,
) {
  const normalizedWeights = normalizeToolSelectionScoreWeights(weights);
  const score = WEIGHT_KEYS.reduce((sum, key) => (
    sum + clampMetric(inputs[key]) * normalizedWeights[key]
  ), 0);

  return {
    score: Number(score.toFixed(2)),
    weights: normalizedWeights,
  };
}

export function suggestToolSelectionWeightsFromPattern(
  pattern: ScoreSuggestionPatternLike,
): { weights: ToolSelectionScoreWeights; reason: string } | null {
  const confidence = Number(pattern.confidence || 0);
  if (!Number.isFinite(confidence) || confidence < 0.75) return null;

  if (pattern.patternType === 'tool_failure_hotspot' && pattern.toolName) {
    return {
      weights: normalizeToolSelectionScoreWeights({
        goalMatch: 0.24,
        procedureStepMatch: 0.2,
        requiredSlotsPresent: 0.3,
        policyAllowed: 0.21,
        toolEvidence: 0.05,
      }),
      reason: `Sugestao conservadora: aumentar peso de slots/politica antes de executar tools; evidencia em ${pattern.toolName}.`,
    };
  }

  if (pattern.patternType === 'score_drift') {
    return {
      weights: normalizeToolSelectionScoreWeights({
        goalMatch: 0.22,
        procedureStepMatch: 0.18,
        requiredSlotsPresent: 0.32,
        policyAllowed: 0.23,
        toolEvidence: 0.05,
      }),
      reason: 'Sugestao conservadora: corrigir drift do Tool Selection Score aumentando peso de slots obrigatorios e politica.',
    };
  }

  return null;
}

export async function recordAgentScoreHistory(input: {
  workspaceId: string;
  agentId?: string | null;
  autopilotConfigId?: string | null;
  weights: Partial<ToolSelectionScoreWeights>;
  source: AgentScoreHistorySource;
  evidencePatternId?: string | null;
  reason?: string | null;
  userId?: string | null;
}): Promise<AgentScoreHistoryEntry | null> {
  const weights = normalizeToolSelectionScoreWeights(input.weights);
  const { rows } = await db.query(
    `INSERT INTO agent_score_history (
        workspace_id,
        agent_id,
        autopilot_config_id,
        weights_json,
        source,
        evidence_pattern_id,
        reason,
        created_by_user_id
     ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7, $8
     )
     RETURNING id, workspace_id, agent_id, autopilot_config_id, weights_json,
               source, evidence_pattern_id, reason, applied_at`,
    [
      input.workspaceId,
      input.agentId || null,
      input.autopilotConfigId || null,
      JSON.stringify(weights),
      input.source,
      input.evidencePatternId || null,
      input.reason || null,
      input.userId || null,
    ],
  );
  const row = rows[0];
  if (!row) return null;

  return mapAgentScoreHistoryRow(row);
}

export async function loadLatestActiveToolSelectionScoreWeights(input: {
  workspaceId: string;
  agentId?: string | null;
  autopilotConfigId?: string | null;
  includeSuggestions?: boolean;
}): Promise<AgentScoreHistoryEntry | null> {
  const sources = input.includeSuggestions
    ? ['manual', 'auto_tune', 'suggestion']
    : ['manual', 'auto_tune'];

  const { rows } = await db.query(
    `SELECT id, workspace_id, agent_id, autopilot_config_id, weights_json,
            source, evidence_pattern_id, reason, applied_at
       FROM agent_score_history
      WHERE workspace_id = $1
        AND source = ANY($4::text[])
        AND (
          ($2::uuid IS NOT NULL AND autopilot_config_id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND agent_id = $3::uuid)
          OR (autopilot_config_id IS NULL AND agent_id IS NULL)
        )
      ORDER BY
        CASE
          WHEN $2::uuid IS NOT NULL AND autopilot_config_id = $2::uuid THEN 0
          WHEN $3::uuid IS NOT NULL AND agent_id = $3::uuid THEN 1
          ELSE 2
        END,
        applied_at DESC
      LIMIT 1`,
    [
      input.workspaceId,
      input.autopilotConfigId || null,
      input.agentId || null,
      sources,
    ],
  );
  const row = rows[0];
  return row ? mapAgentScoreHistoryRow(row) : null;
}
