import { format } from 'date-fns';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, ShieldCheck, User } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTicket, getTicketMessages } from '@/actions/support';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { ChatInterface } from './chat-interface';

export default async function TicketPage(props: { params: Promise<{ ticketId: string }> }) {
    const params = await props.params;
    const { ticketId } = params;
    const ticket = await getTicket(ticketId);

    if (!ticket) {
        notFound();
    }

    const messages = await getTicketMessages(ticketId);

    const statusMap: Record<string, { label: string; color: string; icon: typeof AlertCircle }> = {
        open: { label: 'Aberto', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', icon: AlertCircle },
        in_progress: { label: 'Em andamento', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20', icon: Clock },
        closed: { label: 'Resolvido', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', icon: CheckCircle2 },
    };

    const status = statusMap[ticket.status] || statusMap.open;
    const StatusIcon = status.icon;

    return (
        <div className="h-full flex flex-col bg-muted/30">
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="mx-auto max-w-4xl space-y-6">
                    <div className="flex items-center gap-4">
                        <Link href="/support/tickets">
                            <Button variant="ghost" size="icon" className="rounded-full">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold tracking-tight text-foreground">{ticket.subject}</h1>
                                <Badge variant="outline" className={`${status.color} flex items-center gap-1`}>
                                    <StatusIcon className="h-3 w-3" />
                                    {status.label}
                                </Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Ticket #{ticket.id.slice(0, 8)} | Criado em {format(new Date(ticket.created_at), 'dd/MM/yyyy HH:mm')}
                            </p>
                            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                                <span className="inline-flex items-center gap-1.5">
                                    <User className="h-3.5 w-3.5" />
                                    Solicitante: {ticket.requester?.display_name || 'Usuario'}
                                    {ticket.requester?.email ? ` (${ticket.requester.email})` : ''}
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    {ticket.last_staff_reply
                                        ? `Ultima resposta do suporte: ${ticket.last_staff_reply.display_name}`
                                        : 'Suporte ainda nao respondeu'}
                                </span>
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <Card className="border-border bg-card">
                            <CardContent className="flex items-start gap-3 p-4">
                                <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                                    <User className="h-4 w-4" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Solicitante</p>
                                    <p className="text-sm font-medium text-foreground">{ticket.requester?.display_name || 'Usuario'}</p>
                                    {ticket.requester?.email && (
                                        <p className="text-sm text-muted-foreground">{ticket.requester.email}</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-border bg-card">
                            <CardContent className="flex items-start gap-3 p-4">
                                <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                                    <ShieldCheck className="h-4 w-4" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Atendimento</p>
                                    <p className="text-sm font-medium text-foreground">
                                        {ticket.last_staff_reply?.display_name || 'Aguardando equipe de suporte'}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {ticket.last_staff_reply_at
                                            ? `Ultima resposta em ${format(new Date(ticket.last_staff_reply_at), 'dd/MM/yyyy HH:mm')}`
                                            : 'Nenhuma resposta registrada ate agora'}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-border bg-card">
                        <CardHeader className="border-b pb-3">
                            <CardTitle className="flex items-center gap-2 text-base font-medium">
                                <span className="h-2 w-2 rounded-full bg-primary" />
                                Descricao do Problema
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="whitespace-pre-wrap pt-4 text-sm leading-relaxed">
                            {ticket.description}
                        </CardContent>
                    </Card>

                    <div className="flex flex-col gap-4">
                        <h3 className="flex items-center gap-2 px-1 text-lg font-semibold">
                            Historico de Conversa
                        </h3>

                        <ChatInterface ticketId={ticket.id} initialMessages={messages} />
                    </div>
                </div>
            </div>
        </div>
    );
}
