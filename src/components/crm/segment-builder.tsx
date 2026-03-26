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
    { value: 'last_activity', label: 'Ultima Atividade', type: 'date' },
];

const OPERATORS: { value: Operator; label: string; types: string[] }[] = [
    { value: 'equals', label: 'Igual a', types: ['text', 'select', 'date', 'number'] },
    { value: 'contains', label: 'Contem', types: ['text'] },
    { value: 'gt', label: 'Maior que', types: ['date', 'number'] },
    { value: 'lt', label: 'Menor que', types: ['date', 'number'] },
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
        <Card className="space-y-6 border border-slate-200 bg-white p-6 text-slate-950 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.24)]">
            <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Novo Segmento Inteligente</h3>
                <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
            </div>

            <div className="space-y-3 rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-4">
                <Label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" /> Descreva o segmento em linguagem natural
                </Label>
                <Textarea
                    value={nlpInput}
                    onChange={e => setNlpInput(e.target.value)}
                    placeholder="Ex: contatos com score acima de 70 que nao tiveram atividade nos ultimos 5 dias"
                    className="min-h-[60px] resize-none border-slate-200 bg-white text-sm text-slate-900"
                    rows={2}
                />
                <Button
                    size="sm"
                    className="gap-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
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
                    <Label>Nome do Segmento</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Leads Quentes"
                        className="border-slate-200 bg-white"
                    />
                </div>
                <div className="grid gap-2">
                    <Label>Descricao (Opcional)</Label>
                    <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ex: Contatos sem resposta ha 3 dias"
                        className="border-slate-200 bg-white"
                    />
                </div>
            </div>

            <div className="space-y-4">
                <Label>Regras</Label>
                <div className="space-y-2">
                    {criteria.conditions.map((condition, index) => {
                        if (!('field' in condition)) return null;

                        const fieldDef = allFields.find(f => f.value === condition.field);
                        const fieldType = fieldDef?.type || 'text';
                        const availableOps = OPERATORS.filter(op => op.types.includes(fieldType));

                        return (
                            <div key={index} className="flex items-center gap-2">
                                <Select
                                    value={condition.field as string}
                                    onValueChange={(val) => updateCondition(index, { field: val as Field, operator: 'is_set', value: '' })}
                                >
                                    <SelectTrigger className="w-[150px] border-slate-200 bg-white text-slate-900">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border-slate-200 bg-white text-slate-900">
                                        {allFields.map(f => <SelectItem key={f.value as string} value={f.value as string}>{f.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                <Select
                                    value={condition.operator}
                                    onValueChange={(val) => updateCondition(index, { operator: val as Operator })}
                                >
                                    <SelectTrigger className="w-[150px] border-slate-200 bg-white text-slate-900">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border-slate-200 bg-white text-slate-900">
                                        {availableOps.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                {condition.operator !== 'is_set' && condition.operator !== 'is_not_set' && (
                                    <div className="flex-1">
                                        {fieldDef?.value === 'tags' ? (
                                            <Select
                                                value={condition.value}
                                                onValueChange={(val) => updateCondition(index, { value: val })}
                                            >
                                                <SelectTrigger className="w-full border-slate-200 bg-white text-slate-900">
                                                    <SelectValue placeholder="Selecione uma tag" />
                                                </SelectTrigger>
                                                <SelectContent className="border-slate-200 bg-white text-slate-900">
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
                                                <SelectTrigger className="w-full border-slate-200 bg-white text-slate-900">
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                                <SelectContent className="border-slate-200 bg-white text-slate-900">
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
                                                className="border-slate-200 bg-white"
                                            />
                                        ) : fieldType === 'number' ? (
                                            <Input
                                                type="number"
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                className="border-slate-200 bg-white"
                                            />
                                        ) : (
                                            <Input
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                placeholder="Valor..."
                                                className="border-slate-200 bg-white"
                                            />
                                        )}
                                    </div>
                                )}

                                <Button variant="ghost" size="icon" onClick={() => removeCondition(index)} className="text-slate-400 hover:bg-red-50 hover:text-red-500">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
                <Button variant="outline" size="sm" onClick={addCondition} className="w-full border-dashed border-slate-200 text-slate-600 hover:bg-slate-50">
                    <Plus className="w-4 h-4 mr-2" /> Adicionar Regra
                </Button>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
                <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Save className="w-4 h-4 mr-2" /> Salvar Segmento
                </Button>
            </div>
        </Card>
    );
}
