'use client';

import React, { useMemo, useEffect, useState } from 'react';
import { Contact, Tag, DealMetrics } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import {
    Users,
    ArrowUpRight,
    ArrowDownRight,
    Calendar,
    Phone,
    Mail,
    MessageCircle,
    FileText,
    DollarSign,
    Target,
    Clock,
    MoreHorizontal,
} from 'lucide-react';
import { format, subDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { getDealMetrics } from '@/actions/deals';
import { getPipelineStages } from '@/actions/crm';
import { labelizePipelineStageValue, sortPipelineStages, type PipelineStage } from '@/lib/crm-pipeline';

interface CrmDashboardProps {
    contacts: Contact[];
    tags: Tag[];
    workspaceId?: string;
}

function formatBRL(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildStageColorMap(stages: PipelineStage[]): Record<string, string> {
    return stages.reduce<Record<string, string>>((accumulator, stage) => {
        accumulator[stage.value] = stage.color;
        return accumulator;
    }, {});
}

function buildStageLabelMap(stages: PipelineStage[]): Record<string, string> {
    return stages.reduce<Record<string, string>>((accumulator, stage) => {
        accumulator[stage.value] = stage.label;
        return accumulator;
    }, {});
}

export default function CrmDashboard({ contacts, workspaceId }: CrmDashboardProps) {
    const [dealMetrics, setDealMetrics] = useState<DealMetrics | null>(null);
    const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);

    useEffect(() => {
        if (!workspaceId) return;

        Promise.all([
            getDealMetrics(workspaceId),
            getPipelineStages(workspaceId),
        ]).then(([dealMetricsRes, stagesRes]) => {
            if (dealMetricsRes.metrics) setDealMetrics(dealMetricsRes.metrics);
            if (stagesRes.stages) setPipelineStages(sortPipelineStages(stagesRes.stages));
        });
    }, [workspaceId]);

    const stageColors = useMemo(() => buildStageColorMap(pipelineStages), [pipelineStages]);
    const stageLabels = useMemo(() => buildStageLabelMap(pipelineStages), [pipelineStages]);

    const metrics = useMemo(() => {
        const totalContacts = contacts.length;
        const newContactsThisWeek = contacts.filter((contact) =>
            contact.created_at && isAfter(new Date(contact.created_at), subDays(new Date(), 7))
        ).length;

        const fallbackStage = pipelineStages[0];
        const stageCounts = pipelineStages.map((stage, index) => {
            const count = contacts.filter((contact) => {
                const stageTag = contact.tags?.find((tag) => stageLabels[tag.value]);
                if (stageTag) return stageTag.value === stage.value;
                return index === 0 && fallbackStage?.value === stage.value;
            }).length;

            return { name: stage.value, count };
        });

        const allActivities = contacts.flatMap((contact) =>
            (contact.activities || []).map((activity) => ({
                ...activity,
                contactName: contact.name,
                contactAvatar: contact.avatar_url,
                contactEmail: contact.email,
            }))
        ).sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 6);

        return {
            totalContacts,
            newContactsThisWeek,
            stageCounts,
            recentActivities: allActivities,
        };
    }, [contacts, pipelineStages, stageLabels]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xl dark:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.5)]">
                    <p className="mb-1 font-medium text-slate-950 dark:text-slate-50">{stageLabels[label] || labelizePipelineStageValue(label)}</p>
                    <p className="text-blue-400 text-sm">
                        {payload[0].value} Contatos
                    </p>
                </div>
            );
        }
        return null;
    };

    const trendData = dealMetrics?.trends;

    const metricCards = [
        {
            title: 'Pipeline Total',
            value: dealMetrics ? formatBRL(dealMetrics.totalPipelineValue) : '—',
            subtext: dealMetrics ? `Ponderado: ${formatBRL(dealMetrics.weightedPipelineValue)}` : 'Carregando...',
            icon: DollarSign,
            trend: trendData ? `${trendData.revenue.change >= 0 ? '+' : ''}${trendData.revenue.change}%` : '',
            trendUp: trendData ? trendData.revenue.change >= 0 : true,
            gradient: 'from-emerald-500 to-teal-400',
        },
        {
            title: 'Total de Contatos',
            value: metrics.totalContacts,
            subtext: `${metrics.newContactsThisWeek} novos essa semana`,
            icon: Users,
            trend: trendData ? `${trendData.newDeals.change >= 0 ? '+' : ''}${trendData.newDeals.change}%` : '',
            trendUp: trendData ? trendData.newDeals.change >= 0 : true,
            gradient: 'from-blue-500 to-cyan-400',
        },
        {
            title: 'Ticket Medio',
            value: dealMetrics ? formatBRL(dealMetrics.averageTicket) : '—',
            subtext: `Win rate: ${dealMetrics?.winRate ?? 0}%`,
            icon: Target,
            trend: trendData ? `${trendData.closedWon.change >= 0 ? '+' : ''}${trendData.closedWon.change}%` : '',
            trendUp: trendData ? trendData.closedWon.change >= 0 : true,
            gradient: 'from-purple-500 to-pink-500',
        },
        {
            title: 'Ciclo Medio',
            value: dealMetrics ? `${dealMetrics.averageCycleTimeDays}d` : '—',
            subtext: 'Media de dias ate fechar',
            icon: Clock,
            trend: '',
            trendUp: true,
            gradient: 'from-orange-500 to-amber-400',
        },
    ];

    return (
        <div className="h-full space-y-8 overflow-y-auto bg-transparent p-8 custom-scrollbar">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Visao Geral</h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Acompanhe o desempenho do seu funil de vendas em tempo real.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-1.5 text-xs text-slate-600 dark:text-slate-400 shadow-sm dark:shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)]">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Ultimos 7 dias</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                {metricCards.map((metric, index) => (
                    <Card key={index} className="group relative overflow-hidden border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_60px_-40px_rgba(0,0,0,0.5)]">
                        <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity duration-500 group-hover:opacity-20 dark:opacity-5 dark:group-hover:opacity-10">
                            <metric.icon className="h-24 w-24 text-slate-900 dark:text-slate-100" />
                        </div>
                        <CardHeader className="relative z-10 flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">{metric.title}</CardTitle>
                            <metric.icon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                        </CardHeader>
                        <CardContent className="relative z-10">
                            <div className={`bg-gradient-to-r ${metric.gradient} bg-clip-text text-3xl font-bold text-transparent`}>
                                {metric.value}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                {metric.trend ? (
                                    <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${metric.trendUp ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {metric.trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                        {metric.trend}
                                    </span>
                                ) : null}
                                <p className="text-xs text-slate-500 dark:text-slate-400">{metric.subtext}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {dealMetrics && dealMetrics.dealsByStage.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                    {dealMetrics.dealsByStage.map((stageMetric) => (
                        <div key={stageMetric.stage} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-center shadow-sm">
                            <div className="mb-1 flex items-center justify-center gap-1.5">
                                <div
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: stageColors[stageMetric.stage] || '#94a3b8' }}
                                />
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {stageLabels[stageMetric.stage] || labelizePipelineStageValue(stageMetric.stage)}
                                </span>
                            </div>
                            <p className="text-sm font-bold text-slate-950 dark:text-slate-50">{formatBRL(stageMetric.totalValue)}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">{stageMetric.count} deals</p>
                        </div>
                    ))}
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <Card className="col-span-1 border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_60px_-40px_rgba(0,0,0,0.5)] lg:col-span-2">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg text-slate-950 dark:text-slate-50">Funil de Vendas</CardTitle>
                                <CardDescription className="text-slate-500 dark:text-slate-400">Distribuicao de contatos por etapa do funil</CardDescription>
                            </div>
                            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-950 dark:hover:text-slate-50">
                                <MoreHorizontal className="w-5 h-5" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={metrics.stageCounts} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} barSize={50}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    stroke="rgba(100,116,139,0.6)"
                                    tickFormatter={(value) => stageLabels[value] || labelizePipelineStageValue(value)}
                                    tick={{ fill: 'rgba(71,85,105,0.85)', fontSize: 12 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="rgba(100,116,139,0.6)"
                                    tick={{ fill: 'rgba(71,85,105,0.85)', fontSize: 12 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                                    {metrics.stageCounts.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={stageColors[entry.name] || '#94a3b8'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="col-span-1 flex flex-col border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_60px_-40px_rgba(0,0,0,0.5)]">
                    <CardHeader>
                        <CardTitle className="text-lg text-slate-950 dark:text-slate-50">Atividades Recentes</CardTitle>
                        <CardDescription className="text-slate-500 dark:text-slate-400">Ultimas interacoes com clientes</CardDescription>
                    </CardHeader>
                    <CardContent className="custom-scrollbar flex-1 overflow-auto pr-2">
                        <div className="space-y-6">
                            {metrics.recentActivities.length > 0 ? (
                                metrics.recentActivities.map((activity, index) => (
                                    <div key={index} className="group flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 transition-colors group-hover:border-slate-300 dark:group-hover:border-slate-700 group-hover:bg-slate-100 dark:group-hover:bg-slate-800">
                                                {activity.type === 'ligacao' ? <Phone className="w-3.5 h-3.5 text-blue-400" /> : null}
                                                {activity.type === 'whatsapp' ? <MessageCircle className="w-3.5 h-3.5 text-green-400" /> : null}
                                                {activity.type === 'email' ? <Mail className="w-3.5 h-3.5 text-purple-400" /> : null}
                                                {!['ligacao', 'whatsapp', 'email'].includes(activity.type) ? <FileText className="w-3.5 h-3.5 text-yellow-400" /> : null}
                                            </div>
                                            {index !== metrics.recentActivities.length - 1 ? (
                                                <div className="my-2 flex-1 w-[1px] bg-gradient-to-b from-slate-200 dark:from-slate-800 to-transparent" />
                                            ) : null}
                                        </div>
                                        <div className="flex-1 pb-2">
                                            <div className="flex items-start justify-between">
                                                <p className="text-sm font-medium text-slate-950 dark:text-slate-50">{activity.contactName}</p>
                                                <span className="whitespace-nowrap text-[10px] text-slate-500 dark:text-slate-400">
                                                    {format(new Date(activity.date), 'd MMM, HH:mm', { locale: ptBR })}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{activity.notes}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="py-8 text-center text-sm italic text-slate-400 dark:text-slate-500">
                                    Nenhuma atividade recente.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
