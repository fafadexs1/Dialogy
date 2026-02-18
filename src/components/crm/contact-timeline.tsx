'use client';

import React, { useEffect, useState } from 'react';
import { getContactTimeline, getDealsByContact } from '@/actions/deals';
import type { Deal } from '@/lib/types';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
    Phone, MessageCircle, Mail, FileText, ArrowRight,
    DollarSign, Target, Trophy, XCircle, Clock, Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TimelineEvent {
    id: string;
    type: 'activity' | 'stage_change' | 'deal_created' | 'deal_closed' | 'chat';
    date: string;
    data: any;
}

interface ContactTimelineProps {
    contactId: string;
    compact?: boolean;
    maxItems?: number;
}

const typeConfig: Record<string, { icon: any; color: string; bgColor: string }> = {
    activity: { icon: FileText, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10 border-yellow-500/20' },
    stage_change: { icon: ArrowRight, color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/20' },
    deal_created: { icon: Target, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10 border-emerald-500/20' },
    deal_closed: { icon: Trophy, color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/20' },
    chat: { icon: MessageCircle, color: 'text-green-400', bgColor: 'bg-green-500/10 border-green-500/20' },
};

const activityIcons: Record<string, any> = {
    ligacao: Phone,
    whatsapp: MessageCircle,
    email: Mail,
    nota: FileText,
};

function formatBRL(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ContactTimeline({ contactId, compact = false, maxItems = 30 }: ContactTimelineProps) {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!contactId) return;
        setLoading(true);
        getContactTimeline(contactId)
            .then(res => {
                setEvents((res.events || []).slice(0, maxItems));
            })
            .finally(() => setLoading(false));
    }, [contactId, maxItems]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <p className="text-xs text-muted-foreground text-center py-6 italic">
                Nenhum evento registrado ainda.
            </p>
        );
    }

    return (
        <div className="space-y-1">
            {events.map((event, idx) => {
                const config = typeConfig[event.type] || typeConfig.activity;
                const IconComponent = getIcon(event);
                const isLast = idx === events.length - 1;

                return (
                    <div key={event.id} className="flex gap-3 group">
                        {/* Timeline line + icon */}
                        <div className="flex flex-col items-center">
                            <div className={cn(
                                'w-7 h-7 rounded-full flex items-center justify-center border shrink-0',
                                config.bgColor
                            )}>
                                <IconComponent className={cn('w-3.5 h-3.5', config.color)} />
                            </div>
                            {!isLast && (
                                <div className="w-px flex-1 bg-border/50 my-1" />
                            )}
                        </div>

                        {/* Content */}
                        <div className={cn('flex-1 pb-3', compact ? 'pb-2' : 'pb-3')}>
                            <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-medium text-foreground leading-tight">
                                    {getTitle(event)}
                                </p>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0" title={format(new Date(event.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}>
                                    {formatDistanceToNow(new Date(event.date), { addSuffix: true, locale: ptBR })}
                                </span>
                            </div>
                            {getDescription(event) && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {getDescription(event)}
                                </p>
                            )}
                            {event.type === 'deal_created' && event.data.value && (
                                <Badge variant="outline" className="mt-1 text-[10px] font-semibold text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400">
                                    {formatBRL(event.data.value)}
                                </Badge>
                            )}
                            {event.type === 'deal_closed' && (
                                <Badge variant="outline" className={cn(
                                    'mt-1 text-[10px] font-semibold',
                                    event.data.won
                                        ? 'text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400'
                                        : 'text-red-600 border-red-300 bg-red-50 dark:bg-red-950/30 dark:text-red-400'
                                )}>
                                    {event.data.won ? '✓ Ganho' : '✗ Perdido'} — {formatBRL(event.data.value)}
                                </Badge>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function getIcon(event: TimelineEvent) {
    if (event.type === 'activity') {
        return activityIcons[event.data.activityType] || FileText;
    }
    if (event.type === 'deal_closed' && !event.data.won) {
        return XCircle;
    }
    return typeConfig[event.type]?.icon || FileText;
}

function getTitle(event: TimelineEvent): string {
    switch (event.type) {
        case 'activity':
            return event.data.activityType?.replace(/-/g, ' ')?.replace(/^\w/, (c: string) => c.toUpperCase()) || 'Atividade';
        case 'stage_change':
            return `Movido: ${event.data.fromStage || '?'} → ${event.data.toStage}`;
        case 'deal_created':
            return `Deal criado: ${event.data.title}`;
        case 'deal_closed':
            return `Deal ${event.data.won ? 'ganho' : 'perdido'}: ${event.data.title}`;
        case 'chat':
            return 'Conversa';
        default:
            return 'Evento';
    }
}

function getDescription(event: TimelineEvent): string | null {
    switch (event.type) {
        case 'activity':
            return event.data.notes || null;
        case 'stage_change':
            return event.data.changedByName ? `Por ${event.data.changedByName}` : null;
        default:
            return null;
    }
}
