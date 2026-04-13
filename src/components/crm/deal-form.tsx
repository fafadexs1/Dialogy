'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';
import { createDeal, updateDeal } from '@/actions/deals';
import { getPipelineStages } from '@/actions/crm';
import type { Deal } from '@/lib/types';
import { DollarSign, Percent, Calendar, FileText, Target, Loader2 } from 'lucide-react';
import { getDefaultPipelineStageValue, sortPipelineStages, type PipelineStage } from '@/lib/crm-pipeline';

interface DealFormProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    workspaceId: string;
    contactId?: string;
    contactName?: string;
    deal?: Deal | null;
    onSaved?: (deal: Deal) => void;
}

export default function DealForm({
    isOpen,
    setIsOpen,
    workspaceId,
    contactId,
    contactName,
    deal,
    onSaved,
}: DealFormProps) {
    const [title, setTitle] = useState('');
    const [value, setValue] = useState('');
    const [stage, setStage] = useState('novo');
    const [probability, setProbability] = useState(50);
    const [expectedCloseDate, setExpectedCloseDate] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [stages, setStages] = useState<PipelineStage[]>([]);

    const isEditing = !!deal;
    const orderedStages = useMemo(() => sortPipelineStages(stages), [stages]);
    const defaultStage = useMemo(() => getDefaultPipelineStageValue(orderedStages), [orderedStages]);
    const selectedStageMissing = useMemo(
        () => !!stage && orderedStages.every((stageOption) => stageOption.value !== stage),
        [orderedStages, stage]
    );

    useEffect(() => {
        if (!workspaceId) return;

        getPipelineStages(workspaceId).then((result) => {
            if (result.stages) {
                setStages(sortPipelineStages(result.stages));
            }
        });
    }, [workspaceId]);

    useEffect(() => {
        if (deal) {
            setTitle(deal.title);
            setValue(String(deal.value));
            setStage(deal.stage);
            setProbability(deal.probability);
            setExpectedCloseDate(deal.expected_close_date?.split('T')[0] || '');
            setNotes(deal.notes || '');
            return;
        }

        setTitle('');
        setValue('');
        setStage(defaultStage);
        setProbability(50);
        setExpectedCloseDate('');
        setNotes('');
    }, [deal, isOpen, defaultStage]);

    const handleSubmit = async () => {
        if (!title.trim()) {
            toast({ title: 'Titulo obrigatorio', variant: 'destructive' });
            return;
        }

        const numericValue = parseFloat(value);
        if (Number.isNaN(numericValue) || numericValue < 0) {
            toast({ title: 'Valor invalido', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            if (isEditing && deal) {
                const result = await updateDeal(deal.id, {
                    title: title.trim(),
                    value: numericValue,
                    stage,
                    probability,
                    expected_close_date: expectedCloseDate || null,
                    notes: notes.trim() || null,
                });
                if (result.error) {
                    toast({ title: result.error, variant: 'destructive' });
                } else if (result.deal) {
                    toast({ title: 'Deal atualizado!' });
                    onSaved?.(result.deal);
                    setIsOpen(false);
                }
            } else {
                if (!contactId) {
                    toast({ title: 'Contato nao selecionado', variant: 'destructive' });
                    return;
                }
                const result = await createDeal({
                    workspace_id: workspaceId,
                    contact_id: contactId,
                    title: title.trim(),
                    value: numericValue,
                    stage,
                    probability,
                    expected_close_date: expectedCloseDate || null,
                    notes: notes.trim() || null,
                });
                if (result.error) {
                    toast({ title: result.error, variant: 'destructive' });
                } else if (result.deal) {
                    toast({ title: 'Deal criado!' });
                    onSaved?.(result.deal);
                    setIsOpen(false);
                }
            }
        } catch {
            toast({ title: 'Erro inesperado', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (currentValue: string) => {
        const numericValue = parseFloat(currentValue);
        if (Number.isNaN(numericValue)) return 'R$ 0,00';
        return numericValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" />
                        {isEditing ? 'Editar Deal' : 'Novo Deal'}
                    </DialogTitle>
                    <DialogDescription>
                        {contactName ? `Para: ${contactName}` : 'Preencha os dados da oportunidade'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="deal-title">Titulo *</Label>
                        <Input
                            id="deal-title"
                            placeholder="Ex: Pacote Premium 2026"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="deal-value" className="flex items-center gap-1">
                                <DollarSign className="h-3.5 w-3.5" /> Valor (R$)
                            </Label>
                            <Input
                                id="deal-value"
                                type="number"
                                min={0}
                                step={0.01}
                                placeholder="0,00"
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                            />
                            {value ? (
                                <p className="text-xs text-muted-foreground">{formatCurrency(value)}</p>
                            ) : null}
                        </div>

                        <div className="space-y-2">
                            <Label>Estagio</Label>
                            <Select value={stage} onValueChange={setStage}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {selectedStageMissing ? (
                                        <SelectItem value={stage}>{stage}</SelectItem>
                                    ) : null}
                                    {orderedStages.map((stageOption) => (
                                        <SelectItem key={stageOption.id} value={stageOption.value}>
                                            {stageOption.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                            <Percent className="h-3.5 w-3.5" /> Probabilidade: {probability}%
                        </Label>
                        <Slider
                            value={[probability]}
                            onValueChange={(nextValue) => setProbability(nextValue[0])}
                            max={100}
                            min={0}
                            step={5}
                            className="py-2"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>0%</span>
                            <span className="font-medium">
                                Ponderado: {formatCurrency(String((parseFloat(value || '0') * probability) / 100))}
                            </span>
                            <span>100%</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="deal-date" className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" /> Previsao de Fechamento
                        </Label>
                        <Input
                            id="deal-date"
                            type="date"
                            value={expectedCloseDate}
                            onChange={(event) => setExpectedCloseDate(event.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="deal-notes" className="flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" /> Observacoes
                        </Label>
                        <Textarea
                            id="deal-notes"
                            placeholder="Detalhes sobre a negociacao..."
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isEditing ? 'Salvar' : 'Criar Deal'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
