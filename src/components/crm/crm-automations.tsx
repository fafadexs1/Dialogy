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
    Zap, Plus, Trash2, Loader2,
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

// Constants

const TRIGGER_TYPES = [
    { value: 'stage_changed', label: 'Mudanca de Estagio', icon: GitBranch, description: 'Quando um contato muda de estagio no funil' },
    { value: 'deal_created', label: 'Deal Criado', icon: Target, description: 'Quando um novo deal e criado' },
    { value: 'lead_score_above', label: 'Lead Score Acima de', icon: Zap, description: 'Quando o score do lead ultrapassa um valor' },
    { value: 'contact_created', label: 'Contato Criado', icon: UserCheck, description: 'Quando um novo contato e cadastrado' },
    { value: 'custom_field_changed', label: 'Campo Personalizado', icon: List, description: 'Quando um campo personalizado e alterado' },
];

const ACTION_TYPES = [
    { value: 'move_to_stage', label: 'Mover para Estagio', icon: ArrowRight },
    { value: 'assign_owner', label: 'Atribuir Responsavel', icon: UserCheck },
    { value: 'create_deal', label: 'Criar Deal', icon: Target },
    { value: 'send_notification', label: 'Enviar Notificacao', icon: Bell },
    { value: 'update_custom_field', label: 'Atualizar Campo', icon: List },
    { value: 'api_call', label: 'Chamada API', icon: Globe },
];

const STAGES = [
    { value: 'novo', label: 'Novo' },
    { value: 'qualificado', label: 'Qualificado' },
    { value: 'proposta', label: 'Proposta' },
    { value: 'negociacao', label: 'Negociacao' },
    { value: 'fechamento', label: 'Fechamento' },
];

const ANY_VALUE_SENTINEL = '__any__';
const CLEAR_VALUE_SENTINEL = '__clear__';
type VariableFieldElement = HTMLInputElement | HTMLTextAreaElement;
type TriggerFieldCondition = { field_id: string; field_value?: string };

function toCustomFieldVariableBaseKey(label: string): string {
    return String(label || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function toCustomFieldVariableKey(field: CustomFieldDefinition, allFields: CustomFieldDefinition[]): string {
    const baseKey = toCustomFieldVariableBaseKey(field.label);
    if (!baseKey) return field.id;

    let sameBaseCount = 0;
    for (const candidate of allFields) {
        if (toCustomFieldVariableBaseKey(candidate.label) === baseKey) {
            sameBaseCount += 1;
        }
    }

    if (sameBaseCount <= 1) return baseKey;
    const shortId = field.id.replace(/-/g, '').slice(0, 8).toLowerCase();
    return shortId ? `${baseKey}_${shortId}` : baseKey;
}

function sanitizeTriggerConfigForSave(type: string, config: AutomationTriggerConfig): AutomationTriggerConfig {
    if (type !== 'custom_field_changed') return config;

    const changedRaw = Array.isArray(config.changed_conditions)
        ? config.changed_conditions
        : config.field_id
            ? [{ field_id: config.field_id, field_value: config.field_value }]
            : [];
    const stateRaw = Array.isArray(config.state_conditions) ? config.state_conditions : [];

    const normalizeList = (list: Array<{ field_id?: string; field_value?: string }>) =>
        list
            .filter(condition => condition?.field_id)
            .map(condition => ({
                field_id: String(condition.field_id),
                field_value: condition.field_value || '',
            }));

    const changed_conditions = normalizeList(changedRaw);
    const state_conditions = normalizeList(stateRaw);
    const firstChanged = changed_conditions[0];

    return {
        ...config,
        // Keep legacy keys for backward compatibility.
        field_id: firstChanged?.field_id || '',
        field_value: firstChanged?.field_value || '',
        changed_conditions,
        state_conditions,
    };
}

const VariableSelector = ({ customFields, onSelect }: { customFields: CustomFieldDefinition[], onSelect: (val: string) => void }) => {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950">
                    <Braces className="h-3.5 w-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[300px] w-[200px] overflow-y-auto border-slate-200 bg-white">
                <DropdownMenuItem className="cursor-pointer text-xs text-slate-600 hover:text-slate-950" onClick={() => onSelect('{{contact.name}}')}>Nome do Contato</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-xs text-slate-600 hover:text-slate-950" onClick={() => onSelect('{{contact.email}}')}>Email</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-xs text-slate-600 hover:text-slate-950" onClick={() => onSelect('{{contact.phone}}')}>Telefone</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-xs text-slate-600 hover:text-slate-950" onClick={() => onSelect('{{event.actor_full_name}}')}>Usuario que executou</DropdownMenuItem>
                {customFields.length > 0 && <Separator className="my-1 bg-slate-200" />}
                {customFields.map(cf => (
                    <DropdownMenuItem
                        className="cursor-pointer text-xs text-slate-600 hover:text-slate-950"
                        key={cf.id}
                        onClick={() => onSelect(`{{contact.custom_fields.${toCustomFieldVariableKey(cf, customFields)}}}`)}
                    >
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
            toast({ title: 'Nome obrigatorio', variant: 'destructive' });
            return;
        }
        if (actions.length === 0) {
            toast({ title: 'Adicione pelo menos uma acao', variant: 'destructive' });
            return;
        }

        const normalizedTriggerConfig = sanitizeTriggerConfigForSave(triggerType, triggerConfig);
        if (
            triggerType === 'custom_field_changed' &&
            (!normalizedTriggerConfig.changed_conditions || normalizedTriggerConfig.changed_conditions.length === 0)
        ) {
            toast({ title: 'Adicione pelo menos uma condicao em "Quando..."', variant: 'destructive' });
            return;
        }

        if (editingId) {
            const res = await updateAutomation(editingId, { name, trigger_type: triggerType, trigger_config: normalizedTriggerConfig, actions });
            if (res.error) { toast({ title: 'Erro', description: res.error, variant: 'destructive' }); return; }
            toast({ title: 'Automacao atualizada!' });
        } else {
            const res = await createAutomation({ workspace_id: workspaceId, name, trigger_type: triggerType, trigger_config: normalizedTriggerConfig, actions });
            if (res.error) { toast({ title: 'Erro', description: res.error, variant: 'destructive' }); return; }
            toast({ title: 'Automacao criada!' });
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
        toast({ title: 'Automacao excluida' });
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

    // Helpers

    const getTriggerLabel = (type: string) => TRIGGER_TYPES.find(t => t.value === type)?.label || type;
    const getTriggerIcon = (type: string) => TRIGGER_TYPES.find(t => t.value === type)?.icon || Zap;
    const getActionLabel = (type: string) => ACTION_TYPES.find(a => a.value === type)?.label || type;
    const getCustomFieldById = (fieldId?: string) => customFields.find(f => f.id === fieldId);
    const getCustomFieldOptionLabel = (field: CustomFieldDefinition | undefined, optionValue?: string) => {
        if (!field || !optionValue) return optionValue || '';
        const option = field.options?.find(o => o.value === optionValue);
        return option?.label || optionValue;
    };

    const getConditionList = (config: AutomationTriggerConfig, key: 'changed_conditions' | 'state_conditions'): TriggerFieldCondition[] => {
        const rawList = config[key];
        if (Array.isArray(rawList)) {
            return rawList.map(condition => ({
                field_id: condition?.field_id || '',
                field_value: condition?.field_value || '',
            }));
        }
        if (key === 'changed_conditions' && config.field_id) {
            return [{ field_id: config.field_id, field_value: config.field_value || '' }];
        }
        return [];
    };

    const getChangedConditions = (config: AutomationTriggerConfig): TriggerFieldCondition[] => {
        const list = getConditionList(config, 'changed_conditions');
        return list.length > 0 ? list : [{ field_id: '', field_value: '' }];
    };

    const getStateConditions = (config: AutomationTriggerConfig): TriggerFieldCondition[] => {
        return getConditionList(config, 'state_conditions');
    };

    const setTriggerConditionList = (
        key: 'changed_conditions' | 'state_conditions',
        nextList: TriggerFieldCondition[]
    ) => {
        const baseChanged = key === 'changed_conditions'
            ? nextList
            : getConditionList(triggerConfig, 'changed_conditions');

        const normalizedChanged = baseChanged
            .filter(condition => condition.field_id)
            .map(condition => ({ field_id: condition.field_id, field_value: condition.field_value || '' }));

        const firstChanged = normalizedChanged[0];

        setTriggerConfig({
            ...triggerConfig,
            field_id: firstChanged?.field_id || '',
            field_value: firstChanged?.field_value || '',
            changed_conditions: key === 'changed_conditions'
                ? nextList
                : getConditionList(triggerConfig, 'changed_conditions'),
            state_conditions: key === 'state_conditions'
                ? nextList
                : getConditionList(triggerConfig, 'state_conditions'),
        });
    };

    const addTriggerCondition = (key: 'changed_conditions' | 'state_conditions') => {
        const currentList = key === 'changed_conditions'
            ? getChangedConditions(triggerConfig)
            : getStateConditions(triggerConfig);
        setTriggerConditionList(key, [...currentList, { field_id: '', field_value: '' }]);
    };

    const updateTriggerCondition = (
        key: 'changed_conditions' | 'state_conditions',
        index: number,
        patch: Partial<TriggerFieldCondition>
    ) => {
        const currentList = key === 'changed_conditions'
            ? getChangedConditions(triggerConfig)
            : getStateConditions(triggerConfig);
        const nextList = [...currentList];
        nextList[index] = { ...nextList[index], ...patch };
        setTriggerConditionList(key, nextList);
    };

    const removeTriggerCondition = (key: 'changed_conditions' | 'state_conditions', index: number) => {
        const currentList = key === 'changed_conditions'
            ? getChangedConditions(triggerConfig)
            : getStateConditions(triggerConfig);
        const nextList = currentList.filter((_, conditionIndex) => conditionIndex !== index);
        if (key === 'changed_conditions' && nextList.length === 0) {
            setTriggerConditionList(key, [{ field_id: '', field_value: '' }]);
            return;
        }
        setTriggerConditionList(key, nextList);
    };

    const describeTriggerCondition = (condition: TriggerFieldCondition): string => {
        const field = getCustomFieldById(condition.field_id);
        const label = field?.label || condition.field_id || 'Campo';
        const value = condition.field_value
            ? getCustomFieldOptionLabel(field, condition.field_value)
            : 'qualquer valor';
        return `${label} = ${value}`;
    };

    const describeTrigger = (auto: CrmAutomation) => {
        const config = auto.trigger_config || {};
        switch (auto.trigger_type) {
            case 'stage_changed':
                if (config.from_stage && config.to_stage) return `${STAGES.find(s => s.value === config.from_stage)?.label || config.from_stage} -> ${STAGES.find(s => s.value === config.to_stage)?.label || config.to_stage}`;
                if (config.to_stage) return `-> ${STAGES.find(s => s.value === config.to_stage)?.label || config.to_stage}`;
                return 'Qualquer mudanca';
            case 'lead_score_above':
                return `Score >= ${config.threshold || 0}`;
            case 'custom_field_changed': {
                const changedConditions = getConditionList(config, 'changed_conditions');
                const fallbackChanged = changedConditions.length > 0
                    ? changedConditions
                    : config.field_id
                        ? [{ field_id: config.field_id, field_value: config.field_value || '' }]
                        : [];
                const stateConditions = getConditionList(config, 'state_conditions');

                const changedText = fallbackChanged.length > 0
                    ? fallbackChanged.map(describeTriggerCondition).join(' E ')
                    : 'qualquer campo';
                const stateText = stateConditions.length > 0
                    ? ` | estando ${stateConditions.map(describeTriggerCondition).join(' E ')}`
                    : '';
                return `${changedText}${stateText}`;
            }
            default:
                return '';
        }
    };

    const describeAction = (action: AutomationAction) => {
        switch (action.type) {
            case 'move_to_stage': return `-> ${STAGES.find(s => s.value === action.config.stage)?.label || action.config.stage || '?'}`;
            case 'assign_owner': {
                const user = users.find(u => u.id === action.config.owner_id);
                return user?.name || user?.email || action.config.owner_id || '?';
            }
            case 'create_deal': return action.config.title || 'Deal Automatico';
            case 'send_notification': return action.config.message || 'Notificacao';
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

    // Render

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col bg-[#f4f6f2] dark:bg-[#090e0c]">
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-5 pb-5 pt-6 md:px-8 md:pt-8">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Operação inteligente</p>
                    <h2 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#132b20] dark:text-white md:text-[34px]">Automações do funil</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Crie regras para manter cada oportunidade em movimento.</p>
                </div>
                <Button size="sm" className="h-10 gap-1.5 rounded-xl bg-[#164e34] px-5 font-semibold text-white hover:bg-[#0b6b42] dark:bg-emerald-400 dark:text-[#092015] dark:hover:bg-emerald-300" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Nova automação
                </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-5 pb-6 md:px-8">
                <div className="mb-5 grid gap-3 rounded-[22px] border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-[#121b16] sm:grid-cols-3">
                    <div><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Regras criadas</p><p className="mt-1 text-2xl font-semibold tracking-tight text-[#142d20] dark:text-white">{automations.length}</p></div>
                    <div className="border-t border-[#e8eee5] pt-3 dark:border-white/10 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Em operação</p><p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-300">{automations.filter((item) => item.is_active).length}</p></div>
                    <div className="border-t border-[#e8eee5] pt-3 dark:border-white/10 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Pausadas</p><p className="mt-1 text-2xl font-semibold tracking-tight text-[#142d20] dark:text-white">{automations.filter((item) => !item.is_active).length}</p></div>
                </div>
                {automations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-[22px] border border-dashed border-[#d8e5d8] bg-white px-5 py-20 text-center dark:border-white/10 dark:bg-[#121b16]">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-400/10">
                            <Zap className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
                        </div>
                        <h3 className="mb-1 text-lg font-semibold text-[#142d20] dark:text-white">Seu CRM pode trabalhar junto com você</h3>
                        <p className="max-w-md text-sm text-slate-500 dark:text-zinc-400">Crie uma regra para reagir a novas etapas, negócios e mudanças nos contatos.</p>
                        <Button onClick={openCreate} className="mt-5 rounded-xl bg-[#164e34] text-white hover:bg-[#0b6b42]">Criar primeira automação</Button>
                    </div>
                ) : (
                    <div className="grid gap-3 pb-8">
                        {automations.map(auto => {
                            const TriggerIcon = getTriggerIcon(auto.trigger_type);
                            return (
                                <Card
                                    key={auto.id}
                                    className={`rounded-[19px] border-[#e1e9df] bg-white shadow-[0_9px_24px_-19px_rgba(16,46,25,.5)] transition-all hover:border-emerald-200 hover:shadow-[0_15px_30px_-19px_rgba(16,46,25,.5)] dark:border-white/10 dark:bg-[#121b16] dark:hover:bg-[#18251c] ${!auto.is_active ? 'opacity-60' : ''}`}
                                >
                                    <CardContent className="p-5 md:p-6">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3 flex-1 min-w-0">
                                                <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-400/10">
                                                    <TriggerIcon className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="truncate text-sm font-semibold text-[#142d20] dark:text-white">{auto.name}</span>
                                                        <Badge variant="outline" className={`shrink-0 text-[10px] ${auto.is_active ? 'border-emerald-500/30 text-emerald-500' : 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
                                                            {auto.is_active ? 'Ativa' : 'Inativa'}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                                        <span className="font-medium text-emerald-700 dark:text-emerald-300">{getTriggerLabel(auto.trigger_type)}</span>
                                                        {describeTrigger(auto) && (
                                                            <>
                                                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                                                <span>{describeTrigger(auto)}</span>
                                                            </>
                                                        )}
                                                        <ArrowRight className="mx-0.5 h-3 w-3 text-slate-300 dark:text-slate-600" />
                                                        {auto.actions.map((action, i) => (
                                                            <span key={i} className="text-[#87631a] dark:text-amber-300">
                                                                {getActionLabel(action.type)}{' '}
                                                                <span className="text-slate-500 dark:text-slate-400">{describeAction(action)}</span>
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
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-slate-50" onClick={() => openEdit(auto)}>
                                                    <Zap className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400" onClick={() => handleDelete(auto.id)}>
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

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1200px] overflow-hidden border-slate-200 bg-white sm:max-w-[1200px] dark:border-slate-800 dark:bg-slate-950">
                    <DialogHeader>
                        <DialogTitle className="text-slate-950 dark:text-slate-50">{editingId ? 'Editar' : 'Nova'} Automacao</DialogTitle>
                        <DialogDescription className="text-slate-500 dark:text-slate-400">
                            Configure quando a automacao deve disparar e quais acoes executar.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-[68vh] overflow-y-auto pr-1 space-y-4 py-2">
                        {/* Name */}
                        <div className="space-y-1.5">
                            <Label className="text-xs text-slate-600 dark:text-slate-300">Nome</Label>
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ex: Qualificado -> Atribuir Vendedor"
                                className="border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
                            />
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2 items-start">
                            {/* Trigger */}
                            <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                            <Label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                                <Zap className="h-3 w-3 text-blue-400" /> Quando...
                            </Label>
                            <Select value={triggerType} onValueChange={v => { setTriggerType(v); setTriggerConfig({}); }}>
                                <SelectTrigger className="border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
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
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-slate-500 text-[10px] dark:text-slate-400">De (opcional)</Label>
                                        <Select value={triggerConfig.from_stage || '_any'} onValueChange={v => setTriggerConfig({ ...triggerConfig, from_stage: v === '_any' ? undefined : v })}>
                                            <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="_any">Qualquer</SelectItem>
                                                {STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slate-500 text-[10px] dark:text-slate-400">Para (opcional)</Label>
                                        <Select value={triggerConfig.to_stage || '_any'} onValueChange={v => setTriggerConfig({ ...triggerConfig, to_stage: v === '_any' ? undefined : v })}>
                                            <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
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
                                    <Label className="text-slate-500 text-[10px] dark:text-slate-400">Score minimo</Label>
                                    <Input
                                        type="number"
                                        min={0} max={100}
                                        value={triggerConfig.threshold || ''}
                                        onChange={e => setTriggerConfig({ ...triggerConfig, threshold: parseInt(e.target.value) || 0 })}
                                        className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
                                        placeholder="Ex: 60"
                                    />
                                </div>
                            )}

                            {triggerType === 'custom_field_changed' && (
                                <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-slate-600 text-[10px] dark:text-slate-400">Contato fizer (todas com E)</Label>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-[10px] text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
                                                onClick={() => addTriggerCondition('changed_conditions')}
                                            >
                                                <Plus className="h-3 w-3 mr-1" /> E
                                            </Button>
                                        </div>

                                        {getChangedConditions(triggerConfig).map((condition, index) => (
                                            <div key={`changed-${index}`} className="space-y-1.5">
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                                    <Select
                                                        value={condition.field_id || ''}
                                                        onValueChange={v => updateTriggerCondition('changed_conditions', index, { field_id: v, field_value: '' })}
                                                    >
                                                        <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
                                                            <SelectValue placeholder="Campo" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {customFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>

                                                    {(() => {
                                                        const selectedField = getCustomFieldById(condition.field_id);
                                                        const fieldOptions = selectedField?.type === 'select' ? (selectedField.options || []) : [];
                                                        if (fieldOptions.length > 0) {
                                                            return (
                                                                <Select
                                                                    value={condition.field_value || ANY_VALUE_SENTINEL}
                                                                    onValueChange={v => updateTriggerCondition('changed_conditions', index, {
                                                                        field_value: v === ANY_VALUE_SENTINEL ? '' : v,
                                                                    })}
                                                                >
                                                                    <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
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
                                                                value={condition.field_value || ''}
                                                                onChange={e => updateTriggerCondition('changed_conditions', index, { field_value: e.target.value })}
                                                                className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                                                placeholder="Igual a (opcional)"
                                                            />
                                                        );
                                                    })()}

                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-slate-400 hover:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                                        onClick={() => removeTriggerCondition('changed_conditions', index)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                                {index < getChangedConditions(triggerConfig).length - 1 && (
                                                    <p className="text-[10px] text-emerald-300/70 font-medium pl-1">E</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    <Separator className="bg-white/10" />

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-slate-600 text-[10px] dark:text-slate-400">E contato estiver (todas com E)</Label>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-[10px] text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
                                                onClick={() => addTriggerCondition('state_conditions')}
                                            >
                                                <Plus className="h-3 w-3 mr-1" /> E
                                            </Button>
                                        </div>

                                        {getStateConditions(triggerConfig).length === 0 && (
                                            <p className="text-[10px] text-slate-400">Opcional. Adicione condicoes de estado do contato.</p>
                                        )}

                                        {getStateConditions(triggerConfig).map((condition, index) => (
                                            <div key={`state-${index}`} className="space-y-1.5">
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                                    <Select
                                                        value={condition.field_id || ''}
                                                        onValueChange={v => updateTriggerCondition('state_conditions', index, { field_id: v, field_value: '' })}
                                                    >
                                                        <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
                                                            <SelectValue placeholder="Campo" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {customFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>

                                                    {(() => {
                                                        const selectedField = getCustomFieldById(condition.field_id);
                                                        const fieldOptions = selectedField?.type === 'select' ? (selectedField.options || []) : [];
                                                        if (fieldOptions.length > 0) {
                                                            return (
                                                                <Select
                                                                    value={condition.field_value || ANY_VALUE_SENTINEL}
                                                                    onValueChange={v => updateTriggerCondition('state_conditions', index, {
                                                                        field_value: v === ANY_VALUE_SENTINEL ? '' : v,
                                                                    })}
                                                                >
                                                                    <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
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
                                                                value={condition.field_value || ''}
                                                                onChange={e => updateTriggerCondition('state_conditions', index, { field_value: e.target.value })}
                                                                className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                                                placeholder="Igual a (opcional)"
                                                            />
                                                        );
                                                    })()}

                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-slate-400 hover:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                                        onClick={() => removeTriggerCondition('state_conditions', index)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                                {index < getStateConditions(triggerConfig).length - 1 && (
                                                    <p className="text-[10px] text-emerald-300/70 font-medium pl-1">E</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                            {/* Actions */}
                            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 min-w-0 dark:border-slate-800 dark:bg-slate-900/50">
                            <div className="flex items-center justify-between">
                                <Label className="text-slate-600 text-xs flex items-center gap-1.5 dark:text-slate-400">
                                    <ArrowRight className="h-3 w-3 text-amber-400" /> Entao faca...
                                </Label>
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50" onClick={addAction}>
                                    <Plus className="h-3 w-3 mr-1" /> Acao
                                </Button>
                            </div>

                            {actions.length === 0 && (
                                <p className="text-xs text-slate-400 text-center py-3">Nenhuma acao adicionada.</p>
                            )}

                            {actions.map((action, i) => (
                                <div key={i} className="p-3 rounded-lg bg-white border border-slate-200 space-y-2 dark:bg-slate-950 dark:border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <Select value={action.type} onValueChange={v => updateAction(i, 'type', v)}>
                                            <SelectTrigger className="h-8 min-w-0 flex-1 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ACTION_TYPES.map(a => (
                                                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-400 shrink-0 dark:hover:bg-red-500/10 dark:hover:text-red-400" onClick={() => removeAction(i)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>

                                    {/* Action config */}
                                    {action.type === 'move_to_stage' && (
                                        <Select value={action.config.stage || ''} onValueChange={v => updateAction(i, 'stage', v)}>
                                            <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
                                                <SelectValue placeholder="Selecione o estagio" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )}

                                    {action.type === 'assign_owner' && (
                                        <Select value={action.config.owner_id || ''} onValueChange={v => updateAction(i, 'owner_id', v)}>
                                            <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
                                                <SelectValue placeholder="Selecione o responsavel" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )}

                                    {action.type === 'create_deal' && (
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <Input
                                                value={action.config.title || ''}
                                                onChange={e => updateAction(i, 'title', e.target.value)}
                                                placeholder="Titulo do deal"
                                                className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                            />
                                            <Input
                                                type="number"
                                                value={action.config.value || ''}
                                                onChange={e => updateAction(i, 'value', parseFloat(e.target.value) || 0)}
                                                placeholder="Valor (R$)"
                                                className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                            />
                                        </div>
                                    )}

                                    {action.type === 'send_notification' && (
                                        <Input
                                            value={action.config.message || ''}
                                            onChange={e => updateAction(i, 'message', e.target.value)}
                                            placeholder="Mensagem da notificacao"
                                            className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                        />
                                    )}

                                    {action.type === 'update_custom_field' && (
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                                                <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
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
                                                            <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
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
                                                        className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                                    />
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {action.type === 'api_call' && (
                                        <div className="space-y-4 pt-2">
                                            <div className="grid grid-cols-1 gap-2 md:grid-cols-[100px_minmax(0,1fr)_auto]">
                                                <div className="w-[100px]">
                                                    <Select value={action.config.method || 'GET'} onValueChange={v => updateAction(i, 'method', v)}>
                                                        <SelectTrigger className="h-8 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
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
                                                <div className="flex min-w-0 flex-1 gap-1">
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
                                                        className="h-8 min-w-0 flex-1 border-slate-200 bg-white text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
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
                                            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-slate-600 font-medium dark:text-slate-400">Headers</Label>
                                                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50" onClick={() => addActionHeader(i)}>
                                                        <Plus className="h-3 w-3 mr-1" /> Adicionar Header
                                                    </Button>
                                                </div>
                                                {(action.config.headers || []).map((header: any, hIndex: number) => (
                                                    <div key={hIndex} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                                        <Input
                                                            value={header.key}
                                                            onChange={e => updateActionHeader(i, hIndex, 'key', e.target.value)}
                                                            placeholder="Key (ex: Authorization)"
                                                            className="h-7 min-w-0 flex-1 border-slate-200 bg-slate-50 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                                        />
                                                        <div className="flex min-w-0 flex-1 gap-1">
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
                                                                className="h-7 min-w-0 flex-1 border-slate-200 bg-slate-50 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
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
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-400 shrink-0 dark:hover:bg-red-500/10 dark:hover:text-red-400" onClick={() => removeActionHeader(i, hIndex)}>
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                ))}
                                                {!(action.config.headers?.length > 0) && <p className="text-[10px] text-slate-400 dark:text-slate-500">Nenhum header configurado.</p>}
                                            </div>

                                            {/* Body Configuration */}
                                            {action.config.method !== 'GET' && (
                                                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Label className="text-slate-600 font-medium dark:text-slate-400">Body (Payload)</Label>
                                                        <Select value={action.config.bodyType || 'json'} onValueChange={v => updateAction(i, 'bodyType', v)}>
                                                            <SelectTrigger className="w-[180px] h-6 border-slate-200 bg-slate-50 px-2 text-[10px] text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50">
                                                                <SelectValue placeholder="Tipo de Envio" />
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
                                                                className="min-h-[60px] resize-y border-slate-200 bg-slate-50 pr-10 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
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
                                                                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50" onClick={() => addActionFormData(i)}>
                                                                    <Plus className="h-3 w-3 mr-1" /> Adicionar Parametro
                                                                </Button>
                                                            </div>
                                                            {(action.config.formData || []).map((data: any, dIndex: number) => (
                                                                <div key={dIndex} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                                                    <Input
                                                                        value={data.key}
                                                                        onChange={e => updateActionFormData(i, dIndex, 'key', e.target.value)}
                                                                        placeholder="Key (ex: email)"
                                                                        className="h-7 min-w-0 flex-1 border-slate-200 bg-slate-50 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                                                    />
                                                                    <div className="flex min-w-0 flex-1 gap-1">
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
                                                                            className="h-7 min-w-0 flex-1 border-slate-200 bg-slate-50 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
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
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-400 shrink-0 dark:hover:bg-red-500/10 dark:hover:text-red-400" onClick={() => removeActionFormData(i, dIndex)}>
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                            {!(action.config.formData?.length > 0) && <p className="text-[10px] text-slate-400 mt-1 dark:text-slate-500">Nenhum parametro configurado.</p>}
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
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-200 text-slate-500 dark:border-slate-800 dark:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50">
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} className="gap-1.5">
                            <Zap className="h-3.5 w-3.5" />
                            {editingId ? 'Salvar' : 'Criar'} Automacao
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}


