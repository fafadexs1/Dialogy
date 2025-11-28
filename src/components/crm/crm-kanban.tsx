'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Contact, Tag, User } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateTag, getContacts, getTags, saveContactAction } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';

// Define standard stages if they don't exist as tags
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

export default function CrmKanban({ user, onContactClick }: CrmKanbanProps) {
    const [columns, setColumns] = useState<Record<string, KanbanColumn>>({});
    const [loading, setLoading] = useState(true);
    const [tags, setTags] = useState<Tag[]>([]);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            const [contactsRes, tagsRes] = await Promise.all([
                getContacts(user.activeWorkspaceId),
                getTags(user.activeWorkspaceId)
            ]);

            if (contactsRes.error) throw new Error(contactsRes.error);
            if (tagsRes.error) throw new Error(tagsRes.error);

            const fetchedTags = tagsRes.tags || [];
            setTags(fetchedTags);

            // Filter tags that represent stages (start with 'Stage:' or match default IDs)
            // For this implementation, we will assume specific tags exist or use defaults mapped to 'Stage: X'
            // To make it simple, we will look for tags that match our default stage IDs or create a mapping

            // We will use the DEFAULT_STAGES as the source of truth for columns
            // And we will look for tags that match these IDs (value)

            const initialColumns: Record<string, KanbanColumn> = {};

            DEFAULT_STAGES.forEach(stage => {
                initialColumns[stage.id] = {
                    id: stage.id,
                    title: stage.label,
                    color: stage.color,
                    items: []
                };
            });

            // Distribute contacts
            (contactsRes.contacts || []).forEach(contact => {
                // Find which stage the contact is in based on their tags
                // We look for a tag that matches one of our stage IDs
                const stageTag = contact.tags?.find(t => initialColumns[t.value]);

                const stageId = stageTag ? stageTag.value : 'novo'; // Default to 'novo' if no stage tag

                if (initialColumns[stageId]) {
                    initialColumns[stageId].items.push(contact);
                } else {
                    // Fallback if tag exists but column doesn't (shouldn't happen with logic above)
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

    const onDragEnd = async (result: DropResult) => {
        if (!result.destination) return;

        const { source, destination, draggableId } = result;

        if (source.droppableId === destination.droppableId) {
            // Reordering within same column (not persisted in DB for now, just UI)
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
            // Moving between columns
            const sourceColumn = columns[source.droppableId];
            const destColumn = columns[destination.droppableId];
            const sourceItems = Array.from(sourceColumn.items);
            const destItems = Array.from(destColumn.items);
            const [removed] = sourceItems.splice(source.index, 1);

            // Optimistic update
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

            // Persist change
            // We need to:
            // 1. Remove the old stage tag
            // 2. Add the new stage tag

            try {
                // Find the tag object for the new stage
                // In a real app, we'd ensure these tags exist in the DB. 
                // For now, we assume the user has created tags with values matching our stage IDs ('novo', 'qualificado', etc.)
                // Or we create them on the fly? Better to just assume they exist or use the ID as the value.

                // Let's assume we are just updating the tags list for the contact.
                // We need to construct a FormData to reuse saveContactAction or create a specific action for moving stages.
                // Reusing saveContactAction is safer as it handles everything.

                const contact = removed;
                const newStageId = destination.droppableId;
                const oldStageId = source.droppableId;

                // Filter out the old stage tag
                const currentTags = contact.tags?.map(t => t.id) || [];
                // We need the ID of the old stage tag to remove it. 
                // But we only have the value (stageId) from the column.
                // We need to find the tag in the 'tags' state that matches the oldStageId value.
                const oldTag = tags.find(t => t.value === oldStageId);
                const newTag = tags.find(t => t.value === newStageId);

                let newTagIds = currentTags;

                if (oldTag) {
                    newTagIds = newTagIds.filter(id => id !== oldTag.id);
                }

                if (newTag) {
                    newTagIds.push(newTag.id);
                } else {
                    // If the tag for the new stage doesn't exist, we should probably create it or warn.
                    // For this MVP, let's assume if it's not found, we can't properly tag it in DB, 
                    // but we updated UI. This might revert on refresh.
                    // Ideally, we should create the tag if it doesn't exist.
                    // Let's skip auto-creation for now to avoid side effects and just warn.
                    toast({ title: "Aviso", description: `Tag para fase '${destColumn.title}' não encontrada. Crie uma tag com valor '${newStageId}'.`, variant: "destructive" });
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

                const result = await saveContactAction(null, formData);
                if (!result.success) {
                    throw new Error(result.error || "Falha ao salvar");
                }

                // Update the contact object in the state with new tags (to keep consistency for next drag)
                // We need to reconstruct the tags array for the contact
                const updatedTags = contact.tags?.filter(t => t.value !== oldStageId) || [];
                if (newTag) updatedTags.push(newTag);
                removed.tags = updatedTags;

            } catch (error: any) {
                toast({ title: "Erro ao mover contato", description: error.message, variant: 'destructive' });
                fetchData(); // Revert on error
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
        <div className="h-full overflow-x-auto bg-muted/30 p-6">
            <DragDropContext onDragEnd={onDragEnd}>
                <div className="flex h-full gap-4 min-w-max">
                    {DEFAULT_STAGES.map(stage => {
                        const column = columns[stage.id];
                        if (!column) return null;

                        return (
                            <div key={stage.id} className="flex flex-col w-80 h-full rounded-lg bg-muted/50 border border-border/50">
                                <div className="p-3 flex items-center justify-between border-b border-border/50 bg-card/50 rounded-t-lg backdrop-blur-sm sticky top-0 z-10">
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

                                <Droppable droppableId={stage.id}>
                                    {(provided, snapshot) => (
                                        <div
                                            {...provided.droppableProps}
                                            ref={provided.innerRef}
                                            className={`flex-1 p-2 overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-accent/20' : ''}`}
                                        >
                                            <div className="flex flex-col gap-2">
                                                {column.items.map((contact, index) => (
                                                    <Draggable key={contact.id} draggableId={contact.id} index={index}>
                                                        {(provided, snapshot) => (
                                                            <Card
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                onClick={() => onContactClick(contact)}
                                                                className={`cursor-pointer hover:shadow-md transition-all border-border/60 bg-card ${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20 rotate-1' : ''}`}
                                                            >
                                                                <CardContent className="p-3 space-y-3">
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                                            <Avatar className="h-6 w-6 shrink-0">
                                                                                <AvatarImage src={contact.avatar_url || undefined} />
                                                                                <AvatarFallback className="text-[10px]">{contact.name.charAt(0)}</AvatarFallback>
                                                                            </Avatar>
                                                                            <span className="font-medium text-sm truncate">{contact.name}</span>
                                                                        </div>
                                                                    </div>

                                                                    {/* Tags (excluding stage tags to avoid clutter) */}
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
                                                ))}
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
    );
}
