'use client';

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Save, X, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tag, CustomFieldDefinition } from '@/lib/types';
import { CriteriaGroup, Condition, Field, Operator } from '@/lib/crm-query-builder';
import { parseNaturalLanguageSegment } from '@/actions/nlp-segment';
import { toast } from '@/hooks/use-toast';

interface SegmentBuilderProps {
    onSave: (criteria: CriteriaGroup, name: string, description: string) => void;
    onCancel: () => void;
    tags: Tag[];
    customFields: CustomFieldDefinition[];
}

const STATIC_FIELDS: { value: Field; label: string; type: 'text' | 'date' | 'select' | 'boolean' }[] = [
    { value: 'name', label: 'Nome', type: 'text' },
    { value: 'email', label: 'Email', type: 'text' },
    { value: 'phone_number_jid', label: 'Telefone', type: 'text' },
    { value: 'tags', label: 'Tags', type: 'select' },
    { value: 'contacted_at', label: 'Entraram em contato', type: 'date' },
    { value: 'last_activity', label: 'Ultima atividade real', type: 'date' },
    { value: 'created_at', label: 'Data de cadastro', type: 'date' },
];

const OPERATORS: { value: Operator; label: string; types: string[] }[] = [
    { value: 'equals', label: 'Igual a', types: ['text', 'select', 'date', 'number'] },
    { value: 'contains', label: 'Contem', types: ['text'] },
    { value: 'gt', label: 'Depois de', types: ['date'] },
    { value: 'lt', label: 'Antes de', types: ['date'] },
    { value: 'gt', label: 'Maior que', types: ['number'] },
    { value: 'lt', label: 'Menor que', types: ['number'] },
    { value: 'between', label: 'Entre datas', types: ['date'] },
    { value: 'gte', label: 'Desde', types: ['date', 'number'] },
    { value: 'lte', label: 'Ate', types: ['date', 'number'] },
    { value: 'is_set', label: 'Esta preenchido', types: ['text', 'select', 'date', 'boolean', 'number'] },
    { value: 'is_not_set', label: 'Nao esta preenchido', types: ['text', 'select', 'date', 'boolean', 'number'] },
];

export function SegmentBuilder({ onSave, onCancel, tags, customFields }: SegmentBuilderProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [criteria, setCriteria] = useState<CriteriaGroup>({
        operator: 'AND',
        conditions: [{ field: 'name', operator: 'contains', value: '' }]
    });
    const [nlpInput, setNlpInput] = useState('');
    const [nlpLoading, setNlpLoading] = useState(false);

    const allFields = useMemo(() => {
        const custom = customFields.map(cf => {
            let type: 'text' | 'date' | 'select' | 'boolean' | 'number' = 'text';
            if (cf.type === 'number') type = 'number';
            else if (cf.type === 'date') type = 'date';
            else if (cf.type === 'select') type = 'select';

            return {
                value: `custom_field_${cf.id}` as Field,
                label: cf.label,
                type,
                options: cf.options
            };
        });
        return [...STATIC_FIELDS, ...custom];
    }, [customFields]);

    const addCondition = () => {
        setCriteria({
            ...criteria,
            conditions: [...criteria.conditions, { field: 'name', operator: 'contains', value: '' }]
        });
    };

    const removeCondition = (index: number) => {
        const newConditions = [...criteria.conditions];
        newConditions.splice(index, 1);
        setCriteria({ ...criteria, conditions: newConditions });
    };

    const updateCondition = (index: number, updates: Partial<Condition>) => {
        const newConditions = [...criteria.conditions];
        if ('field' in newConditions[index]) {
            newConditions[index] = { ...newConditions[index], ...updates } as Condition;
            setCriteria({ ...criteria, conditions: newConditions });
        }
    };

    const handleSave = () => {
        if (!name.trim()) return;
        onSave(criteria, name, description);
    };

    const handleNlpGenerate = async () => {
        if (!nlpInput.trim()) return;
        setNlpLoading(true);
        try {
            const result = await parseNaturalLanguageSegment(nlpInput);
            if (result.error || !result.criteria) {
                toast({ title: 'Erro ao gerar filtros', description: result.error, variant: 'destructive' });
                return;
            }
            setCriteria(result.criteria);
            if (!name.trim()) {
                setName(nlpInput.length > 40 ? nlpInput.substring(0, 40) + '...' : nlpInput);
            }
            if (!description.trim()) {
                setDescription(nlpInput);
            }
            toast({ title: 'Filtros gerados com IA!', description: `${result.criteria.conditions.length} condicao(oes) criada(s).` });
        } catch {
            toast({ title: 'Erro', description: 'Falha ao conectar com a IA.', variant: 'destructive' });
        } finally {
            setNlpLoading(false);
        }
    };

    return (
        <Card className="max-h-[88vh] space-y-6 overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-emerald-400/20 dark:bg-[#050807] dark:text-zinc-100">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-300">Listas Dialogy</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">Nova lista inteligente</h3>
                </div>
                <Button variant="ghost" size="icon" className="rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white" onClick={onCancel}><X className="w-4 h-4" /></Button>
            </div>

            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/10">
                <Label className="flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-100">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" /> Descreva a lista em linguagem natural
                </Label>
                <Textarea
                    value={nlpInput}
                    onChange={e => setNlpInput(e.target.value)}
                    placeholder="Ex: clientes sem contato ha mais de 30 dias que tem tag financeiro"
                    className="min-h-[72px] resize-none rounded-lg border-emerald-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-black/30 dark:text-white dark:placeholder:text-zinc-500"
                    rows={2}
                />
                <Button
                    size="sm"
                    className="gap-1.5 rounded-lg bg-emerald-600 font-bold text-white hover:bg-emerald-700 dark:bg-white dark:text-black dark:hover:bg-emerald-100"
                    onClick={handleNlpGenerate}
                    disabled={nlpLoading || !nlpInput.trim()}
                >
                    {nlpLoading ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Gerando...</>
                    ) : (
                        <><Sparkles className="h-3.5 w-3.5" /> Gerar com IA</>
                    )}
                </Button>
            </div>

            <div className="space-y-4">
                <div className="grid gap-2">
                    <Label className="text-slate-700 dark:text-zinc-300">Nome da lista</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Clientes sem contato"
                        className="rounded-lg border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-zinc-500"
                    />
                </div>
                <div className="grid gap-2">
                    <Label className="text-slate-700 dark:text-zinc-300">Descricao opcional</Label>
                    <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ex: Contatos que precisam de reativacao"
                        className="rounded-lg border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div className="space-y-4">
                <Label className="text-slate-700 dark:text-zinc-300">Regras</Label>
                <div className="space-y-2">
                    {criteria.conditions.map((condition, index) => {
                        if (!('field' in condition)) return null;

                        const fieldDef = allFields.find(f => f.value === condition.field);
                        const fieldType = fieldDef?.type || 'text';
                        const availableOps = OPERATORS.filter(op => op.types.includes(fieldType));

                        return (
                            <div key={index} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.04] md:grid-cols-[170px_150px_minmax(0,1fr)_36px] md:items-center">
                                <Select
                                    value={condition.field as string}
                                    onValueChange={(val) => {
                                        const nextField = allFields.find(f => f.value === val);
                                        updateCondition(index, {
                                            field: val as Field,
                                            operator: nextField?.type === 'date' ? 'between' : 'is_set',
                                            value: nextField?.type === 'date' ? { from: '', to: '' } : '',
                                        });
                                    }}
                                >
                                    <SelectTrigger className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-black/30 dark:text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                                        {allFields.map(f => <SelectItem key={f.value as string} value={f.value as string}>{f.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                <Select
                                    value={condition.operator}
                                    onValueChange={(val) => updateCondition(index, {
                                        operator: val as Operator,
                                        value: val === 'between' ? { from: '', to: '' } : '',
                                    })}
                                >
                                    <SelectTrigger className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-black/30 dark:text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                                        {availableOps.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                {condition.operator !== 'is_set' && condition.operator !== 'is_not_set' && (
                                    <div className="min-w-0">
                                        {condition.operator === 'between' ? (
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <div className="grid gap-1">
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">De</span>
                                                    <Input
                                                        type="date"
                                                        value={condition.value?.from || ''}
                                                        onChange={(e) => updateCondition(index, {
                                                            value: { ...(condition.value || {}), from: e.target.value },
                                                        })}
                                                        className="border-slate-200 bg-white text-slate-900 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-black/30 dark:text-white"
                                                    />
                                                </div>
                                                <div className="grid gap-1">
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">Ate</span>
                                                    <Input
                                                        type="date"
                                                        value={condition.value?.to || ''}
                                                        onChange={(e) => updateCondition(index, {
                                                            value: { ...(condition.value || {}), to: e.target.value },
                                                        })}
                                                        className="border-slate-200 bg-white text-slate-900 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-black/30 dark:text-white"
                                                    />
                                                </div>
                                            </div>
                                        ) : fieldDef?.value === 'tags' ? (
                                            <Select
                                                value={condition.value}
                                                onValueChange={(val) => updateCondition(index, { value: val })}
                                            >
                                                <SelectTrigger className="w-full border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-black/30 dark:text-white">
                                                    <SelectValue placeholder="Selecione uma tag" />
                                                </SelectTrigger>
                                                <SelectContent className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                                                    {tags.map(t => (
                                                        <SelectItem key={t.id} value={t.value}>{t.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : fieldType === 'select' && (fieldDef as any).options ? (
                                            <Select
                                                value={condition.value}
                                                onValueChange={(val) => updateCondition(index, { value: val })}
                                            >
                                                <SelectTrigger className="w-full border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-black/30 dark:text-white">
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                                <SelectContent className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
                                                    {(fieldDef as any).options.map((opt: any) => {
                                                        const value = typeof opt === 'string' ? opt : opt.value;
                                                        const label = typeof opt === 'string' ? opt : opt.label;
                                                        return <SelectItem key={value} value={value}>{label}</SelectItem>;
                                                    })}
                                                </SelectContent>
                                            </Select>
                                        ) : fieldType === 'date' ? (
                                            <Input
                                                type="date"
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                className="border-slate-200 bg-white text-slate-900 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-black/30 dark:text-white"
                                            />
                                        ) : fieldType === 'number' ? (
                                            <Input
                                                type="number"
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                className="border-slate-200 bg-white text-slate-900 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-black/30 dark:text-white"
                                            />
                                        ) : (
                                            <Input
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                placeholder="Valor..."
                                                className="border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-emerald-400/30 dark:border-white/10 dark:bg-black/30 dark:text-white dark:placeholder:text-zinc-500"
                                            />
                                        )}
                                    </div>
                                )}

                                <Button variant="ghost" size="icon" onClick={() => removeCondition(index)} className="rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-300">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
                <Button variant="outline" size="sm" onClick={addCondition} className="w-full rounded-lg border-dashed border-emerald-300 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/5 dark:text-emerald-100 dark:hover:bg-emerald-400/10 dark:hover:text-white">
                    <Plus className="w-4 h-4 mr-2" /> Adicionar Regra
                </Button>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-white/10">
                <Button variant="ghost" className="text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white" onClick={onCancel}>Cancelar</Button>
                <Button onClick={handleSave} className="rounded-lg bg-emerald-600 font-bold text-white hover:bg-emerald-700 dark:bg-white dark:text-black dark:hover:bg-emerald-100">
                    <Save className="w-4 h-4 mr-2" /> Salvar lista
                </Button>
            </div>
        </Card>
    );
}
