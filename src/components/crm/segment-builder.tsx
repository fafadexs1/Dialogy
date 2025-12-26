
'use client';

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tag, CustomFieldDefinition } from '@/lib/types';
import { CriteriaGroup, Condition, Field, Operator } from '@/lib/crm-query-builder';

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
    { value: 'last_activity', label: 'Última Atividade', type: 'date' },
];

const OPERATORS: { value: Operator; label: string; types: string[] }[] = [
    { value: 'equals', label: 'Igual a', types: ['text', 'select', 'date', 'number'] },
    { value: 'contains', label: 'Contém', types: ['text'] },
    { value: 'gt', label: 'Maior que', types: ['date', 'number'] },
    { value: 'lt', label: 'Menor que', types: ['date', 'number'] },
    { value: 'is_set', label: 'Está preenchido', types: ['text', 'select', 'date', 'boolean', 'number'] },
    { value: 'is_not_set', label: 'Não está preenchido', types: ['text', 'select', 'date', 'boolean', 'number'] },
];

export function SegmentBuilder({ onSave, onCancel, tags, customFields }: SegmentBuilderProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [criteria, setCriteria] = useState<CriteriaGroup>({
        operator: 'AND',
        conditions: [{ field: 'name', operator: 'contains', value: '' }]
    });

    const allFields = useMemo(() => {
        const custom = customFields.map(cf => {
            let type: 'text' | 'date' | 'select' | 'boolean' | 'number' = 'text';
            if (cf.type === 'number') type = 'number';
            else if (cf.type === 'date') type = 'date';
            else if (cf.type === 'select') type = 'select';
            // email and tel fall back to 'text'

            return {
                value: `custom_field_${cf.id}` as Field,
                label: cf.label,
                type: type,
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
        // Ensure we are updating a Condition, not a Group (simple version supports only 1 level depth for now)
        if ('field' in newConditions[index]) {
            newConditions[index] = { ...newConditions[index], ...updates } as Condition;
            setCriteria({ ...criteria, conditions: newConditions });
        }
    };

    const handleSave = () => {
        if (!name.trim()) return;
        onSave(criteria, name, description);
    };

    return (
        <Card className="p-6 bg-zinc-950 border-white/10 text-white space-y-6">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Novo Segmento Inteligente</h3>
                <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
            </div>

            <div className="space-y-4">
                <div className="grid gap-2">
                    <Label>Nome do Segmento</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Leads Quentes"
                        className="bg-white/5 border-white/10"
                    />
                </div>
                <div className="grid gap-2">
                    <Label>Descrição (Opcional)</Label>
                    <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ex: Contatos sem resposta há 3 dias"
                        className="bg-white/5 border-white/10"
                    />
                </div>
            </div>

            <div className="space-y-4">
                <Label>Regras</Label>
                <div className="space-y-2">
                    {criteria.conditions.map((condition, index) => {
                        if (!('field' in condition)) return null; // Skip nested groups for simple UI

                        const fieldDef = allFields.find(f => f.value === condition.field);
                        const fieldType = fieldDef?.type || 'text';
                        const availableOps = OPERATORS.filter(op => op.types.includes(fieldType));

                        return (
                            <div key={index} className="flex gap-2 items-center">
                                <Select
                                    value={condition.field as string}
                                    onValueChange={(val) => updateCondition(index, { field: val as Field, operator: 'is_set', value: '' })}
                                >
                                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                        {allFields.map(f => <SelectItem key={f.value as string} value={f.value as string}>{f.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                <Select
                                    value={condition.operator}
                                    onValueChange={(val) => updateCondition(index, { operator: val as Operator })}
                                >
                                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-zinc-900 border-white/10 text-white">
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
                                                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                                                    <SelectValue placeholder="Selecione uma tag" />
                                                </SelectTrigger>
                                                <SelectContent className="bg-zinc-900 border-white/10 text-white">
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
                                                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                                <SelectContent className="bg-zinc-900 border-white/10 text-white">
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
                                                className="bg-white/5 border-white/10"
                                            />
                                        ) : fieldType === 'number' ? (
                                            <Input
                                                type="number"
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                className="bg-white/5 border-white/10"
                                            />
                                        ) : (
                                            <Input
                                                value={condition.value}
                                                onChange={(e) => updateCondition(index, { value: e.target.value })}
                                                placeholder="Valor..."
                                                className="bg-white/5 border-white/10"
                                            />
                                        )}
                                    </div>
                                )}

                                <Button variant="ghost" size="icon" onClick={() => removeCondition(index)} className="text-white/50 hover:text-red-400">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
                <Button variant="outline" size="sm" onClick={addCondition} className="w-full border-dashed border-white/20 hover:bg-white/5 text-white/70">
                    <Plus className="w-4 h-4 mr-2" /> Adicionar Regra
                </Button>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
                <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Save className="w-4 h-4 mr-2" /> Salvar Segmento
                </Button>
            </div>
        </Card>
    );
}
