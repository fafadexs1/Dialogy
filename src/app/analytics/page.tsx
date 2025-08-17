
'use client';

import React from 'react';
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
    LineChart,
    Line,
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
    TrendingDown,
    Phone,
    Monitor,
    BrainCircuit,
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
import { Progress } from '@/components/ui/progress';

// Mock Data
const overviewData = {
  totalConversas: { value: '1,284', change: '+15.2%', changeType: 'increase' },
  novosContatos: { value: '312', change: '+8.1%', changeType: 'increase' },
  tempoMedioResposta: { value: '2m 34s', change: '-5.6%', changeType: 'decrease' },
  taxaResolucao: { value: '89.7%', change: '+1.2%', changeType: 'increase' },
  csat: { value: '94.2%', change: '+0.5%', changeType: 'increase' }
};

const conversationsByHour = [
  { name: '0-2h', volume: 10 }, { name: '2-4h', volume: 5 }, { name: '4-6h', volume: 8 },
  { name: '6-8h', volume: 22 }, { name: '8-10h', volume: 75 }, { name: '10-12h', volume: 110 },
  { name: '12-14h', volume: 90 }, { name: '14-16h', volume: 125 }, { name: '16-18h', volume: 105 },
  { name: '18-20h', volume: 60 }, { name: '20-22h', volume: 30 }, { name: '22-24h', volume: 15 },
];

const channelsData = [
  { name: 'WhatsApp', value: 65, color: '#25D366' },
  { name: 'Website Chat', value: 20, color: '#3b82f6' },
  { name: 'Telegram', value: 15, color: '#229ED9' },
];

const agentPerformance = [
  { id: 1, name: 'Alex Johnson', avatar: 'https://placehold.co/40x40.png', attended: 125, responseTime: '1m 45s', resolved: 118, rating: 4.9 },
  { id: 2, name: 'Maria Garcia', avatar: 'https://placehold.co/40x40.png', attended: 110, responseTime: '2m 10s', resolved: 98, rating: 4.8 },
  { id: 3, name: 'David Smith', avatar: 'https://placehold.co/40x40.png', attended: 98, responseTime: '3m 02s', resolved: 85, rating: 4.7 },
  { id: 4, name: 'Sophia Brown', avatar: 'https://placehold.co/40x40.png', attended: 85, responseTime: '2m 55s', resolved: 78, rating: 4.6 },
];

const botEfficiencyData = {
    resolutionRate: 72,
    topQuestions: ['Qual o preço?', 'Como funciona a devolução?', 'Fale com um atendente'],
    topDropoffs: ['Seleção de departamento', 'Confirmação de dados', 'Aguardando na fila'],
};

const leadsData = {
    leadsGenerated: 128,
    conversionRate: 12.5,
    topProducts: ['Plano Pro', 'Consultoria Premium', 'API Access'],
    topLossReasons: ['Preço alto', 'Falta de funcionalidade X', 'Concorrente Y'],
}

// Components
const StatCard = ({ title, value, change, changeType, icon: Icon }: any) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {changeType === 'increase' ? 
          <span className="flex items-center text-emerald-500"><ArrowUpRight className="h-3 w-3" /> {change}</span> :
          <span className="flex items-center text-red-500"><ArrowDownRight className="h-3 w-3" /> {change}</span>
        }
        em relação ao período anterior
      </p>
    </CardContent>
  </Card>
);

const AgentPerformanceTable = () => (
    <Table>
        <TableHeader>
            <TableRow>
                <TableHead>Pos.</TableHead>
                <TableHead>Atendente</TableHead>
                <TableHead className='text-center'>Atendimentos</TableHead>
                <TableHead className='text-center'>Tempo Médio Resposta</TableHead>
                <TableHead className='text-center'>Conversas Finalizadas</TableHead>
                <TableHead className='text-center'>Avaliação Média</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            {agentPerformance.map((agent, index) => (
                <TableRow key={agent.id}>
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
                                <AvatarImage src={agent.avatar} alt={agent.name} />
                                <AvatarFallback>{agent.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{agent.name}</span>
                        </div>
                    </TableCell>
                    <TableCell className='text-center font-semibold text-lg'>{agent.attended}</TableCell>
                    <TableCell className='text-center'>{agent.responseTime}</TableCell>
                    <TableCell className='text-center'>{agent.resolved}</TableCell>
                    <TableCell className='text-center font-semibold text-lg text-primary'>{agent.rating}</TableCell>
                </TableRow>
            ))}
        </TableBody>
    </Table>
)

export default function AnalyticsPage() {
  const user = useAuth();
  
  if (!user) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
        </div>
      </MainLayout>
    )
  }

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
                            <SelectItem value="today">Hoje</SelectItem>
                            <SelectItem value="last_7_days">Últimos 7 dias</SelectItem>
                            <SelectItem value="last_30_days">Últimos 30 dias</SelectItem>
                            <SelectItem value="this_month">Este mês</SelectItem>
                            <SelectItem value="custom">Personalizado</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline"><Filter className="mr-2 h-4 w-4" /> Filtros</Button>
                    <Button><FileDown className="mr-2 h-4 w-4" /> Exportar</Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto bg-muted/40 p-6 space-y-6">
                
                {/* 1. Visão Geral */}
                <section>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                        <StatCard title="Total de Conversas" value={overviewData.totalConversas.value} change={overviewData.totalConversas.change} changeType={overviewData.totalConversas.changeType} icon={MessageSquare} />
                        <StatCard title="Novos Contatos" value={overviewData.novosContatos.value} change={overviewData.novosContatos.change} changeType={overviewData.novosContatos.changeType} icon={Users} />
                        <StatCard title="Tempo Médio de Resposta" value={overviewData.tempoMedioResposta.value} change={overviewData.tempoMedioResposta.change} changeType={overviewData.tempoMedioResposta.changeType} icon={Clock} />
                        <StatCard title="Taxa de Resolução (FCR)" value={overviewData.taxaResolucao.value} change={overviewData.taxaResolucao.change} changeType={overviewData.taxaResolucao.changeType} icon={CheckCircle} />
                        <StatCard title="CSAT" value={overviewData.csat.value} change={overviewData.csat.change} changeType={overviewData.csat.changeType} icon={Smile} />
                    </div>
                </section>

                {/* 2. Volume de Conversas */}
                <section className="grid md:grid-cols-3 gap-6">
                    <Card className="col-span-2">
                        <CardHeader>
                            <CardTitle>Volume de Conversas por Hora</CardTitle>
                            <CardDescription>Picos de atendimento durante o dia.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={conversationsByHour} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}/>
                                    <Bar dataKey="volume" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Canais Mais Usados</CardTitle>
                            <CardDescription>Distribuição do volume por canal de entrada.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px]">
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
                        </CardContent>
                    </Card>
                </section>

                {/* 3. Performance de Atendentes */}
                <section>
                    <Card>
                        <CardHeader>
                            <CardTitle>Performance dos Atendentes</CardTitle>
                            <CardDescription>Ranking de performance da equipe de atendimento.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <AgentPerformanceTable />
                        </CardContent>
                    </Card>
                </section>

                <div className="grid md:grid-cols-2 gap-6">
                    {/* 4. Eficiência do Bot */}
                    <section>
                         <Card className='h-full'>
                            <CardHeader>
                                <CardTitle className='flex items-center gap-2'><Bot /> Eficiência do Piloto Automático</CardTitle>
                                <CardDescription>Como a automação está impactando seu atendimento.</CardDescription>
                            </CardHeader>
                            <CardContent className='space-y-4'>
                                <div>
                                    <div className='flex justify-between items-center mb-1'>
                                        <h4 className='font-semibold'>Taxa de Resolução sem Intervenção</h4>
                                        <span className='font-bold text-primary text-lg'>{botEfficiencyData.resolutionRate}%</span>
                                    </div>
                                    <Progress value={botEfficiencyData.resolutionRate} />
                                </div>
                                <div className='space-y-2'>
                                    <h4 className='font-semibold'>Questões mais respondidas pelo bot:</h4>
                                    <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
                                        {botEfficiencyData.topQuestions.map(q => <li key={q}>{q}</li>)}
                                    </ul>
                                </div>
                                 <div className='space-y-2'>
                                    <h4 className='font-semibold'>Principais pontos de abandono do fluxo:</h4>
                                    <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
                                        {botEfficiencyData.topDropoffs.map(d => <li key={d}>{d}</li>)}
                                    </ul>
                                </div>
                            </CardContent>
                        </Card>
                    </section>
                    {/* 5. Conversões e Oportunidades */}
                    <section>
                         <Card className='h-full'>
                            <CardHeader>
                                <CardTitle className='flex items-center gap-2'><TrendingUp/> Conversões e Oportunidades</CardTitle>
                                <CardDescription>O impacto das conversas nos seus resultados de negócio.</CardDescription>
                            </CardHeader>
                            <CardContent className='space-y-4'>
                               <div className='grid grid-cols-2 gap-4'>
                                    <div className='bg-muted p-3 rounded-lg'>
                                        <p className='text-sm text-muted-foreground'>Leads Gerados</p>
                                        <p className='text-2xl font-bold'>{leadsData.leadsGenerated}</p>
                                    </div>
                                    <div className='bg-muted p-3 rounded-lg'>
                                        <p className='text-sm text-muted-foreground'>Taxa de Conversão</p>
                                        <p className='text-2xl font-bold'>{leadsData.conversionRate}%</p>
                                    </div>
                               </div>
                                <div className='space-y-2'>
                                    <h4 className='font-semibold'>Produtos/Serviços mais citados:</h4>
                                    <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
                                        {leadsData.topProducts.map(p => <li key={p}>{p}</li>)}
                                    </ul>
                                </div>
                                 <div className='space-y-2'>
                                    <h4 className='font-semibold'>Principais motivos de perda:</h4>
                                    <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
                                        {leadsData.topLossReasons.map(r => <li key={r}>{r}</li>)}
                                    </ul>
                                </div>
                            </CardContent>
                        </Card>
                    </section>
                </div>

            </main>
        </div>
    </MainLayout>
  );
}
