'use client';

import React, { useMemo, useEffect, useState } from 'react';
import { Contact, Tag, DealMetrics } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import { Users, UserPlus, TrendingUp, Activity, ArrowUpRight, ArrowDownRight, Calendar, Phone, Mail, MessageCircle, FileText, DollarSign, Target, Clock, MoreHorizontal } from 'lucide-react';
import { format, subDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { getDealMetrics } from '@/actions/deals';

interface CrmDashboardProps {
    contacts: Contact[];
    tags: Tag[];
    workspaceId?: string;
}

function formatBRL(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CrmDashboard({ contacts, tags, workspaceId }: CrmDashboardProps) {
    const [dealMetrics, setDealMetrics] = useState<DealMetrics | null>(null);

    useEffect(() => {
        if (workspaceId) {
            getDealMetrics(workspaceId).then(res => {
                if (res.metrics) setDealMetrics(res.metrics);
            });
        }
    }, [workspaceId]);

    const metrics = useMemo(() => {
        const totalContacts = contacts.length;
        const newContactsThisWeek = contacts.filter(c =>
            c.created_at && isAfter(new Date(c.created_at), subDays(new Date(), 7))
        ).length;

        const stages = ['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
        const stageCounts = stages.map(stage => {
            const count = contacts.filter(c => c.tags?.some(t => t.value === stage)).length;
            if (stage === 'novo') {
                const noStageCount = contacts.filter(c => !c.tags?.some(t => stages.includes(t.value))).length;
                return { name: stage, count: count + noStageCount };
            }
            return { name: stage, count };
        });

        const allActivities = contacts.flatMap(c =>
            (c.activities || []).map(a => ({ ...a, contactName: c.name, contactAvatar: c.avatar_url, contactEmail: c.email }))
        ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);

        return {
            totalContacts,
            newContactsThisWeek,
            stageCounts,
            recentActivities: allActivities
        };
    }, [contacts]);

    const stageColors: Record<string, string> = {
        novo: '#60A5FA',
        qualificado: '#FACC15',
        proposta: '#C084FC',
        negociacao: '#FB923C',
        ganho: '#4ADE80',
        perdido: '#F87171'
    };

    const stageLabels: Record<string, string> = {
        novo: 'Novo',
        qualificado: 'Qualificado',
        proposta: 'Proposta',
        negociacao: 'Negociação',
        ganho: 'Ganho',
        perdido: 'Perdido'
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
                    <p className="mb-1 font-medium text-slate-950">{stageLabels[label] || label}</p>
                    <p className="text-blue-400 text-sm">
                        {payload[0].value} Contatos
                    </p>
                </div>
            );
        }
        return null;
    };

    // Build the metrics cards data with real trend info from deals
    const trendData = dealMetrics?.trends;

    const metricCards = [
        {
            title: "Pipeline Total",
            value: dealMetrics ? formatBRL(dealMetrics.totalPipelineValue) : '—',
            subtext: dealMetrics ? `Ponderado: ${formatBRL(dealMetrics.weightedPipelineValue)}` : 'Carregando...',
            icon: DollarSign,
            trend: trendData ? `${trendData.revenue.change >= 0 ? '+' : ''}${trendData.revenue.change}%` : '',
            trendUp: trendData ? trendData.revenue.change >= 0 : true,
            gradient: "from-emerald-500 to-teal-400"
        },
        {
            title: "Total de Contatos",
            value: metrics.totalContacts,
            subtext: `${metrics.newContactsThisWeek} novos essa semana`,
            icon: Users,
            trend: trendData ? `${trendData.newDeals.change >= 0 ? '+' : ''}${trendData.newDeals.change}%` : '',
            trendUp: trendData ? trendData.newDeals.change >= 0 : true,
            gradient: "from-blue-500 to-cyan-400"
        },
        {
            title: "Ticket Médio",
            value: dealMetrics ? formatBRL(dealMetrics.averageTicket) : '—',
            subtext: `Win rate: ${dealMetrics?.winRate ?? 0}%`,
            icon: Target,
            trend: trendData ? `${trendData.closedWon.change >= 0 ? '+' : ''}${trendData.closedWon.change}%` : '',
            trendUp: trendData ? trendData.closedWon.change >= 0 : true,
            gradient: "from-purple-500 to-pink-500"
        },
        {
            title: "Ciclo Médio",
            value: dealMetrics ? `${dealMetrics.averageCycleTimeDays}d` : '—',
            subtext: "Média de dias até fechar",
            icon: Clock,
            trend: '',
            trendUp: true,
            gradient: "from-orange-500 to-amber-400"
        },
    ];

    return (
        <div className="p-8 space-y-8 h-full overflow-y-auto bg-transparent custom-scrollbar">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950">Visão Geral</h1>
                    <p className="mt-1 text-sm text-slate-500">Acompanhe o desempenho do seu funil de vendas em tempo real.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600 shadow-sm">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Últimos 7 dias</span>
                    </div>
                </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {metricCards.map((metric, i) => (
                    <Card key={i} className="group relative overflow-hidden border-slate-200/80 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity duration-500">
                            <metric.icon className="h-24 w-24 text-slate-900" />
                        </div>
                        <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
                            <CardTitle className="text-sm font-medium text-slate-500">{metric.title}</CardTitle>
                            <metric.icon className="h-4 w-4 text-slate-400" />
                        </CardHeader>
                        <CardContent className="relative z-10">
                            <div className={`text-3xl font-bold bg-gradient-to-r ${metric.gradient} bg-clip-text text-transparent`}>
                                {metric.value}
                            </div>
                            <div className="flex items-center mt-2 gap-2">
                                {metric.trend && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${metric.trendUp ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {metric.trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                        {metric.trend}
                                    </span>
                                )}
                                <p className="text-xs text-slate-500">{metric.subtext}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Deal Pipeline per Stage */}
            {dealMetrics && dealMetrics.dealsByStage.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {dealMetrics.dealsByStage.map(ds => (
                        <div key={ds.stage} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stageColors[ds.stage] || '#888' }} />
                                <span className="text-xs text-slate-500">{stageLabels[ds.stage] || ds.stage}</span>
                            </div>
                            <p className="text-sm font-bold text-slate-950">{formatBRL(ds.totalValue)}</p>
                            <p className="text-[10px] text-slate-500">{ds.count} deals</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Funnel Chart */}
                <Card className="col-span-1 border-slate-200/80 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)] lg:col-span-2">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg text-slate-950">Funil de Vendas</CardTitle>
                                <CardDescription className="text-slate-500">Distribuição de contatos por fase do funil</CardDescription>
                            </div>
                            <Button variant="ghost" size="icon" className="text-slate-400 hover:bg-slate-100 hover:text-slate-950">
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
                                    tickFormatter={(val) => stageLabels[val] || val}
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
                                        <Cell key={`cell-${index}`} fill={stageColors[entry.name] || '#8884d8'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Recent Activity Feed */}
                <Card className="col-span-1 flex flex-col border-slate-200/80 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                    <CardHeader>
                        <CardTitle className="text-lg text-slate-950">Atividades Recentes</CardTitle>
                        <CardDescription className="text-slate-500">Últimas interações com clientes</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-auto custom-scrollbar pr-2">
                        <div className="space-y-6">
                            {metrics.recentActivities.length > 0 ? (
                                metrics.recentActivities.map((activity, i) => (
                                    <div key={i} className="flex gap-4 group">
                                        <div className="flex flex-col items-center">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border border-slate-200 bg-slate-50 shrink-0
                                                group-hover:border-slate-300 group-hover:bg-slate-100 transition-colors
                                            `}>
                                                {activity.type === 'ligacao' && <Phone className="w-3.5 h-3.5 text-blue-400" />}
                                                {activity.type === 'whatsapp' && <MessageCircle className="w-3.5 h-3.5 text-green-400" />}
                                                {activity.type === 'email' && <Mail className="w-3.5 h-3.5 text-purple-400" />}
                                                {(activity.type === 'nota' || !['ligacao', 'whatsapp', 'email'].includes(activity.type)) && <FileText className="w-3.5 h-3.5 text-yellow-400" />}
                                            </div>
                                            {i !== metrics.recentActivities.length - 1 && (
                                                <div className="my-2 w-[1px] flex-1 bg-gradient-to-b from-slate-200 to-transparent" />
                                            )}
                                        </div>
                                        <div className="flex-1 pb-2">
                                            <div className="flex justify-between items-start">
                                                <p className="text-sm font-medium text-slate-950">
                                                    {activity.contactName}
                                                </p>
                                                <span className="whitespace-nowrap text-[10px] text-slate-500">
                                                    {format(new Date(activity.date), "d MMM, HH:mm", { locale: ptBR })}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                                                {activity.notes}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="py-8 text-center text-sm italic text-slate-400">
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
