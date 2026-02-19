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
import { getAnalyticsData, getAgentPerformance, getWorkspaceMembers } from '@/actions/analytics';
import { getTeams } from '@/actions/teams';
import type { AnalyticsData, AgentPerformance, Team } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { subDays, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { useCurrentUser } from '@/hooks/use-online-status';
import { motion, AnimatePresence } from 'framer-motion';

type TimeRange = 'last_30_days' | 'last_7_days' | 'today' | 'this_month';

// Componente de Cartão de Estatística
const StatCard = ({ title, value, change, changeType, icon: Icon, loading }: any) => (
    <Card className="bg-zinc-950/40 border-white/5 backdrop-blur-md text-white transition-all duration-300 hover:bg-zinc-950/60 hover:border-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/5 group relative overflow-hidden">
        {/* Background gradient hint */}
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">{title}</CardTitle>
            <div className="p-2 rounded-xl bg-white/5 border border-white/5 group-hover:bg-white/10 transition-colors">
                <Icon className="h-4 w-4 text-emerald-400" />
            </div>
        </CardHeader>
        <CardContent className="relative z-10">
            {loading ? (
                <div className="space-y-2">
                    <Skeleton className="h-8 w-1/2 bg-white/5" />
                    <Skeleton className="h-4 w-3/4 bg-white/5" />
                </div>
            ) : (
                <>
                    <div className="text-2xl font-bold text-white mb-1">{value}</div>
                    <p className="text-xs text-zinc-500 flex items-center gap-1">
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
    <div className="rounded-xl border border-white/5 overflow-hidden bg-zinc-950/20">
        <Table>
            <TableHeader className="bg-white/5">
                <TableRow className="border-white/5 hover:bg-white/5">
                    <TableHead className="text-zinc-400 w-16 text-center">Pos.</TableHead>
                    <TableHead className="text-zinc-400">Atendente</TableHead>
                    <TableHead className='text-center text-zinc-400'>Atendimentos</TableHead>
                    <TableHead className='text-center text-zinc-400'>Resolvidos</TableHead>
                    <TableHead className='text-center text-zinc-400'>T.M.R.</TableHead>
                    <TableHead className='text-center text-zinc-400'>Avaliação</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i} className="border-white/5 hover:bg-white/5">
                            <TableCell><Skeleton className="h-8 w-8 rounded-full bg-white/5 mx-auto" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-32 bg-white/5" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-12 bg-white/5 mx-auto" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-12 bg-white/5 mx-auto" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-20 bg-white/5 mx-auto" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-10 bg-white/5 mx-auto" /></TableCell>
                        </TableRow>
                    ))
                ) : (
                    performance.map((agent, index) => (
                        <TableRow key={agent.agent_id} className="border-white/5 hover:bg-white/5 transition-colors">
                            <TableCell>
                                <div className={`flex items-center justify-center h-8 w-8 rounded-full font-bold text-xs mx-auto ${index === 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                        index === 1 ? 'bg-slate-400/20 text-slate-300 border border-slate-400/30' :
                                            index === 2 ? 'bg-orange-700/20 text-orange-400 border border-orange-700/30' :
                                                'bg-white/5 text-zinc-500'
                                    }`}>
                                    {index === 0 && <Award className="h-4 w-4" />}
                                    {index === 1 && <Award className="h-4 w-4" />}
                                    {index === 2 && <Award className="h-4 w-4" />}
                                    {index > 2 && (index + 1)}
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-9 w-9 border border-white/10">
                                        <AvatarImage src={agent.avatar_url} alt={agent.agent_name} />
                                        <AvatarFallback className="bg-zinc-800 text-zinc-400 text-xs">{agent.agent_name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium text-zinc-200">{agent.agent_name}</span>
                                </div>
                            </TableCell>
                            <TableCell className='text-center font-semibold text-lg text-zinc-300'>{agent.total_chats}</TableCell>
                            <TableCell className='text-center text-zinc-400'>{agent.resolved_chats}</TableCell>
                            <TableCell className='text-center text-zinc-400 font-mono text-sm'>{agent.avg_first_response_time || 'N/A'}</TableCell>
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
        dateRange: { from: string, to: string }
    ) => {
        startTransition(async () => {
            const [data, performance] = await Promise.all([
                getAnalyticsData(workspaceId, filters, dateRange),
                getAgentPerformance(workspaceId, { teamId: filters.teamId }, dateRange)
            ]);
            if (data) setAnalyticsData(data);
            if (performance) setAgentPerformance(performance);
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
            })
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
            fetchPageData(user.activeWorkspaceId, filters, dateRange);
        }
    }, [user?.activeWorkspaceId, selectedTeamId, selectedAgentId, timeRange, fetchPageData]);

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


    if (!user) {
        return (
            <div className="flex items-center justify-center h-full bg-zinc-950">
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
                            <h1 className="text-3xl font-bold tracking-tight text-white">Analytics</h1>
                            <p className="text-zinc-400 mt-1">Métricas e insights para otimizar sua operação.</p>
                        </div>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className='flex flex-wrap items-center gap-2 p-1.5 bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-2xl'
                    >
                        <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
                            <SelectTrigger className="w-[180px] bg-white/5 border-white/5 text-zinc-200 focus:ring-emerald-500/20 h-9 rounded-xl">
                                <Calendar className='mr-2 h-3.5 w-3.5 text-emerald-400' />
                                <SelectValue placeholder="Selecione o período" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                <SelectItem value="today">Hoje</SelectItem>
                                <SelectItem value="last_7_days">Últimos 7 dias</SelectItem>
                                <SelectItem value="this_month">Este mês</SelectItem>
                                <SelectItem value="last_30_days">Últimos 30 dias</SelectItem>
                            </SelectContent>
                        </Select>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                            <SelectTrigger className="w-[180px] bg-white/5 border-white/5 text-zinc-200 focus:ring-emerald-500/20 h-9 rounded-xl">
                                <Users2 className='mr-2 h-3.5 w-3.5 text-blue-400' />
                                <SelectValue placeholder="Todos os Setores" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                <SelectItem value="all">Todos os Setores</SelectItem>
                                {teams.map(team => (
                                    <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={selectedAgentId} onValueChange={setSelectedAgentId} disabled={filteredMembers.length === 0 && selectedTeamId !== 'all'}>
                            <SelectTrigger className="w-[180px] bg-white/5 border-white/5 text-zinc-200 focus:ring-emerald-500/20 h-9 rounded-xl">
                                <Filter className='mr-2 h-3.5 w-3.5 text-violet-400' />
                                <SelectValue placeholder="Todos da Equipe" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                <SelectItem value="all">Todos da Equipe</SelectItem>
                                {filteredMembers.map(member => (
                                    <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Button variant="outline" size="sm" className="bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white h-9 rounded-xl ml-auto">
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
                        <Card className="col-span-2 bg-zinc-950/40 border-white/5 backdrop-blur-md text-white overflow-hidden relative">
                            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                            <CardHeader>
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-emerald-400" />
                                    Volume de Conversas por Hora
                                </CardTitle>
                                <CardDescription className="text-zinc-500">Picos de atendimento e distribuição temporal.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px] mt-2">
                                {isPending ? <Skeleton className="h-full w-full bg-white/5 rounded-xl" /> : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={conversationsByHour} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                            <XAxis
                                                dataKey="hour"
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={false}
                                                stroke="rgba(255,255,255,0.3)"
                                                dy={10}
                                            />
                                            <YAxis
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={false}
                                                stroke="rgba(255,255,255,0.3)"
                                            />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                contentStyle={{
                                                    backgroundColor: '#09090b',
                                                    border: '1px solid rgba(255,255,255,0.1)',
                                                    borderRadius: '12px',
                                                    color: '#fff',
                                                    boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
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
                        <Card className="bg-zinc-950/40 border-white/5 backdrop-blur-md text-white overflow-hidden relative">
                            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                            <CardHeader>
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                    <MessageCircle className="h-4 w-4 text-blue-400" />
                                    Canais Mais Usados
                                </CardTitle>
                                <CardDescription className="text-zinc-500">Distribuição por canal de entrada.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px] flex flex-col justify-between">
                                {isPending ? <Skeleton className="h-full w-full bg-white/5 rounded-xl" /> : (
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
                                                                    <div className="bg-zinc-950/90 border border-white/10 px-3 py-2 rounded-lg text-xs text-white shadow-xl">
                                                                        <span className="font-semibold" style={{ color: data.color }}>{data.name}</span>
                                                                        <div className="text-zinc-400 mt-0.5">{data.value} conversas</div>
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
                                                            <div className="p-1.5 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                                                                <Icon size={14} style={{ color: channel.color }} />
                                                            </div>
                                                            <span className="text-zinc-300 group-hover:text-white transition-colors">{channel.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-1.5 w-16 bg-white/5 rounded-full overflow-hidden">
                                                                <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: channel.color }} />
                                                            </div>
                                                            <span className="text-zinc-400 font-mono text-xs w-9 text-right">{percent}%</span>
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
                        <Card className="bg-zinc-950/40 border-white/5 backdrop-blur-md text-white overflow-hidden">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                        <Award className="h-4 w-4 text-amber-400" />
                                        {selectedAgentId !== 'all'
                                            ? `Performance: ${allMembers.find(m => m.id === selectedAgentId)?.name}`
                                            : `Ranking de Atendimento`
                                        }
                                    </CardTitle>
                                    <CardDescription className="text-zinc-500 mt-1">
                                        {selectedAgentId !== 'all'
                                            ? "Análise detalhada de métricas individuais de performance."
                                            : "Acompanhe o desempenho da sua equipe em tempo real."
                                        }
                                    </CardDescription>
                                </div>
                                <Button variant="outline" size="sm" className="hidden sm:flex bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10">
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
                            <Card className='h-full bg-zinc-950/40 border-white/5 backdrop-blur-md text-white hover:border-emerald-500/20 transition-all cursor-default group'>
                                <CardHeader>
                                    <CardTitle className='flex items-center gap-2 text-white group-hover:text-emerald-400 transition-colors'>
                                        <div className="p-1.5 rounded-lg bg-emerald-500/10"><Bot className="h-4 w-4 text-emerald-500" /></div>
                                        Eficiência do Piloto Automático
                                    </CardTitle>
                                    <CardDescription className="text-zinc-500">Impacto da automação no atendimento.</CardDescription>
                                </CardHeader>
                                <CardContent className='space-y-4'>
                                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                                        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center text-zinc-600">
                                            <Bot size={24} />
                                        </div>
                                        <p className="text-sm text-zinc-500 max-w-xs">Métricas detalhadas de automação e retenção do bot estarão disponíveis na próxima atualização.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </section>
                        <section>
                            <Card className='h-full bg-zinc-950/40 border-white/5 backdrop-blur-md text-white hover:border-blue-500/20 transition-all cursor-default group'>
                                <CardHeader>
                                    <CardTitle className='flex items-center gap-2 text-white group-hover:text-blue-400 transition-colors'>
                                        <div className="p-1.5 rounded-lg bg-blue-500/10"><TrendingUp className="h-4 w-4 text-blue-500" /></div>
                                        Conversões e Oportunidades
                                    </CardTitle>
                                    <CardDescription className="text-zinc-500">Resultados de negócio gerados.</CardDescription>
                                </CardHeader>
                                <CardContent className='space-y-4'>
                                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                                        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center text-zinc-600">
                                            <TrendingUp size={24} />
                                        </div>
                                        <p className="text-sm text-zinc-500 max-w-xs">Relatórios de conversão de leads e vendas atribuídas estarão disponíveis em breve.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </section>
                    </motion.div>
                </motion.main>
            </div>
        </div>
    );
}
