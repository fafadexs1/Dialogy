'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Contact, User, Deal } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, Plus, DollarSign, Zap, Columns3, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { getContacts, getPipelineStages, createPipelineStage, deletePipelineStage, saveContactAction } from '@/actions/crm';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getDeals, logStageChange } from '@/actions/deals';
import { toast } from '@/hooks/use-toast';
import LeadScoreBadge from './lead-score-badge';
import { recalculateWorkspaceScores } from '@/actions/lead-scoring';
import {
    type PipelineStage,
    getDefaultPipelineStageValue,
    sortPipelineStages,
} from '@/lib/crm-pipeline';

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
    const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
    const [loading, setLoading] = useState(true);
    const [deals, setDeals] = useState<Deal[]>([]);
    const [stageDialogOpen, setStageDialogOpen] = useState(false);
    const [newStageLabel, setNewStageLabel] = useState('');
    const [newStageColor, setNewStageColor] = useState('#3b82f6');
    const [creatingStage, setCreatingStage] = useState(false);

    const orderedStages = useMemo(() => sortPipelineStages(pipelineStages), [pipelineStages]);
    const stageValueSet = useMemo(() => new Set(orderedStages.map((stage) => stage.value)), [orderedStages]);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            const [contactsRes, stagesRes, dealsRes] = await Promise.all([
                getContacts(user.activeWorkspaceId),
                getPipelineStages(user.activeWorkspaceId),
                getDeals(user.activeWorkspaceId),
            ]);

            if (contactsRes.error) throw new Error(contactsRes.error);
            if (stagesRes.error) throw new Error(stagesRes.error);
            if (dealsRes.error) throw new Error(dealsRes.error);

            const fetchedStages = sortPipelineStages(stagesRes.stages || []);
            const initialColumns: Record<string, KanbanColumn> = {};

            fetchedStages.forEach((stage) => {
                initialColumns[stage.value] = {
                    id: stage.value,
                    title: stage.label,
                    color: stage.color,
                    items: [],
                };
            });

            const fallbackStageValue = getDefaultPipelineStageValue(fetchedStages);

            (contactsRes.contacts || []).forEach((contact) => {
                const stageTag = contact.tags?.find((tag) => initialColumns[tag.value]);
                const stageValue = stageTag?.value || fallbackStageValue;

                if (initialColumns[stageValue]) {
                    initialColumns[stageValue].items.push(contact);
                }
            });

            setPipelineStages(fetchedStages);
            setDeals(dealsRes.deals || []);
            setColumns(initialColumns);
        } catch (error: any) {
            toast({ title: 'Erro ao carregar Kanban', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const dealTotalsByStage = useMemo(() => {
        const totals: Record<string, number> = {};
        for (const stage of orderedStages) {
            totals[stage.value] = 0;
        }
        for (const deal of deals) {
            if (deal.won === null || deal.won === undefined) {
                if (totals[deal.stage] !== undefined) {
                    totals[deal.stage] += deal.value;
                }
            }
        }
        return totals;
    }, [deals, orderedStages]);

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

    const handleCreateStage = async () => {
        if (!user?.activeWorkspaceId) return;
        if (!newStageLabel.trim()) {
            toast({ title: 'Nome obrigatorio', description: 'Informe o nome da nova etapa.', variant: 'destructive' });
            return;
        }

        setCreatingStage(true);
        try {
            const result = await createPipelineStage(user.activeWorkspaceId, newStageLabel, newStageColor);
            if (!result.success) {
                throw new Error(result.error || 'Falha ao criar etapa.');
            }

            toast({ title: 'Etapa criada', description: 'A nova etapa ja esta disponivel no funil.' });
            setStageDialogOpen(false);
            setNewStageLabel('');
            setNewStageColor('#3b82f6');
            await fetchData();
        } catch (error: any) {
            toast({ title: 'Erro ao criar etapa', description: error.message, variant: 'destructive' });
        } finally {
            setCreatingStage(false);
        }
    };

    const handleDeleteStage = async (stageId: string, stageLabel: string) => {
        if (!user?.activeWorkspaceId) return;
        
        if (!confirm(`Tem certeza que deseja apagar o funil "${stageLabel}"? Todos os contatos voltarão a primeira etapa do CRM automaticamente.`)) {
            return;
        }

        try {
            const result = await deletePipelineStage(user.activeWorkspaceId, stageId);
            if (!result.success) {
                throw new Error(result.error || 'Falha ao excluir etapa.');
            }

            toast({ title: 'Etapa excluída', description: 'O funil foi removido com sucesso.' });
            await fetchData();
        } catch (error: any) {
            toast({ title: 'Erro ao excluir etapa', description: error.message, variant: 'destructive' });
        }
    };

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
                    items: newItems,
                },
            });
            return;
        }

        const sourceColumn = columns[source.droppableId];
        const destinationColumn = columns[destination.droppableId];
        const sourceItems = Array.from(sourceColumn.items);
        const destinationItems = Array.from(destinationColumn.items);
        const [removed] = sourceItems.splice(source.index, 1);

        destinationItems.splice(destination.index, 0, removed);

        setColumns({
            ...columns,
            [source.droppableId]: {
                ...sourceColumn,
                items: sourceItems,
            },
            [destination.droppableId]: {
                ...destinationColumn,
                items: destinationItems,
            },
        });

        try {
            const currentTags = removed.tags?.map((tag) => tag.id) || [];
            const stageTagIdsToRemove = (removed.tags || [])
                .filter((tag) => stageValueSet.has(tag.value))
                .map((tag) => tag.id);
            const newStageTag = orderedStages.find((stage) => stage.value === destination.droppableId);

            if (!newStageTag) {
                throw new Error('Etapa de destino nao encontrada.');
            }

            const nextTagIds = currentTags
                .filter((tagId) => !stageTagIdsToRemove.includes(tagId))
                .concat(newStageTag.id);

            const formData = new FormData();
            formData.append('workspaceId', user.activeWorkspaceId!);
            formData.append('id', removed.id);
            formData.append('name', removed.name);
            if (removed.email) formData.append('email', removed.email);
            if (removed.phone_number_jid) formData.append('phone_number_jid', removed.phone_number_jid);
            if (removed.owner_id) formData.append('owner_id', removed.owner_id);

            nextTagIds.forEach((tagId) => formData.append('tags', tagId));

            const saveResult = await saveContactAction(null, formData);
            if (!saveResult.success) {
                throw new Error(saveResult.error || 'Falha ao salvar contato.');
            }

            await logStageChange(
                removed.id,
                source.droppableId,
                destination.droppableId,
                user.id,
                user.activeWorkspaceId
            );
        } catch (error: any) {
            toast({ title: 'Erro ao mover contato', description: error.message, variant: 'destructive' });
            fetchData();
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
            <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col bg-transparent px-5 py-6 md:px-8 md:py-8">
                <div className="mb-6 flex shrink-0 flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Pipeline comercial</p>
                        <h2 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#132b20] dark:text-white md:text-[34px]">Funil de oportunidades</h2>
                        <p className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400"><Columns3 className="h-4 w-4" /> {orderedStages.length} etapas para acompanhar cada avanço.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-10 gap-1.5 rounded-xl border-[#d8e5d8] bg-white px-4 text-xs font-semibold text-[#23402d] shadow-sm hover:bg-[#f4f8f2] dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
                            onClick={() => setStageDialogOpen(true)}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Nova etapa
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-10 gap-1.5 rounded-xl border-[#d8e5d8] bg-white px-4 text-xs font-semibold text-[#23402d] shadow-sm hover:bg-[#f4f8f2] dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
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
                </div>

                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
                    <DragDropContext onDragEnd={onDragEnd}>
                        <div className="flex h-full min-w-max gap-4 pb-2">
                            {orderedStages.map((stage) => {
                            const column = columns[stage.value];
                            if (!column) return null;
                            const stageTotal = dealTotalsByStage[stage.value] || 0;

                            return (
                                <div key={stage.value} className="flex h-full w-[300px] flex-col overflow-hidden rounded-[22px] border border-[#dfe8dd] bg-[#eef3ec] dark:border-white/10 dark:bg-[#131c16] md:w-[326px]">
                                    <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-[#dfe8dd] bg-white/90 px-4 py-4 backdrop-blur-sm dark:border-white/10 dark:bg-[#1a261e]/95">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="h-2.5 w-2.5 rounded-full ring-4 ring-slate-100 dark:ring-white/5" style={{ backgroundColor: stage.color }} />
                                                <h3 className="text-sm font-semibold text-[#1d3628] dark:text-white">{stage.label}</h3>
                                                <Badge variant="secondary" className="h-5 min-w-[1.25rem] justify-center rounded-full bg-[#eef4ec] px-1.5 text-[10px] text-[#43624b] dark:bg-white/10 dark:text-zinc-200">
                                                    {column.items.length}
                                                </Badge>
                                            </div>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:bg-muted">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem 
                                                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                        onClick={() => handleDeleteStage(stage.id, stage.label)}
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Excluir Etapa
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                        {stageTotal > 0 && (
                                            <div className="flex items-center gap-1 pl-5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                                <DollarSign className="h-3 w-3" />
                                                <span>{formatBRL(stageTotal)}</span>
                                            </div>
                                        )}
                                    </div>

                                    <Droppable droppableId={stage.value}>
                                        {(provided, snapshot) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className={`flex-1 overflow-y-auto p-3 transition-colors ${snapshot.isDraggingOver ? 'bg-emerald-100/70 dark:bg-emerald-400/10' : ''}`}
                                            >
                                                <div className="flex flex-col gap-3">
                                                    {column.items.map((contact, index) => {
                                                        const topDeal = topDealByContact[contact.id];
                                                        return (
                                                            <Draggable key={contact.id} draggableId={contact.id} index={index}>
                                                                {(dragProvided, dragSnapshot) => (
                                                                    <Card
                                                                        ref={dragProvided.innerRef}
                                                                        {...dragProvided.draggableProps}
                                                                        {...dragProvided.dragHandleProps}
                                                                        onClick={() => onContactClick(contact)}
                                                                        className={`cursor-pointer rounded-[17px] border-[#e1e9de] bg-white shadow-[0_9px_24px_-19px_rgba(16,46,25,.5)] transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_15px_30px_-19px_rgba(16,46,25,.5)] dark:border-white/10 dark:bg-[#1d2a21] ${dragSnapshot.isDragging ? 'rotate-1 shadow-xl ring-2 ring-emerald-400/30' : ''}`}
                                                                    >
                                                                        <CardContent className="space-y-3 p-4">
                                                                            <div className="flex items-start justify-between gap-2">
                                                                                <div className="flex items-center gap-2 overflow-hidden">
                                                                                    <Avatar className="h-9 w-9 shrink-0 border border-emerald-100 dark:border-white/10">
                                                                                        <AvatarImage src={contact.avatar_url || undefined} />
                                                                                        <AvatarFallback className="text-[10px]">{contact.name.charAt(0)}</AvatarFallback>
                                                                                    </Avatar>
                                                                                    <span className="truncate text-sm font-semibold text-[#1c3728] dark:text-white">{contact.name}</span>
                                                                                    {contact.lead_score != null && contact.lead_score > 0 ? (
                                                                                        <LeadScoreBadge score={contact.lead_score} size="sm" />
                                                                                    ) : null}
                                                                                </div>
                                                                                {topDeal ? (
                                                                                    <Badge variant="outline" className="shrink-0 border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400">
                                                                                        {formatBRL(topDeal.value)}
                                                                                    </Badge>
                                                                                ) : null}
                                                                            </div>

                                                                            {topDeal ? (
                                                                                <p className="truncate pl-11 text-[11px] text-slate-500 dark:text-zinc-400">{topDeal.title}</p>
                                                                            ) : null}

                                                                            <div className="flex flex-wrap gap-1">
                                                                                {contact.tags
                                                                                    ?.filter((tag) => !stageValueSet.has(tag.value))
                                                                                    .slice(0, 3)
                                                                                    .map((tag) => (
                                                                                        <span
                                                                                            key={tag.id}
                                                                                            className="rounded-full border border-[#e1e9de] bg-[#f4f7f2] px-2 py-0.5 text-[10px] text-[#496350] dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
                                                                                        >
                                                                                            {tag.label}
                                                                                        </span>
                                                                                    ))}
                                                                            </div>

                                                                            <div className="flex items-center justify-between border-t border-[#edf1eb] pt-3 text-[11px] text-slate-500 dark:border-white/10 dark:text-zinc-400">
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
            </div>
            <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nova etapa do funil</DialogTitle>
                        <DialogDescription>
                            Crie uma nova coluna no kanban para refletir o seu processo comercial.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="pipeline-stage-name">Nome da etapa</Label>
                            <Input
                                id="pipeline-stage-name"
                                value={newStageLabel}
                                onChange={(event) => setNewStageLabel(event.target.value)}
                                placeholder="Ex: Reuniao agendada"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="pipeline-stage-color">Cor</Label>
                            <input
                                id="pipeline-stage-color"
                                type="color"
                                value={newStageColor}
                                onChange={(event) => setNewStageColor(event.target.value)}
                                className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-2"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStageDialogOpen(false)} disabled={creatingStage}>
                            Cancelar
                        </Button>
                        <Button onClick={handleCreateStage} disabled={creatingStage}>
                            {creatingStage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Criar etapa
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
