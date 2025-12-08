import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BrainCircuit, DollarSign, Activity } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { AutopilotUsageLog } from '@/lib/types';
import { useMemo } from 'react';

interface AutopilotStatsProps {
    usageLogs: AutopilotUsageLog[];
    loading: boolean;
}

const chartConfig = {
    executions: {
        label: "Execuções",
        color: "hsl(var(--primary))",
    },
};

// Mock data for chart - in real app, aggregate logs by month
const chartData = [
    { month: "Jan", executions: 0 },
    { month: "Fev", executions: 0 },
    { month: "Mar", executions: 0 },
    { month: "Abr", executions: 0 },
    { month: "Mai", executions: 0 },
    { month: "Jun", executions: 0 },
];

export function AutopilotStats({ usageLogs, loading }: AutopilotStatsProps) {
    const stats = useMemo(() => {
        if (!usageLogs.length) return { executions: 0, tokens: 0, cost: 0 };
        // Simplified calculation for demo
        const executions = usageLogs.length;
        const tokens = usageLogs.reduce((acc, log) => acc + log.total_tokens, 0);
        // Estimate cost (generic $0.50 per 1M tokens for mixed usage)
        const cost = (tokens / 1000000) * 0.50;
        return { executions, tokens, cost };
    }, [usageLogs]);

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-3 mb-6">
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
            </div>
        );
    }

    return (
        <div className="grid gap-6 mb-6">
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Execuções Totais</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.executions.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">Interações realizadas pelo agente</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Tokens Consumidos</CardTitle>
                        <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{(stats.tokens / 1000).toFixed(1)}k</div>
                        <p className="text-xs text-muted-foreground">Volume de processamento de texto</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Custo Estimado</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-500">
                            {stats.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </div>
                        <p className="text-xs text-muted-foreground">Baseado no modelo Gemini Flash</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="col-span-3">
                <CardHeader>
                    <CardTitle>Histórico de Atividade</CardTitle>
                    <CardDescription>Volume de execuções nos últimos 6 meses</CardDescription>
                </CardHeader>
                <CardContent>
                    <ChartContainer config={chartConfig} className="h-[200px] w-full">
                        <BarChart accessibilityLayer data={chartData}>
                            <XAxis
                                dataKey="month"
                                tickLine={false}
                                tickMargin={10}
                                axisLine={false}
                                tickFormatter={(value) => value.slice(0, 3)}
                            />
                            <YAxis tickLine={false} axisLine={false} />
                            <ChartTooltip
                                cursor={false}
                                content={<ChartTooltipContent indicator="dot" />}
                            />
                            <Bar dataKey="executions" fill="var(--color-executions)" radius={4} />
                        </BarChart>
                    </ChartContainer>
                </CardContent>
            </Card>
        </div>
    );
}
