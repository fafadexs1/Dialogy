'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Search, Filter, MoreVertical, MessageSquare, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Mock data
const mockTickets = [
    {
        id: 'TKT-1024',
        subject: 'Erro ao integrar WhatsApp Baileys',
        status: 'open',
        priority: 'high',
        category: 'technical',
        lastUpdate: 'Há 2 horas',
        createdAt: '2024-05-20T10:00:00Z',
    },
    {
        id: 'TKT-1023',
        subject: 'Dúvida sobre faturamento',
        status: 'closed',
        priority: 'medium',
        category: 'billing',
        lastUpdate: 'Há 1 dia',
        createdAt: '2024-05-19T14:30:00Z',
    },
    {
        id: 'TKT-1022',
        subject: 'Sugestão: Modo escuro automático',
        status: 'in_progress',
        priority: 'low',
        category: 'feature',
        lastUpdate: 'Há 3 dias',
        createdAt: '2024-05-18T09:15:00Z',
    },
];

const statusMap: Record<string, { label: string; color: string; icon: any }> = {
    open: { label: 'Aberto', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', icon: AlertCircle },
    in_progress: { label: 'Em Andamento', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20', icon: Clock },
    closed: { label: 'Resolvido', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', icon: CheckCircle2 },
};

const priorityMap: Record<string, { label: string; color: string }> = {
    low: { label: 'Baixa', color: 'text-zinc-500' },
    medium: { label: 'Média', color: 'text-amber-500' },
    high: { label: 'Alta', color: 'text-red-500' },
    critical: { label: 'Crítica', color: 'text-red-600 font-bold' },
};

export default function TicketListPage() {
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05
            }
        }
    };

    const itemVariants = {
        hidden: { y: 10, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1
        }
    };

    return (
        <div className="flex-1 p-8 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <Link href="/support">
                            <Button variant="ghost" size="icon" className="rounded-full">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Meus Tickets</h1>
                            <p className="text-muted-foreground">Gerencie suas solicitações de suporte.</p>
                        </div>
                    </div>
                    <Link href="/support/tickets/new">
                        <Button className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white shadow-lg shadow-blue-500/20">
                            Novo Ticket
                        </Button>
                    </Link>
                </div>

                {/* Filters */}
                <div className="flex gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar tickets..."
                            className="pl-10 bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
                        />
                    </div>
                    <Button variant="outline" className="gap-2 bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800">
                        <Filter className="h-4 w-4" />
                        Filtrar
                    </Button>
                </div>

                {/* Ticket List */}
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-4"
                >
                    {mockTickets.map((ticket) => {
                        const status = statusMap[ticket.status];
                        const priority = priorityMap[ticket.priority];
                        const StatusIcon = status.icon;

                        return (
                            <motion.div key={ticket.id} variants={itemVariants}>
                                <Link href={`/support/tickets/${ticket.id}`}>
                                    <Card className="hover:shadow-md transition-all duration-200 cursor-pointer border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 group">
                                        <CardContent className="p-6 flex items-center justify-between">
                                            <div className="flex items-start gap-4">
                                                <div className={`p-2 rounded-full ${status.color.split(' ')[0]}`}>
                                                    <StatusIcon className={`h-5 w-5 ${status.color.split(' ')[1]}`} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-semibold text-lg group-hover:text-blue-600 transition-colors">
                                                            {ticket.subject}
                                                        </span>
                                                        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                                                            {ticket.id}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                        <span className="flex items-center gap-1">
                                                            Prioridade: <span className={priority.color}>{priority.label}</span>
                                                        </span>
                                                        <span>•</span>
                                                        <span>{ticket.category}</span>
                                                        <span>•</span>
                                                        <span>Atualizado {ticket.lastUpdate}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                <Badge className={`${status.color} border hover:bg-opacity-20`}>
                                                    {status.label}
                                                </Badge>
                                                <Button variant="ghost" size="icon" className="text-muted-foreground">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </motion.div>
                        );
                    })}
                </motion.div>
            </div>
        </div>
    );
}
