import type { AutopilotDecisionOutcome } from './outcome-tracker';

export type AutopilotLearningTrendVerdict = 'improved' | 'regressed' | 'stable' | 'insufficient_data';

export type AutopilotLearningTrendMetric = {
  current: number | null;
  previous: number | null;
  delta: number | null;
};

export type AutopilotLearningTrendInsight = {
  currentWindowDays: number;
  previousWindowDays: number;
  currentSampleSize: number;
  previousSampleSize: number;
  resolvedRate: AutopilotLearningTrendMetric;
  handoffRate: AutopilotLearningTrendMetric;
  averageTurnsToResolve: AutopilotLearningTrendMetric;
  automatedResolutionRate: AutopilotLearningTrendMetric;
  positiveSentimentRate: AutopilotLearningTrendMetric;
  improvementScore: number | null;
  verdict: AutopilotLearningTrendVerdict;
  summary: string;
};

export type AutopilotLearningTrendDecision = {
  createdAt: string | Date;
  outcome: Pick<AutopilotDecisionOutcome, 'resolved' | 'resolutionType' | 'turnsToResolve' | 'escalationNeeded' | 'customerSentimentFinal'>;
};

type BuildAutopilotLearningTrendOptions = {
  now?: Date;
  windowDays?: number;
  minSamples?: number;
};

type TrendWindow = {
  sampleSize: number;
  resolvedRate: number | null;
  handoffRate: number | null;
  averageTurnsToResolve: number | null;
  automatedResolutionRate: number | null;
  positiveSentimentRate: number | null;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function metric(current: number | null, previous: number | null): AutopilotLearningTrendMetric {
  return {
    current,
    previous,
    delta: current == null || previous == null ? null : round(current - previous),
  };
}

function summarizeWindow(decisions: AutopilotLearningTrendDecision[]): TrendWindow {
  if (decisions.length === 0) {
    return {
      sampleSize: 0,
      resolvedRate: null,
      handoffRate: null,
      averageTurnsToResolve: null,
      automatedResolutionRate: null,
      positiveSentimentRate: null,
    };
  }

  const resolved = decisions.filter((decision) => decision.outcome.resolved).length;
  const handoff = decisions.filter((decision) => (
    decision.outcome.escalationNeeded || decision.outcome.resolutionType === 'human_handoff'
  )).length;
  const automated = decisions.filter((decision) => decision.outcome.resolutionType === 'automated').length;
  const positiveSentiment = decisions.filter((decision) => decision.outcome.customerSentimentFinal === 'positive').length;
  const turns = decisions
    .map((decision) => decision.outcome.turnsToResolve)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return {
    sampleSize: decisions.length,
    resolvedRate: round(resolved / decisions.length),
    handoffRate: round(handoff / decisions.length),
    averageTurnsToResolve: turns.length > 0
      ? round(turns.reduce((sum, value) => sum + value, 0) / turns.length)
      : null,
    automatedResolutionRate: round(automated / decisions.length),
    positiveSentimentRate: round(positiveSentiment / decisions.length),
  };
}

function buildVerdict(score: number | null): AutopilotLearningTrendVerdict {
  if (score == null) return 'insufficient_data';
  if (score >= 0.06) return 'improved';
  if (score <= -0.06) return 'regressed';
  return 'stable';
}

function buildSummary(verdict: AutopilotLearningTrendVerdict, windowDays: number) {
  if (verdict === 'improved') {
    return `O agente melhorou nos ultimos ${windowDays} dias: mais resolucao automatica e menos atrito operacional.`;
  }
  if (verdict === 'regressed') {
    return `O agente piorou nos ultimos ${windowDays} dias; revise rotas, pesos e politicas com prioridade.`;
  }
  if (verdict === 'stable') {
    return `O agente ficou estavel nos ultimos ${windowDays} dias; continue acumulando outcomes e validando sugestoes.`;
  }
  return `Amostra insuficiente para comparar os ultimos ${windowDays} dias com os ${windowDays} dias anteriores.`;
}

export function buildAutopilotLearningTrend(
  decisions: AutopilotLearningTrendDecision[],
  options?: BuildAutopilotLearningTrendOptions,
): AutopilotLearningTrendInsight {
  const now = options?.now && Number.isFinite(options.now.getTime()) ? options.now : new Date();
  const windowDays = Math.max(1, Math.min(365, Math.round(options?.windowDays || 30)));
  const minSamples = Math.max(1, Math.round(options?.minSamples || 5));
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const currentStart = now.getTime() - windowMs;
  const previousStart = currentStart - windowMs;

  const dated = decisions
    .map((decision) => ({ decision, createdAt: toDate(decision.createdAt) }))
    .filter((item): item is { decision: AutopilotLearningTrendDecision; createdAt: Date } => Boolean(item.createdAt))
    .filter((item) => item.createdAt.getTime() <= now.getTime());

  const current = summarizeWindow(dated
    .filter((item) => item.createdAt.getTime() >= currentStart)
    .map((item) => item.decision));
  const previous = summarizeWindow(dated
    .filter((item) => item.createdAt.getTime() >= previousStart && item.createdAt.getTime() < currentStart)
    .map((item) => item.decision));

  const resolvedRate = metric(current.resolvedRate, previous.resolvedRate);
  const handoffRate = metric(current.handoffRate, previous.handoffRate);
  const averageTurnsToResolve = metric(current.averageTurnsToResolve, previous.averageTurnsToResolve);
  const automatedResolutionRate = metric(current.automatedResolutionRate, previous.automatedResolutionRate);
  const positiveSentimentRate = metric(current.positiveSentimentRate, previous.positiveSentimentRate);
  const enoughData = current.sampleSize >= minSamples && previous.sampleSize >= minSamples;
  const turnImprovement = averageTurnsToResolve.delta == null || previous.averageTurnsToResolve == null
    ? 0
    : -averageTurnsToResolve.delta / Math.max(1, previous.averageTurnsToResolve);
  const improvementScore = enoughData
    ? round(
      ((resolvedRate.delta || 0) * 0.35)
      + (-(handoffRate.delta || 0) * 0.2)
      + ((automatedResolutionRate.delta || 0) * 0.2)
      + ((positiveSentimentRate.delta || 0) * 0.15)
      + (turnImprovement * 0.1),
    )
    : null;
  const verdict = enoughData ? buildVerdict(improvementScore) : 'insufficient_data';

  return {
    currentWindowDays: windowDays,
    previousWindowDays: windowDays,
    currentSampleSize: current.sampleSize,
    previousSampleSize: previous.sampleSize,
    resolvedRate,
    handoffRate,
    averageTurnsToResolve,
    automatedResolutionRate,
    positiveSentimentRate,
    improvementScore,
    verdict,
    summary: buildSummary(verdict, windowDays),
  };
}
