
'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
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
    Loader2
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
import type { AnalyticsData, AgentPerformance, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

// Componente de Cartão de Estatística
const StatCard = ({ title, value, change, changeType, icon: Icon, loading }: any) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
        {loading ? (
            <Skeleton className="h-10 w-3/4" />
        ) : (
            <>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                    {changeType === 'increase' ? 
                    <span className="flex items-center text-emerald-500"><ArrowUpRight className="h-3 w-3" /> {change}</span> :
                    <span className="flex items-center text-red-500"><ArrowDownRight className="h-3 w-3" /> {change}</span>
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
    <Table>
        <TableHeader>
            <TableRow>
                <TableHead>Pos.</TableHead>
                <TableHead>Atendente</TableHead>
                <TableHead className='text-center'>Atendimentos</TableHead>
                <TableHead className='text-center'>Resolvidos</TableHead>
                <TableHead className='text-center'>Tempo Médio Resposta</TableHead>
                <TableHead className='text-center'>Avaliação Média</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-10" /></TableCell>
                    </TableRow>
                ))
            ) : (
                performance.map((agent, index) => (
                <TableRow key={agent.agent_id}>
                    <TableCell>
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted font-bold">
                            {index === 0 && <Award className="h-5 w-5 text-amber-400" />}
                            {index === 1 && <Award className="h-5 w-5 text-slate-400" />}
                            {index === 2 && <Award className="h-5 w-5 text-amber-600" />}
                            {index > 2 && (index + 1)}
                        </div>
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-3">
                            <Avatar>
                                <AvatarImage src={agent.avatar_url} alt={agent.agent_name} />
                                <AvatarFallback>{agent.agent_name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{agent.agent_name}</span>
                        </div>
                    </TableCell>
                    <TableCell className='text-center font-semibold text-lg'>{agent.total_chats}</TableCell>
                    <TableCell className='text-center'>{agent.resolved_chats}</TableCell>
                    <TableCell className='text-center'>{agent.avg_first_response_time || 'N/A'}</TableCell>
                    <TableCell className='text-center font-semibold text-lg text-primary'>{agent.avg_rating || 'N/A'}</TableCell>
                </TableRow>
            )))}
        </TableBody>
    </Table>
);

const channelsData = [
  { name: 'WhatsApp', value: 100, color: '#25D366' },
];

// Página Principal de Analytics
export default function AnalyticsPage() {
  const user = useAuth();
  const [isPending, startTransition] = useTransition();
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [agentPerformance, setAgentPerformance] = useState<AgentPerformance[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  
  const fetchPageData = useCallback((workspaceId: string, agentId?: string) => {
    startTransition(async () => {
        const [data, performance] = await Promise.all([
             getAnalyticsData(workspaceId, agentId),
             getAgentPerformance(workspaceId)
        ]);
        if(data) setAnalyticsData(data);
        if(performance) setAgentPerformance(performance);
    });
  }, []);

  useEffect(() => {
    if (user?.activeWorkspaceId) {
        fetchPageData(user.activeWorkspaceId, selectedAgentId === 'all' ? undefined : selectedAgentId);
        
        getWorkspaceMembers(user.activeWorkspaceId).then(res => {
            if (res.members) setMembers(res.members as User[]);
        });

    }
  }, [user?.activeWorkspaceId, selectedAgentId, fetchPageData]);

  if (!user) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
        </div>
      </MainLayout>
    )
  }
  
  const conversationsByHour = analyticsData?.conversationsByHour || [];

  return (
    <MainLayout>
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 border-b flex-shrink-0 bg-card flex items-center justify-between sticky top-0 z-10">
                <div>
                    <h1 className="text-2xl font-bold">Analytics</h1>
                    <p className="text-muted-foreground">Métricas e insights para otimizar sua operação.</p>
                </div>
                <div className='flex items-center gap-2'>
                    <Select defaultValue='last_30_days'>
                        <SelectTrigger className="w-[180px]">
                            <Calendar className='mr-2 h-4 w-4' />
                            <SelectValue placeholder="Selecione o período" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="last_30_days">Últimos 30 dias</SelectItem>
                            <SelectItem value="last_7_days">Últimos 7 dias</SelectItem>
                            <SelectItem value="today">Hoje</SelectItem>
                            <SelectItem value="this_month" disabled>Este mês</SelectItem>
                        </SelectContent>
                    </Select>
                     <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                        <SelectTrigger className="w-[220px]">
                            <Filter className='mr-2 h-4 w-4' />
                            <SelectValue placeholder="Filtrar por atendente" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Visão Geral (Todos)</SelectItem>
                             {members.map(member => (
                                <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button><FileDown className="mr-2 h-4 w-4" /> Exportar</Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto bg-muted/40 p-6 space-y-6">
                
                <section>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                        <StatCard loading={isPending} title="Total de Conversas" value={analyticsData?.totalConversations.toLocaleString() || '0'} change="+15.2%" changeType="increase" icon={MessageSquare} />
                        <StatCard loading={isPending} title="Novos Contatos" value={analyticsData?.newContacts.toLocaleString() || '0'} change="+8.1%" changeType="increase" icon={Users} />
                        <StatCard loading={isPending} title="Tempo Médio de Resposta" value={analyticsData?.avgFirstResponseTime || 'N/A'} change="-5.6%" changeType="decrease" icon={Clock} />
                        <StatCard loading={isPending} title="Taxa de Resolução (FCR)" value={`${analyticsData?.firstContactResolutionRate.toFixed(1) || '0.0'}%`} change="+1.2%" changeType="increase" icon={CheckCircle} />
                        <StatCard loading={isPending} title="CSAT" value={'94.2%'} change="+0.5%" changeType="increase" icon={Smile} />
                    </div>
                </section>

                <section className="grid md:grid-cols-3 gap-6">
                    <Card className="col-span-2">
                        <CardHeader>
                            <CardTitle>Volume de Conversas por Hora</CardTitle>
                            <CardDescription>Picos de atendimento durante o dia.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                            {isPending ? <Skeleton className="h-full w-full" /> : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={conversationsByHour} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="hour" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}/>
                                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Canais Mais Usados</CardTitle>
                            <CardDescription>Distribuição do volume por canal de entrada.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                           {isPending ? <Skeleton className="h-full w-full" /> : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={channelsData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={60} labelLine={false} label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                                        const radius = innerRadius + (outerRadius - innerRadius) * 1.2;
                                        const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
                                        const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);
                                        return (
                                            <text x={x} y={y} fill="currentColor" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="text-xs font-semibold">
                                            {`${(percent * 100).toFixed(0)}%`}
                                            </text>
                                        );
                                    }}>
                                        {channelsData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                                    </Pie>
                                    <Legend iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                           )}
                        </CardContent>
                    </Card>
                </section>
                
                {selectedAgentId === 'all' && (
                    <section>
                        <Card>
                            <CardHeader>
                                <CardTitle>Performance dos Atendentes</CardTitle>
                                <CardDescription>Ranking de performance da equipe de atendimento.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AgentPerformanceTable performance={agentPerformance} loading={isPending} />
                            </CardContent>
                        </Card>
                    </section>
                )}
                
                 <div className="grid md:grid-cols-2 gap-6">
                    <section>
                         <Card className='h-full'>
                            <CardHeader>
                                <CardTitle className='flex items-center gap-2'><Bot /> Eficiência do Piloto Automático</CardTitle>
                                <CardDescription>Como a automação está impactando seu atendimento.</CardDescription>
                            </CardHeader>
                            <CardContent className='space-y-4'>
                                <p className="text-sm text-muted-foreground text-center pt-8">Dados de automação estarão disponíveis em breve.</p>
                            </CardContent>
                        </Card>
                    </section>
                    <section>
                         <Card className='h-full'>
                            <CardHeader>
                                <CardTitle className='flex items-center gap-2'><TrendingUp/> Conversões e Oportunidades</CardTitle>
                                <CardDescription>O impacto das conversas nos seus resultados de negócio.</CardDescription>
                            </CardHeader>
                             <CardContent className='space-y-4'>
                                <p className="text-sm text-muted-foreground text-center pt-8">Métricas de conversão estarão disponíveis em breve.</p>
                            </CardContent>
                        </Card>
                    </section>
                </div>
            </main>
        </div>
    </MainLayout>
  );
}
