import { useMemo } from 'react';
import { Activity, BrainCircuit, DollarSign, LineChart } from 'lucide-react';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { AutopilotUsageLog } from '@/lib/types';

interface AutopilotStatsProps {
  usageLogs: AutopilotUsageLog[];
  loading: boolean;
}

const chartConfig = {
  executions: {
    label: 'Execuções',
    color: 'hsl(var(--primary))',
  },
};

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

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

export function AutopilotStats({ usageLogs, loading }: AutopilotStatsProps) {
  const stats = useMemo(() => {
    if (!usageLogs.length) return { executions: 0, tokens: 0, cost: 0 };

    const executions = usageLogs.length;
    const tokens = usageLogs.reduce((acc, log) => acc + log.total_tokens, 0);
    const cost = (tokens / 1000000) * 0.5;
    return { executions, tokens, cost };
  }, [usageLogs]);

  const chartData = useMemo(() => buildChartData(usageLogs), [usageLogs]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32 rounded-[26px]" />
        <Skeleton className="h-32 rounded-[26px]" />
        <Skeleton className="h-32 rounded-[26px]" />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="overflow-hidden rounded-[26px] border border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/60 bg-muted/30 pb-4">
            <CardTitle className="text-sm font-medium">Execuções totais</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.executions.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Interações realizadas pelo agente</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[26px] border border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/60 bg-muted/30 pb-4">
            <CardTitle className="text-sm font-medium">Tokens consumidos</CardTitle>
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.tokens / 1000).toFixed(1)}k</div>
            <p className="text-xs text-muted-foreground">Volume total de processamento do agente</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[26px] border border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/60 bg-muted/30 pb-4">
            <CardTitle className="text-sm font-medium">Custo estimado</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {stats.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </div>
            <p className="text-xs text-muted-foreground">Estimativa genérica com base no uso total registrado</p>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/30">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Histórico de atividade</CardTitle>
              <CardDescription>Volume de execuções nos últimos 6 meses</CardDescription>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
              <LineChart className="h-3.5 w-3.5 text-primary" />
              Atualizado com base nos logs do agente
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <BarChart accessibilityLayer data={chartData}>
              <XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
              <Bar dataKey="executions" fill="var(--color-executions)" radius={8} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
