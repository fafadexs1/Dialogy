import type { CausalPatternImpactDecision } from './causal-pattern-impact';

export type AutopilotSwitchRouteOutcomeInsight = {
  switchNodeId: string;
  routeId: string;
  routeLabel: string | null;
  targetNodeId: string | null;
  sampleSize: number;
  resolvedCount: number;
  handoffCount: number;
  automatedCount: number;
  fallbackCount: number;
  resolvedRate: number | null;
  handoffRate: number | null;
  automatedResolutionRate: number | null;
  fallbackRate: number | null;
  averageTurnsToResolve: number | null;
  averageConfidence: number | null;
  toolFailureRate: number | null;
  lastDecisionAt: string | null;
};

type SwitchResolutionSnapshot = {
  switchNodeId: string;
  routeId: string;
  routeLabel: string | null;
  targetNodeId: string | null;
  confidence: number | null;
  fallbackUsed: boolean;
};

function round(value: number) {
  return Number(value.toFixed(3));
}

function ratio(count: number, total: number) {
  return total > 0 ? round(count / total) : null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseSwitchResolution(metadata: Record<string, unknown> | null | undefined): SwitchResolutionSnapshot | null {
  const raw = metadata?.switchResolution;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const switchNodeId = String(record.switchNodeId || '').trim();
  const routeId = String(record.routeId || '').trim();
  if (!switchNodeId || !routeId) return null;
  const rawConfidence = typeof record.confidence === 'number' ? record.confidence : Number(record.confidence);

  return {
    switchNodeId,
    routeId,
    routeLabel: typeof record.routeLabel === 'string' && record.routeLabel.trim()
      ? record.routeLabel.trim()
      : null,
    targetNodeId: typeof record.targetNodeId === 'string' && record.targetNodeId.trim()
      ? record.targetNodeId.trim()
      : null,
    confidence: Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : null,
    fallbackUsed: Boolean(record.fallbackUsed),
  };
}

export function buildAutopilotSwitchRouteOutcomeInsights(
  decisions: CausalPatternImpactDecision[],
  limit = 10,
): AutopilotSwitchRouteOutcomeInsight[] {
  const groups = new Map<string, Array<{ decision: CausalPatternImpactDecision; switchResolution: SwitchResolutionSnapshot }>>();

  for (const decision of decisions) {
    const switchResolution = parseSwitchResolution(decision.metadata);
    if (!switchResolution) continue;
    const key = `${switchResolution.switchNodeId}:${switchResolution.routeId}`;
    groups.set(key, [...(groups.get(key) || []), { decision, switchResolution }]);
  }

  return Array.from(groups.values())
    .map((items): AutopilotSwitchRouteOutcomeInsight => {
      const latestResolution = items
        .slice()
        .sort((left, right) => {
          const leftDate = toDate(left.decision.createdAt)?.getTime() || 0;
          const rightDate = toDate(right.decision.createdAt)?.getTime() || 0;
          return rightDate - leftDate;
        })[0]?.switchResolution || items[0].switchResolution;
      const resolvedCount = items.filter((item) => item.decision.outcome.resolved).length;
      const handoffCount = items.filter((item) => (
        item.decision.outcome.escalationNeeded || item.decision.outcome.resolutionType === 'human_handoff'
      )).length;
      const automatedCount = items.filter((item) => item.decision.outcome.resolutionType === 'automated').length;
      const fallbackCount = items.filter((item) => item.switchResolution.fallbackUsed || item.decision.decisionType === 'fallback').length;
      const toolFailureCount = items.filter((item) => (item.decision.outcome.toolsFailed || []).length > 0).length;
      const turns = items
        .map((item) => item.decision.outcome.turnsToResolve)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const confidences = items
        .map((item) => item.switchResolution.confidence)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const lastDecisionAt = items
        .map((item) => toDate(item.decision.createdAt))
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0] || null;

      return {
        switchNodeId: latestResolution.switchNodeId,
        routeId: latestResolution.routeId,
        routeLabel: latestResolution.routeLabel,
        targetNodeId: latestResolution.targetNodeId,
        sampleSize: items.length,
        resolvedCount,
        handoffCount,
        automatedCount,
        fallbackCount,
        resolvedRate: ratio(resolvedCount, items.length),
        handoffRate: ratio(handoffCount, items.length),
        automatedResolutionRate: ratio(automatedCount, items.length),
        fallbackRate: ratio(fallbackCount, items.length),
        averageTurnsToResolve: turns.length > 0
          ? round(turns.reduce((sum, value) => sum + value, 0) / turns.length)
          : null,
        averageConfidence: confidences.length > 0
          ? round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
          : null,
        toolFailureRate: ratio(toolFailureCount, items.length),
        lastDecisionAt: lastDecisionAt?.toISOString() || null,
      };
    })
    .sort((left, right) => {
      if (right.sampleSize !== left.sampleSize) return right.sampleSize - left.sampleSize;
      if ((right.fallbackRate || 0) !== (left.fallbackRate || 0)) {
        return (right.fallbackRate || 0) - (left.fallbackRate || 0);
      }
      return String(right.lastDecisionAt || '').localeCompare(String(left.lastDecisionAt || ''));
    })
    .slice(0, Math.max(1, Math.round(limit)));
}
