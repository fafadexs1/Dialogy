'use client';

import React, { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
    BarChart3,
    Calendar,
    Clock3,
    Loader2,
    MessageSquare,
    PieChart,
    Send,
    Sparkles,
    StickyNote,
    TrendingUp,
} from 'lucide-react';
import { getContactStatistics, addActivityAction } from '@/actions/crm';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from '@/hooks/use-toast';
import type { Activity } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ContactStatisticsDialogProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    contactId: string;
    contactName: string;
}

type StatisticsData = Awaited<ReturnType<typeof getContactStatistics>>['stats'];
type StatsPeriod = 'this_month' | 'last_7_days' | 'last_month' | 'all_time';

const PERIOD_OPTIONS: Array<{ value: StatsPeriod; label: string }> = [
    { value: 'this_month', label: 'Este mes' },
    { value: 'last_7_days', label: '7 dias' },
    { value: 'last_month', label: 'Mes passado' },
    { value: 'all_time', label: 'Todo periodo' },
];

function AddNoteForm({ contactId, onNoteAdded }: { contactId: string; onNoteAdded: () => void }) {
    const [note, setNote] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!note.trim()) return;

        setIsSubmitting(true);
        const formData = new FormData();
        formData.append('contactId', contactId);
        formData.append('type', 'nota');
        formData.append('notes', note);

        const result = await addActivityAction(null, formData);
        setIsSubmitting(false);

        if (result.success) {
            setNote('');
            toast({ title: 'Nota adicionada!' });
            onNoteAdded();
            return;
        }

        toast({
            title: 'Erro ao adicionar nota',
            description: result.error,
            variant: 'destructive',
        });
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
        >
            <div className="space-y-2">
                <Label className="text-white/70">Nova anotacao</Label>
                <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Escreva algo importante sobre este contato..."
                    className="min-h-[92px] resize-none border-white/10 bg-black/30 text-white"
                />
            </div>
            <div className="flex justify-end">
                <Button
                    type="submit"
                    size="sm"
                    disabled={isSubmitting || !note.trim()}
                    className="border-0 bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-[0_10px_30px_rgba(59,130,246,0.35)] hover:from-blue-500 hover:to-cyan-400"
                >
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Adicionar
                </Button>
            </div>
        </form>
    );
}

export function ContactStatisticsDialog({
    isOpen,
    setIsOpen,
    contactId,
    contactName,
}: ContactStatisticsDialogProps) {
    const [stats, setStats] = useState<StatisticsData>(null);
    const [loading, setLoading] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [period, setPeriod] = useState<StatsPeriod>('this_month');

    useEffect(() => {
        if (!isOpen || !contactId) return;

        setLoading(true);
        getContactStatistics(contactId, period)
            .then((res) => {
                if (res.stats) {
                    setStats(res.stats);
                    return;
                }
                if (res.error) {
                    toast({ title: 'Erro', description: res.error, variant: 'destructive' });
                }
            })
            .finally(() => setLoading(false));
    }, [isOpen, contactId, refreshTrigger, period]);

    const handleRefresh = () => setRefreshTrigger((prev) => prev + 1);

    const selectedPeriodLabel = PERIOD_OPTIONS.find((option) => option.value === period)?.label || 'Este mes';
    const totalClosed = stats?.closeReasons?.reduce((sum, item) => sum + item.count, 0) || 0;
    const maxReasonCount = Math.max(...(stats?.closeReasons?.map((reason) => reason.count) || [1]), 1);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl w-[min(1000px,96vw)] max-h-[90vh] flex flex-col gap-0 overflow-hidden border-white/15 bg-zinc-950 p-0 text-white shadow-[0_40px_100px_rgba(0,0,0,0.7)]">
                <div className="pointer-events-none absolute -top-20 -left-20 h-56 w-56 rounded-full bg-blue-500/20 blur-[90px]" />
                <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-cyan-500/15 blur-[110px]" />

                <DialogHeader className="relative border-b border-white/10 bg-gradient-to-r from-white/[0.06] via-white/[0.03] to-transparent p-6 pb-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/25 to-cyan-500/20 text-blue-300 shadow-[0_0_40px_rgba(59,130,246,0.25)]">
                                <BarChart3 className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="truncate text-2xl font-bold tracking-tight">Estatisticas & Historico</DialogTitle>
                                <DialogDescription className="truncate text-white/55">
                                    Analise detalhada de {contactName}
                                </DialogDescription>
                            </div>
                        </div>
                        <Badge className="border border-blue-400/35 bg-blue-500/10 text-blue-100">{selectedPeriodLabel}</Badge>
                    </div>
                </DialogHeader>

                {loading && !stats ? (
                    <div className="flex min-h-[300px] flex-1 items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : stats ? (
                    <div className="flex flex-1 flex-col overflow-hidden">
                        <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden">
                            <div className="px-6 pt-4">
                                <div className="mb-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                    <div className="flex items-center justify-between gap-3 pb-2">
                                        <div className="flex items-center gap-2 text-xs tracking-wide text-white/60">
                                            <Clock3 className="h-3.5 w-3.5 text-blue-400" />
                                            Periodo dos dados
                                        </div>
                                        {loading && (
                                            <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                Atualizando...
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                        {PERIOD_OPTIONS.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setPeriod(option.value)}
                                                className={cn(
                                                    'relative h-9 rounded-xl border text-[11px] font-semibold transition-all',
                                                    period === option.value
                                                        ? 'border-blue-400/45 bg-gradient-to-r from-blue-500/25 to-cyan-500/15 text-blue-100 shadow-[0_10px_30px_rgba(59,130,246,0.25)]'
                                                        : 'border-white/10 bg-black/20 text-white/60 hover:bg-white/[0.06] hover:text-white'
                                                )}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <TabsList className="h-auto w-full justify-start border border-white/10 bg-white/[0.03] p-1">
                                    <TabsTrigger value="overview" className="flex-1 py-2.5 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                                        Visao Geral
                                    </TabsTrigger>
                                    <TabsTrigger value="notes" className="flex-1 py-2.5 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                                        Anotacoes ({stats.totalNotes})
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent value="overview" className="data-[state=inactive]:hidden flex-1 space-y-6 overflow-y-auto p-6">
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/18 to-blue-500/5 p-4">
                                        <div className="flex items-center gap-2 text-sm text-blue-100/80">
                                            <MessageSquare className="h-4 w-4" />
                                            Total de atendimentos
                                        </div>
                                        <div className="mt-2 text-4xl font-black tracking-tight text-white">{stats.totalChats}</div>
                                        <div className="mt-1 text-[11px] text-blue-100/60">No periodo selecionado</div>
                                    </div>

                                    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/15 to-cyan-500/5 p-4">
                                        <div className="flex items-center gap-2 text-sm text-cyan-100/80">
                                            <Calendar className="h-4 w-4" />
                                            Ultimo contato
                                        </div>
                                        <div className="mt-2 truncate text-lg font-bold text-white">
                                            {stats.lastContactDate
                                                ? format(new Date(stats.lastContactDate), "dd 'de' MMMM, yyyy", { locale: ptBR })
                                                : 'Sem contato'}
                                        </div>
                                        {stats.lastContactDate && (
                                            <div className="text-xs text-cyan-100/60">
                                                {format(new Date(stats.lastContactDate), 'HH:mm', { locale: ptBR })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 p-4">
                                        <div className="flex items-center gap-2 text-sm text-emerald-100/80">
                                            <StickyNote className="h-4 w-4" />
                                            Anotacoes
                                        </div>
                                        <div className="mt-2 text-4xl font-black tracking-tight text-white">{stats.totalNotes}</div>
                                        <div className="mt-1 text-[11px] text-emerald-100/60">Registradas no periodo</div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="flex items-center gap-2 font-semibold text-white">
                                        <PieChart className="h-4 w-4 text-purple-400" />
                                        Motivos de encerramento
                                        <Badge className="border-white/10 bg-white/10 text-white/70">{totalClosed}</Badge>
                                    </h4>

                                    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                        {stats.closeReasons.length > 0 ? (
                                            stats.closeReasons.map((reason, idx) => {
                                                const intensityWidth = (reason.count / maxReasonCount) * 100;
                                                const percent = totalClosed > 0 ? (reason.count / totalClosed) * 100 : 0;

                                                return (
                                                    <div key={`${reason.tag}-${idx}`} className="rounded-xl border border-white/10 bg-black/25 p-3">
                                                        <div className="mb-2 flex items-center justify-between text-sm">
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: reason.color }} />
                                                                <span className="truncate font-medium text-white/85">{reason.tag}</span>
                                                            </div>
                                                            <span className="shrink-0 text-white/55">
                                                                {reason.count} ({Math.round(percent)}%)
                                                            </span>
                                                        </div>
                                                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                                                            <div
                                                                className="h-full rounded-full transition-all duration-500"
                                                                style={{
                                                                    width: `${intensityWidth}%`,
                                                                    background: `linear-gradient(90deg, ${reason.color}, ${reason.color}AA)`,
                                                                    boxShadow: `0 0 24px ${reason.color}88`,
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="py-8 text-center">
                                                <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/5">
                                                    <Sparkles className="h-5 w-5 text-white/30" />
                                                </div>
                                                <p className="text-sm text-white/40">Sem encerramentos etiquetados neste periodo.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-purple-500/10 via-blue-500/8 to-cyan-500/10 p-4">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                        <TrendingUp className="h-4 w-4 text-cyan-300" />
                                        Insight rapido
                                    </div>
                                    <p className="mt-2 text-sm text-white/70">
                                        {stats.totalChats > 0
                                            ? `Voce teve ${stats.totalChats} atendimento(s) neste recorte e ${stats.totalNotes} anotacao(oes) registradas.`
                                            : 'Sem atendimentos no recorte atual. Tente trocar o periodo para ver mais historico.'}
                                    </p>
                                </div>
                            </TabsContent>

                            <TabsContent value="notes" className="data-[state=inactive]:hidden flex flex-1 flex-col overflow-hidden">
                                <div className="p-6 pb-0">
                                    <AddNoteForm contactId={contactId} onNoteAdded={handleRefresh} />
                                </div>

                                <ScrollArea className="flex-1 p-6">
                                    <div className="relative ml-2 space-y-5 border-l border-white/10 pl-4">
                                        {stats.activities.length > 0 ? (
                                            stats.activities.map((activity: Activity) => (
                                                <div key={activity.id} className="group relative pl-6">
                                                    <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full border-2 border-white/20 bg-zinc-800 transition-colors group-hover:border-blue-500 group-hover:bg-blue-900" />

                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <Avatar className="h-6 w-6 border border-white/10">
                                                                    <AvatarImage src={(activity as any).user_avatar} />
                                                                    <AvatarFallback className="bg-zinc-800 text-[10px] text-white">
                                                                        {(activity as any).user_name?.charAt(0)}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                                <span className="text-sm font-medium text-white/90">{(activity as any).user_name}</span>
                                                            </div>
                                                            <span className="text-xs text-white/40">
                                                                {format(new Date(activity.date), 'dd/MM/yy HH:mm')}
                                                            </span>
                                                        </div>
                                                        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.03] p-3 text-sm leading-relaxed text-white/85">
                                                            {activity.notes}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="py-10 text-center">
                                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
                                                    <StickyNote className="h-6 w-6 text-white/20" />
                                                </div>
                                                <p className="text-white/50">Nenhuma anotacao registrada no periodo.</p>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </TabsContent>
                        </Tabs>
                    </div>
                ) : (
                    <div className="p-6 text-center text-white/50">Falha ao carregar dados.</div>
                )}
            </DialogContent>
        </Dialog>
    );
}
