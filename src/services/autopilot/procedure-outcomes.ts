import type { CausalPatternImpactDecision } from './causal-pattern-impact';

export type AutopilotProcedureOutcomeInsight = {
  procedureId: string;
  sampleSize: number;
  resolvedCount: number;
  handoffCount: number;
  automatedCount: number;
  resolvedRate: number | null;
  handoffRate: number | null;
  automatedResolutionRate: number | null;
  averageTurnsToResolve: number | null;
  toolFailureRate: number | null;
  lastDecisionAt: string | null;
};

function round(value: number) {
  return Number(value.toFixed(3));
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ratio(count: number, total: number) {
  return total > 0 ? round(count / total) : null;
}

export function buildAutopilotProcedureOutcomeInsights(
  decisions: CausalPatternImpactDecision[],
  limit = 8,
): AutopilotProcedureOutcomeInsight[] {
  const groups = new Map<string, CausalPatternImpactDecision[]>();
  for (const decision of decisions) {
    const procedureId = String(decision.procedureId || '').trim();
    if (!procedureId) continue;
    groups.set(procedureId, [...(groups.get(procedureId) || []), decision]);
  }

  return Array.from(groups.entries())
    .map(([procedureId, items]): AutopilotProcedureOutcomeInsight => {
      const resolvedCount = items.filter((item) => item.outcome.resolved).length;
      const handoffCount = items.filter((item) => (
        item.outcome.escalationNeeded || item.outcome.resolutionType === 'human_handoff'
      )).length;
      const automatedCount = items.filter((item) => item.outcome.resolutionType === 'automated').length;
      const toolFailureCount = items.filter((item) => (item.outcome.toolsFailed || []).length > 0).length;
      const turns = items
        .map((item) => item.outcome.turnsToResolve)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const lastDecisionAt = items
        .map((item) => toDate(item.createdAt))
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0] || null;

      return {
        procedureId,
        sampleSize: items.length,
        resolvedCount,
        handoffCount,
        automatedCount,
        resolvedRate: ratio(resolvedCount, items.length),
        handoffRate: ratio(handoffCount, items.length),
        automatedResolutionRate: ratio(automatedCount, items.length),
        averageTurnsToResolve: turns.length > 0
          ? round(turns.reduce((sum, value) => sum + value, 0) / turns.length)
          : null,
        toolFailureRate: ratio(toolFailureCount, items.length),
        lastDecisionAt: lastDecisionAt?.toISOString() || null,
      };
    })
    .sort((left, right) => {
      if (right.sampleSize !== left.sampleSize) return right.sampleSize - left.sampleSize;
      return String(right.lastDecisionAt || '').localeCompare(String(left.lastDecisionAt || ''));
    })
    .slice(0, Math.max(1, Math.round(limit)));
}
