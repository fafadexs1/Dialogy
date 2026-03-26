'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Search, MoreVertical, Clock, CheckCircle2, AlertCircle, Plus, Filter, User, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useEffect, useMemo, useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteTicket, getTicketsWithPermissions, type SupportTicket, type TicketStatus, updateTicketStatus } from '@/actions/support';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const statusMap: Record<string, { label: string; color: string; icon: any; bg: string }> = {
    open: {
        label: 'Aberto',
        color: 'text-blue-400',
        bg: 'bg-blue-400/10 border-blue-400/20',
        icon: AlertCircle
    },
    in_progress: {
        label: 'Em andamento',
        color: 'text-amber-400',
        bg: 'bg-amber-400/10 border-amber-400/20',
        icon: Clock
    },
    closed: {
        label: 'Resolvido',
        color: 'text-emerald-400',
        bg: 'bg-emerald-400/10 border-emerald-400/20',
        icon: CheckCircle2
    },
};

const priorityMap: Record<string, { label: string; color: string }> = {
    low: { label: 'Baixa', color: 'text-slate-500' },
    medium: { label: 'Media', color: 'text-amber-400' },
    high: { label: 'Alta', color: 'text-orange-400' },
    critical: { label: 'Critica', color: 'text-red-400 font-bold' },
};

function formatLastUpdate(ticket: SupportTicket): string {
    const value = ticket.updated_at || ticket.created_at;
    if (!value) return 'Sem atualizacao';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sem atualizacao';

    return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
}

export default function TicketListPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'closed'>('all');
    const [search, setSearch] = useState('');
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSuperAdmin, setIsSuperAdmin] = useState(false);
    const [isMutatingTicketId, setIsMutatingTicketId] = useState<string | null>(null);

    useEffect(() => {
        const fetchTickets = async () => {
            try {
                const payload = await getTicketsWithPermissions();
                setTickets((payload?.tickets || []) as SupportTicket[]);
                setIsSuperAdmin(Boolean(payload?.isSuperAdmin));
            } catch (error) {
                console.error('Failed to load tickets', error);
                toast({
                    title: 'Erro ao carregar tickets',
                    description: 'Nao foi possivel carregar os tickets.',
                    variant: 'destructive',
                });
            } finally {
                setLoading(false);
            }
        };

        fetchTickets();
    }, [toast]);

    const filterOptions = useMemo<Array<{ value: 'all' | 'open' | 'in_progress' | 'closed'; label: string }>>(
        () => [
            { value: 'all', label: 'Todos' },
            { value: 'open', label: 'Abertos' },
            { value: 'in_progress', label: 'Em andamento' },
            { value: 'closed', label: 'Resolvidos' }
        ],
        []
    );

    const filteredTickets = useMemo(() => {
        return tickets.filter((ticket) => {
            const subject = String(ticket.subject || '').toLowerCase();
            const id = String(ticket.id || '').toLowerCase();
            const requester = String(ticket.requester?.display_name || '').toLowerCase();
            const responder = String(ticket.last_staff_reply?.display_name || '').toLowerCase();
            const query = search.toLowerCase();
            const matchesSearch =
                subject.includes(query) ||
                id.includes(query) ||
                requester.includes(query) ||
                responder.includes(query);
            const matchesFilter = filter === 'all' || ticket.status === filter;
            return matchesSearch && matchesFilter;
        });
    }, [tickets, search, filter]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
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
        exit: { opacity: 0, scale: 0.95 },
    };

    async function handleStatusChange(ticketId: string, status: TicketStatus) {
        if (!isSuperAdmin) return;

        setIsMutatingTicketId(ticketId);
        const result = await updateTicketStatus(ticketId, status);
        setIsMutatingTicketId(null);

        if (!result.success) {
            toast({
                title: 'Falha ao atualizar ticket',
                description: result.error || 'Nao foi possivel atualizar o status.',
                variant: 'destructive',
            });
            return;
        }

        setTickets((prev) => {
            return prev.map((ticket) =>
                ticket.id === ticketId
                    ? { ...ticket, status, updated_at: new Date().toISOString() }
                    : ticket
            );
        });

        toast({
            title: 'Status atualizado',
            description: 'O ticket foi atualizado com sucesso.',
        });
    }

    async function handleDelete(ticketId: string) {
        if (!isSuperAdmin) return;

        const confirmed = window.confirm('Deseja realmente excluir este ticket? Esta acao nao pode ser desfeita.');
        if (!confirmed) return;

        setIsMutatingTicketId(ticketId);
        const result = await deleteTicket(ticketId);
        setIsMutatingTicketId(null);

        if (!result.success) {
            toast({
                title: 'Falha ao excluir ticket',
                description: result.error || 'Nao foi possivel excluir o ticket.',
                variant: 'destructive',
            });
            return;
        }

        setTickets((prev) => prev.filter((ticket) => ticket.id !== ticketId));
        toast({
            title: 'Ticket excluido',
            description: 'O ticket foi removido com sucesso.',
        });
    }

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="absolute left-[10%] top-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
                <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
            </div>

            <div className="relative z-10 mx-auto w-full max-w-[1600px] space-y-8 p-4 md:p-8">
                <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                    <div className="flex items-center gap-4">
                        <Link href="/support">
                            <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl border border-slate-200 bg-white text-slate-500 transition-all hover:scale-105 hover:bg-slate-50 hover:text-slate-950">
                                <ArrowLeft className="h-6 w-6" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                                {isSuperAdmin ? 'Gestao de Tickets' : 'Meus Tickets'}
                            </h1>
                            <p className="mt-1 text-slate-500">
                                {isSuperAdmin
                                    ? 'Visualize e administre todas as solicitacoes de suporte.'
                                    : 'Acompanhe o status e historico das suas solicitacoes.'}
                            </p>
                        </div>
                    </div>
                    <Link href="/support/tickets/new">
                        <Button className="h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 hover:shadow-emerald-500/30">
                            <Plus className="mr-2 h-5 w-5" /> Novo Ticket
                        </Button>
                    </Link>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.14)] md:flex-row"
                >
                    <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 no-scrollbar md:w-auto">
                        {filterOptions.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setFilter(opt.value)}
                                className={`
                                    relative whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all
                                    ${filter === opt.value
                                        ? 'text-slate-950'
                                        : 'text-slate-500 hover:bg-slate-200 hover:text-slate-900'
                                    }
                                `}
                            >
                                {filter === opt.value && (
                                    <motion.div
                                        layoutId="activeFilter"
                                        className="absolute inset-0 rounded-lg bg-white shadow-sm"
                                        initial={false}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">{opt.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="relative w-full max-w-md flex-1">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Search className="h-4 w-4 text-slate-400" />
                        </div>
                        <Input
                            placeholder="Buscar por ID, assunto ou usuario..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-slate-900 placeholder:text-slate-400 focus-visible:border-emerald-500/20 focus-visible:ring-emerald-500/20"
                        />
                    </div>
                </motion.div>

                <AnimatePresence mode="popLayout">
                    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-3">
                        {!loading && filteredTickets.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center py-24 text-center"
                            >
                                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-slate-200 bg-slate-100">
                                    <Search className="h-10 w-10 text-slate-400" />
                                </div>
                                <h3 className="mb-2 text-xl font-semibold text-slate-950">Nenhum ticket encontrado</h3>
                                <p className="max-w-sm text-slate-500">
                                    Nao encontramos nenhum ticket com os filtros atuais. Tente limpar a busca ou mudar os filtros.
                                </p>
                            </motion.div>
                        ) : (
                            filteredTickets.map((ticket) => {
                                const status = statusMap[ticket.status] || statusMap.open;
                                const priority = priorityMap[ticket.priority] || priorityMap.low;
                                const StatusIcon = status.icon;

                                return (
                                    <motion.div key={ticket.id} variants={itemVariants} layout>
                                        <Card
                                            className="group relative cursor-pointer overflow-hidden border-slate-200 bg-white transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-slate-50 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.18)]"
                                            onClick={() => router.push(`/support/tickets/${ticket.id}`)}
                                        >
                                            <CardContent className="flex flex-col justify-between gap-6 p-5 md:flex-row md:items-center">
                                                <div className="flex items-start gap-5">
                                                    <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${status.bg} ${status.color}`}>
                                                        <StatusIcon className="h-5 w-5" />
                                                    </div>

                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-lg font-semibold text-slate-950 transition-colors group-hover:text-emerald-600">
                                                                {ticket.subject}
                                                            </span>
                                                            <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">
                                                                <span className="text-[10px] font-mono text-slate-500">#{ticket.id.slice(0, 8)}</span>
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`h-1.5 w-1.5 rounded-full ${priority.color === 'text-red-400 font-bold' ? 'bg-red-500' : priority.color.replace('text-', 'bg-').replace('-400', '-500')}`} />
                                                                <span className={priority.color}>{priority.label}</span>
                                                            </div>
                                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                            <div className="flex items-center gap-1.5">
                                                                <Filter className="h-3.5 w-3.5" />
                                                                <span className="capitalize">{ticket.category}</span>
                                                            </div>
                                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                            <div className="flex items-center gap-1.5">
                                                                <Clock className="h-3.5 w-3.5" />
                                                                <span>{formatLastUpdate(ticket)}</span>
                                                            </div>
                                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                            <div className="flex items-center gap-1.5">
                                                                <User className="h-3.5 w-3.5" />
                                                                <span>Solicitante: {ticket.requester?.display_name || 'Usuario'}</span>
                                                            </div>
                                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                            <div className="flex items-center gap-1.5">
                                                                <ShieldCheck className="h-3.5 w-3.5" />
                                                                <span>
                                                                    {ticket.last_staff_reply
                                                                        ? `Respondido por ${ticket.last_staff_reply.display_name}`
                                                                        : 'Aguardando resposta do suporte'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-4 pl-14 md:justify-end md:pl-0">
                                                    <div className={`rounded-full border px-3 py-1 text-xs font-medium ${status.bg} ${status.color}`}>
                                                        {status.label}
                                                    </div>

                                                    {isSuperAdmin && (
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <MoreVertical className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent
                                                                align="end"
                                                                className="w-56 border-slate-200 bg-white text-slate-700"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <DropdownMenuItem
                                                                    disabled={ticket.status === 'open' || isMutatingTicketId === ticket.id}
                                                                    onClick={() => handleStatusChange(ticket.id, 'open')}
                                                                    className="focus:bg-slate-50"
                                                                >
                                                                    <AlertCircle className="mr-2 h-4 w-4 text-blue-400" />
                                                                    Marcar como aberto
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    disabled={ticket.status === 'in_progress' || isMutatingTicketId === ticket.id}
                                                                    onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                                                                    className="focus:bg-slate-50"
                                                                >
                                                                    <Clock className="mr-2 h-4 w-4 text-amber-400" />
                                                                    Marcar como em andamento
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    disabled={ticket.status === 'closed' || isMutatingTicketId === ticket.id}
                                                                    onClick={() => handleStatusChange(ticket.id, 'closed')}
                                                                    className="focus:bg-slate-50"
                                                                >
                                                                    <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-400" />
                                                                    Marcar como resolvido
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator className="bg-slate-200" />
                                                                <DropdownMenuItem
                                                                    disabled={isMutatingTicketId === ticket.id}
                                                                    onClick={() => handleDelete(ticket.id)}
                                                                    className="text-red-400 focus:bg-red-50 focus:text-red-500"
                                                                >
                                                                    Excluir ticket
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
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
