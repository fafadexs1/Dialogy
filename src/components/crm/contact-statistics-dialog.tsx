'use client';

import React, { useState, useEffect, useActionState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, MessageSquare, Calendar, StickyNote, Plus, Send, BarChart3, PieChart } from 'lucide-react';
import { getContactStatistics, addActivityAction } from '@/actions/crm';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from '@/hooks/use-toast';
import { Activity } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ContactStatisticsDialogProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    contactId: string;
    contactName: string;
}

type StatisticsData = Awaited<ReturnType<typeof getContactStatistics>>['stats'];

function AddNoteForm({ contactId, onNoteAdded }: { contactId: string, onNoteAdded: () => void }) {
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
            toast({ title: "Nota adicionada!" });
            onNoteAdded();
        } else {
            toast({ title: "Erro ao adicionar nota", description: result.error, variant: 'destructive' });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3 bg-white/5 p-4 rounded-lg border border-white/10">
            <div className="space-y-2">
                <Label className="text-white/70">Nova Anotação</Label>
                <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Escreva uma observação sobre este cliente..."
                    className="bg-black/20 border-white/10 text-white resize-none min-h-[80px]"
                />
            </div>
            <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={isSubmitting || !note.trim()} className="bg-blue-600 hover:bg-blue-500 text-white">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Adicionar
                </Button>
            </div>
        </form>
    );
}

export function ContactStatisticsDialog({ isOpen, setIsOpen, contactId, contactName }: ContactStatisticsDialogProps) {
    const [stats, setStats] = useState<StatisticsData>(null);
    const [loading, setLoading] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        if (isOpen && contactId) {
            setLoading(true);
            getContactStatistics(contactId)
                .then(res => {
                    if (res.stats) setStats(res.stats);
                    else if (res.error) toast({ title: "Erro", description: res.error, variant: 'destructive' });
                })
                .finally(() => setLoading(false));
        }
    }, [isOpen, contactId, refreshTrigger]);

    const handleRefresh = () => setRefreshTrigger(prev => prev + 1);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-3xl bg-zinc-950 border-white/10 text-white max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogHeader className="p-6 pb-4 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                            <BarChart3 className="h-5 w-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-xl">Estatísticas & Histórico</DialogTitle>
                            <DialogDescription className="text-white/50">
                                Análise detalhada de {contactName}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {loading && !stats ? (
                    <div className="flex-1 flex items-center justify-center min-h-[300px]">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : stats ? (
                    <div className="flex-1 overflow-hidden flex flex-col">
                        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
                            <div className="px-6 pt-4">
                                <TabsList className="bg-white/5 border border-white/10 w-full justify-start h-auto p-1">
                                    <TabsTrigger value="overview" className="data-[state=active]:bg-white/10 data-[state=active]:text-white flex-1 py-2">Visão Geral</TabsTrigger>
                                    <TabsTrigger value="notes" className="data-[state=active]:bg-white/10 data-[state=active]:text-white flex-1 py-2">Anotações ({stats.totalNotes})</TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent value="overview" className="flex-1 overflow-y-auto p-6 space-y-6 data-[state=inactive]:hidden">
                                {/* KPI Cards */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-white/50 text-sm">
                                            <MessageSquare className="h-4 w-4" />
                                            Total de Atendimentos
                                        </div>
                                        <div className="text-3xl font-bold text-white">{stats.totalChats}</div>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-white/50 text-sm">
                                            <Calendar className="h-4 w-4" />
                                            Último Contato
                                        </div>
                                        <div className="text-lg font-medium text-white truncate">
                                            {stats.lastContactDate
                                                ? format(new Date(stats.lastContactDate), "dd 'de' MMMM, yyyy", { locale: ptBR })
                                                : "Nunca"}
                                        </div>
                                        {stats.lastContactDate && (
                                            <div className="text-xs text-white/40">
                                                {format(new Date(stats.lastContactDate), "HH:mm", { locale: ptBR })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Close Reasons Chart */}
                                <div className="space-y-4">
                                    <h4 className="font-medium text-white flex items-center gap-2">
                                        <PieChart className="h-4 w-4 text-purple-400" />
                                        Motivos de Encerramento
                                    </h4>
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                                        {stats.closeReasons.length > 0 ? (
                                            stats.closeReasons.map((reason, idx) => {
                                                const max = Math.max(...stats.closeReasons.map(r => r.count));
                                                const percent = (reason.count / stats.totalChats) * 100;

                                                return (
                                                    <div key={idx} className="space-y-1">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-white/80 font-medium">{reason.tag}</span>
                                                            <span className="text-white/50">{reason.count} ({Math.round(percent)}%)</span>
                                                        </div>
                                                        <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full transition-all duration-500"
                                                                style={{
                                                                    width: `${(reason.count / max) * 100}%`,
                                                                    backgroundColor: reason.color
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <p className="text-center text-white/30 py-4 text-sm">Nenhum atendimento encerrado com etiqueta ainda.</p>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="notes" className="flex-1 overflow-hidden flex flex-col data-[state=inactive]:hidden">
                                <div className="p-6 pb-0">
                                    <AddNoteForm contactId={contactId} onNoteAdded={handleRefresh} />
                                </div>

                                <ScrollArea className="flex-1 p-6">
                                    <div className="space-y-6 relative pl-4 border-l border-white/10 ml-2">
                                        {stats.activities.length > 0 ? (
                                            stats.activities.map((activity) => (
                                                <div key={activity.id} className="relative pl-6 group">
                                                    {/* Timeline dot */}
                                                    <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-zinc-800 border-2 border-white/20 group-hover:border-blue-500 group-hover:bg-blue-900 transition-colors" />

                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <Avatar className="h-6 w-6 border border-white/10">
                                                                    <AvatarImage src={(activity as any).user_avatar} />
                                                                    <AvatarFallback className="text-[10px] bg-zinc-800 text-white">
                                                                        {(activity as any).user_name?.charAt(0)}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                                <span className="text-sm font-medium text-white/90">{(activity as any).user_name}</span>
                                                            </div>
                                                            <span className="text-xs text-white/40">
                                                                {format(new Date(activity.date), "dd/MM/yy HH:mm")}
                                                            </span>
                                                        </div>
                                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white/80 leading-relaxed">
                                                            {activity.notes}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-center py-10">
                                                <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
                                                    <StickyNote className="h-6 w-6 text-white/20" />
                                                </div>
                                                <p className="text-white/50">Nenhuma anotação registrada.</p>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </TabsContent>
                        </Tabs>
                    </div>
                ) : (
                    <div className="p-6 text-center text-white/50">
                        Falha ao carregar dados.
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
