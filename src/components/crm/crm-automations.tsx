'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
    Zap, Plus, Trash2, Loader2, Play, Pause,
    ArrowRight, UserCheck, Target, Bell, GitBranch
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
    getAutomations, createAutomation, updateAutomation,
    deleteAutomation, toggleAutomation,
    type CrmAutomation, type AutomationAction, type AutomationTriggerConfig
} from '@/actions/automations';
import { getWorkspaceUsers } from '@/actions/crm';
import type { User } from '@/lib/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
    { value: 'stage_changed', label: 'Mudança de Estágio', icon: GitBranch, description: 'Quando um contato muda de estágio no funil' },
    { value: 'deal_created', label: 'Deal Criado', icon: Target, description: 'Quando um novo deal é criado' },
    { value: 'lead_score_above', label: 'Lead Score Acima de', icon: Zap, description: 'Quando o score do lead ultrapassa um valor' },
    { value: 'contact_created', label: 'Contato Criado', icon: UserCheck, description: 'Quando um novo contato é cadastrado' },
];

const ACTION_TYPES = [
    { value: 'move_to_stage', label: 'Mover para Estágio', icon: ArrowRight },
    { value: 'assign_owner', label: 'Atribuir Responsável', icon: UserCheck },
    { value: 'create_deal', label: 'Criar Deal', icon: Target },
    { value: 'send_notification', label: 'Enviar Notificação', icon: Bell },
];

const STAGES = [
    { value: 'novo', label: 'Novo' },
    { value: 'qualificado', label: 'Qualificado' },
    { value: 'proposta', label: 'Proposta' },
    { value: 'negociacao', label: 'Negociação' },
    { value: 'fechamento', label: 'Fechamento' },
];

interface CrmAutomationsProps {
    workspaceId: string;
}

export default function CrmAutomations({ workspaceId }: CrmAutomationsProps) {
    const [automations, setAutomations] = useState<CrmAutomation[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [triggerType, setTriggerType] = useState('stage_changed');
    const [triggerConfig, setTriggerConfig] = useState<AutomationTriggerConfig>({});
    const [actions, setActions] = useState<AutomationAction[]>([]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const [autoRes, usersRes] = await Promise.all([
            getAutomations(workspaceId),
            getWorkspaceUsers(workspaceId),
        ]);
        setAutomations(autoRes.automations);
        if (usersRes.users) setUsers(usersRes.users);
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

    // ─── Helpers ────────────────────────────────────────────────────────────

    const getTriggerLabel = (type: string) => TRIGGER_TYPES.find(t => t.value === type)?.label || type;
    const getTriggerIcon = (type: string) => TRIGGER_TYPES.find(t => t.value === type)?.icon || Zap;
    const getActionLabel = (type: string) => ACTION_TYPES.find(a => a.value === type)?.label || type;

    const describeTrigger = (auto: CrmAutomation) => {
        const config = auto.trigger_config || {};
        switch (auto.trigger_type) {
            case 'stage_changed':
                if (config.from_stage && config.to_stage) return `${STAGES.find(s => s.value === config.from_stage)?.label || config.from_stage} → ${STAGES.find(s => s.value === config.to_stage)?.label || config.to_stage}`;
                if (config.to_stage) return `→ ${STAGES.find(s => s.value === config.to_stage)?.label || config.to_stage}`;
                return 'Qualquer mudança';
            case 'lead_score_above':
                return `Score ≥ ${config.threshold || 0}`;
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
