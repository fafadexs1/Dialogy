import type { AutopilotDecisionOutcome } from './outcome-tracker';

export type CausalPatternImpactScope = {
  id: string;
  patternType: string;
  procedureId?: string | null;
  stepId?: string | null;
  switchNodeId?: string | null;
  switchRouteId?: string | null;
  toolName?: string | null;
  appliedAt?: string | Date | null;
  applicationStatus?: string | null;
};

export type CausalPatternImpactDecision = {
  createdAt: string | Date;
  decisionType: string;
  procedureId?: string | null;
  stepId?: string | null;
  selectedTool?: string | null;
  selectedTools?: string[];
  metadata?: Record<string, unknown> | null;
  outcome: AutopilotDecisionOutcome;
};

export type CausalPatternImpactWindow = {
  sampleSize: number;
  resolvedRate: number | null;
  handoffRate: number | null;
  averageTurnsToResolve: number | null;
  toolFailureRate: number | null;
  fallbackRate: number | null;
};

export type CausalPatternImpactReport = {
  status: 'measured' | 'insufficient_data' | 'not_applied';
  direction: 'improved' | 'regressed' | 'neutral' | 'unknown';
  appliedAt: string | null;
  applicationStatus: string | null;
  baseline: CausalPatternImpactWindow;
  after: CausalPatternImpactWindow;
  deltas: {
    resolvedRate: number | null;
    handoffRate: number | null;
    averageTurnsToResolve: number | null;
    toolFailureRate: number | null;
    fallbackRate: number | null;
    improvementScore: number | null;
  };
};

type BuildImpactOptions = {
  windowDays?: number;
  minSamples?: number;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function emptyWindow(): CausalPatternImpactWindow {
  return {
    sampleSize: 0,
    resolvedRate: null,
    handoffRate: null,
    averageTurnsToResolve: null,
    toolFailureRate: null,
    fallbackRate: null,
  };
}

function parseSwitchResolution(metadata: Record<string, unknown> | null | undefined) {
  const raw = metadata?.switchResolution;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

export function decisionMatchesCausalPatternScope(
  pattern: CausalPatternImpactScope,
  decision: CausalPatternImpactDecision,
): boolean {
  if (pattern.switchNodeId) {
    const switchResolution = parseSwitchResolution(decision.metadata);
    if (switchResolution.switchNodeId !== pattern.switchNodeId) return false;
    if (pattern.switchRouteId && switchResolution.routeId !== pattern.switchRouteId) return false;
    return true;
  }

  if (pattern.toolName) {
    const selectedTools = new Set([
      decision.selectedTool || null,
      ...(decision.selectedTools || []),
      ...(decision.outcome.toolsExecuted || []),
      ...(decision.outcome.toolsFailed || []),
    ].filter((tool): tool is string => Boolean(tool)));
    return selectedTools.has(pattern.toolName);
  }

  if (pattern.procedureId && decision.procedureId !== pattern.procedureId) return false;
  if (pattern.stepId && decision.stepId !== pattern.stepId) return false;
  return Boolean(pattern.procedureId || pattern.stepId);
}

function summarizeWindow(decisions: CausalPatternImpactDecision[]): CausalPatternImpactWindow {
  if (decisions.length === 0) return emptyWindow();
  const resolved = decisions.filter((decision) => decision.outcome.resolved).length;
  const handoff = decisions.filter((decision) => (
    decision.outcome.resolutionType === 'human_handoff' || decision.outcome.escalationNeeded
  )).length;
  const withTurns = decisions
    .map((decision) => decision.outcome.turnsToResolve)
    .filter((turns): turns is number => typeof turns === 'number' && Number.isFinite(turns));
  const withToolFailure = decisions.filter((decision) => (decision.outcome.toolsFailed || []).length > 0).length;
  const fallback = decisions.filter((decision) => decision.decisionType === 'fallback').length;

  return {
    sampleSize: decisions.length,
    resolvedRate: round(resolved / decisions.length),
    handoffRate: round(handoff / decisions.length),
    averageTurnsToResolve: withTurns.length > 0
      ? round(withTurns.reduce((sum, turns) => sum + turns, 0) / withTurns.length)
      : null,
    toolFailureRate: round(withToolFailure / decisions.length),
    fallbackRate: round(fallback / decisions.length),
  };
}

function delta(after: number | null, before: number | null) {
  return after == null || before == null ? null : round(after - before);
}

function buildDirection(score: number | null): CausalPatternImpactReport['direction'] {
  if (score == null) return 'unknown';
  if (score >= 0.08) return 'improved';
  if (score <= -0.08) return 'regressed';
  return 'neutral';
}

export function buildCausalPatternImpactReport(
  pattern: CausalPatternImpactScope,
  decisions: CausalPatternImpactDecision[],
  options?: BuildImpactOptions,
): CausalPatternImpactReport {
  const anchor = toDate(pattern.appliedAt);
  const windowDays = Math.max(1, Math.min(365, Math.round(options?.windowDays || 30)));
  const minSamples = Math.max(1, Math.round(options?.minSamples || 3));

  if (!anchor || pattern.applicationStatus === 'reverted' || pattern.applicationStatus === 'conflicted') {
    return {
      status: 'not_applied',
      direction: 'unknown',
      appliedAt: anchor?.toISOString() || null,
      applicationStatus: pattern.applicationStatus || null,
      baseline: emptyWindow(),
      after: emptyWindow(),
      deltas: {
        resolvedRate: null,
        handoffRate: null,
        averageTurnsToResolve: null,
        toolFailureRate: null,
        fallbackRate: null,
        improvementScore: null,
      },
    };
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const scoped = decisions
    .filter((decision) => decisionMatchesCausalPatternScope(pattern, decision))
    .map((decision) => ({ decision, createdAt: toDate(decision.createdAt) }))
    .filter((item): item is { decision: CausalPatternImpactDecision; createdAt: Date } => Boolean(item.createdAt));
  const baseline = summarizeWindow(scoped
    .filter((item) => item.createdAt.getTime() < anchor.getTime()
      && item.createdAt.getTime() >= anchor.getTime() - windowMs)
    .map((item) => item.decision));
  const after = summarizeWindow(scoped
    .filter((item) => item.createdAt.getTime() >= anchor.getTime()
      && item.createdAt.getTime() <= anchor.getTime() + windowMs)
    .map((item) => item.decision));

  const resolvedRate = delta(after.resolvedRate, baseline.resolvedRate);
  const handoffRate = delta(after.handoffRate, baseline.handoffRate);
  const averageTurnsToResolve = delta(after.averageTurnsToResolve, baseline.averageTurnsToResolve);
  const toolFailureRate = delta(after.toolFailureRate, baseline.toolFailureRate);
  const fallbackRate = delta(after.fallbackRate, baseline.fallbackRate);
  const enoughData = baseline.sampleSize >= minSamples && after.sampleSize >= minSamples;
  const turnImprovement = averageTurnsToResolve == null || baseline.averageTurnsToResolve == null
    ? 0
    : -averageTurnsToResolve / Math.max(1, baseline.averageTurnsToResolve);
  const score = enoughData
    ? round(
      ((resolvedRate || 0) * 0.4)
      + (-(handoffRate || 0) * 0.25)
      + (turnImprovement * 0.2)
      + (-(toolFailureRate || 0) * 0.1)
      + (-(fallbackRate || 0) * 0.05),
    )
    : null;

  return {
    status: enoughData ? 'measured' : 'insufficient_data',
    direction: enoughData ? buildDirection(score) : 'unknown',
    appliedAt: anchor.toISOString(),
    applicationStatus: pattern.applicationStatus || null,
    baseline,
    after,
    deltas: {
      resolvedRate,
      handoffRate,
      averageTurnsToResolve,
      toolFailureRate,
      fallbackRate,
      improvementScore: score,
    },
  };
}
