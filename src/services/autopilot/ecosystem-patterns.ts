import { db } from '@/lib/db';

export type EcosystemPatternStatus = 'candidate' | 'validated' | 'active' | 'deprecated';

export type LocalCausalPatternForEcosystem = {
  workspaceId: string;
  fingerprint: string;
  patternType: string;
  vertical?: string | null;
  insight: string;
  evidence: Record<string, unknown>;
  suggestedFix: Record<string, unknown>;
  impact?: Record<string, unknown>;
  confidence: number;
  status: string;
};

export type AgentEcosystemPattern = {
  fingerprint: string;
  patternType: string;
  vertical: string;
  insight: string;
  evidence: Record<string, unknown>;
  suggestedFix: Record<string, unknown>;
  sourceWorkspaceCount: number;
  sampleSize: number;
  confidence: number;
  status: EcosystemPatternStatus;
};

export type EcosystemPatternPromotionOptions = {
  minWorkspaceCount?: number;
  minAverageConfidence?: number;
  minSampleSize?: number;
};

export type EcosystemPatternPromotionResult = {
  candidates: AgentEcosystemPattern[];
  promoted: AgentEcosystemPattern[];
  skipped: Array<{
    fingerprint: string;
    vertical: string;
    reason: string;
    sourceWorkspaceCount: number;
    sampleSize: number;
    confidence: number;
  }>;
};

export type ImportedEcosystemPattern = {
  id: string;
  fingerprint: string;
  status: string;
  scope: 'ecosystem';
  ecosystemPatternId: string;
};

const DEFAULT_PROMOTION_OPTIONS: Required<EcosystemPatternPromotionOptions> = {
  minWorkspaceCount: 3,
  minAverageConfidence: 0.9,
  minSampleSize: 100,
};

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseJsonRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeVertical(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function readNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function estimatePatternSampleSize(pattern: Pick<LocalCausalPatternForEcosystem, 'evidence' | 'impact'>) {
  const candidates = [
    pattern.evidence.sampleSize,
    pattern.evidence.totalSwitchDecisions,
    pattern.evidence.affectedToolExecutions,
    pattern.impact?.affectedConversations,
    pattern.impact?.totalSwitchDecisions,
    pattern.impact?.affectedToolExecutions,
  ];
  for (const candidate of candidates) {
    const value = readNumber(candidate);
    if (value != null && value > 0) return Math.round(value);
  }
  return 0;
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function buildAbstractEvidence(input: {
  sourceWorkspaceCount: number;
  sampleSize: number;
  confidence: number;
  patternType: string;
  statuses: Record<string, number>;
}) {
  return {
    sourceWorkspaceCount: input.sourceWorkspaceCount,
    sampleSize: input.sampleSize,
    averageConfidence: input.confidence,
    patternType: input.patternType,
    statuses: input.statuses,
    privacy: {
      containsRawConversationData: false,
      containsPersonalData: false,
      aggregation: 'workspace_count_sample_size_average_confidence',
    },
  };
}

export function buildEcosystemPatternPromotion(input: {
  patterns: LocalCausalPatternForEcosystem[];
  options?: EcosystemPatternPromotionOptions;
}): EcosystemPatternPromotionResult {
  const options = { ...DEFAULT_PROMOTION_OPTIONS, ...input.options };
  const grouped = new Map<string, LocalCausalPatternForEcosystem[]>();
  for (const pattern of input.patterns) {
    const vertical = normalizeVertical(pattern.vertical);
    if (!vertical || !pattern.fingerprint || !pattern.patternType) continue;
    const key = `${vertical}:${pattern.fingerprint}`;
    grouped.set(key, [...(grouped.get(key) || []), { ...pattern, vertical }]);
  }

  const candidates: AgentEcosystemPattern[] = [];
  const promoted: AgentEcosystemPattern[] = [];
  const skipped: EcosystemPatternPromotionResult['skipped'] = [];

  for (const items of grouped.values()) {
    const first = items[0];
    const vertical = normalizeVertical(first.vertical);
    const positiveItems = items.filter((item) => item.status === 'approved' || item.status === 'applied');
    const conflictItems = items.filter((item) => item.status === 'conflicted');
    const workspaceIds = new Set(positiveItems.map((item) => item.workspaceId));
    const sourceWorkspaceCount = workspaceIds.size;
    const sampleSize = positiveItems.reduce((sum, item) => sum + estimatePatternSampleSize(item), 0);
    const confidence = positiveItems.length > 0
      ? round(positiveItems.reduce((sum, item) => sum + item.confidence, 0) / positiveItems.length)
      : 0;
    const statuses = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    const representative = positiveItems
      .slice()
      .sort((a, b) => b.confidence - a.confidence)[0] || first;
    const candidate: AgentEcosystemPattern = {
      fingerprint: first.fingerprint,
      patternType: first.patternType,
      vertical,
      insight: representative.insight,
      evidence: buildAbstractEvidence({
        sourceWorkspaceCount,
        sampleSize,
        confidence,
        patternType: first.patternType,
        statuses,
      }),
      suggestedFix: representative.suggestedFix,
      sourceWorkspaceCount,
      sampleSize,
      confidence,
      status: 'validated',
    };
    candidates.push(candidate);

    let reason = '';
    if (conflictItems.length > 0) reason = 'conflicting_local_patterns';
    else if (sourceWorkspaceCount < options.minWorkspaceCount) reason = 'insufficient_workspace_quorum';
    else if (confidence < options.minAverageConfidence) reason = 'insufficient_average_confidence';
    else if (sampleSize < options.minSampleSize) reason = 'insufficient_aggregate_sample_size';

    if (reason) {
      skipped.push({
        fingerprint: first.fingerprint,
        vertical,
        reason,
        sourceWorkspaceCount,
        sampleSize,
        confidence,
      });
      continue;
    }

    promoted.push(candidate);
  }

  return {
    candidates,
    promoted,
    skipped,
  };
}

export async function promoteEcosystemPatterns(input: {
  vertical?: string | null;
  options?: EcosystemPatternPromotionOptions;
} = {}): Promise<EcosystemPatternPromotionResult> {
  const vertical = normalizeVertical(input.vertical);
  const params: unknown[] = [];
  let verticalClause = '';
  if (vertical) {
    params.push(vertical);
    verticalClause = 'AND LOWER(p.vertical) = $1';
  }

  const { rows } = await db.query(
    `SELECT p.workspace_id, p.fingerprint, p.pattern_type, p.vertical, p.insight,
            p.evidence_json, p.suggested_fix_json, p.impact_json, p.confidence, p.status
     FROM agent_causal_patterns p
     WHERE p.vertical IS NOT NULL
       ${verticalClause}
       AND p.status IN ('approved', 'applied', 'conflicted')
       AND p.scope = 'local'`,
    params,
  );

  const promotion = buildEcosystemPatternPromotion({
    patterns: rows.map((row): LocalCausalPatternForEcosystem => ({
      workspaceId: String(row.workspace_id),
      fingerprint: String(row.fingerprint),
      patternType: String(row.pattern_type),
      vertical: row.vertical || null,
      insight: String(row.insight || ''),
      evidence: parseJsonRecord(row.evidence_json),
      suggestedFix: parseJsonRecord(row.suggested_fix_json),
      impact: parseJsonRecord(row.impact_json),
      confidence: Number(row.confidence || 0),
      status: String(row.status || ''),
    })),
    options: input.options,
  });

  for (const pattern of promotion.promoted) {
    await db.query(
      `INSERT INTO agent_ecosystem_patterns (
          fingerprint,
          pattern_type,
          vertical,
          insight,
          evidence_json,
          suggested_fix_json,
          source_workspace_count,
          sample_size,
          confidence,
          status,
          validated_at
       ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, clock_timestamp()
       )
       ON CONFLICT (vertical, fingerprint)
       DO UPDATE SET
          pattern_type = EXCLUDED.pattern_type,
          insight = EXCLUDED.insight,
          evidence_json = EXCLUDED.evidence_json,
          suggested_fix_json = EXCLUDED.suggested_fix_json,
          source_workspace_count = EXCLUDED.source_workspace_count,
          sample_size = EXCLUDED.sample_size,
          confidence = EXCLUDED.confidence,
          status = CASE
            WHEN agent_ecosystem_patterns.status = 'deprecated' THEN 'deprecated'
            ELSE EXCLUDED.status
          END,
          validated_at = CASE
            WHEN agent_ecosystem_patterns.status = 'deprecated' THEN agent_ecosystem_patterns.validated_at
            ELSE clock_timestamp()
          END`,
      [
        pattern.fingerprint,
        pattern.patternType,
        pattern.vertical,
        pattern.insight,
        JSON.stringify(pattern.evidence),
        JSON.stringify(pattern.suggestedFix),
        pattern.sourceWorkspaceCount,
        pattern.sampleSize,
        pattern.confidence,
        pattern.status,
      ],
    );
  }

  return promotion;
}

export async function importEcosystemPatternForWorkspace(input: {
  workspaceId: string;
  ecosystemPatternId: string;
  vertical?: string | null;
  importedByUserId?: string | null;
}): Promise<{ pattern: ImportedEcosystemPattern | null; error?: string }> {
  const expectedVertical = normalizeVertical(input.vertical);
  const selected = await db.query(
    `SELECT id, fingerprint, pattern_type, vertical, insight, evidence_json,
            suggested_fix_json, source_workspace_count, sample_size, confidence, status
       FROM agent_ecosystem_patterns
      WHERE id = $1
        AND status IN ('validated', 'active')
      LIMIT 1`,
    [input.ecosystemPatternId],
  );
  const ecosystem = selected.rows[0];
  if (!ecosystem) {
    return { pattern: null, error: 'Sugestao do ecossistema nao encontrada.' };
  }

  const ecosystemVertical = normalizeVertical(ecosystem.vertical);
  if (!ecosystemVertical || (expectedVertical && ecosystemVertical !== expectedVertical)) {
    return { pattern: null, error: 'Sugestao do ecossistema nao pertence a vertical deste workspace.' };
  }

  const evidence = parseJsonRecord(ecosystem.evidence_json);
  const suggestedFix = parseJsonRecord(ecosystem.suggested_fix_json);
  const importMetadata = {
    importedFromEcosystem: true,
    ecosystemPatternId: ecosystem.id,
    ecosystemFingerprint: ecosystem.fingerprint,
    sourceWorkspaceCount: Number(ecosystem.source_workspace_count || 0),
    sampleSize: Number(ecosystem.sample_size || 0),
    importedByUserId: input.importedByUserId || null,
    importedAt: new Date().toISOString(),
    privacy: {
      containsRawConversationData: false,
      containsPersonalData: false,
    },
  };
  const localEvidence = {
    ...evidence,
    ecosystem: importMetadata,
  };
  const localImpact = {
    ecosystemPattern: true,
    sourceWorkspaceCount: Number(ecosystem.source_workspace_count || 0),
    sampleSize: Number(ecosystem.sample_size || 0),
  };

  const inserted = await db.query(
    `INSERT INTO agent_causal_patterns (
        workspace_id,
        agent_id,
        fingerprint,
        pattern_type,
        procedure_id,
        step_id,
        switch_node_id,
        switch_route_id,
        tool_name,
        insight,
        evidence_json,
        suggested_fix_json,
        impact_json,
        confidence,
        scope,
        vertical,
        status,
        review_metadata
     ) VALUES (
        $1, NULL, $2, $3, NULL, NULL, NULL, NULL,
        NULL, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, 'ecosystem', $9, 'pending', $10::jsonb
     )
     ON CONFLICT (workspace_id, fingerprint)
     DO UPDATE SET
        insight = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.insight
          ELSE EXCLUDED.insight
        END,
        evidence_json = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.evidence_json
          ELSE EXCLUDED.evidence_json
        END,
        suggested_fix_json = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.suggested_fix_json
          ELSE EXCLUDED.suggested_fix_json
        END,
        impact_json = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.impact_json
          ELSE EXCLUDED.impact_json
        END,
        confidence = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.confidence
          ELSE EXCLUDED.confidence
        END,
        scope = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.scope
          ELSE 'ecosystem'
        END,
        vertical = COALESCE(agent_causal_patterns.vertical, EXCLUDED.vertical),
        status = CASE
          WHEN agent_causal_patterns.status IN ('approved', 'applied', 'dismissed', 'conflicted')
            THEN agent_causal_patterns.status
          ELSE 'pending'
        END,
        review_metadata = COALESCE(agent_causal_patterns.review_metadata, '{}'::jsonb) || $10::jsonb
     RETURNING id, fingerprint, status, scope`,
    [
      input.workspaceId,
      ecosystem.fingerprint,
      ecosystem.pattern_type,
      ecosystem.insight,
      JSON.stringify(localEvidence),
      JSON.stringify(suggestedFix),
      JSON.stringify(localImpact),
      Number(ecosystem.confidence || 0),
      ecosystemVertical,
      JSON.stringify(importMetadata),
    ],
  );

  const row = inserted.rows[0];
  if (!row) return { pattern: null, error: 'Falha ao importar sugestao do ecossistema.' };
  return {
    pattern: {
      id: row.id,
      fingerprint: row.fingerprint,
      status: row.status,
      scope: 'ecosystem',
      ecosystemPatternId: ecosystem.id,
    },
  };
}
