
'use client';

import React, { useState, useEffect } from 'react';
import type { CustomFieldDefinition, SelectableOption, Tag, Team, User } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Trash2, Palette, Loader2, Edit2, Tag as TagIcon, LayoutList } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '../ui/checkbox';
import { DialogClose } from '@radix-ui/react-dialog';
import { ScrollArea } from '../ui/scroll-area';
import { Textarea } from '../ui/textarea';
import {
    getTags,
    createTag,
    updateTag,
    deleteTag,
    getCustomFieldDefinitions,
    getWorkspaceConversionFieldConfig,
    createCustomFieldDefinition,
    updateCustomFieldDefinition,
    updateWorkspaceConversionFieldConfig,
    deleteCustomFieldDefinition
} from '@/actions/crm';
import { getTeams } from '@/actions/teams';
import { toast } from '@/hooks/use-toast';
import { PIPELINE_STAGE_CATEGORY } from '@/lib/crm-pipeline';

// A generic manager for lists of selectable options (like lead sources, job titles, etc.)
function OptionsManager({
    title,
    options,
    teams,
    onAdd,
    onRemove,
    onUpdate // Added onUpdate prop
}: {
    title: string,
    options: Tag[],
    teams?: Team[],
    onAdd: (label: string, color: string, isCloseReason: boolean, teamIds: string[]) => Promise<any>,
    onRemove: (id: string) => Promise<any>,
    onUpdate?: (id: string, label: string, color: string, isCloseReason: boolean, teamIds: string[]) => Promise<any>
}) {
    const [newItemLabel, setNewItemLabel] = useState('');
    const [newItemColor, setNewItemColor] = useState('#cccccc');
    const [isCloseReason, setIsCloseReason] = useState(false);
    const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingItem, setEditingItem] = useState<Tag | null>(null); // State for editing

    useEffect(() => {
        if (editingItem) {
            setNewItemLabel(editingItem.label);
            setNewItemColor(editingItem.color);
            setIsCloseReason(editingItem.is_close_reason);
            setSelectedTeamIds(editingItem.team_ids || []);
        } else {
            setNewItemLabel('');
            setNewItemColor('#cccccc');
            setIsCloseReason(false);
            setSelectedTeamIds([]);
        }
    }, [editingItem]);

    const handleCancelEdit = () => {
        setEditingItem(null);
    };

    const handleAddItem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newItemLabel.trim()) return;

        setIsSubmitting(true);

        if (editingItem && onUpdate) {
            const result = await onUpdate(editingItem.id, newItemLabel, newItemColor, isCloseReason, selectedTeamIds);
            if (result.success) {
                toast({ title: 'Etiqueta Atualizada!' });
                setEditingItem(null);
            } else {
                toast({ title: 'Erro ao Atualizar', description: result.error, variant: 'destructive' });
            }
        } else {
            const result = await onAdd(newItemLabel, newItemColor, isCloseReason, selectedTeamIds);
            if (result.success) {
                setNewItemLabel('');
                setNewItemColor('#cccccc');
                setIsCloseReason(false);
                setSelectedTeamIds([]);
                toast({ title: 'Etiqueta Adicionada!' })
            } else {
                toast({ title: 'Erro ao Adicionar', description: result.error, variant: 'destructive' })
            }
        }
        setIsSubmitting(false);
    };

    const handleRemoveItem = async (itemToRemove: Tag) => {
        const result = await onRemove(itemToRemove.id);
        if (result.success) {
            toast({ title: 'Etiqueta Removida!' })
        } else {
            toast({ title: 'Erro ao Remover', description: result.error, variant: 'destructive' })
        }
    };

    // Toggle team selection
    const toggleTeam = (teamId: string) => {
        setSelectedTeamIds(prev =>
            prev.includes(teamId)
                ? prev.filter(id => id !== teamId)
                : [...prev, teamId]
        );
    };

    return (
        <div className="flex flex-col gap-6 w-full">
            {/* Form Section */}
            <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 shadow-sm transition-all hover:bg-card/50">
                <div className="mb-5">
                    <h3 className="font-semibold text-[15px] tracking-tight">{title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">Adicione ou edite as {title.toLowerCase()} disponíveis no sistema.</p>
                </div>

                <form onSubmit={handleAddItem} className="space-y-6">
                    <div className="flex flex-col sm:flex-row gap-5">
                        <div className="flex-1 group space-y-2">
                            <Label htmlFor={`new-option-${title}`} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Nome da Opção</Label>
                            <Input
                                id={`new-option-${title}`}
                                placeholder="Ex: Lead Quente"
                                value={newItemLabel}
                                onChange={(e) => setNewItemLabel(e.target.value)}
                                className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4"
                            />
                        </div>
                        <div className="w-full sm:w-28 group space-y-2">
                            <Label htmlFor={`new-color-${title}`} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Cor</Label>
                            <div className="flex items-center gap-2 border border-border/40 hover:border-border/80 bg-background/50 rounded-xl h-11 px-3 shadow-sm transition-all focus-within:ring-1 focus-within:ring-ring focus-within:bg-background">
                                <Palette className="h-4 w-4 text-muted-foreground shrink-0" />
                                <input
                                    id={`new-color-${title}`}
                                    type="color"
                                    value={newItemColor}
                                    onChange={(e) => setNewItemColor(e.target.value)}
                                    className="w-full h-7 p-0 border-none bg-transparent cursor-pointer rounded-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Team Selection UI */}
                    {title === "Etiquetas (Tags)" && teams && teams.length > 0 && (
                        <div className="space-y-3">
                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                                Restringir a Equipes
                                <span className="text-muted-foreground/50 normal-case lowercase text-[10px] tracking-normal font-medium px-1.5 py-0.5 rounded-md bg-foreground/5">(Opcional - Vazio = Todas)</span>
                            </Label>
                            <div className="flex flex-wrap gap-2 pt-1">
                                {teams.map(team => (
                                    <label
                                        key={team.id}
                                        className={cn(
                                            "flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-all active:scale-95",
                                            selectedTeamIds.includes(team.id)
                                                ? "bg-primary/10 border-primary/30 text-primary shadow-sm"
                                                : "bg-background/50 border-border/40 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                                        )}
                                    >
                                        <Checkbox
                                            id={`team-${team.id}`}
                                            checked={selectedTeamIds.includes(team.id)}
                                            onCheckedChange={() => toggleTeam(team.id)}
                                            className="sr-only" // hidden logic
                                        />
                                        {team.name}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2 border-t border-border/20">
                        {title === "Etiquetas (Tags)" ? (
                            <label className="flex items-center gap-3 cursor-pointer group py-2">
                                <Checkbox
                                    id={`is-close-reason-${title}`}
                                    checked={isCloseReason}
                                    onCheckedChange={(checked) => setIsCloseReason(!!checked)}
                                    className="rounded-md border-border/50 data-[state=checked]:bg-primary h-5 w-5"
                                />
                                <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors select-none">
                                    Usar como motivo de encerramento
                                </span>
                            </label>
                        ) : <div />}

                        <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
                            {editingItem && (
                                <Button type="button" variant="ghost" className="h-10 rounded-xl px-4 w-full sm:w-auto hover:bg-muted/50" onClick={handleCancelEdit}>
                                    Cancelar
                                </Button>
                            )}
                            <Button type="submit" className="h-10 rounded-xl px-6 w-full sm:w-auto bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/20 transition-all font-medium">
                                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                {editingItem ? 'Salvar Alterações' : 'Adicionar Opção'}
                            </Button>
                        </div>
                    </div>
                </form>
            </div>

            {/* List Section */}
            <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-0 shadow-sm flex flex-col min-h-[350px] overflow-hidden">
                <div className="px-6 py-5 border-b border-border/20 bg-muted/10 flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-[15px] tracking-tight">Opções Cadastradas</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Gerencie as opções existentes abaixo.</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full font-mono text-xs px-2.5 bg-background shadow-sm border border-border/40">{options.length}</Badge>
                </div>

                <ScrollArea className="flex-1 h-[350px]">
                    <div className="space-y-3 p-6">
                        {options.length === 0 ? (
                            <div className="flex flex-col items-center justify-center text-center py-12 px-4 border border-dashed border-border/40 rounded-xl bg-background/20">
                                <div className="h-10 w-10 flex items-center justify-center rounded-full bg-muted/50 mb-3">
                                    <TagIcon className="h-5 w-5 text-muted-foreground/50" />
                                </div>
                                <p className="text-sm font-medium">Nenhuma opção cadastrada</p>
                                <p className="text-xs text-muted-foreground mt-1">Use o formulário acima para adicionar a primeira opção.</p>
                            </div>
                        ) : (
                            options.map(option => (
                                <div key={option.id} className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-border/30 rounded-xl bg-background/40 hover:bg-background/80 hover:border-border/60 transition-all shadow-sm gap-3">
                                    <div className="flex items-start gap-4">
                                        <div className="mt-1 h-5 w-5 rounded-full shadow-sm ring-2 ring-background shrink-0" style={{ backgroundColor: option.color }} />
                                        <div className="flex flex-col gap-1.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-[14px] text-foreground">{option.label}</span>
                                                {option.is_close_reason && (
                                                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-200/20 font-medium h-5 px-2 text-[10px] uppercase tracking-wider">
                                                        Encerramento
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="text-[11px] font-mono text-muted-foreground/60 select-all">ID: {option.id}</span>

                                            {option.team_ids && option.team_ids.length > 0 && teams && (
                                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Equipes:</span>
                                                    <div className="flex flex-wrap gap-1">
                                                        {option.team_ids.map(tid => {
                                                            const team = teams.find(t => t.id === tid);
                                                            if (!team) return null;
                                                            return (
                                                                <Badge key={tid} variant="outline" className="h-5 px-1.5 text-[10px] font-medium bg-background border-border/50 text-muted-foreground">
                                                                    {team.name}
                                                                </Badge>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 self-end sm:self-center opacity-100 sm:opacity-40 sm:group-hover:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-background border border-transparent hover:border-border/50 transition-all shadow-sm hover:shadow" onClick={() => setEditingItem(option)}>
                                            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span className="sr-only">Editar</span>
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 transition-all shadow-sm hover:shadow" onClick={() => handleRemoveItem(option)}>
                                            <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                                            <span className="sr-only">Remover</span>
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    )
}


export function CrmSettings({ children, user }: { children: React.ReactNode, user: User | null }) {
    const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
    const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
    const [conversionFieldId, setConversionFieldId] = useState('');
    const [conversionFieldValue, setConversionFieldValue] = useState('');
    const [savingConversionConfig, setSavingConversionConfig] = useState(false);
    const [newFieldLabel, setNewFieldLabel] = useState('');
    const [newFieldType, setNewFieldType] = useState<CustomFieldDefinition['type']>('text');
    const [newFieldOptions, setNewFieldOptions] = useState('');
    const [newFieldPlaceholder, setNewFieldPlaceholder] = useState('');

    const [tags, setTags] = useState<Tag[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchAllData = React.useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        const [tagsResult, fieldsResult, teamsResult, conversionResult] = await Promise.all([
            getTags(user.activeWorkspaceId),
            getCustomFieldDefinitions(user.activeWorkspaceId),
            getTeams(user.activeWorkspaceId),
            getWorkspaceConversionFieldConfig(user.activeWorkspaceId),
        ]);

        if (!tagsResult.error) {
            setTags((tagsResult.tags || []).filter(tag => tag.category !== PIPELINE_STAGE_CATEGORY));
        }
        const loadedFields = fieldsResult.fields || [];
        if (!fieldsResult.error) setFields(loadedFields);
        if (!teamsResult.error) setTeams(teamsResult.teams || []);
        if (!conversionResult.error && conversionResult.config) {
            const configFieldId = conversionResult.config.fieldId || '';
            const fieldExists = loadedFields.some(field => field.id === configFieldId);
            setConversionFieldId(fieldExists ? configFieldId : '');
            setConversionFieldValue(fieldExists ? (conversionResult.config.fieldValue || '') : '');
        }

        setLoading(false);
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        if (user) {
            fetchAllData();
        }
    }, [user, fetchAllData]);

    const handleAddTag = async (label: string, color: string, isCloseReason: boolean, teamIds: string[]) => {
        if (!user?.activeWorkspaceId) return { success: false, error: 'Workspace não encontrado' };
        const result = await createTag(user.activeWorkspaceId, label, color, isCloseReason, teamIds);
        if (result.success) {
            fetchAllData(); // Re-fetch all data
        }
        return result;
    }

    const handleUpdateTag = async (id: string, label: string, color: string, isCloseReason: boolean, teamIds: string[]) => {
        if (!user?.activeWorkspaceId) return { success: false, error: 'Workspace não encontrado' };
        const result = await updateTag(id, label, color, isCloseReason, teamIds);
        if (result.success) {
            fetchAllData();
        }
        return result;
    }

    const handleRemoveTag = async (tagId: string) => {
        const result = await deleteTag(tagId);
        if (result.success) {
            fetchAllData(); // Re-fetch all data
        }
        return result;
    }

    const handleAddField = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFieldLabel.trim() || !user?.activeWorkspaceId) return;

        let options: SelectableOption[] | undefined;
        if (newFieldType === 'select' && newFieldOptions.trim()) {
            options = newFieldOptions.split(',').map((opt, index) => {
                const trimmedOpt = opt.trim();
                const value = trimmedOpt.toLowerCase().replace(/\s+/g, '_');
                return {
                    id: `${value}-${index}`,
                    value: value,
                    label: trimmedOpt,
                };
            });
        }

        const newField: Omit<CustomFieldDefinition, 'id' | 'workspace_id'> = {
            label: newFieldLabel,
            type: newFieldType,
            placeholder: newFieldPlaceholder || `Insira ${newFieldLabel}...`,
            options: options,
        };

        const result = editingFieldId
            ? await updateCustomFieldDefinition(editingFieldId, newField)
            : await createCustomFieldDefinition(user.activeWorkspaceId, newField);

        if (result.success) {
            toast({ title: editingFieldId ? 'Campo Atualizado!' : 'Campo Criado!' })
            setNewFieldLabel('');
            setNewFieldType('text');
            setNewFieldOptions('');
            setNewFieldPlaceholder('');
            setEditingFieldId(null);
            fetchAllData();
        } else {
            toast({
                title: editingFieldId ? 'Erro ao Atualizar Campo' : 'Erro ao Criar Campo',
                description: result.error,
                variant: 'destructive'
            })
        }
    };

    const handleEditField = (field: CustomFieldDefinition) => {
        setEditingFieldId(field.id);
        setNewFieldLabel(field.label || '');
        setNewFieldType(field.type);
        setNewFieldPlaceholder(field.placeholder || '');
        setNewFieldOptions(
            field.type === 'select'
                ? (field.options || []).map(option => option.label).join(', ')
                : ''
        );
    };

    const cancelFieldEdit = () => {
        setEditingFieldId(null);
        setNewFieldLabel('');
        setNewFieldType('text');
        setNewFieldOptions('');
        setNewFieldPlaceholder('');
    };

    const selectedConversionField = fields.find(field => field.id === conversionFieldId);
    const selectedConversionFieldOptions =
        selectedConversionField?.type === 'select'
            ? (selectedConversionField.options || [])
            : [];

    const handleSaveConversionConfig = async () => {
        if (!user?.activeWorkspaceId) return;

        setSavingConversionConfig(true);
        const result = await updateWorkspaceConversionFieldConfig(user.activeWorkspaceId, {
            fieldId: conversionFieldId || null,
            fieldValue: conversionFieldId ? conversionFieldValue : '',
        });
        setSavingConversionConfig(false);

        if (result.success) {
            toast({ title: 'Configuração de conversão salva!' });
            fetchAllData();
        } else {
            toast({ title: 'Erro ao salvar configuração', description: result.error, variant: 'destructive' });
        }
    };

    const handleRemoveField = async (id: string) => {
        const result = await deleteCustomFieldDefinition(id);
        if (result.success) {
            toast({ title: 'Campo Removido!' })
            fetchAllData();
        } else {
            toast({ title: 'Erro ao Remover Campo', description: result.error, variant: 'destructive' })
        }
    };


    return (
        <Dialog>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Configurações do CRM</DialogTitle>
                    <DialogDescription>
                        Gerencie os campos e opções que aparecerão nos formulários e perfis. Adapte o CRM às necessidades do seu negócio.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[70vh] overflow-y-auto p-1">
                    <Tabs defaultValue="fields">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="fields">Campos Personalizados</TabsTrigger>
                            <TabsTrigger value="options">Etiquetas e Opções</TabsTrigger>
                        </TabsList>
                        <TabsContent value="fields" className="pt-2 focus-visible:outline-none focus-visible:ring-0">
                            <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 space-y-6 shadow-sm">
                                <div>
                                    <h3 className="font-semibold text-[15px] tracking-tight">Gerenciador de Campos</h3>
                                    <p className="text-sm text-muted-foreground mt-1">Crie campos únicos para capturar informações essenciais para o seu negócio.</p>
                                </div>

                                <div className="p-4 border border-border/30 rounded-xl bg-background/20 space-y-3">
                                    <div>
                                        <h4 className="text-sm font-semibold">Campo de Conversão (Analytics)</h4>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Selecione qual campo do CRM define quando um lead é considerado convertido.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Campo</Label>
                                            <Select
                                                value={conversionFieldId || '__none__'}
                                                onValueChange={(value) => {
                                                    const nextFieldId = value === '__none__' ? '' : value;
                                                    setConversionFieldId(nextFieldId);
                                                    setConversionFieldValue('');
                                                }}
                                            >
                                                <SelectTrigger className="h-10 bg-background/50 border-border/40">
                                                    <SelectValue placeholder="Selecione um campo" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">Nenhum campo</SelectItem>
                                                    {fields.map(field => (
                                                        <SelectItem key={field.id} value={field.id}>
                                                            {field.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1.5 md:col-span-2">
                                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Valor de Conversão</Label>
                                            {selectedConversionFieldOptions.length > 0 ? (
                                                <Select
                                                    value={conversionFieldValue || '__any__'}
                                                    onValueChange={(value) => setConversionFieldValue(value === '__any__' ? '' : value)}
                                                    disabled={!conversionFieldId}
                                                >
                                                    <SelectTrigger className="h-10 bg-background/50 border-border/40">
                                                        <SelectValue placeholder="Qualquer valor preenchido" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__any__">Qualquer valor preenchido</SelectItem>
                                                        {selectedConversionFieldOptions.map(option => (
                                                            <SelectItem key={option.id} value={option.value}>
                                                                {option.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input
                                                    value={conversionFieldValue}
                                                    onChange={(e) => setConversionFieldValue(e.target.value)}
                                                    className="h-10 bg-background/50 border-border/40"
                                                    placeholder={conversionFieldId ? 'Ex: cliente' : 'Selecione um campo primeiro'}
                                                    disabled={!conversionFieldId}
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs text-muted-foreground">
                                            Se o valor ficar vazio, qualquer valor preenchido no campo contará como conversão.
                                        </p>
                                        <Button
                                            type="button"
                                            className="h-9"
                                            onClick={handleSaveConversionConfig}
                                            disabled={savingConversionConfig}
                                        >
                                            {savingConversionConfig && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                            Salvar Conversão
                                        </Button>
                                    </div>
                                </div>

                                <div>
                                    <form onSubmit={handleAddField} className="flex flex-col gap-5 p-5 border border-border/30 rounded-xl bg-background/30 mb-8 shadow-sm">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
                                            <div className="group space-y-2">
                                                <Label htmlFor="field-label" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Nome do Campo</Label>
                                                <Input
                                                    id="field-label"
                                                    placeholder="Ex: Orçamento Anual"
                                                    value={newFieldLabel}
                                                    onChange={(e) => setNewFieldLabel(e.target.value)}
                                                    className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4"
                                                />
                                            </div>
                                            <div className="group space-y-2">
                                                <Label htmlFor="field-type" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Tipo do Campo</Label>
                                                <Select value={newFieldType} onValueChange={(val) => setNewFieldType(val as CustomFieldDefinition['type'])}>
                                                    <SelectTrigger id="field-type" className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4">
                                                        <SelectValue placeholder="Selecione o tipo" />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                                        <SelectItem value="text">Texto</SelectItem>
                                                        <SelectItem value="number">Número</SelectItem>
                                                        <SelectItem value="date">Data</SelectItem>
                                                        <SelectItem value="email">Email</SelectItem>
                                                        <SelectItem value="tel">Telefone</SelectItem>
                                                        <SelectItem value="select">Dropdown</SelectItem>
                                                        <SelectItem value="file">Arquivo (Anexo)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="md:pt-[24px] flex gap-2">
                                                {editingFieldId && (
                                                    <Button type="button" variant="outline" className="h-11 rounded-xl border-border/40" onClick={cancelFieldEdit}>
                                                        Cancelar
                                                    </Button>
                                                )}
                                                <Button type="submit" className="h-11 flex-1 rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/20 transition-all font-medium">
                                                    <PlusCircle className="mr-2 h-4 w-4" />
                                                    {editingFieldId ? 'Salvar Campo' : 'Adicionar Campo'}
                                                </Button>
                                            </div>
                                        </div>

                                        {newFieldType === 'select' ? (
                                            <div className="group space-y-2 animate-in fade-in-50 slide-in-from-top-2 duration-300 border-t border-border/20 pt-4 mt-2">
                                                <Label htmlFor="field-options" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors flex items-center gap-1.5">
                                                    Opções do Dropdown
                                                    <span className="text-[9px] normal-case bg-foreground/5 px-1.5 py-0.5 rounded-md font-medium tracking-normal text-muted-foreground/70">(Separadas por vírgula)</span>
                                                </Label>
                                                <Textarea
                                                    id="field-options"
                                                    placeholder="Opção 1, Opção 2, Opção 3"
                                                    value={newFieldOptions}
                                                    onChange={(e) => setNewFieldOptions(e.target.value)}
                                                    className="resize-none bg-background/50 border-border/40 hover:border-border/80 rounded-xl shadow-sm focus:bg-background transition-all min-h-[80px]"
                                                />
                                            </div>
                                        ) : (
                                            <div className="group space-y-2 animate-in fade-in-50 slide-in-from-top-2 duration-300 border-t border-border/20 pt-4 mt-2">
                                                <Label htmlFor="field-placeholder" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Texto de Exemplo (Placeholder)</Label>
                                                <Input
                                                    id="field-placeholder"
                                                    placeholder="Ex: R$ 50.000"
                                                    value={newFieldPlaceholder}
                                                    onChange={(e) => setNewFieldPlaceholder(e.target.value)}
                                                    className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4"
                                                />
                                            </div>
                                        )}
                                    </form>

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between pb-2 border-b border-border/20">
                                            <h3 className="font-semibold text-sm">Campos Atuais</h3>
                                            <Badge variant="secondary" className="rounded-full font-mono text-xs">{fields.length}</Badge>
                                        </div>

                                        <ScrollArea className="h-[250px] pr-4">
                                            {fields.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-3 pb-4">
                                                    {fields.map(field => (
                                                        <div key={field.id} className="group flex items-center justify-between p-4 border border-border/30 rounded-xl bg-background/40 hover:bg-background/80 transition-all shadow-sm">
                                                            <div className="flex flex-col gap-1.5 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="font-semibold text-[14px] truncate">{field.label}</p>
                                                                    <Badge variant="outline" className="capitalize text-[10px] h-5 px-1.5 bg-background border-border/50 text-muted-foreground">{field.type}</Badge>
                                                                </div>

                                                                {field.type === 'select' && field.options && (
                                                                    <div className="flex items-center gap-1.5 mt-1 overflow-x-auto pb-1 scrollbar-hide">
                                                                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Opções:</span>
                                                                        {field.options.map(o => (
                                                                            <Badge key={o.id} variant="secondary" className="h-5 px-1.5 text-[10px] font-medium shrink-0 bg-secondary/50 border border-border/20">
                                                                                {o.label}
                                                                            </Badge>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 shrink-0 rounded-lg hover:bg-background border border-transparent hover:border-border/50 transition-all opacity-100 sm:opacity-40 sm:group-hover:opacity-100"
                                                                    onClick={() => handleEditField(field)}
                                                                >
                                                                    <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                                                                    <span className="sr-only">Editar</span>
                                                                </Button>
                                                                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 transition-all opacity-100 sm:opacity-40 sm:group-hover:opacity-100" onClick={() => handleRemoveField(field.id)}>
                                                                    <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                                                                    <span className="sr-only">Remover</span>
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-border/40 rounded-xl bg-background/20 mt-2">
                                                    <div className="h-10 w-10 flex items-center justify-center rounded-full bg-muted/50 mb-3">
                                                        <LayoutList className="h-5 w-5 text-muted-foreground/50" />
                                                    </div>
                                                    <p className="text-sm text-muted-foreground">Nenhum campo personalizado criado.</p>
                                                </div>
                                            )}
                                        </ScrollArea>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                        <TabsContent value="options" className="pt-2 focus-visible:outline-none focus-visible:ring-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1">
                                {loading ? (
                                    <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center py-20">
                                        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                                        <p className="text-sm font-medium text-muted-foreground animate-pulse">Carregando etiquetas...</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* The OptionsManager maps to full width by default but inside grid-cols-2 it takes half. 
                                            Since CRM settings only has one OptionsManager right now, we can make it full width 
                                            or keep it half width. The user wants it more spacious, let's remove the grid cols and let it be full width. */}
                                        <div className="col-span-1 md:col-span-2">
                                            <OptionsManager
                                                title="Etiquetas (Tags)"
                                                options={tags}
                                                teams={teams}
                                                onAdd={handleAddTag}
                                                onUpdate={handleUpdateTag}
                                                onRemove={handleRemoveTag}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Fechar</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
