import { getTicket, getTicketMessages, sendMessage } from '@/actions/support';
import { notFound } from 'next/navigation';
import { ChatInterface } from './chat-interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

export default async function TicketPage(props: { params: Promise<{ ticketId: string }> }) {
    const params = await props.params;
    const { ticketId } = params;
    const ticket = await getTicket(ticketId);

    if (!ticket) {
        notFound();
    }

    const messages = await getTicketMessages(ticketId);

    const statusMap: Record<string, { label: string; color: string; icon: any }> = {
        open: { label: 'Aberto', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', icon: AlertCircle },
        in_progress: { label: 'Em Andamento', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20', icon: Clock },
        closed: { label: 'Resolvido', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', icon: CheckCircle2 },
    };

    const status = statusMap[ticket.status] || statusMap.open;
    const StatusIcon = status.icon;

    return (
        <div className="h-full flex flex-col bg-muted/30">
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    {/* Header */}
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
                            <p className="text-sm text-muted-foreground mt-1">
                                Ticket #{ticket.id.slice(0, 8)} • Criado em {format(new Date(ticket.created_at), 'dd/MM/yyyy HH:mm')}
                            </p>
                        </div>
                    </div>

                    {/* Original Description */}
                    <Card className="bg-card border-border">
                        <CardHeader className="pb-3 border-b">
                            <CardTitle className="text-base font-medium flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-primary" />
                                Descrição do Problema
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 text-sm leading-relaxed whitespace-pre-wrap">
                            {ticket.description}
                        </CardContent>
                    </Card>

                    {/* Chat Area */}
                    <div className="flex flex-col gap-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2 px-1">
                            Histórico de Conversa
                        </h3>

                        <ChatInterface
                            ticketId={ticket.id}
                            initialMessages={messages}
                            currentUserValues={{
                                // We don't have user avatar here easily without another fetch, 
                                // but the ChatInterface can handle "me" vs "them" based on is_staff flag or user_id match
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
