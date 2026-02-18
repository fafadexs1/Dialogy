'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Contact, Tag, User, Deal } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, Plus, DollarSign, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getContacts, getTags, saveContactAction } from '@/actions/crm';
import { getDeals, logStageChange } from '@/actions/deals';
import { toast } from '@/hooks/use-toast';
import DealForm from './deal-form';
import LeadScoreBadge from './lead-score-badge';
import { recalculateWorkspaceScores } from '@/actions/lead-scoring';

const DEFAULT_STAGES = [
    { id: 'novo', label: 'Novo', color: '#3b82f6' },
    { id: 'qualificado', label: 'Qualificado', color: '#eab308' },
    { id: 'proposta', label: 'Proposta', color: '#a855f7' },
    { id: 'negociacao', label: 'Negociação', color: '#f97316' },
    { id: 'ganho', label: 'Ganho', color: '#22c55e' },
    { id: 'perdido', label: 'Perdido', color: '#ef4444' }
];

interface KanbanColumn {
    id: string;
    title: string;
    color: string;
    items: Contact[];
}

interface CrmKanbanProps {
    user: User;
    onContactClick: (contact: Contact) => void;
}

function formatBRL(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CrmKanban({ user, onContactClick }: CrmKanbanProps) {
    const [columns, setColumns] = useState<Record<string, KanbanColumn>>({});
    const [loading, setLoading] = useState(true);
    const [tags, setTags] = useState<Tag[]>([]);
    const [deals, setDeals] = useState<Deal[]>([]);
    const [dealFormOpen, setDealFormOpen] = useState(false);
    const [dealFormContact, setDealFormContact] = useState<{ id: string; name: string } | null>(null);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            const [contactsRes, tagsRes, dealsRes] = await Promise.all([
                getContacts(user.activeWorkspaceId),
                getTags(user.activeWorkspaceId),
                getDeals(user.activeWorkspaceId),
            ]);

            if (contactsRes.error) throw new Error(contactsRes.error);
            if (tagsRes.error) throw new Error(tagsRes.error);

            const fetchedTags = tagsRes.tags || [];
            setTags(fetchedTags);
            setDeals(dealsRes.deals || []);

            const initialColumns: Record<string, KanbanColumn> = {};

            DEFAULT_STAGES.forEach(stage => {
                initialColumns[stage.id] = {
                    id: stage.id,
                    title: stage.label,
                    color: stage.color,
                    items: []
                };
            });

            (contactsRes.contacts || []).forEach(contact => {
                const stageTag = contact.tags?.find(t => initialColumns[t.value]);
                const stageId = stageTag ? stageTag.value : 'novo';

                if (initialColumns[stageId]) {
                    initialColumns[stageId].items.push(contact);
                } else {
                    initialColumns['novo'].items.push(contact);
                }
            });

            setColumns(initialColumns);

        } catch (error: any) {
            toast({ title: "Erro ao carregar Kanban", description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Compute deal totals per stage
    const dealTotalsByStage = useMemo(() => {
        const totals: Record<string, number> = {};
        for (const stage of DEFAULT_STAGES) {
            totals[stage.id] = 0;
        }
        for (const deal of deals) {
            if (deal.won === null || deal.won === undefined) {
                // Only count open deals
                if (totals[deal.stage] !== undefined) {
                    totals[deal.stage] += deal.value;
                }
            }
        }
        return totals;
    }, [deals]);

    // Map contactId to highest-value open deal
    const topDealByContact = useMemo(() => {
        const map: Record<string, Deal> = {};
        for (const deal of deals) {
            if (deal.won !== null && deal.won !== undefined) continue;
            if (!map[deal.contact_id] || deal.value > map[deal.contact_id].value) {
                map[deal.contact_id] = deal;
            }
        }
        return map;
    }, [deals]);

    const onDragEnd = async (result: DropResult) => {
        if (!result.destination) return;

        const { source, destination } = result;

        if (source.droppableId === destination.droppableId) {
            const column = columns[source.droppableId];
            const newItems = Array.from(column.items);
            const [removed] = newItems.splice(source.index, 1);
            newItems.splice(destination.index, 0, removed);

            setColumns({
                ...columns,
                [source.droppableId]: {
                    ...column,
                    items: newItems
                }
            });
        } else {
            const sourceColumn = columns[source.droppableId];
            const destColumn = columns[destination.droppableId];
            const sourceItems = Array.from(sourceColumn.items);
            const destItems = Array.from(destColumn.items);
            const [removed] = sourceItems.splice(source.index, 1);

            destItems.splice(destination.index, 0, removed);

            setColumns({
                ...columns,
                [source.droppableId]: {
                    ...sourceColumn,
                    items: sourceItems
                },
                [destination.droppableId]: {
                    ...destColumn,
                    items: destItems
                }
            });

            try {
                const contact = removed;
                const newStageId = destination.droppableId;
                const oldStageId = source.droppableId;

                const currentTags = contact.tags?.map(t => t.id) || [];
                const oldTag = tags.find(t => t.value === oldStageId);
                const newTag = tags.find(t => t.value === newStageId);

                let newTagIds = currentTags;

                if (oldTag) {
                    newTagIds = newTagIds.filter(id => id !== oldTag.id);
                }

                if (newTag) {
                    newTagIds.push(newTag.id);
                } else {
                    toast({ title: "Aviso", description: `Tag para fase '${destColumn.title}' não encontrada.`, variant: "destructive" });
                    return;
                }

                const formData = new FormData();
                formData.append('workspaceId', user.activeWorkspaceId!);
                formData.append('id', contact.id);
                formData.append('name', contact.name);
                if (contact.email) formData.append('email', contact.email);
                if (contact.phone_number_jid) formData.append('phone_number_jid', contact.phone_number_jid);
                if (contact.owner_id) formData.append('owner_id', contact.owner_id);

                newTagIds.forEach(id => formData.append('tags', id));

                const saveResult = await saveContactAction(null, formData);
                if (!saveResult.success) {
                    throw new Error(saveResult.error || "Falha ao salvar");
                }

                // Log stage change
                await logStageChange(contact.id, oldStageId, newStageId, user.id, user.activeWorkspaceId);

                const updatedTags = contact.tags?.filter(t => t.value !== oldStageId) || [];
                if (newTag) updatedTags.push(newTag);
                removed.tags = updatedTags;

            } catch (error: any) {
                toast({ title: "Erro ao mover contato", description: error.message, variant: 'destructive' });
                fetchData();
            }
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <>
            <div className="h-full overflow-x-auto bg-muted/30 p-6">
                <div className="flex items-center justify-end mb-4 gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={async () => {
                            if (!user?.activeWorkspaceId) return;
                            toast({ title: 'Recalculando scores...' });
                            const res = await recalculateWorkspaceScores(user.activeWorkspaceId);
                            if (res.error) {
                                toast({ title: 'Erro', description: res.error, variant: 'destructive' });
                            } else {
                                toast({ title: 'Scores atualizados', description: `${res.updated} contatos recalculados.` });
                                fetchData();
                            }
                        }}
                    >
                        <Zap className="h-3.5 w-3.5" />
                        Recalcular Scores
                    </Button>
                </div>
                <DragDropContext onDragEnd={onDragEnd}>
                    <div className="flex h-full gap-4 min-w-max">
                        {DEFAULT_STAGES.map(stage => {
                            const column = columns[stage.id];
                            if (!column) return null;
                            const stageTotal = dealTotalsByStage[stage.id] || 0;

                            return (
                                <div key={stage.id} className="flex flex-col w-80 h-full rounded-lg bg-muted/50 border border-border/50">
                                    <div className="p-3 flex flex-col gap-1 border-b border-border/50 bg-card/50 rounded-t-lg backdrop-blur-sm sticky top-0 z-10">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                                                <h3 className="font-medium text-sm text-foreground">{stage.label}</h3>
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 min-w-[1.25rem] justify-center">
                                                    {column.items.length}
                                                </Badge>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                                                <Plus className="h-3 w-3" />
                                            </Button>
                                        </div>
                                        {stageTotal > 0 && (
                                            <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground pl-5">
                                                <DollarSign className="h-3 w-3" />
                                                <span>{formatBRL(stageTotal)}</span>
                                            </div>
                                        )}
                                    </div>

                                    <Droppable droppableId={stage.id}>
                                        {(provided, snapshot) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className={`flex-1 p-2 overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-accent/20' : ''}`}
                                            >
                                                <div className="flex flex-col gap-2">
                                                    {column.items.map((contact, index) => {
                                                        const topDeal = topDealByContact[contact.id];
                                                        return (
                                                            <Draggable key={contact.id} draggableId={contact.id} index={index}>
                                                                {(provided, snapshot) => (
                                                                    <Card
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        {...provided.dragHandleProps}
                                                                        onClick={() => onContactClick(contact)}
                                                                        className={`cursor-pointer hover:shadow-md transition-all border-border/60 bg-card ${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20 rotate-1' : ''}`}
                                                                    >
                                                                        <CardContent className="p-3 space-y-2">
                                                                            <div className="flex items-start justify-between gap-2">
                                                                                <div className="flex items-center gap-2 overflow-hidden">
                                                                                    <Avatar className="h-6 w-6 shrink-0">
                                                                                        <AvatarImage src={contact.avatar_url || undefined} />
                                                                                        <AvatarFallback className="text-[10px]">{contact.name.charAt(0)}</AvatarFallback>
                                                                                    </Avatar>
                                                                                    <span className="font-medium text-sm truncate">{contact.name}</span>
                                                                                    {contact.lead_score != null && contact.lead_score > 0 && <LeadScoreBadge score={contact.lead_score} size="sm" />}
                                                                                </div>
                                                                                {topDeal && (
                                                                                    <Badge variant="outline" className="text-[10px] shrink-0 font-semibold text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                                                                                        {formatBRL(topDeal.value)}
                                                                                    </Badge>
                                                                                )}
                                                                            </div>

                                                                            {topDeal && (
                                                                                <p className="text-[10px] text-muted-foreground truncate pl-8">{topDeal.title}</p>
                                                                            )}

                                                                            {/* Tags (excluding stage tags) */}
                                                                            <div className="flex flex-wrap gap-1">
                                                                                {contact.tags?.filter(t => !DEFAULT_STAGES.some(s => s.id === t.value)).slice(0, 3).map(tag => (
                                                                                    <span key={tag.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                                                                                        {tag.label}
                                                                                    </span>
                                                                                ))}
                                                                            </div>

                                                                            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                                                                                <span>{contact.owner?.name || 'Sem dono'}</span>
                                                                                <span>{contact.last_activity ? format(new Date(contact.last_activity), 'dd/MM', { locale: ptBR }) : '-'}</span>
                                                                            </div>
                                                                        </CardContent>
                                                                    </Card>
                                                                )}
                                                            </Draggable>
                                                        );
                                                    })}
                                                    {provided.placeholder}
                                                </div>
                                            </div>
                                        )}
                                    </Droppable>
                                </div>
                            );
                        })}
                    </div>
                </DragDropContext>
            </div>

            {/* Deal Form */}
            {dealFormContact && (
                <DealForm
                    isOpen={dealFormOpen}
                    setIsOpen={setDealFormOpen}
                    workspaceId={user.activeWorkspaceId!}
                    contactId={dealFormContact.id}
                    contactName={dealFormContact.name}
                    onSaved={() => fetchData()}
                />
            )}
        </>
    );
}
