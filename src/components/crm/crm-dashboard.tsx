'use client';

import React, { useMemo } from 'react';
import { Contact, Tag } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie } from 'recharts';
import { Users, UserPlus, TrendingUp, Activity } from 'lucide-react';
import { format, subDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CrmDashboardProps {
    contacts: Contact[];
    tags: Tag[];
}

export default function CrmDashboard({ contacts, tags }: CrmDashboardProps) {

    const metrics = useMemo(() => {
        const totalContacts = contacts.length;
        const newContactsThisWeek = contacts.filter(c =>
            c.created_at && isAfter(new Date(c.created_at), subDays(new Date(), 7))
        ).length;

        // Calculate contacts per stage
        // Assuming stages are tags with specific values as defined in Kanban
        const stages = ['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
        const stageCounts = stages.map(stage => {
            const count = contacts.filter(c => c.tags?.some(t => t.value === stage)).length;
            // Fallback for 'novo' if no stage tag is present
            if (stage === 'novo') {
                const noStageCount = contacts.filter(c => !c.tags?.some(t => stages.includes(t.value))).length;
                return { name: stage, count: count + noStageCount };
            }
            return { name: stage, count };
        });

        // Recent activities (mocked extraction from contacts for now as we don't have a direct activity feed prop yet)
        // In a real scenario, we would fetch activities separately or extract them from all contacts
        const allActivities = contacts.flatMap(c =>
            (c.activities || []).map(a => ({ ...a, contactName: c.name, contactAvatar: c.avatar_url }))
        ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

        return {
            totalContacts,
            newContactsThisWeek,
            stageCounts,
            recentActivities: allActivities
        };
    }, [contacts]);

    const stageColors: Record<string, string> = {
        novo: '#3b82f6',
        qualificado: '#eab308',
        proposta: '#a855f7',
        negociacao: '#f97316',
        ganho: '#22c55e',
        perdido: '#ef4444'
    };

    const stageLabels: Record<string, string> = {
        novo: 'Novo',
        qualificado: 'Qualificado',
        proposta: 'Proposta',
        negociacao: 'Negociação',
        ganho: 'Ganho',
        perdido: 'Perdido'
    };

    return (
        <div className="p-6 space-y-6 bg-muted/30 h-full overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Contatos</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.totalContacts}</div>
                        <p className="text-xs text-muted-foreground">Base total de clientes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Novos (7 dias)</CardTitle>
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.newContactsThisWeek}</div>
                        <p className="text-xs text-muted-foreground">
                            +{((metrics.newContactsThisWeek / (metrics.totalContacts || 1)) * 100).toFixed(1)}% da base
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Em Negociação</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {metrics.stageCounts.find(s => s.name === 'negociacao')?.count || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">Oportunidades ativas</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {(() => {
                                const won = metrics.stageCounts.find(s => s.name === 'ganho')?.count || 0;
                                const lost = metrics.stageCounts.find(s => s.name === 'perdido')?.count || 0;
                                const totalClosed = won + lost;
                                return totalClosed > 0 ? `${((won / totalClosed) * 100).toFixed(1)}%` : '0%';
                            })()}
                        </div>
                        <p className="text-xs text-muted-foreground">Ganho vs Perdido</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="col-span-1">
                    <CardHeader>
                        <CardTitle>Funil de Vendas</CardTitle>
                        <CardDescription>Distribuição de contatos por fase</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={metrics.stageCounts} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                <XAxis type="number" hide />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    tickFormatter={(value) => stageLabels[value] || value}
                                    width={100}
                                    tick={{ fontSize: 12 }}
                                />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                                    formatter={(value: number) => [value, 'Contatos']}
                                    labelFormatter={(label) => stageLabels[label] || label}
                                />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={32}>
                                    {metrics.stageCounts.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={stageColors[entry.name] || '#8884d8'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="col-span-1">
                    <CardHeader>
                        <CardTitle>Atividades Recentes</CardTitle>
                        <CardDescription>Últimas interações registradas</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {metrics.recentActivities.length > 0 ? (
                                metrics.recentActivities.map((activity, i) => (
                                    <div key={i} className="flex items-start gap-4 pb-4 border-b border-border last:border-0 last:pb-0">
                                        <div className="w-2 h-2 mt-2 rounded-full bg-primary shrink-0" />
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium leading-none">
                                                {activity.type === 'ligacao' && 'Ligação para '}
                                                {activity.type === 'whatsapp' && 'WhatsApp para '}
                                                {activity.type === 'email' && 'Email para '}
                                                {activity.type === 'nota' && 'Nota sobre '}
                                                <span className="text-primary">{activity.contactName}</span>
                                            </p>
                                            <p className="text-xs text-muted-foreground line-clamp-2">
                                                {activity.notes}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground/60">
                                                {format(new Date(activity.date), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center text-sm text-muted-foreground py-8">
                                    Nenhuma atividade recente encontrada.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
