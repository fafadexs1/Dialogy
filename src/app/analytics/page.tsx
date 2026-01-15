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
    MessageCircle
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

type TimeRange = 'last_30_days' | 'last_7_days' | 'today' | 'this_month';

// Componente de Cartão de Estatística
const StatCard = ({ title, value, change, changeType, icon: Icon, loading }: any) => (
    <Card className="bg-black/40 border-white/10 backdrop-blur-md text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-white/80">{title}</CardTitle>
            <Icon className="h-4 w-4 text-white/50" />
        </CardHeader>
        <CardContent>
            {loading ? (
                <Skeleton className="h-10 w-3/4 bg-white/10" />
            ) : (
                <>
                    <div className="text-2xl font-bold">{value}</div>
                    <p className="text-xs text-white/50 flex items-center gap-1">
                        {changeType === 'increase' ?
                            <span className="flex items-center text-emerald-400"><ArrowUpRight className="h-3 w-3" /> {change}</span> :
                            <span className="flex items-center text-rose-400"><ArrowDownRight className="h-3 w-3" /> {change}</span>
                        }
                        em relação ao período anterior
                    </p>
                </>
            )}
        </CardContent>
    </Card>
);

// Tabela de Desempenho do Agente
const AgentPerformanceTable = ({ performance, loading }: { performance: AgentPerformance[], loading: boolean }) => (
    <div className="rounded-md border border-white/10 overflow-hidden">
        <Table>
            <TableHeader className="bg-white/5">
                <TableRow className="border-white/10 hover:bg-white/5">
                    <TableHead className="text-white/70">Pos.</TableHead>
                    <TableHead className="text-white/70">Atendente</TableHead>
                    <TableHead className='text-center text-white/70'>Atendimentos</TableHead>
                    <TableHead className='text-center text-white/70'>Resolvidos</TableHead>
                    <TableHead className='text-center text-white/70'>Tempo Médio Resposta</TableHead>
                    <TableHead className='text-center text-white/70'>Avaliação Média</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i} className="border-white/10 hover:bg-white/5">
                            <TableCell><Skeleton className="h-8 w-8 rounded-full bg-white/10" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-32 bg-white/10" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-12 bg-white/10" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-12 bg-white/10" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-20 bg-white/10" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-10 bg-white/10" /></TableCell>
                        </TableRow>
                    ))
                ) : (
                    performance.map((agent, index) => (
                        <TableRow key={agent.agent_id} className="border-white/10 hover:bg-white/5">
                            <TableCell>
                                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white/10 font-bold text-white">
                                    {index === 0 && <Award className="h-5 w-5 text-amber-400" />}
                                    {index === 1 && <Award className="h-5 w-5 text-slate-400" />}
                                    {index === 2 && <Award className="h-5 w-5 text-amber-600" />}
                                    {index > 2 && (index + 1)}
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Avatar className="border border-white/10">
                                        <AvatarImage src={agent.avatar_url} alt={agent.agent_name} />
                                        <AvatarFallback className="bg-white/10 text-white">{agent.agent_name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium text-white">{agent.agent_name}</span>
                                </div>
                            </TableCell>
                            <TableCell className='text-center font-semibold text-lg text-white'>{agent.total_chats}</TableCell>
                            <TableCell className='text-center text-white/70'>{agent.resolved_chats}</TableCell>
                            <TableCell className='text-center text-white/70'>{agent.avg_first_response_time || 'N/A'}</TableCell>
                            <TableCell className='text-center font-semibold text-lg text-emerald-400'>{agent.avg_rating || 'N/A'}</TableCell>
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
            <div className="flex items-center justify-center h-full bg-black">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
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

    return (
        <div className="relative flex flex-col flex-1 h-full bg-black overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
                <div className="absolute -left-[10%] top-[20%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]" />
                <div className="absolute -right-[10%] bottom-[20%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[100px]" />
            </div>

            <header className="p-6 border-b border-white/10 flex-shrink-0 bg-black/20 backdrop-blur-xl flex items-center justify-between sticky top-0 z-10">
                <div>
                    <h1 className="text-2xl font-bold text-white">Analytics</h1>
                    <p className="text-white/50">Métricas e insights para otimizar sua operação.</p>
                </div>
                <div className='flex items-center gap-2'>
                    <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
                        <SelectTrigger className="w-[180px] bg-white/5 border-white/10 text-white">
                            <Calendar className='mr-2 h-4 w-4 text-white/70' />
                            <SelectValue placeholder="Selecione o período" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-white/10 text-white">
                            <SelectItem value="last_30_days">Últimos 30 dias</SelectItem>
                            <SelectItem value="last_7_days">Últimos 7 dias</SelectItem>
                            <SelectItem value="today">Hoje</SelectItem>
                            <SelectItem value="this_month">Este mês</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                        <SelectTrigger className="w-[220px] bg-white/5 border-white/10 text-white">
                            <Users2 className='mr-2 h-4 w-4 text-white/70' />
                            <SelectValue placeholder="Filtrar por setor" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-white/10 text-white">
                            <SelectItem value="all">Todos os Setores</SelectItem>
                            {teams.map(team => (
                                <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={selectedAgentId} onValueChange={setSelectedAgentId} disabled={filteredMembers.length === 0 && selectedTeamId !== 'all'}>
                        <SelectTrigger className="w-[220px] bg-white/5 border-white/10 text-white">
                            <Filter className='mr-2 h-4 w-4 text-white/70' />
                            <SelectValue placeholder="Filtrar por atendente" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-white/10 text-white">
                            <SelectItem value="all">Todos da Equipe</SelectItem>
                            {filteredMembers.map(member => (
                                <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white"><FileDown className="mr-2 h-4 w-4" /> Exportar</Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6 space-y-6 z-10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">

                <section>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                        <StatCard loading={isPending} title="Total de Conversas" value={analyticsData?.totalConversations?.toLocaleString() || '0'} change="+15.2%" changeType="increase" icon={MessageSquare} />
                        <StatCard loading={isPending} title="Novos Contatos" value={analyticsData?.newContacts?.toLocaleString() || '0'} change="+8.1%" changeType="increase" icon={Users} />
                        <StatCard loading={isPending} title="Tempo Médio de Resposta" value={analyticsData?.avgFirstResponseTime || 'N/A'} change="-5.6%" changeType="decrease" icon={Clock} />
                        <StatCard loading={isPending} title="Taxa de Resolução (FCR)" value={`${analyticsData?.firstContactResolutionRate.toFixed(1) || '0.0'}%`} change="+1.2%" changeType="increase" icon={CheckCircle} />
                        <StatCard loading={isPending} title="CSAT" value={'94.2%'} change="+0.5%" changeType="increase" icon={Smile} />
                    </div>
                </section>

                <section className="grid md:grid-cols-3 gap-6">
                    <Card className="col-span-2 bg-black/40 border-white/10 backdrop-blur-md text-white">
                        <CardHeader>
                            <CardTitle className="text-white">Volume de Conversas por Hora</CardTitle>
                            <CardDescription className="text-white/50">Picos de atendimento durante o dia.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                            {isPending ? <Skeleton className="h-full w-full bg-white/10" /> : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={conversationsByHour} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                                        <XAxis dataKey="hour" fontSize={12} tickLine={false} axisLine={false} stroke="rgba(255,255,255,0.5)" />
                                        <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="rgba(255,255,255,0.5)" />
                                        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#000', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }} />
                                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                    <Card className="bg-black/40 border-white/10 backdrop-blur-md text-white">
                        <CardHeader>
                            <CardTitle className="text-white">Canais Mais Usados</CardTitle>
                            <CardDescription className="text-white/50">Distribuição do volume por canal de entrada.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                            {isPending ? <Skeleton className="h-full w-full bg-white/10" /> : (
                                <div className="h-full flex flex-col">
                                    <div className="flex-1 min-h-[200px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={channelsData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    outerRadius={80}
                                                    innerRadius={60}
                                                    stroke="none"
                                                    paddingAngle={5}
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
                                                                <div className="bg-black/90 border border-white/10 p-2 rounded text-xs text-white">
                                                                    <span className="font-semibold">{data.name}</span>: {data.value}
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="px-4 pb-4 space-y-3">
                                        {channelsData.map((channel) => {
                                            const total = channelsData.reduce((acc, curr) => acc + curr.value, 0);
                                            const percent = total > 0 ? ((channel.value / total) * 100).toFixed(1) : "0.0";

                                            let Icon = MessageCircle;
                                            if (channel.name === 'Instagram') Icon = Instagram;
                                            if (channel.name === 'Messenger') Icon = Facebook;

                                            return (
                                                <div key={channel.name} className="flex items-center justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className="p-1.5 rounded-full bg-white/5">
                                                            <Icon size={14} style={{ color: channel.color }} />
                                                        </div>
                                                        <span className="text-white/70">{channel.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-white font-medium">{percent}%</span>
                                                        <span className="text-white/40 text-xs text-right min-w-[30px]">{channel.value}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </section>

                <section>
                    <Card className="bg-black/40 border-white/10 backdrop-blur-md text-white">
                        <CardHeader>
                            <CardTitle className="text-white">
                                {selectedAgentId !== 'all'
                                    ? `Performance de: ${allMembers.find(m => m.id === selectedAgentId)?.name}`
                                    : `Performance dos Atendentes`
                                }
                            </CardTitle>
                            <CardDescription className="text-white/50">
                                {selectedAgentId !== 'all'
                                    ? "Análise detalhada da performance individual."
                                    : selectedTeamId === 'all'
                                        ? "Ranking de performance da equipe de atendimento."
                                        : `Ranking da equipe: ${teams.find(t => t.id === selectedTeamId)?.name}`
                                }
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <AgentPerformanceTable performance={performanceToDisplay} loading={isPending} />
                        </CardContent>
                    </Card>
                </section>

                <div className="grid md:grid-cols-2 gap-6">
                    <section>
                        <Card className='h-full bg-black/40 border-white/10 backdrop-blur-md text-white'>
                            <CardHeader>
                                <CardTitle className='flex items-center gap-2 text-white'><Bot /> Eficiência do Piloto Automático</CardTitle>
                                <CardDescription className="text-white/50">Como a automação está impactando seu atendimento.</CardDescription>
                            </CardHeader>
                            <CardContent className='space-y-4'>
                                <p className="text-sm text-white/30 text-center pt-8">Dados de automação estarão disponíveis em breve.</p>
                            </CardContent>
                        </Card>
                    </section>
                    <section>
                        <Card className='h-full bg-black/40 border-white/10 backdrop-blur-md text-white'>
                            <CardHeader>
                                <CardTitle className='flex items-center gap-2 text-white'><TrendingUp /> Conversões e Oportunidades</CardTitle>
                                <CardDescription className="text-white/50">O impacto das conversas nos seus resultados de negócio.</CardDescription>
                            </CardHeader>
                            <CardContent className='space-y-4'>
                                <p className="text-sm text-white/30 text-center pt-8">Métricas de conversão estarão disponíveis em breve.</p>
                            </CardContent>
                        </Card>
                    </section>
                </div>
            </main>
        </div>
    );
}
