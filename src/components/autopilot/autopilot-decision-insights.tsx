import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Eye,
  FileDiff,
  GitBranch,
  HelpCircle,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react';

import type { AutopilotCausalPatternApplicationPreview, AutopilotDecisionInsights } from '@/actions/autopilot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type AutopilotDecisionInsightsPanelProps = {
  insights: AutopilotDecisionInsights | null;
  loading: boolean;
  refreshing: boolean;
  reviewingPatternId?: string | null;
  previewingPatternId?: string | null;
  applicationPreviewPatternId?: string | null;
  applicationPreview?: AutopilotCausalPatternApplicationPreview | null;
  applyingPatternId?: string | null;
  revertingPatternId?: string | null;
  applyingScoreHistoryId?: string | null;
  importingEcosystemPatternId?: string | null;
  autoTuning?: boolean;
  onRefresh: () => void;
  onReviewPattern: (patternId: string, decision: 'approve' | 'dismiss') => void;
  onPreviewPattern: (patternId: string) => void;
  onClearPreview: () => void;
  onApplyPattern: (patternId: string, applicationMode?: 'full' | 'knowledge_only') => void;
  onRevertPattern: (patternId: string) => void;
  onApplyScoreHistory: (scoreHistoryId: string) => void;
  onImportEcosystemPattern: (ecosystemPatternId: string) => void;
  onSafeAutoTune: () => void;
};

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data invalida';
  return dateTimeFormatter.format(date);
}

function percent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

function decisionLabel(value: string) {
  const labels: Record<string, string> = {
    answer: 'Resposta',
    ask_slot: 'Coleta de dado',
    retrieve_knowledge: 'Conhecimento',
    call_tool: 'Tool',
    wait_confirmation: 'Confirmacao',
    handoff: 'Humano',
    close: 'Encerrar',
    fallback: 'Fallback',
    continue_llm: 'LLM geral',
  };
  return labels[value] || value;
}

function outcomeLabel(value: string | null) {
  const labels: Record<string, string> = {
    automated: 'Resolvido pela IA',
    manual_close: 'Fechado manualmente',
    human_handoff: 'Transferido',
    timeout: 'Timeout',
    open: 'Aberto',
    unknown: 'Desconhecido',
  };
  return labels[value || ''] || value || 'Sem outcome';
}

function patternLabel(value: string) {
  const labels: Record<string, string> = {
    unnecessary_confirmation: 'Confirmacao excessiva',
    confusing_step: 'Etapa confusa',
    unnecessary_slot: 'Slot desnecessario',
    dead_end_step: 'Beco sem saida',
    tool_failure_hotspot: 'Falha de tool',
    score_drift: 'Drift de score',
    switch_fallback_hotspot: 'Fallback no Switch',
    switch_route_low_confidence: 'Rota incerta',
  };
  return labels[value] || value;
}

function patternStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovado',
    applied: 'Aplicado',
    dismissed: 'Ignorado',
    conflicted: 'Conflito',
  };
  return labels[value] || value;
}

function applicationStatusLabel(value: string) {
  const labels: Record<string, string> = {
    drafted: 'No rascunho',
    published: 'Publicado',
    reverted: 'Revertido',
    conflicted: 'Conflito',
  };
  return labels[value] || value;
}

function applicationSourceLabel(value: AutopilotDecisionInsights['recentApplications'][number]['applicationSource']) {
  const labels: Record<typeof value, string> = {
    manual: 'Manual',
    safe_auto_tune: 'Auto-tune seguro',
    unknown: 'Origem antiga',
  };
  return labels[value] || value;
}

function applicationTypeLabel(value: string) {
  const labels: Record<string, string> = {
    draft_knowledge_policy: 'Documento operacional',
    draft_switch_graph_patch: 'Documento + Switch',
  };
  return labels[value] || value;
}

function scoreSourceLabel(value: string) {
  const labels: Record<string, string> = {
    manual: 'Manual',
    auto_tune: 'Auto-tune',
    suggestion: 'Sugestao',
  };
  return labels[value] || value;
}

function applicationStatusTone(value: string) {
  if (value === 'published') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (value === 'drafted') return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  if (value === 'conflicted') return 'border-destructive/25 bg-destructive/10 text-destructive';
  if (value === 'reverted') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-border bg-muted/35 text-muted-foreground';
}

function patternIcon(value: string) {
  if (value === 'switch_fallback_hotspot' || value === 'switch_route_low_confidence') return GitBranch;
  if (value === 'tool_failure_hotspot') return Wrench;
  if (value === 'score_drift') return ShieldCheck;
  if (value === 'unnecessary_confirmation') return CheckCircle2;
  if (value === 'unnecessary_slot') return FileDiff;
  if (value === 'dead_end_step') return Route;
  return HelpCircle;
}

function getPatternScopeText(pattern: AutopilotDecisionInsights['patterns'][number]) {
  const parts = [
    pattern.switchNodeId ? `Switch ${pattern.switchNodeId}` : null,
    pattern.switchRouteId ? `rota ${pattern.switchRouteId}` : null,
    pattern.procedureId ? `procedimento ${pattern.procedureId}` : null,
    pattern.stepId && pattern.stepId !== pattern.switchNodeId ? `etapa ${pattern.stepId}` : null,
    pattern.toolName ? `tool ${pattern.toolName}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function getDecisionTone(value: string) {
  if (value === 'call_tool') return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  if (value === 'handoff' || value === 'fallback') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (value === 'close' || value === 'answer') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return 'border-border bg-muted/35 text-muted-foreground';
}

function getEvidenceText(value: Record<string, unknown>) {
  const sampleSize = value.sampleSize;
  const failureRate = value.failureRate;
  const confusionRate = value.confusionRate;
  const escalationRate = value.escalationRate;
  const fallbackRate = value.fallbackRate;
  const averageConfidence = value.averageConfidence;
  const handoffRate = value.handoffRate;
  const parts = [
    typeof sampleSize === 'number' ? `${sampleSize} amostras` : null,
    typeof failureRate === 'number' ? `${Math.round(failureRate * 100)}% falha` : null,
    typeof confusionRate === 'number' ? `${Math.round(confusionRate * 100)}% confusao` : null,
    typeof escalationRate === 'number' ? `${Math.round(escalationRate * 100)}% escalacao` : null,
    typeof fallbackRate === 'number' ? `${Math.round(fallbackRate * 100)}% fallback` : null,
    typeof averageConfidence === 'number' ? `${Math.round(averageConfidence * 100)}% confianca media` : null,
    typeof handoffRate === 'number' ? `${Math.round(handoffRate * 100)}% humano` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'Evidencia registrada';
}

function operationLabel(value: AutopilotCausalPatternApplicationPreview['graphPatchOperations'][number]['type']) {
  const labels: Record<string, string> = {
    update_switch_instructions: 'Instrucao do Switch',
    update_switch_route_description: 'Descricao da rota',
    update_switch_route_examples: 'Exemplos da rota',
  };
  return labels[value] || value;
}

function formatPatchValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value.length > 0 ? value.join('\n') : 'Vazio';
  return value?.trim() || 'Vazio';
}

function shortHash(value: string) {
  return value ? value.slice(0, 10) : 'sem hash';
}

function impactDirectionText(direction: NonNullable<AutopilotDecisionInsights['patterns'][number]['applicationImpact']>['direction']) {
  const labels: Record<string, string> = {
    improved: 'Melhorou',
    regressed: 'Piorou',
    neutral: 'Estavel',
    unknown: 'Em observacao',
  };
  return labels[direction] || 'Em observacao';
}

function impactTone(direction: NonNullable<AutopilotDecisionInsights['patterns'][number]['applicationImpact']>['direction']) {
  if (direction === 'improved') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (direction === 'regressed') return 'border-destructive/25 bg-destructive/10 text-destructive';
  if (direction === 'neutral') return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return 'border-border bg-muted/35 text-muted-foreground';
}

function learningVerdictText(value: AutopilotDecisionInsights['learningTrend']['verdict']) {
  const labels: Record<typeof value, string> = {
    improved: 'Melhorou',
    regressed: 'Piorou',
    stable: 'Estavel',
    insufficient_data: 'Dados insuficientes',
  };
  return labels[value] || value;
}

function learningVerdictTone(value: AutopilotDecisionInsights['learningTrend']['verdict']) {
  if (value === 'improved') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (value === 'regressed') return 'border-destructive/25 bg-destructive/10 text-destructive';
  if (value === 'stable') return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return 'border-border bg-muted/35 text-muted-foreground';
}

function numberValue(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return Number(value.toFixed(1)).toString();
}

function signedPercentPoint(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded} p.p.`;
}

function signedNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}`;
}

export function AutopilotDecisionInsightsPanel({
  insights,
  loading,
  refreshing,
  reviewingPatternId,
  previewingPatternId,
  applicationPreviewPatternId,
  applicationPreview,
  applyingPatternId,
  revertingPatternId,
  applyingScoreHistoryId,
  importingEcosystemPatternId,
  autoTuning,
  onRefresh,
  onReviewPattern,
  onPreviewPattern,
  onClearPreview,
  onApplyPattern,
  onRevertPattern,
  onApplyScoreHistory,
  onImportEcosystemPattern,
  onSafeAutoTune,
}: AutopilotDecisionInsightsPanelProps) {
  const resolvedRate = useMemo(() => {
    const total = insights?.summary.decisionsWithOutcome || 0;
    if (!total) return null;
    return (insights?.summary.resolvedOutcomes || 0) / total;
  }, [insights]);

  if (loading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-36 rounded-[28px]" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
        </div>
      </div>
    );
  }

  const summary = insights?.summary;
  const recentDecisions = insights?.recentDecisions || [];
  const patterns = insights?.patterns || [];
  const recentApplications = insights?.recentApplications || [];
  const ecosystemPatterns = insights?.ecosystemPatterns || [];
  const scoreHistory = insights?.scoreHistory || [];
  const learningTrend = insights?.learningTrend || null;
  const procedureOutcomes = insights?.procedureOutcomes || [];
  const switchRouteOutcomes = insights?.switchRouteOutcomes || [];
  const resourceMappings = insights?.resourceMappings || [];
  const actionablePatterns = (summary?.pendingPatterns || 0) + (summary?.approvedPatterns || 0) + (summary?.appliedPatterns || 0);

  return (
    <div className="grid gap-5">
      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardContent className="grid gap-5 p-6 sm:p-8 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              <BrainCircuit className="h-3.5 w-3.5" />
              Motor de decisao
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">Ledger e autoevolucao</h2>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Decisoes auditaveis, resultados observados e padroes que o agente ja pode sugerir para melhoria.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              disabled={refreshing || autoTuning}
              className="w-fit rounded-full"
            >
              {refreshing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Atualizar aprendizados
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSafeAutoTune}
              disabled={Boolean(autoTuning || refreshing || (summary?.approvedPatterns || 0) === 0)}
              className="w-fit rounded-full border-emerald-500/25 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
            >
              {autoTuning ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Auto-tune seguro
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[124px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Decisoes</div>
              <GitBranch className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-foreground">{summary?.totalDecisions || 0}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{summary?.decisionsWithOutcome || 0} com outcome.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[124px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Resolucao</div>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">{percent(resolvedRate)}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{summary?.handoffOutcomes || 0} transferencia(s).</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[124px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Confianca media</div>
              <ShieldCheck className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-foreground">{percent(summary?.averageConfidence)}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{summary?.blockedToolDecisions || 0} bloqueio(s) de tool.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[124px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Sugestoes</div>
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-foreground">{actionablePatterns}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {summary?.pendingPatterns || 0} pendente(s) / {summary?.approvedPatterns || 0} aprovada(s) / {summary?.appliedPatterns || 0} aplicada(s).
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {learningTrend && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                  Evolucao do agente
                </CardTitle>
                <CardDescription>{learningTrend.summary}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('w-fit rounded-full', learningVerdictTone(learningTrend.verdict))}>
                  {learningVerdictText(learningTrend.verdict)}
                </Badge>
                <Badge variant="outline" className="w-fit rounded-full">
                  {learningTrend.currentSampleSize} atuais / {learningTrend.previousSampleSize} anteriores
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="text-xs text-muted-foreground">Resolucao</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{percent(learningTrend.resolvedRate.current)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{signedPercentPoint(learningTrend.resolvedRate.delta)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="text-xs text-muted-foreground">Handoff</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{percent(learningTrend.handoffRate.current)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{signedPercentPoint(learningTrend.handoffRate.delta)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="text-xs text-muted-foreground">Turnos medios</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{numberValue(learningTrend.averageTurnsToResolve.current)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{signedNumber(learningTrend.averageTurnsToResolve.delta)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="text-xs text-muted-foreground">Automatica</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{percent(learningTrend.automatedResolutionRate.current)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{signedPercentPoint(learningTrend.automatedResolutionRate.delta)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="text-xs text-muted-foreground">Satisfacao</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{percent(learningTrend.positiveSentimentRate.current)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{signedPercentPoint(learningTrend.positiveSentimentRate.delta)}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {procedureOutcomes.length > 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Outcomes por procedimento</CardTitle>
                <CardDescription>Resolucao, transferencia e atrito por fluxo executavel</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                {procedureOutcomes.length} procedimento(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 lg:grid-cols-2">
            {procedureOutcomes.map((procedure) => (
              <div key={procedure.procedureId} className="grid gap-3 rounded-2xl border border-border bg-muted/25 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{procedure.procedureId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {procedure.sampleSize} outcome(s)
                      {procedure.lastDecisionAt ? ` / ultimo ${formatDate(procedure.lastDecisionAt)}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                    {percent(procedure.resolvedRate)} resolucao
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Handoff</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(procedure.handoffRate)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Automatica</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(procedure.automatedResolutionRate)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Turnos</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{numberValue(procedure.averageTurnsToResolve)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Falha tool</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(procedure.toolFailureRate)}</div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {switchRouteOutcomes.length > 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Outcomes por rota Switch</CardTitle>
                <CardDescription>Resolucao, fallback e atrito por caminho escolhido</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                {switchRouteOutcomes.length} rota(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 lg:grid-cols-2">
            {switchRouteOutcomes.map((route) => (
              <div key={`${route.switchNodeId}-${route.routeId}`} className="grid gap-3 rounded-2xl border border-border bg-muted/25 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {route.routeLabel || route.routeId}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {route.switchNodeId} / {route.routeId}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {route.sampleSize} outcome(s)
                      {route.targetNodeId ? ` / alvo ${route.targetNodeId}` : ''}
                      {route.lastDecisionAt ? ` / ultimo ${formatDate(route.lastDecisionAt)}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                    {percent(route.resolvedRate)} resolucao
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-5">
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fallback</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(route.fallbackRate)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Handoff</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(route.handoffRate)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Auto</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(route.automatedResolutionRate)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Confianca</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{percent(route.averageConfidence)}</div>
                  </div>
                  <div className="rounded-xl bg-background/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Turnos</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{numberValue(route.averageTurnsToResolve)}</div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {scoreHistory.length > 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Pesos do score</CardTitle>
                <CardDescription>Historico auditavel do Tool Selection Score</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                {scoreHistory.length} snapshot(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 lg:grid-cols-2">
            {scoreHistory.map((entry) => (
              <div key={entry.id} className="grid gap-3 rounded-2xl border border-border bg-muted/25 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {scoreSourceLabel(entry.source)}
                    </Badge>
                    {entry.evidencePatternId && (
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        pattern {entry.evidencePatternId.slice(0, 8)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {entry.source === 'suggestion' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full px-2 text-[11px]"
                        disabled={applyingScoreHistoryId === entry.id}
                        onClick={() => onApplyScoreHistory(entry.id)}
                      >
                        <CheckCircle2 className="mr-1.5 h-3 w-3" />
                        {applyingScoreHistoryId === entry.id ? 'Aplicando...' : 'Aplicar pesos'}
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(entry.appliedAt)}</span>
                  </div>
                </div>
                {entry.reason && (
                  <p className="text-xs leading-5 text-muted-foreground">{entry.reason}</p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(entry.weights).map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-background/60 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{key}</div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{percent(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Decisoes recentes</CardTitle>
                <CardDescription>Ultimas entradas do Decision Ledger</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {(insights?.decisionTypeCounts || []).slice(0, 4).map((item) => (
                  <Badge key={item.decisionType} variant="outline" className="rounded-full">
                    {decisionLabel(item.decisionType)} · {item.count}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentDecisions.length > 0 ? (
              <div className="divide-y divide-border">
                {recentDecisions.map((decision) => (
                  <div key={decision.id} className="grid gap-3 px-5 py-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn('rounded-full text-[10px]', getDecisionTone(decision.decisionType))}>
                            {decisionLabel(decision.decisionType)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{decision.stage}</span>
                          {decision.confidence != null && (
                            <span className="text-xs text-muted-foreground">{percent(decision.confidence)}</span>
                          )}
                        </div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {decision.goal || 'Goal nao identificado'}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {decision.procedureId || 'sem procedimento'} · {decision.stepId || 'sem etapa'}
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground sm:items-end">
                        <span>{formatDate(decision.createdAt)}</span>
                        <span>{outcomeLabel(decision.outcomeResolutionType)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {(decision.selectedTools.length > 0 ? decision.selectedTools : [decision.selectedTool].filter(Boolean) as string[])
                        .slice(0, 3)
                        .map((tool) => (
                          <span key={tool} className="rounded-full border border-border bg-muted/35 px-2 py-1">
                            {tool}
                          </span>
                        ))}
                      {decision.presentSlots.slice(0, 3).map((slot) => (
                        <span
                          key={`${decision.id}-present-${slot.name}`}
                          className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-sky-700 dark:text-sky-300"
                          title={slot.source || undefined}
                        >
                          tem {slot.name}
                          {slot.confidence != null ? ` - ${percent(slot.confidence)}` : ''}
                        </span>
                      ))}
                      {decision.requiredSlots.slice(0, 3).map((slot) => (
                        <span key={slot} className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                          falta {slot}
                        </span>
                      ))}
                      {decision.invalidSlots.slice(0, 2).map((slot) => (
                        <span
                          key={`${decision.id}-invalid-${slot.name}`}
                          className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-1 text-destructive"
                          title={slot.reason || undefined}
                        >
                          invalido {slot.name}
                        </span>
                      ))}
                      {decision.switchResolution && (
                        <span
                          className={cn(
                            'rounded-full border px-2 py-1',
                            decision.switchResolution.fallbackUsed
                              ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                          )}
                          title={decision.switchResolution.switchNodeId}
                        >
                          rota {decision.switchResolution.routeId}
                          {decision.switchResolution.confidence != null ? ` - ${percent(decision.switchResolution.confidence)}` : ''}
                        </span>
                      )}
                      {decision.blockedToolsCount > 0 && (
                        <span className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-1 text-destructive">
                          {decision.blockedToolsCount} tool(s) bloqueada(s)
                        </span>
                      )}
                    </div>
                    {decision.switchResolution && decision.switchResolution.candidateRoutes.length > 0 && (
                      <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          <Route className="h-3.5 w-3.5" />
                          Rotas avaliadas pelo Switch
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {decision.switchResolution.candidateRoutes.slice(0, 5).map((route) => (
                            <span
                              key={`${decision.id}-${route.routeId}`}
                              className={cn(
                                'rounded-full border px-2 py-1 text-[11px]',
                                route.selected
                                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'border-slate-500/20 bg-slate-500/10 text-muted-foreground',
                              )}
                              title={route.rejectedReason || route.targetNodeId || undefined}
                            >
                              {route.routeId}
                              {route.confidence != null ? ` - ${percent(route.confidence)}` : ''}
                              {route.selected ? ' - escolhida' : ' - rejeitada'}
                            </span>
                          ))}
                        </div>
                        {decision.switchResolution.rejectedRoutes.length > 0 && (
                          <div className="grid gap-1 text-[11px] leading-5 text-muted-foreground">
                            {decision.switchResolution.rejectedRoutes.slice(0, 2).map((route) => (
                              <div key={`${decision.id}-${route.routeId}-rejected`}>
                                <span className="font-medium text-foreground">{route.routeId}</span>: {route.rejectedReason || 'rota nao escolhida pelo Switch'}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {decision.candidateTools.length > 0 && (
                      <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          <Wrench className="h-3.5 w-3.5" />
                          Candidatas do motor
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {decision.candidateTools.slice(0, 4).map((tool) => (
                            <span
                              key={`${decision.id}-${tool.tool}`}
                              className={cn(
                                'rounded-full border px-2 py-1 text-[11px]',
                                tool.allowed
                                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'border-destructive/20 bg-destructive/10 text-destructive',
                              )}
                              title={tool.reason || undefined}
                            >
                              {tool.tool}
                              {tool.score != null ? ` - ${percent(tool.score)}` : ''}
                              {tool.code ? ` - ${tool.code}` : ''}
                            </span>
                          ))}
                        </div>
                        {decision.blockedTools.length > 0 && (
                          <div className="grid gap-1 text-[11px] leading-5 text-muted-foreground">
                            {decision.blockedTools.slice(0, 2).map((tool) => (
                              <div key={`${decision.id}-${tool.toolName}-blocked`}>
                                <span className="font-medium text-foreground">{tool.toolName}</span>: {tool.reason || 'bloqueada pelo gate'}
                                {tool.missingSlots.length > 0 ? ` - faltam ${tool.missingSlots.join(', ')}` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-10 text-center">
                <BrainCircuit className="h-10 w-10 text-muted-foreground/50" />
                <h3 className="mt-4 text-sm font-semibold text-foreground">Sem ledger registrado</h3>
                <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                  As decisoes aparecem quando o agente atende conversas com o novo runtime.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Resource Mapper</CardTitle>
                <CardDescription>Campos preenchidos e payloads validados</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                {resourceMappings.length} mapeamento(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {resourceMappings.length > 0 ? (
              <div className="divide-y divide-border">
                {resourceMappings.map((mapping) => (
                  <div key={mapping.id} className="grid gap-3 px-5 py-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="rounded-full text-[10px]">
                            {mapping.status}
                          </Badge>
                          {mapping.confidence != null && (
                            <span className="text-xs text-muted-foreground">{percent(mapping.confidence)}</span>
                          )}
                        </div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {mapping.resource} / {mapping.operation}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {mapping.payloadHash || 'sem payload hash'} - {formatDate(mapping.createdAt)}
                        </div>
                      </div>
                      {mapping.rejectedFieldsCount > 0 && (
                        <Badge variant="outline" className="w-fit rounded-full border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                          {mapping.rejectedFieldsCount} rejeitado(s)
                        </Badge>
                      )}
                    </div>
                    {mapping.mappedFields.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {mapping.mappedFields.slice(0, 6).map((field) => (
                          <span
                            key={`${mapping.id}-${field.slot}-${field.fieldId || field.fieldLabel || 'field'}`}
                            className="rounded-full border border-border bg-muted/35 px-2 py-1 text-[11px] text-muted-foreground"
                            title={field.reason || undefined}
                          >
                            {field.slot} {'->'} {field.fieldLabel || field.fieldId || 'campo'}
                            {field.confidence != null ? ` - ${percent(field.confidence)}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Nenhum campo mapeado com confianca suficiente.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
                <FileDiff className="h-10 w-10 text-muted-foreground/50" />
                <h3 className="mt-4 text-sm font-semibold text-foreground">Sem mapeamentos recentes</h3>
                <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                  Os campos aparecem quando uma action usa o Resource Mapper.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div>
              <CardTitle className="text-lg">Padroes detectados</CardTitle>
              <CardDescription>Base do modo Suggest</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {patterns.length > 0 ? (
              <div className="divide-y divide-border">
                {patterns.map((pattern) => {
                  const PatternIcon = patternIcon(pattern.patternType);
                  const isPending = pattern.status === 'pending';
                  const isApproved = pattern.status === 'approved';
                  const isApplied = pattern.status === 'applied';
                  const isDraftApplication = pattern.applicationStatus === 'drafted';
                  const isPublishedApplication = pattern.applicationStatus === 'published';
                  const isReviewing = reviewingPatternId === pattern.id;
                  const isPreviewing = previewingPatternId === pattern.id;
                  const isApplying = applyingPatternId === pattern.id;
                  const isReverting = revertingPatternId === pattern.id;
                  const isBusy = isReviewing || isPreviewing || isApplying || isReverting;
                  const scopeText = getPatternScopeText(pattern);
                  const previewForPattern = applicationPreviewPatternId === pattern.id ? applicationPreview : null;
                  const impact = pattern.applicationImpact;
                  return (
                    <div key={pattern.id} className="grid gap-3 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                          <PatternIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {patternLabel(pattern.patternType)}
                            </Badge>
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {patternStatusLabel(pattern.status)}
                            </Badge>
                            {isPublishedApplication && (
                              <Badge variant="outline" className="rounded-full border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                                Publicado
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">{percent(pattern.confidence)}</span>
                          </div>
                          <p className="mt-2 text-sm leading-5 text-foreground">{pattern.insight}</p>
                          {scopeText && (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {scopeText}
                            </p>
                          )}
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {getEvidenceText(pattern.evidence)}
                      </p>
                      {impact && (
                        <div className="grid gap-2 rounded-2xl border border-border bg-background/50 p-3 text-xs leading-5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant="outline" className={cn('rounded-full text-[10px]', impactTone(impact.direction))}>
                              {impactDirectionText(impact.direction)}
                            </Badge>
                            <span className="text-muted-foreground">
                              {impact.baseline.sampleSize} antes / {impact.after.sampleSize} depois
                            </span>
                          </div>
                          {impact.status === 'measured' ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <span className="rounded-xl bg-muted/45 px-3 py-2 text-muted-foreground">
                                Resolucao {signedPercentPoint(impact.deltas.resolvedRate)}
                              </span>
                              <span className="rounded-xl bg-muted/45 px-3 py-2 text-muted-foreground">
                                Transferencia {signedPercentPoint(impact.deltas.handoffRate)}
                              </span>
                              <span className="rounded-xl bg-muted/45 px-3 py-2 text-muted-foreground">
                                Turnos {signedNumber(impact.deltas.averageTurnsToResolve)}
                              </span>
                              <span className="rounded-xl bg-muted/45 px-3 py-2 text-muted-foreground">
                                Falha tool {signedPercentPoint(impact.deltas.toolFailureRate)}
                              </span>
                            </div>
                          ) : (
                            <div className="rounded-xl bg-muted/45 px-3 py-2 text-muted-foreground">
                              Impacto aguardando amostra minima de outcomes no mesmo escopo.
                            </div>
                          )}
                        </div>
                      )}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
                        {typeof pattern.suggestedFix.action === 'string'
                          ? pattern.suggestedFix.action
                          : 'review_pattern'}
                      </div>
                      {previewForPattern && (
                        <div className="grid gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
                              <FileDiff className="h-3.5 w-3.5" />
                              Patch proposto
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{shortHash(previewForPattern.beforeSnapshotHash)}</span>
                              <span>-&gt;</span>
                              <span>{shortHash(previewForPattern.afterSnapshotHash)}</span>
                            </div>
                          </div>
                          <div className="rounded-xl border border-border bg-background/60 p-3 text-xs leading-5">
                            <div className="font-medium text-foreground">{previewForPattern.documentName}</div>
                            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                              {previewForPattern.documentContentPreview}
                            </p>
                          </div>
                          {previewForPattern.graphPatchOperations.length > 0 ? (
                            <div className="grid gap-2">
                              {previewForPattern.graphPatchOperations.map((operation, index) => (
                                <div key={`${operation.type}-${index}`} className="grid gap-2 rounded-xl border border-border bg-background/60 p-3">
                                  <div className="text-xs font-medium text-foreground">{operationLabel(operation.type)}</div>
                                  <div className="grid gap-2 text-[11px] leading-5 sm:grid-cols-2">
                                    <div className="min-w-0 rounded-lg bg-muted/50 p-2">
                                      <div className="mb-1 font-medium text-muted-foreground">Antes</div>
                                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground">
                                        {formatPatchValue(operation.before)}
                                      </pre>
                                    </div>
                                    <div className="min-w-0 rounded-lg bg-emerald-500/10 p-2">
                                      <div className="mb-1 font-medium text-emerald-700 dark:text-emerald-300">Depois</div>
                                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-sans text-foreground">
                                        {formatPatchValue(operation.after)}
                                      </pre>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
                              Esta aplicacao adiciona somente o documento operacional ao rascunho.
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {isPending && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => onReviewPattern(pattern.id, 'approve')}
                            className="h-8 rounded-full border-emerald-500/25 bg-emerald-500/10 px-3 text-xs text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Aprovar
                          </Button>
                        )}
                        {isApproved && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => onPreviewPattern(pattern.id)}
                              className="h-8 rounded-full px-3 text-xs"
                            >
                              {isPreviewing ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                              Ver patch
                            </Button>
                            {previewForPattern && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={onClearPreview}
                                className="h-8 rounded-full px-3 text-xs"
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                Fechar patch
                              </Button>
                            )}
                            {previewForPattern && previewForPattern.graphPatchOperations.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => onApplyPattern(pattern.id, 'knowledge_only')}
                                className="h-8 rounded-full px-3 text-xs"
                              >
                                <Sparkles className={cn('mr-1.5 h-3.5 w-3.5', isApplying && 'animate-spin')} />
                                Aplicar so documento
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => onApplyPattern(pattern.id, 'full')}
                              className="h-8 rounded-full border-violet-500/25 bg-violet-500/10 px-3 text-xs text-violet-700 hover:bg-violet-500/15 dark:text-violet-300"
                            >
                              <Sparkles className={cn('mr-1.5 h-3.5 w-3.5', isApplying && 'animate-spin')} />
                              Aplicar no rascunho
                            </Button>
                          </>
                        )}
                        {isApplied && isDraftApplication && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => onRevertPattern(pattern.id)}
                            className="h-8 rounded-full border-amber-500/25 bg-amber-500/10 px-3 text-xs text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
                          >
                            <Undo2 className={cn('mr-1.5 h-3.5 w-3.5', isReverting && 'animate-spin')} />
                            Reverter rascunho
                          </Button>
                        )}
                        {(isPending || isApproved) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => onReviewPattern(pattern.id, 'dismiss')}
                            className="h-8 rounded-full px-3 text-xs"
                          >
                            <XCircle className="mr-1.5 h-3.5 w-3.5" />
                            Ignorar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-10 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground/50" />
                <h3 className="mt-4 text-sm font-semibold text-foreground">Sem sugestoes pendentes</h3>
                <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                  Atualize aprendizados depois de conversas com outcome para gerar sugestoes.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {recentApplications.length > 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Timeline de aprendizado</CardTitle>
                <CardDescription>Aplicacoes feitas no rascunho, publicadas ou revertidas</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                {recentApplications.length} evento(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {recentApplications.map((application) => (
                <div key={application.id} className="grid gap-3 px-5 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn('rounded-full text-[10px]', applicationStatusTone(application.status))}>
                          {applicationStatusLabel(application.status)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {applicationSourceLabel(application.applicationSource)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {applicationTypeLabel(application.applicationType)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm leading-5 text-foreground">
                        {application.insight}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {patternLabel(application.patternType)}
                        {application.graphPatchIncluded
                          ? ` / ${application.graphPatchOperationCount} ajuste(s) no grafo`
                          : ' / conhecimento operacional'}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground sm:items-end">
                      <span>{formatDate(application.createdAt)}</span>
                      {application.publishedVersionNumber != null && (
                        <span>v{application.publishedVersionNumber}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/35 px-2 py-1">
                      <FileDiff className="h-3 w-3" />
                      {shortHash(application.beforeSnapshotHash)} -&gt; {shortHash(application.afterSnapshotHash)}
                    </span>
                    {application.publishedAt && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />
                        Publicado {formatDate(application.publishedAt)}
                      </span>
                    )}
                    {application.revertedAt && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                        <Undo2 className="h-3 w-3" />
                        Revertido {formatDate(application.revertedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {ecosystemPatterns.length > 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Sugestoes do ecossistema</CardTitle>
                <CardDescription>Padroes validados por outros workspaces da mesma vertical</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                {ecosystemPatterns.length} sugestao(oes)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 lg:grid-cols-2">
            {ecosystemPatterns.map((pattern) => {
              const PatternIcon = patternIcon(pattern.patternType);
              return (
                <div key={pattern.id} className="grid gap-3 rounded-2xl border border-border bg-muted/25 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      <PatternIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {patternLabel(pattern.patternType)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                          {pattern.vertical}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{percent(pattern.confidence)}</span>
                      </div>
                      <p className="mt-2 text-sm leading-5 text-foreground">{pattern.insight}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs leading-5 sm:grid-cols-3">
                    <span className="rounded-xl bg-background/60 px-3 py-2 text-muted-foreground">
                      {pattern.sourceWorkspaceCount} workspaces
                    </span>
                    <span className="rounded-xl bg-background/60 px-3 py-2 text-muted-foreground">
                      {pattern.sampleSize} amostras
                    </span>
                    <span className="rounded-xl bg-background/60 px-3 py-2 text-muted-foreground">
                      {pattern.status === 'active' ? 'Ativo' : 'Validado'}
                    </span>
                  </div>
                  <div className="rounded-xl border border-border bg-background/60 p-3 text-xs leading-5 text-muted-foreground">
                    {typeof pattern.suggestedFix.action === 'string'
                      ? pattern.suggestedFix.action
                      : 'review_ecosystem_pattern'}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={importingEcosystemPatternId === pattern.id}
                      onClick={() => onImportEcosystemPattern(pattern.id)}
                    >
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      {importingEcosystemPatternId === pattern.id ? 'Importando...' : 'Trazer para revisao'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {insights && insights.outcomeCounts.length > 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <CardTitle className="text-lg">Outcomes observados</CardTitle>
            <CardDescription>Distribuicao dos resultados vinculados ao ledger</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {insights.outcomeCounts.map((item) => (
              <div key={item.resolutionType} className="rounded-2xl border border-border bg-muted/25 p-4">
                <div className="text-xs text-muted-foreground">{outcomeLabel(item.resolutionType)}</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{item.count}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
