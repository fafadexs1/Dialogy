'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Search, Filter, MoreVertical, MessageSquare, Clock, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useState, useEffect } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getTickets } from '@/actions/support';

// Mock data (fallback) -> Start empty to not confuse user
const initialMockTickets: any[] = [];

const statusMap: Record<string, { label: string; color: string; icon: any; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    open: { label: 'Aberto', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20', icon: AlertCircle, variant: 'outline' },
    in_progress: { label: 'Em Andamento', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20', icon: Clock, variant: 'outline' },
    closed: { label: 'Resolvido', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2, variant: 'outline' },
};

const priorityMap: Record<string, { label: string; color: string }> = {
    low: { label: 'Baixa', color: 'text-zinc-500' },
    medium: { label: 'Média', color: 'text-amber-500' },
    high: { label: 'Alta', color: 'text-red-500' },
    critical: { label: 'Crítica', color: 'text-red-600 font-bold' },
};

export default function TicketListPage() {
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [tickets, setTickets] = useState(initialMockTickets);
    const [loading, setLoading] = useState(true);

    // Load tickets from server
    useEffect(() => {
        const fetchTickets = async () => {
            try {
                const data = await getTickets();
                setTickets(data || []);
            } catch (error) {
                console.error("Failed to load tickets", error);
            } finally {
                setLoading(false);
            }
        };
        fetchTickets();
    }, []);

    const filteredTickets = tickets.filter(ticket => {
        const matchesSearch = ticket.subject.toLowerCase().includes(search.toLowerCase()) || ticket.id.toLowerCase().includes(search.toLowerCase());
        const matchesFilter = filter === 'all' || ticket.status === filter;
        return matchesSearch && matchesFilter;
    });

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
        },
        exit: { opacity: 0, height: 0, marginBottom: 0 }
    };

    return (
        <div className="h-full flex flex-col bg-muted/30 p-6 md:p-8">
            <div className="w-full max-w-[1600px] mx-auto space-y-8 flex-1">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <Link href="/support">
                            <Button variant="ghost" size="icon" className="rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground">Meus Tickets</h1>
                            <p className="text-muted-foreground">Gerencie e acompanhe suas solicitações de suporte.</p>
                        </div>
                    </div>
                    <Link href="/support/tickets/new">
                        <Button className="bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Novo Ticket
                        </Button>
                    </Link>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card p-2 rounded-2xl border shadow-sm">
                    <div className="flex gap-2 p-1 bg-muted/50 rounded-xl">
                        {['all', 'open', 'closed'].map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === f
                                    ? 'bg-background shadow text-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                                    }`}
                            >
                                {f === 'all' ? 'Todos' : f === 'open' ? 'Abertos' : 'Resolvidos'}
                            </button>
                        ))}
                    </div>

                    <div className="relative flex-1 max-w-md w-full">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por ID ou assunto..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 bg-transparent border-transparent focus-visible:ring-0 placeholder:text-muted-foreground/50"
                        />
                    </div>
                </div>

                {/* Ticket List */}
                <AnimatePresence mode='popLayout'>
                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                        className="space-y-3"
                    >
                        {filteredTickets.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-center py-20"
                            >
                                <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                                    <Search className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-lg font-medium text-foreground">Nenhum ticket encontrado</h3>
                                <p className="text-muted-foreground">Tente ajustar seus filtros de busca.</p>
                            </motion.div>
                        ) : (
                            filteredTickets.map((ticket) => {
                                const status = statusMap[ticket.status] || statusMap.open;
                                const priority = priorityMap[ticket.priority] || priorityMap.low;
                                const StatusIcon = status.icon;

                                return (
                                    <motion.div key={ticket.id} variants={itemVariants} layout>
                                        <Link href={`/support/tickets/${ticket.id}`} className="block">
                                            <Card className="hover:border-primary/40 hover:shadow-md transition-all duration-300 cursor-pointer border-border bg-card group overflow-hidden relative">
                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                                <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                    <div className="flex items-start gap-4">
                                                        <div className={`mt-1 p-2.5 rounded-xl ${status.color.replace('border-', '')} bg-opacity-10`}>
                                                            <StatusIcon className="h-5 w-5" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-3 mb-1">
                                                                <span className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors">
                                                                    {ticket.subject}
                                                                </span>
                                                                <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground bg-muted/50">
                                                                    {ticket.id}
                                                                </Badge>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-sm text-muted-foreground">
                                                                <span className="flex items-center gap-1.5">
                                                                    Prioridade <span className={`font-medium ${priority.color}`}>{priority.label}</span>
                                                                </span>
                                                                <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                                                                <span className="capitalize">{ticket.category}</span>
                                                                <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="h-3 w-3" /> {ticket.lastUpdate}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between md:justify-end gap-4 pl-14 md:pl-0">
                                                        <Badge className={status.color}>
                                                            {status.label}
                                                        </Badge>
                                                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    </motion.div>
                                );
                            })
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}
