'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
    Zap, Plus, Trash2, Loader2, Play, Pause,
    ArrowRight, UserCheck, Target, Bell, GitBranch,
    List, Globe, Braces
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
    getAutomations, createAutomation, updateAutomation,
    deleteAutomation, toggleAutomation,
    type CrmAutomation, type AutomationAction, type AutomationTriggerConfig
} from '@/actions/automations';
import { getWorkspaceUsers, getCustomFieldDefinitions } from '@/actions/crm';
import type { User, CustomFieldDefinition } from '@/lib/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
    { value: 'stage_changed', label: 'Mudança de Estágio', icon: GitBranch, description: 'Quando um contato muda de estágio no funil' },
    { value: 'deal_created', label: 'Deal Criado', icon: Target, description: 'Quando um novo deal é criado' },
    { value: 'lead_score_above', label: 'Lead Score Acima de', icon: Zap, description: 'Quando o score do lead ultrapassa um valor' },
    { value: 'contact_created', label: 'Contato Criado', icon: UserCheck, description: 'Quando um novo contato é cadastrado' },
    { value: 'custom_field_changed', label: 'Campo Personalizado', icon: List, description: 'Quando um campo personalizado é alterado' },
];

const ACTION_TYPES = [
    { value: 'move_to_stage', label: 'Mover para Estágio', icon: ArrowRight },
    { value: 'assign_owner', label: 'Atribuir Responsável', icon: UserCheck },
    { value: 'create_deal', label: 'Criar Deal', icon: Target },
    { value: 'send_notification', label: 'Enviar Notificação', icon: Bell },
    { value: 'update_custom_field', label: 'Atualizar Campo', icon: List },
    { value: 'api_call', label: 'Chamada API', icon: Globe },
];

const STAGES = [
    { value: 'novo', label: 'Novo' },
    { value: 'qualificado', label: 'Qualificado' },
    { value: 'proposta', label: 'Proposta' },
    { value: 'negociacao', label: 'Negociação' },
    { value: 'fechamento', label: 'Fechamento' },
];

const ANY_VALUE_SENTINEL = '__any__';
const CLEAR_VALUE_SENTINEL = '__clear__';
type VariableFieldElement = HTMLInputElement | HTMLTextAreaElement;

const VariableSelector = ({ customFields, onSelect }: { customFields: CustomFieldDefinition[], onSelect: (val: string) => void }) => {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 bg-transparent border-white/10 text-white/50 hover:text-white hover:bg-white/5">
                    <Braces className="h-3.5 w-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px] max-h-[300px] overflow-y-auto bg-zinc-950 border-white/10">
                <DropdownMenuItem className="text-xs text-white/70 hover:text-white cursor-pointer" onClick={() => onSelect('{{contact.name}}')}>Nome do Contato</DropdownMenuItem>
                <DropdownMenuItem className="text-xs text-white/70 hover:text-white cursor-pointer" onClick={() => onSelect('{{contact.email}}')}>Email</DropdownMenuItem>
                <DropdownMenuItem className="text-xs text-white/70 hover:text-white cursor-pointer" onClick={() => onSelect('{{contact.phone}}')}>Telefone</DropdownMenuItem>
                <DropdownMenuItem className="text-xs text-white/70 hover:text-white cursor-pointer" onClick={() => onSelect('{{event.actor_full_name}}')}>Usuário que executou</DropdownMenuItem>
                {customFields.length > 0 && <Separator className="my-1 bg-white/10" />}
                {customFields.map(cf => (
                    <DropdownMenuItem className="text-xs text-white/70 hover:text-white cursor-pointer" key={cf.id} onClick={() => onSelect(`{{contact.custom_fields.${cf.id}}}`)}>
                        {cf.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

interface CrmAutomationsProps {
    workspaceId: string;
}

export default function CrmAutomations({ workspaceId }: CrmAutomationsProps) {
    const [automations, setAutomations] = useState<CrmAutomation[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [triggerType, setTriggerType] = useState('stage_changed');
    const [triggerConfig, setTriggerConfig] = useState<AutomationTriggerConfig>({});
    const [actions, setActions] = useState<AutomationAction[]>([]);
    const variableFieldRefs = useRef<Record<string, VariableFieldElement | null>>({});
    const variableFieldSelections = useRef<Record<string, { start: number; end: number }>>({});

    const fetchData = useCallback(async () => {
        setLoading(true);
        const [autoRes, usersRes, fieldsRes] = await Promise.all([
            getAutomations(workspaceId),
            getWorkspaceUsers(workspaceId),
            getCustomFieldDefinitions(workspaceId),
        ]);
        setAutomations(autoRes.automations);
        if (usersRes.users) setUsers(usersRes.users);
        if (fieldsRes.fields) setCustomFields(fieldsRes.fields);
        setLoading(false);
    }, [workspaceId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const resetForm = () => {
        setName('');
        setTriggerType('stage_changed');
        setTriggerConfig({});
        setActions([]);
        setEditingId(null);
    };

    const openCreate = () => {
        resetForm();
        setDialogOpen(true);
    };

    const openEdit = (auto: CrmAutomation) => {
        setName(auto.name);
        setTriggerType(auto.trigger_type);
        setTriggerConfig(auto.trigger_config || {});
        setActions(auto.actions || []);
        setEditingId(auto.id);
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!name.trim()) {
            toast({ title: 'Nome obrigatório', variant: 'destructive' });
            return;
        }
        if (actions.length === 0) {
            toast({ title: 'Adicione pelo menos uma ação', variant: 'destructive' });
            return;
        }

        if (editingId) {
            const res = await updateAutomation(editingId, { name, trigger_type: triggerType, trigger_config: triggerConfig, actions });
            if (res.error) { toast({ title: 'Erro', description: res.error, variant: 'destructive' }); return; }
            toast({ title: 'Automação atualizada!' });
        } else {
            const res = await createAutomation({ workspace_id: workspaceId, name, trigger_type: triggerType, trigger_config: triggerConfig, actions });
            if (res.error) { toast({ title: 'Erro', description: res.error, variant: 'destructive' }); return; }
            toast({ title: 'Automação criada!' });
        }

        setDialogOpen(false);
        resetForm();
        fetchData();
    };

    const handleToggle = async (id: string) => {
        await toggleAutomation(id);
        fetchData();
    };

    const handleDelete = async (id: string) => {
        await deleteAutomation(id);
        toast({ title: 'Automação excluída' });
        fetchData();
    };

    const addAction = () => {
        setActions([...actions, { type: 'move_to_stage', config: {} }]);
    };

    const removeAction = (index: number) => {
        setActions(actions.filter((_, i) => i !== index));
    };

    const updateAction = (index: number, field: string, value: any) => {
        const updated = [...actions];
        if (field === 'type') {
            updated[index] = { type: value, config: {} };
        } else {
            updated[index] = { ...updated[index], config: { ...updated[index].config, [field]: value } };
        }
        setActions(updated);
    };

    const addActionHeader = (actionIndex: number) => {
        const updated = [...actions];
        const headers = updated[actionIndex].config.headers || [];
        updated[actionIndex].config.headers = [...headers, { key: '', value: '' }];
        setActions(updated);
    };

    const updateActionHeader = (actionIndex: number, headerIndex: number, field: 'key' | 'value', value: string) => {
        const updated = [...actions];
        updated[actionIndex].config.headers[headerIndex][field] = value;
        setActions(updated);
    };

    const removeActionHeader = (actionIndex: number, headerIndex: number) => {
        const updated = [...actions];
        updated[actionIndex].config.headers = updated[actionIndex].config.headers.filter((_: any, i: number) => i !== headerIndex);
        setActions(updated);
    };

    const addActionFormData = (actionIndex: number) => {
        const updated = [...actions];
        const formData = updated[actionIndex].config.formData || [];
        updated[actionIndex].config.formData = [...formData, { key: '', value: '' }];
        setActions(updated);
    };

    const updateActionFormData = (actionIndex: number, formDataIndex: number, field: 'key' | 'value', value: string) => {
        const updated = [...actions];
        updated[actionIndex].config.formData[formDataIndex][field] = value;
        setActions(updated);
    };

    const removeActionFormData = (actionIndex: number, formDataIndex: number) => {
        const updated = [...actions];
        updated[actionIndex].config.formData = updated[actionIndex].config.formData.filter((_: any, i: number) => i !== formDataIndex);
        setActions(updated);
    };

    const rememberVariableFieldSelection = (fieldKey: string, element: VariableFieldElement) => {
        const fallbackPos = element.value.length;
        variableFieldSelections.current[fieldKey] = {
            start: element.selectionStart ?? fallbackPos,
            end: element.selectionEnd ?? fallbackPos,
        };
    };

    const insertVariableAtCursor = (
        fieldKey: string,
        currentValue: string,
        token: string,
        applyValue: (nextValue: string) => void
    ) => {
        const savedSelection = variableFieldSelections.current[fieldKey];
        let start = savedSelection?.start ?? currentValue.length;
        let end = savedSelection?.end ?? currentValue.length;

        const liveElement = variableFieldRefs.current[fieldKey];
        if (
            liveElement &&
            typeof liveElement.selectionStart === 'number' &&
            typeof liveElement.selectionEnd === 'number' &&
            document.activeElement === liveElement
        ) {
            start = liveElement.selectionStart;
            end = liveElement.selectionEnd;
        }

        const nextValue = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;
        const nextCursor = start + token.length;

        applyValue(nextValue);
        variableFieldSelections.current[fieldKey] = { start: nextCursor, end: nextCursor };

        window.setTimeout(() => {
            const element = variableFieldRefs.current[fieldKey];
            if (!element) return;
            element.focus();
            element.setSelectionRange(nextCursor, nextCursor);
        }, 0);
    };

    // ─── Helpers ────────────────────────────────────────────────────────────

    const getTriggerLabel = (type: string) => TRIGGER_TYPES.find(t => t.value === type)?.label || type;
    const getTriggerIcon = (type: string) => TRIGGER_TYPES.find(t => t.value === type)?.icon || Zap;
    const getActionLabel = (type: string) => ACTION_TYPES.find(a => a.value === type)?.label || type;
    const getCustomFieldById = (fieldId?: string) => customFields.find(f => f.id === fieldId);
    const getCustomFieldOptionLabel = (field: CustomFieldDefinition | undefined, optionValue?: string) => {
        if (!field || !optionValue) return optionValue || '';
        const option = field.options?.find(o => o.value === optionValue);
        return option?.label || optionValue;
    };

    const describeTrigger = (auto: CrmAutomation) => {
        const config = auto.trigger_config || {};
        switch (auto.trigger_type) {
            case 'stage_changed':
                if (config.from_stage && config.to_stage) return `${STAGES.find(s => s.value === config.from_stage)?.label || config.from_stage} → ${STAGES.find(s => s.value === config.to_stage)?.label || config.to_stage}`;
                if (config.to_stage) return `→ ${STAGES.find(s => s.value === config.to_stage)?.label || config.to_stage}`;
                return 'Qualquer mudança';
            case 'lead_score_above':
                return `Score ≥ ${config.threshold || 0}`;
            case 'custom_field_changed': {
                const field = getCustomFieldById(config.field_id);
                const displayValue = config.field_value
                    ? getCustomFieldOptionLabel(field, String(config.field_value))
                    : 'Qualquer valor';
                return `${field?.label || config.field_id || 'Campo'} → ${displayValue}`;
            }
            default:
                return '';
        }
    };

    const describeAction = (action: AutomationAction) => {
        switch (action.type) {
            case 'move_to_stage': return `→ ${STAGES.find(s => s.value === action.config.stage)?.label || action.config.stage || '?'}`;
            case 'assign_owner': {
                const user = users.find(u => u.id === action.config.owner_id);
                return user?.name || user?.email || action.config.owner_id || '?';
            }
            case 'create_deal': return action.config.title || 'Deal Automático';
            case 'send_notification': return action.config.message || 'Notificação';
            case 'update_custom_field': {
                const field = getCustomFieldById(action.config.field_id);
                const displayValue = getCustomFieldOptionLabel(field, action.config.field_value);
                return `${field?.label || 'Campo'} = ${displayValue || ''}`;
            }
            case 'api_call': {
                return `${action.config.method || 'GET'} ${action.config.url || '?'}`;
            }
            default: return '';
        }
    };

    // ─── Render ─────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="p-6 pb-4 flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-lg font-semibold text-white">Automações do Funil</h2>
                    <p className="text-sm text-white/50">Regras automáticas: quando algo acontecer, execute ações.</p>
                </div>
                <Button size="sm" className="gap-1.5" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Nova Automação
                </Button>
            </div>

            <ScrollArea className="flex-1 px-6 pb-6">
                {automations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                            <Zap className="h-8 w-8 text-white/30" />
                        </div>
                        <h3 className="text-base font-medium text-white/70 mb-1">Nenhuma automação criada</h3>
                        <p className="text-sm text-white/40 max-w-xs">Crie regras para automatizar ações quando contatos mudarem de estágio, deals forem criados, e mais.</p>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {automations.map(auto => {
                            const TriggerIcon = getTriggerIcon(auto.trigger_type);
                            return (
                                <Card
                                    key={auto.id}
                                    className={`bg-white/[0.03] border-white/10 transition-all hover:bg-white/[0.05] ${!auto.is_active ? 'opacity-50' : ''}`}
                                >
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3 flex-1 min-w-0">
                                                <div className="h-9 w-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                                    <TriggerIcon className="h-4 w-4 text-blue-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-medium text-sm text-white truncate">{auto.name}</span>
                                                        <Badge variant="outline" className={`text-[10px] shrink-0 ${auto.is_active ? 'text-emerald-400 border-emerald-500/30' : 'text-zinc-500 border-zinc-700'}`}>
                                                            {auto.is_active ? 'Ativa' : 'Inativa'}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-xs text-white/50 flex-wrap">
                                                        <span className="text-blue-400 font-medium">{getTriggerLabel(auto.trigger_type)}</span>
                                                        {describeTrigger(auto) && (
                                                            <>
                                                                <span className="text-white/20">•</span>
                                                                <span>{describeTrigger(auto)}</span>
                                                            </>
                                                        )}
                                                        <ArrowRight className="h-3 w-3 text-white/20 mx-0.5" />
                                                        {auto.actions.map((action, i) => (
                                                            <span key={i} className="text-amber-400">
                                                                {getActionLabel(action.type)}{' '}
                                                                <span className="text-white/40">{describeAction(action)}</span>
                                                                {i < auto.actions.length - 1 && ', '}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Switch
                                                    checked={auto.is_active}
                                                    onCheckedChange={() => handleToggle(auto.id)}
                                                    className="scale-90"
                                                />
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-white" onClick={() => openEdit(auto)}>
                                                    <Zap className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-red-400" onClick={() => handleDelete(auto.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </ScrollArea>

            {/* ─── Create/Edit Dialog ─────────────────────────────────────── */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg bg-zinc-950 border-white/10">
                    <DialogHeader>
                        <DialogTitle className="text-white">{editingId ? 'Editar' : 'Nova'} Automação</DialogTitle>
                        <DialogDescription className="text-white/50">
                            Configure quando a automação deve disparar e quais ações executar.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        {/* Name */}
                        <div className="space-y-1.5">
                            <Label className="text-white/70 text-xs">Nome</Label>
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ex: Qualificado → Atribuir Vendedor"
                                className="bg-white/5 border-white/10 text-white"
                            />
                        </div>

                        <Separator className="bg-white/10" />

                        {/* Trigger */}
                        <div className="space-y-3">
                            <Label className="text-white/70 text-xs flex items-center gap-1.5">
                                <Zap className="h-3 w-3 text-blue-400" /> Quando...
                            </Label>
                            <Select value={triggerType} onValueChange={v => { setTriggerType(v); setTriggerConfig({}); }}>
                                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TRIGGER_TYPES.map(t => (
                                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Trigger Config */}
                            {triggerType === 'stage_changed' && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-white/50 text-[10px]">De (opcional)</Label>
                                        <Select value={triggerConfig.from_stage || '_any'} onValueChange={v => setTriggerConfig({ ...triggerConfig, from_stage: v === '_any' ? undefined : v })}>
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="_any">Qualquer</SelectItem>
                                                {STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-white/50 text-[10px]">Para (opcional)</Label>
                                        <Select value={triggerConfig.to_stage || '_any'} onValueChange={v => setTriggerConfig({ ...triggerConfig, to_stage: v === '_any' ? undefined : v })}>
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="_any">Qualquer</SelectItem>
                                                {STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            )}

                            {triggerType === 'lead_score_above' && (
                                <div className="space-y-1">
                                    <Label className="text-white/50 text-[10px]">Score mínimo</Label>
                                    <Input
                                        type="number"
                                        min={0} max={100}
                                        value={triggerConfig.threshold || ''}
                                        onChange={e => setTriggerConfig({ ...triggerConfig, threshold: parseInt(e.target.value) || 0 })}
                                        className="bg-white/5 border-white/10 text-white h-8 text-xs"
                                        placeholder="Ex: 60"
                                    />
                                </div>
                            )}

                            {triggerType === 'custom_field_changed' && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-white/50 text-[10px]">Campo *</Label>
                                        <Select
                                            value={triggerConfig.field_id || ''}
                                            onValueChange={v => setTriggerConfig({ ...triggerConfig, field_id: v, field_value: '' })}
                                        >
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                <SelectValue placeholder="Selecione o campo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {customFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-white/50 text-[10px]">Igual a (opcional)</Label>
                                        {(() => {
                                            const selectedField = getCustomFieldById(triggerConfig.field_id);
                                            const fieldOptions = selectedField?.type === 'select' ? (selectedField.options || []) : [];

                                            if (fieldOptions.length > 0) {
                                                return (
                                                    <Select
                                                        value={triggerConfig.field_value || ANY_VALUE_SENTINEL}
                                                        onValueChange={v => setTriggerConfig({
                                                            ...triggerConfig,
                                                            field_value: v === ANY_VALUE_SENTINEL ? '' : v,
                                                        })}
                                                    >
                                                        <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                            <SelectValue placeholder="Qualquer valor" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value={ANY_VALUE_SENTINEL}>Qualquer valor</SelectItem>
                                                            {fieldOptions.map(option => (
                                                                <SelectItem key={option.id} value={option.value}>
                                                                    {option.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                );
                                            }

                                            return (
                                                <Input
                                                    value={triggerConfig.field_value || ''}
                                                    onChange={e => setTriggerConfig({ ...triggerConfig, field_value: e.target.value })}
                                                    className="bg-white/5 border-white/10 text-white h-8 text-xs"
                                                    placeholder="Ex: VIP"
                                                />
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>

                        <Separator className="bg-white/10" />

                        {/* Actions */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-white/70 text-xs flex items-center gap-1.5">
                                    <ArrowRight className="h-3 w-3 text-amber-400" /> Então faça...
                                </Label>
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-white/50 hover:text-white" onClick={addAction}>
                                    <Plus className="h-3 w-3 mr-1" /> Ação
                                </Button>
                            </div>

                            {actions.length === 0 && (
                                <p className="text-xs text-white/30 text-center py-3">Nenhuma ação adicionada.</p>
                            )}

                            {actions.map((action, i) => (
                                <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Select value={action.type} onValueChange={v => updateAction(i, 'type', v)}>
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8 flex-1">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ACTION_TYPES.map(a => (
                                                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-red-400 shrink-0" onClick={() => removeAction(i)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>

                                    {/* Action config */}
                                    {action.type === 'move_to_stage' && (
                                        <Select value={action.config.stage || ''} onValueChange={v => updateAction(i, 'stage', v)}>
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                <SelectValue placeholder="Selecione o estágio" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )}

                                    {action.type === 'assign_owner' && (
                                        <Select value={action.config.owner_id || ''} onValueChange={v => updateAction(i, 'owner_id', v)}>
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                <SelectValue placeholder="Selecione o responsável" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )}

                                    {action.type === 'create_deal' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                value={action.config.title || ''}
                                                onChange={e => updateAction(i, 'title', e.target.value)}
                                                placeholder="Título do deal"
                                                className="bg-white/5 border-white/10 text-white text-xs h-8"
                                            />
                                            <Input
                                                type="number"
                                                value={action.config.value || ''}
                                                onChange={e => updateAction(i, 'value', parseFloat(e.target.value) || 0)}
                                                placeholder="Valor (R$)"
                                                className="bg-white/5 border-white/10 text-white text-xs h-8"
                                            />
                                        </div>
                                    )}

                                    {action.type === 'send_notification' && (
                                        <Input
                                            value={action.config.message || ''}
                                            onChange={e => updateAction(i, 'message', e.target.value)}
                                            placeholder="Mensagem da notificação"
                                            className="bg-white/5 border-white/10 text-white text-xs h-8"
                                        />
                                    )}

                                    {action.type === 'update_custom_field' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <Select
                                                value={action.config.field_id || ''}
                                                onValueChange={v => {
                                                    const updated = [...actions];
                                                    updated[i] = {
                                                        ...updated[i],
                                                        config: { ...updated[i].config, field_id: v, field_value: '' }
                                                    };
                                                    setActions(updated);
                                                }}
                                            >
                                                <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                    <SelectValue placeholder="Selecione o campo" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {customFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            {(() => {
                                                const selectedField = getCustomFieldById(action.config.field_id);
                                                const fieldOptions = selectedField?.type === 'select' ? (selectedField.options || []) : [];

                                                if (fieldOptions.length > 0) {
                                                    return (
                                                        <Select
                                                            value={action.config.field_value || CLEAR_VALUE_SENTINEL}
                                                            onValueChange={v => updateAction(i, 'field_value', v === CLEAR_VALUE_SENTINEL ? '' : v)}
                                                        >
                                                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                                <SelectValue placeholder="Novo valor" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value={CLEAR_VALUE_SENTINEL}>Limpar valor</SelectItem>
                                                                {fieldOptions.map(option => (
                                                                    <SelectItem key={option.id} value={option.value}>
                                                                        {option.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    );
                                                }

                                                return (
                                                    <Input
                                                        value={action.config.field_value || ''}
                                                        onChange={e => updateAction(i, 'field_value', e.target.value)}
                                                        placeholder="Novo valor"
                                                        className="bg-white/5 border-white/10 text-white text-xs h-8"
                                                    />
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {action.type === 'api_call' && (
                                        <div className="space-y-4 pt-2">
                                            <div className="flex gap-2">
                                                <div className="w-[100px]">
                                                    <Select value={action.config.method || 'GET'} onValueChange={v => updateAction(i, 'method', v)}>
                                                        <SelectTrigger className="bg-white/5 border-white/10 text-white text-xs h-8">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="GET">GET</SelectItem>
                                                            <SelectItem value="POST">POST</SelectItem>
                                                            <SelectItem value="PUT">PUT</SelectItem>
                                                            <SelectItem value="DELETE">DELETE</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="flex flex-1 gap-1">
                                                    <Input
                                                        value={action.config.url || ''}
                                                        ref={element => { variableFieldRefs.current[`action-${i}-url`] = element; }}
                                                        onSelect={e => rememberVariableFieldSelection(`action-${i}-url`, e.currentTarget)}
                                                        onClick={e => rememberVariableFieldSelection(`action-${i}-url`, e.currentTarget)}
                                                        onKeyUp={e => rememberVariableFieldSelection(`action-${i}-url`, e.currentTarget)}
                                                        onBlur={e => rememberVariableFieldSelection(`action-${i}-url`, e.currentTarget)}
                                                        onChange={e => {
                                                            updateAction(i, 'url', e.target.value);
                                                            rememberVariableFieldSelection(`action-${i}-url`, e.currentTarget);
                                                        }}
                                                        placeholder="URL do Webhook (ex: https://api.exemplo.com/webhook)"
                                                        className="bg-white/5 border-white/10 text-white text-xs h-8 flex-1"
                                                    />
                                                    <VariableSelector
                                                        customFields={customFields}
                                                        onSelect={(val) => insertVariableAtCursor(
                                                            `action-${i}-url`,
                                                            action.config.url || '',
                                                            val,
                                                            (nextValue) => updateAction(i, 'url', nextValue)
                                                        )}
                                                    />
                                                </div>
                                            </div>

                                            {/* Headers */}
                                            <div className="space-y-2 border border-white/5 p-3 rounded-md bg-white/5 text-xs">
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-white/70 font-medium">Headers</Label>
                                                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-white/50 hover:text-white" onClick={() => addActionHeader(i)}>
                                                        <Plus className="h-3 w-3 mr-1" /> Adicionar Header
                                                    </Button>
                                                </div>
                                                {(action.config.headers || []).map((header: any, hIndex: number) => (
                                                    <div key={hIndex} className="flex gap-2">
                                                        <Input
                                                            value={header.key}
                                                            onChange={e => updateActionHeader(i, hIndex, 'key', e.target.value)}
                                                            placeholder="Key (ex: Authorization)"
                                                            className="bg-black/20 border-white/10 text-white h-7 text-xs flex-1"
                                                        />
                                                        <div className="flex flex-1 gap-1">
                                                            <Input
                                                                value={header.value}
                                                                ref={element => { variableFieldRefs.current[`action-${i}-header-${hIndex}-value`] = element; }}
                                                                onSelect={e => rememberVariableFieldSelection(`action-${i}-header-${hIndex}-value`, e.currentTarget)}
                                                                onClick={e => rememberVariableFieldSelection(`action-${i}-header-${hIndex}-value`, e.currentTarget)}
                                                                onKeyUp={e => rememberVariableFieldSelection(`action-${i}-header-${hIndex}-value`, e.currentTarget)}
                                                                onBlur={e => rememberVariableFieldSelection(`action-${i}-header-${hIndex}-value`, e.currentTarget)}
                                                                onChange={e => {
                                                                    updateActionHeader(i, hIndex, 'value', e.target.value);
                                                                    rememberVariableFieldSelection(`action-${i}-header-${hIndex}-value`, e.currentTarget);
                                                                }}
                                                                placeholder="Value (ex: Bearer token...)"
                                                                className="bg-black/20 border-white/10 text-white h-7 text-xs flex-1"
                                                            />
                                                            <div className="scale-[0.875] origin-right">
                                                                <VariableSelector
                                                                    customFields={customFields}
                                                                    onSelect={(val) => insertVariableAtCursor(
                                                                        `action-${i}-header-${hIndex}-value`,
                                                                        header.value || '',
                                                                        val,
                                                                        (nextValue) => updateActionHeader(i, hIndex, 'value', nextValue)
                                                                    )}
                                                                />
                                                            </div>
                                                        </div>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-red-400 shrink-0" onClick={() => removeActionHeader(i, hIndex)}>
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                ))}
                                                {!(action.config.headers?.length > 0) && <p className="text-[10px] text-white/30">Nenhum header configurado.</p>}
                                            </div>

                                            {/* Body Configuration */}
                                            {action.config.method !== 'GET' && (
                                                <div className="space-y-2 border border-white/5 p-3 rounded-md bg-white/5 text-xs">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Label className="text-white/70 font-medium">Body (Payload)</Label>
                                                        <Select value={action.config.bodyType || 'json'} onValueChange={v => updateAction(i, 'bodyType', v)}>
                                                            <SelectTrigger className="w-[180px] bg-black/20 border-white/10 text-white text-[10px] h-6 px-2">
                                                                <SelectValue placeholder="Tipo de Envío" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="none">Nenhum</SelectItem>
                                                                <SelectItem value="json">JSON (raw)</SelectItem>
                                                                <SelectItem value="form-data">x-www-form-urlencoded</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    {/* JSON Textarea payload */}
                                                    {(action.config.bodyType === 'json' || !action.config.bodyType) && (
                                                        <div className="relative">
                                                            <Textarea
                                                                value={action.config.payload || ''}
                                                                ref={element => { variableFieldRefs.current[`action-${i}-payload`] = element; }}
                                                                onSelect={e => rememberVariableFieldSelection(`action-${i}-payload`, e.currentTarget)}
                                                                onClick={e => rememberVariableFieldSelection(`action-${i}-payload`, e.currentTarget)}
                                                                onKeyUp={e => rememberVariableFieldSelection(`action-${i}-payload`, e.currentTarget)}
                                                                onBlur={e => rememberVariableFieldSelection(`action-${i}-payload`, e.currentTarget)}
                                                                onChange={e => {
                                                                    updateAction(i, 'payload', e.target.value);
                                                                    rememberVariableFieldSelection(`action-${i}-payload`, e.currentTarget);
                                                                }}
                                                                placeholder='Payload JSON (Opcional). Ex: { "id": "{{contact.id}}" }'
                                                                className="bg-black/20 border-white/10 text-white text-xs min-h-[60px] resize-y pr-10"
                                                            />
                                                            <div className="absolute top-1 right-1">
                                                                <VariableSelector
                                                                    customFields={customFields}
                                                                    onSelect={(val) => insertVariableAtCursor(
                                                                        `action-${i}-payload`,
                                                                        action.config.payload || '',
                                                                        val,
                                                                        (nextValue) => updateAction(i, 'payload', nextValue)
                                                                    )}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* URL Encoded Form Data */}
                                                    {action.config.bodyType === 'form-data' && (
                                                        <div className="space-y-2">
                                                            <div className="flex justify-end">
                                                                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-white/50 hover:text-white" onClick={() => addActionFormData(i)}>
                                                                    <Plus className="h-3 w-3 mr-1" /> Adicionar Parâmetro
                                                                </Button>
                                                            </div>
                                                            {(action.config.formData || []).map((data: any, dIndex: number) => (
                                                                <div key={dIndex} className="flex gap-2">
                                                                    <Input
                                                                        value={data.key}
                                                                        onChange={e => updateActionFormData(i, dIndex, 'key', e.target.value)}
                                                                        placeholder="Key (ex: email)"
                                                                        className="bg-black/20 border-white/10 text-white h-7 text-xs flex-1"
                                                                    />
                                                                    <div className="flex flex-1 gap-1">
                                                                        <Input
                                                                            value={data.value}
                                                                            ref={element => { variableFieldRefs.current[`action-${i}-formdata-${dIndex}-value`] = element; }}
                                                                            onSelect={e => rememberVariableFieldSelection(`action-${i}-formdata-${dIndex}-value`, e.currentTarget)}
                                                                            onClick={e => rememberVariableFieldSelection(`action-${i}-formdata-${dIndex}-value`, e.currentTarget)}
                                                                            onKeyUp={e => rememberVariableFieldSelection(`action-${i}-formdata-${dIndex}-value`, e.currentTarget)}
                                                                            onBlur={e => rememberVariableFieldSelection(`action-${i}-formdata-${dIndex}-value`, e.currentTarget)}
                                                                            onChange={e => {
                                                                                updateActionFormData(i, dIndex, 'value', e.target.value);
                                                                                rememberVariableFieldSelection(`action-${i}-formdata-${dIndex}-value`, e.currentTarget);
                                                                            }}
                                                                            placeholder="Value (ex: {{contact.email}})"
                                                                            className="bg-black/20 border-white/10 text-white h-7 text-xs flex-1"
                                                                        />
                                                                        <div className="scale-[0.875] origin-right">
                                                                            <VariableSelector
                                                                                customFields={customFields}
                                                                                onSelect={(val) => insertVariableAtCursor(
                                                                                    `action-${i}-formdata-${dIndex}-value`,
                                                                                    data.value || '',
                                                                                    val,
                                                                                    (nextValue) => updateActionFormData(i, dIndex, 'value', nextValue)
                                                                                )}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-red-400 shrink-0" onClick={() => removeActionFormData(i, dIndex)}>
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                            {!(action.config.formData?.length > 0) && <p className="text-[10px] text-white/30 mt-1">Nenhum parâmetro configurado.</p>}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-white/10 text-white/50">
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} className="gap-1.5">
                            <Zap className="h-3.5 w-3.5" />
                            {editingId ? 'Salvar' : 'Criar'} Automação
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
