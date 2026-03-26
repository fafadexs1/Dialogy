'use client';

import React, { useState, useEffect, useCallback, useTransition, useMemo } from 'react';
import type { User } from '@/lib/types';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend
} from 'recharts';
import {
    Users,
    MessageSquare,
    Clock,
    CheckCircle,
    Smile,
    ArrowUpRight,
    ArrowDownRight,
    Filter,
    FileDown,
    Calendar,
    Award,
    Bot,
    TrendingUp,
    Loader2,
    Users2,
    Instagram,
    Facebook,
    MessageCircle,
    Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { getAnalyticsData, getAgentPerformance, getWorkspaceMembers, getConversionSettings, getConversionMetrics, updateConversionSettings } from '@/actions/analytics';
import { getTeams } from '@/actions/teams';
import type { AnalyticsData, AgentPerformance, Team, ConversionCounterMode, ConversionMetrics } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { useCurrentUser } from '@/hooks/use-online-status';
import { motion, AnimatePresence } from 'framer-motion';

type TimeRange = 'last_30_days' | 'last_7_days' | 'today' | 'this_month';

// Componente de Cartão de Estatística
const StatCard = ({ title, value, change, changeType, icon: Icon, loading }: any) => (
    <Card className="group relative overflow-hidden border-slate-200/80 bg-white text-slate-950 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)] transition-all duration-300 hover:border-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/10">
        {/* Background gradient hint */}
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-slate-500 transition-colors group-hover:text-slate-700">{title}</CardTitle>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 transition-colors group-hover:bg-slate-100">
                <Icon className="h-4 w-4 text-emerald-400" />
            </div>
        </CardHeader>
        <CardContent className="relative z-10">
            {loading ? (
                <div className="space-y-2">
                    <Skeleton className="h-8 w-1/2 bg-slate-100" />
                    <Skeleton className="h-4 w-3/4 bg-slate-100" />
                </div>
            ) : (
                <>
                    <div className="mb-1 text-2xl font-bold text-slate-950">{value}</div>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                        {changeType === 'increase' ?
                            <span className="flex items-center text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded text-[10px] font-medium"><ArrowUpRight className="h-3 w-3 mr-0.5" /> {change}</span> :
                            <span className="flex items-center text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded text-[10px] font-medium"><ArrowDownRight className="h-3 w-3 mr-0.5" /> {change}</span>
                        }
                        <span className="ml-1">vs. anterior</span>
                    </p>
                </>
            )}
        </CardContent>
    </Card>
);

// Tabela de Desempenho do Agente
const AgentPerformanceTable = ({ performance, loading }: { performance: AgentPerformance[], loading: boolean }) => (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        <Table>
            <TableHeader className="bg-slate-50">
                <TableRow className="border-slate-200/80 hover:bg-slate-50">
                    <TableHead className="w-16 text-center text-slate-500">Pos.</TableHead>
                    <TableHead className="text-slate-500">Atendente</TableHead>
                    <TableHead className='text-center text-slate-500'>Atendimentos</TableHead>
                    <TableHead className='text-center text-slate-500'>Resolvidos</TableHead>
                    <TableHead className='text-center text-slate-500'>T.M.R.</TableHead>
                    <TableHead className='text-center text-slate-500'>Avaliação</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i} className="border-slate-200/80 hover:bg-slate-50">
                            <TableCell><Skeleton className="mx-auto h-8 w-8 rounded-full bg-slate-100" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-32 bg-slate-100" /></TableCell>
                            <TableCell><Skeleton className="mx-auto h-6 w-12 bg-slate-100" /></TableCell>
                            <TableCell><Skeleton className="mx-auto h-6 w-12 bg-slate-100" /></TableCell>
                            <TableCell><Skeleton className="mx-auto h-6 w-20 bg-slate-100" /></TableCell>
                            <TableCell><Skeleton className="mx-auto h-6 w-10 bg-slate-100" /></TableCell>
                        </TableRow>
                    ))
                ) : (
                    performance.map((agent, index) => (
                        <TableRow key={agent.agent_id} className="border-slate-200/80 transition-colors hover:bg-slate-50">
                            <TableCell>
                                <div className={`flex items-center justify-center h-8 w-8 rounded-full font-bold text-xs mx-auto ${index === 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                        index === 1 ? 'bg-slate-400/20 text-slate-300 border border-slate-400/30' :
                                            index === 2 ? 'bg-orange-700/20 text-orange-400 border border-orange-700/30' :
                                                'bg-slate-100 text-slate-500'
                                    }`}>
                                    {index === 0 && <Award className="h-4 w-4" />}
                                    {index === 1 && <Award className="h-4 w-4" />}
                                    {index === 2 && <Award className="h-4 w-4" />}
                                    {index > 2 && (index + 1)}
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-9 w-9 border border-slate-200">
                                        <AvatarImage src={agent.avatar_url} alt={agent.agent_name} />
                                        <AvatarFallback className="bg-slate-100 text-xs text-slate-600">{agent.agent_name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium text-slate-950">{agent.agent_name}</span>
                                </div>
                            </TableCell>
                            <TableCell className='text-center text-lg font-semibold text-slate-800'>{agent.total_chats}</TableCell>
                            <TableCell className='text-center text-slate-600'>{agent.resolved_chats}</TableCell>
                            <TableCell className='text-center font-mono text-sm text-slate-600'>{agent.avg_first_response_time || 'N/A'}</TableCell>
                            <TableCell className='text-center'>
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-sm">
                                    <Smile className="h-3.5 w-3.5" />
                                    {agent.avg_rating || 'N/A'}
                                </div>
                            </TableCell>
                        </TableRow>
                    )))}
            </TableBody>
        </Table>
    </div>
);

// Página Principal de Analytics
export default function AnalyticsPage() {
    const user = useCurrentUser();
    const [isPending, startTransition] = useTransition();
    const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
    const [agentPerformance, setAgentPerformance] = useState<AgentPerformance[]>([]);
    const [conversionMetrics, setConversionMetrics] = useState<ConversionMetrics | null>(null);
    const [conversionCounterMode, setConversionCounterMode] = useState<ConversionCounterMode>('won_deals');
    const [isSavingConversionMode, setIsSavingConversionMode] = useState(false);
    const [allMembers, setAllMembers] = useState<User[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);

    // --- Filter States ---
    const [timeRange, setTimeRange] = useState<TimeRange>('last_30_days');
    const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
    const [selectedAgentId, setSelectedAgentId] = useState<string>('all');

    const getDateRange = (range: TimeRange): { from: string, to: string } => {
        const now = new Date();
        switch (range) {
            case 'today':
                return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
            case 'last_7_days':
                return { from: startOfDay(subDays(now, 6)).toISOString(), to: endOfDay(now).toISOString() };
            case 'this_month':
                return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() };
            case 'last_30_days':
            default:
                return { from: startOfDay(subDays(now, 29)).toISOString(), to: endOfDay(now).toISOString() };
        }
    };

    const fetchPageData = useCallback((
        workspaceId: string,
        filters: { teamId?: string; agentId?: string },
        dateRange: { from: string, to: string },
        counterMode: ConversionCounterMode
    ) => {
        startTransition(async () => {
            const [data, performance, conversions] = await Promise.all([
                getAnalyticsData(workspaceId, filters, dateRange),
                getAgentPerformance(workspaceId, { teamId: filters.teamId }, dateRange),
                getConversionMetrics(workspaceId, filters, dateRange, counterMode),
            ]);
            if (data) setAnalyticsData(data);
            if (performance) setAgentPerformance(performance);
            if (conversions) setConversionMetrics(conversions);
        });
    }, []);

    // Fetch filter options (teams, members)
    useEffect(() => {
        if (user?.activeWorkspaceId) {
            getWorkspaceMembers(user.activeWorkspaceId).then(res => {
                if (res.members) setAllMembers(res.members as User[]);
            });
            getTeams(user.activeWorkspaceId).then(res => {
                if (res.teams) setTeams(res.teams);
            });
            getConversionSettings(user.activeWorkspaceId).then(res => {
                if (res.settings) {
                    setConversionCounterMode(res.settings.counterMode);
                }
            });
        }
    }, [user?.activeWorkspaceId]);

    // Fetch analytics data when filters change
    useEffect(() => {
        if (user?.activeWorkspaceId) {
            const filters = {
                teamId: selectedTeamId === 'all' ? undefined : selectedTeamId,
                agentId: selectedAgentId === 'all' ? undefined : selectedAgentId,
            };
            const dateRange = getDateRange(timeRange);
            fetchPageData(user.activeWorkspaceId, filters, dateRange, conversionCounterMode);
        }
    }, [user?.activeWorkspaceId, selectedTeamId, selectedAgentId, timeRange, conversionCounterMode, fetchPageData]);

    // Reset agent filter when team changes
    useEffect(() => {
        setSelectedAgentId('all');
    }, [selectedTeamId]);

    const filteredMembers = useMemo(() => {
        if (selectedTeamId === 'all') return allMembers;
        const selectedTeam = teams.find(t => t.id === selectedTeamId);
        if (!selectedTeam) return [];
        return allMembers.filter(member => (member as any).team_id === selectedTeamId);
    }, [allMembers, teams, selectedTeamId]);

    const handleCounterModeChange = useCallback(async (nextValue: string) => {
        const normalized = (nextValue === 'unique_converted_contacts'
            ? 'unique_converted_contacts'
            : 'won_deals') as ConversionCounterMode;
        setConversionCounterMode(normalized);

        if (!user?.activeWorkspaceId) return;

        setIsSavingConversionMode(true);
        const result = await updateConversionSettings(user.activeWorkspaceId, normalized);
        if (!result.success) {
            console.error('[ANALYTICS] Failed to save conversion counter mode:', result.error);
        }
        setIsSavingConversionMode(false);
    }, [user?.activeWorkspaceId]);


    if (!user) {
        return (
            <div className="flex h-full items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
                        <Loader2 className="relative h-12 w-12 animate-spin text-emerald-500" />
                    </div>
                </div>
            </div>
        )
    }

    const conversationsByHour = analyticsData?.conversationsByHour || [];

    const channelsData = analyticsData?.conversationsByChannel?.length
        ? analyticsData.conversationsByChannel
        : [{ name: 'Sem dados', value: 100, color: '#333' }];

    const formatBRL = (value: number) =>
        value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const performanceToDisplay = selectedAgentId === 'all'
        ? agentPerformance
        : agentPerformance.filter(p => p.agent_id === selectedAgentId);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05,
            },
        },
    };

    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1,
            transition: { type: 'spring', stiffness: 100, damping: 20 }
        },
    };

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
            {/* Background Effects */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="absolute top-[10%] left-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
                <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
            </div>

            <div className="relative z-10 w-full max-w-[1600px] mx-auto p-4 md:p-8 space-y-8 h-full flex flex-col">
                <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                            <Zap className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Analytics</h1>
                            <p className="mt-1 text-slate-500">Métricas e insights para otimizar sua operação.</p>
                        </div>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className='flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-sm'
                    >
                        <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
                            <SelectTrigger className="h-9 w-[180px] rounded-xl border-slate-200 bg-white text-slate-700 focus:ring-emerald-500/20">
                                <Calendar className='mr-2 h-3.5 w-3.5 text-emerald-400' />
                                <SelectValue placeholder="Selecione o período" />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white text-slate-900">
                                <SelectItem value="today">Hoje</SelectItem>
                                <SelectItem value="last_7_days">Últimos 7 dias</SelectItem>
                                <SelectItem value="this_month">Este mês</SelectItem>
                                <SelectItem value="last_30_days">Últimos 30 dias</SelectItem>
                            </SelectContent>
                        </Select>

                        <div className="mx-1 h-6 w-px bg-slate-200" />

                        <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                            <SelectTrigger className="h-9 w-[180px] rounded-xl border-slate-200 bg-white text-slate-700 focus:ring-emerald-500/20">
                                <Users2 className='mr-2 h-3.5 w-3.5 text-blue-400' />
                                <SelectValue placeholder="Todos os Setores" />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white text-slate-900">
                                <SelectItem value="all">Todos os Setores</SelectItem>
                                {teams.map(team => (
                                    <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={selectedAgentId} onValueChange={setSelectedAgentId} disabled={filteredMembers.length === 0 && selectedTeamId !== 'all'}>
                            <SelectTrigger className="h-9 w-[180px] rounded-xl border-slate-200 bg-white text-slate-700 focus:ring-emerald-500/20">
                                <Filter className='mr-2 h-3.5 w-3.5 text-violet-400' />
                                <SelectValue placeholder="Todos da Equipe" />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white text-slate-900">
                                <SelectItem value="all">Todos da Equipe</SelectItem>
                                {filteredMembers.map(member => (
                                    <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Button variant="outline" size="sm" className="ml-auto h-9 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950">
                            <FileDown className="mr-2 h-3.5 w-3.5" /> Exportar
                        </Button>
                    </motion.div>
                </header>

                <motion.main
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="flex-1 space-y-6"
                >

                    <motion.section variants={itemVariants}>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                            <StatCard loading={isPending} title="Total de Conversas" value={analyticsData?.totalConversations?.toLocaleString() || '0'} change="15.2%" changeType="increase" icon={MessageSquare} />
                            <StatCard loading={isPending} title="Novos Contatos" value={analyticsData?.newContacts?.toLocaleString() || '0'} change="8.1%" changeType="increase" icon={Users} />
                            <StatCard loading={isPending} title="Tempo Médio Resp." value={analyticsData?.avgFirstResponseTime || 'N/A'} change="5.6%" changeType="decrease" icon={Clock} />
                            <StatCard loading={isPending} title="Taxa Resolução" value={`${analyticsData?.firstContactResolutionRate.toFixed(1) || '0.0'}%`} change="1.2%" changeType="increase" icon={CheckCircle} />
                            <StatCard loading={isPending} title="CSAT (Satisfação)" value={'94.2%'} change="0.5%" changeType="increase" icon={Smile} />
                        </div>
                    </motion.section>

                    <motion.section variants={itemVariants} className="grid md:grid-cols-3 gap-6">
                        <Card className="relative col-span-2 overflow-hidden border-slate-200/80 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                                    <Clock className="h-4 w-4 text-emerald-400" />
                                    Volume de Conversas por Hora
                                </CardTitle>
                                <CardDescription className="text-slate-500">Picos de atendimento e distribuição temporal.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px] mt-2">
                                {isPending ? <Skeleton className="h-full w-full rounded-xl bg-slate-100" /> : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={conversationsByHour} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.22)" />
                                            <XAxis
                                                dataKey="hour"
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={false}
                                                stroke="rgba(100,116,139,0.6)"
                                                dy={10}
                                            />
                                            <YAxis
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={false}
                                                stroke="rgba(100,116,139,0.6)"
                                            />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                                                contentStyle={{
                                                    backgroundColor: '#ffffff',
                                                    border: '1px solid rgba(226,232,240,1)',
                                                    borderRadius: '12px',
                                                    color: '#0f172a',
                                                    boxShadow: '0 10px 30px rgba(15,23,42,0.12)'
                                                }}
                                                itemStyle={{ color: '#10b981' }}
                                            />
                                            <Bar
                                                dataKey="count"
                                                fill="url(#colorCount)"
                                                radius={[6, 6, 0, 0]}
                                                barSize={32}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>
                        <Card className="relative overflow-hidden border-slate-200/80 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                                    <MessageCircle className="h-4 w-4 text-blue-400" />
                                    Canais Mais Usados
                                </CardTitle>
                                <CardDescription className="text-slate-500">Distribuição por canal de entrada.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px] flex flex-col justify-between">
                                {isPending ? <Skeleton className="h-full w-full rounded-xl bg-slate-100" /> : (
                                    <>
                                        <div className="flex-1 min-h-[180px] -mt-4">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={channelsData}
                                                        dataKey="value"
                                                        nameKey="name"
                                                        cx="50%"
                                                        cy="50%"
                                                        outerRadius={70}
                                                        innerRadius={55}
                                                        stroke="none"
                                                        paddingAngle={4}
                                                        cornerRadius={4}
                                                    >
                                                        {channelsData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip
                                                        content={({ active, payload }) => {
                                                            if (active && payload && payload.length) {
                                                                const data = payload[0].payload;
                                                                return (
                                                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-950 shadow-xl">
                                                                        <span className="font-semibold" style={{ color: data.color }}>{data.name}</span>
                                                                        <div className="mt-0.5 text-slate-500">{data.value} conversas</div>
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        }}
                                                    />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="space-y-3 pt-2">
                                            {channelsData.map((channel) => {
                                                const total = channelsData.reduce((acc, curr) => acc + curr.value, 0);
                                                const percent = total > 0 ? ((channel.value / total) * 100).toFixed(1) : "0.0";

                                                let Icon = MessageCircle;
                                                if (channel.name === 'Instagram') Icon = Instagram;
                                                if (channel.name === 'Messenger') Icon = Facebook;

                                                return (
                                                    <div key={channel.name} className="flex items-center justify-between text-sm group">
                                                        <div className="flex items-center gap-3">
                                                            <div className="rounded-lg bg-slate-100 p-1.5 transition-colors group-hover:bg-slate-200">
                                                                <Icon size={14} style={{ color: channel.color }} />
                                                            </div>
                                                            <span className="text-slate-700 transition-colors group-hover:text-slate-950">{channel.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                                                <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: channel.color }} />
                                                            </div>
                                                            <span className="w-9 text-right font-mono text-xs text-slate-500">{percent}%</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </motion.section>

                    <motion.section variants={itemVariants}>
                        <Card className="overflow-hidden border-slate-200/80 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                                        <Award className="h-4 w-4 text-amber-400" />
                                        {selectedAgentId !== 'all'
                                            ? `Performance: ${allMembers.find(m => m.id === selectedAgentId)?.name}`
                                            : `Ranking de Atendimento`
                                        }
                                    </CardTitle>
                                    <CardDescription className="mt-1 text-slate-500">
                                        {selectedAgentId !== 'all'
                                            ? "Análise detalhada de métricas individuais de performance."
                                            : "Acompanhe o desempenho da sua equipe em tempo real."
                                        }
                                    </CardDescription>
                                </div>
                                <Button variant="outline" size="sm" className="hidden border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950 sm:flex">
                                    Ver Relatório Completo
                                </Button>
                            </CardHeader>
                            <CardContent>
                                <AgentPerformanceTable performance={performanceToDisplay} loading={isPending} />
                            </CardContent>
                        </Card>
                    </motion.section>

                    <motion.div variants={itemVariants} className="grid md:grid-cols-2 gap-6 pb-8">
                        <section>
                            <Card className='group h-full cursor-default border-slate-200/80 bg-white transition-all hover:border-emerald-500/20 hover:shadow-[0_24px_60px_-40px_rgba(16,185,129,0.18)]'>
                                <CardHeader>
                                    <CardTitle className='flex items-center gap-2 text-slate-950 transition-colors group-hover:text-emerald-500'>
                                        <div className="p-1.5 rounded-lg bg-emerald-500/10"><Bot className="h-4 w-4 text-emerald-500" /></div>
                                        Eficiência do Piloto Automático
                                    </CardTitle>
                                    <CardDescription className="text-slate-500">Impacto da automação no atendimento.</CardDescription>
                                </CardHeader>
                                <CardContent className='space-y-4'>
                                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                                            <Bot size={24} />
                                        </div>
                                        <p className="max-w-xs text-sm text-slate-500">Métricas detalhadas de automação e retenção do bot estarão disponíveis na próxima atualização.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </section>
                        <section>
                            <Card className='group h-full cursor-default border-slate-200/80 bg-white transition-all hover:border-blue-500/20 hover:shadow-[0_24px_60px_-40px_rgba(59,130,246,0.18)]'>
                                <CardHeader className="flex flex-row items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className='flex items-center gap-2 text-slate-950 transition-colors group-hover:text-blue-500'>
                                            <div className="p-1.5 rounded-lg bg-blue-500/10"><TrendingUp className="h-4 w-4 text-blue-500" /></div>
                                            Conversões e Oportunidades
                                        </CardTitle>
                                        <CardDescription className="text-slate-500">Resultados de negócio gerados no período.</CardDescription>
                                    </div>
                                    <Select value={conversionCounterMode} onValueChange={handleCounterModeChange}>
                                        <SelectTrigger className="h-8 w-[220px] border-slate-200 bg-white text-xs text-slate-700">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="border-slate-200 bg-white text-slate-900">
                                            <SelectItem value="won_deals">Contar por Oportunidades Ganhas</SelectItem>
                                            <SelectItem value="unique_converted_contacts">Contar por Leads Convertidos</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </CardHeader>
                                <CardContent className='space-y-4'>
                                    {isPending ? (
                                        <div className="space-y-3">
                                            <Skeleton className="h-16 w-full rounded-xl bg-slate-100" />
                                            <Skeleton className="h-16 w-full rounded-xl bg-slate-100" />
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                <p className="mb-1 text-xs text-slate-500">
                                                    {conversionCounterMode === 'unique_converted_contacts'
                                                        ? 'Leads Convertidos'
                                                        : 'Oportunidades Ganhas'}
                                                </p>
                                                <div className="flex items-end justify-between">
                                                    <span className="text-3xl font-bold text-slate-950">{conversionMetrics?.counterValue ?? 0}</span>
                                                    {isSavingConversionMode && (
                                                        <span className="text-[11px] text-slate-500">salvando método...</span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                    <p className="text-[11px] text-slate-500">Receita convertida</p>
                                                    <p className="text-base font-semibold text-emerald-400">
                                                        {formatBRL(conversionMetrics?.totalRevenue || 0)}
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                    <p className="text-[11px] text-slate-500">Leads únicos</p>
                                                    <p className="text-base font-semibold text-slate-950">
                                                        {conversionMetrics?.convertedContacts ?? 0}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                <p className="text-[11px] text-slate-500">Última conversão registrada</p>
                                                <p className="text-sm text-slate-700">
                                                    {conversionMetrics?.lastConversionAt
                                                        ? format(new Date(conversionMetrics.lastConversionAt), "dd/MM/yyyy 'às' HH:mm")
                                                        : 'Nenhuma conversão no período'}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </section>
                    </motion.div>
                </motion.main>
            </div>
        </div>
    );
}
