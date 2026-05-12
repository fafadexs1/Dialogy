import { useMemo } from 'react';
import { Activity, BrainCircuit, CheckCircle2, Clock3, DollarSign, LineChart, MessageSquareText, XCircle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { AutopilotUsageLog } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AutopilotStatsProps {
  usageLogs: AutopilotUsageLog[];
  loading: boolean;
}

const chartConfig = {
  executions: {
    label: 'Execucoes',
    color: 'hsl(var(--primary))',
  },
};

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function buildChartData(logs: AutopilotUsageLog[]) {
  const now = new Date();
  const buckets = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      month: monthFormatter.format(date).replace('.', ''),
      executions: 0,
    };
  });

  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));

  logs.forEach((log) => {
    const date = new Date(log.created_at);
    if (Number.isNaN(date.getTime())) return;

    const index = bucketIndex.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (index === undefined) return;
    buckets[index].executions += 1;
  });

  return buckets;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function getStatusStyle(status?: string | null) {
  const normalized = (status || '').toLowerCase();
  if (['success', 'ok', 'completed', 'approved'].includes(normalized)) {
    return {
      label: 'sucesso',
      className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      icon: CheckCircle2,
    };
  }
  if (['error', 'failed', 'blocked'].includes(normalized)) {
    return {
      label: 'erro',
      className: 'border-destructive/25 bg-destructive/10 text-destructive',
      icon: XCircle,
    };
  }
  return {
    label: status || 'registrado',
    className: 'border-border bg-muted/40 text-muted-foreground',
    icon: Clock3,
  };
}

function formatLogDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data invalida';
  return dateTimeFormatter.format(date);
}

function previewText(value?: string | null) {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Sem mensagem registrada.';
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

export function AutopilotStats({ usageLogs, loading }: AutopilotStatsProps) {
  const stats = useMemo(() => {
    const executions = usageLogs.length;
    const tokens = usageLogs.reduce((acc, log) => acc + (log.total_tokens || 0), 0);
    const inputTokens = usageLogs.reduce((acc, log) => acc + (log.input_tokens || 0), 0);
    const outputTokens = usageLogs.reduce((acc, log) => acc + (log.output_tokens || 0), 0);
    const cost = (tokens / 1000000) * 0.5;
    const successful = usageLogs.filter((log) => {
      const status = (log.status || '').toLowerCase();
      return !['error', 'failed', 'blocked'].includes(status);
    }).length;
    const successRate = executions > 0 ? Math.round((successful / executions) * 100) : 0;

    return { executions, tokens, inputTokens, outputTokens, cost, successRate };
  }, [usageLogs]);

  const chartData = useMemo(() => buildChartData(usageLogs), [usageLogs]);
  const recentLogs = useMemo(() => (
    [...usageLogs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6)
  ), [usageLogs]);

  if (loading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-40 rounded-[28px]" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
        </div>
        <Skeleton className="h-80 rounded-[28px]" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardContent className="grid gap-5 p-6 sm:p-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <LineChart className="h-3.5 w-3.5" />
              Analytics do agente
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">Desempenho operacional</h2>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Acompanhe volume, consumo e saude das execucoes registradas para este agente.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3">
              <div className="text-xs text-muted-foreground">Taxa de sucesso</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{stats.successRate}%</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3">
              <div className="text-xs text-muted-foreground">Entrada / saida</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {compactNumber(stats.inputTokens)} / {compactNumber(stats.outputTokens)}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3">
              <div className="text-xs text-muted-foreground">Ultimos 6 meses</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {chartData.reduce((total, item) => total + item.executions, 0).toLocaleString('pt-BR')} execucoes
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[132px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Execucoes totais</div>
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-foreground">{stats.executions.toLocaleString('pt-BR')}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Interacoes processadas pelo agente.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[132px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Tokens consumidos</div>
              <BrainCircuit className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-foreground">{compactNumber(stats.tokens)}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Soma de entrada e saida nos logs.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <CardContent className="flex min-h-[132px] flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Custo estimado</div>
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                {stats.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Estimativa generica por uso registrado.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Historico de atividade</CardTitle>
                <CardDescription>Volume de execucoes nos ultimos 6 meses</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">
                logs do agente
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <ChartContainer config={chartConfig} className="h-[320px] w-full">
              <BarChart accessibilityLayer data={chartData} margin={{ left: 4, right: 8, top: 16, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={34} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <Bar dataKey="executions" fill="var(--color-executions)" radius={[10, 10, 4, 4]} maxBarSize={56} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/25">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Execucoes recentes</CardTitle>
                <CardDescription>Ultimos registros do agente</CardDescription>
              </div>
              <MessageSquareText className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentLogs.length > 0 ? (
              <div className="divide-y divide-border">
                {recentLogs.map((log) => {
                  const status = getStatusStyle(log.status);
                  const StatusIcon = status.icon;
                  return (
                    <div key={log.id} className="grid gap-3 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{log.rule_name || log.flow_name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatLogDate(log.created_at)} · {log.model_name}</div>
                        </div>
                        <Badge variant="outline" className={cn('shrink-0 rounded-full text-[10px]', status.className)}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {status.label}
                        </Badge>
                      </div>
                      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{previewText(log.input_message)}</p>
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span>{compactNumber(log.total_tokens || 0)} tokens</span>
                        <span>in {compactNumber(log.input_tokens || 0)}</span>
                        <span>out {compactNumber(log.output_tokens || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-10 text-center">
                <MessageSquareText className="h-10 w-10 text-muted-foreground/50" />
                <h3 className="mt-4 text-sm font-semibold text-foreground">Sem execucoes registradas</h3>
                <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                  Os primeiros atendimentos e testes aparecerao aqui quando o agente gerar logs.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
