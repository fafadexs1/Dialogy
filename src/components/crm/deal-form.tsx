'use client';

import React, { useState, useEffect } from 'react';
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
import type { Deal, Contact } from '@/lib/types';
import { DollarSign, Percent, Calendar, FileText, Target, Loader2 } from 'lucide-react';

const STAGES = [
    { value: 'novo', label: 'Novo' },
    { value: 'qualificado', label: 'Qualificado' },
    { value: 'proposta', label: 'Proposta' },
    { value: 'negociacao', label: 'Negociação' },
    { value: 'ganho', label: 'Ganho' },
    { value: 'perdido', label: 'Perdido' },
];

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

    const isEditing = !!deal;

    useEffect(() => {
        if (deal) {
            setTitle(deal.title);
            setValue(String(deal.value));
            setStage(deal.stage);
            setProbability(deal.probability);
            setExpectedCloseDate(deal.expected_close_date?.split('T')[0] || '');
            setNotes(deal.notes || '');
        } else {
            setTitle('');
            setValue('');
            setStage('novo');
            setProbability(50);
            setExpectedCloseDate('');
            setNotes('');
        }
    }, [deal, isOpen]);

    const handleSubmit = async () => {
        if (!title.trim()) {
            toast({ title: 'Título obrigatório', variant: 'destructive' });
            return;
        }
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0) {
            toast({ title: 'Valor inválido', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            if (isEditing && deal) {
                const res = await updateDeal(deal.id, {
                    title: title.trim(),
                    value: numValue,
                    stage,
                    probability,
                    expected_close_date: expectedCloseDate || null,
                    notes: notes.trim() || null,
                });
                if (res.error) {
                    toast({ title: res.error, variant: 'destructive' });
                } else if (res.deal) {
                    toast({ title: 'Deal atualizado!' });
                    onSaved?.(res.deal);
                    setIsOpen(false);
                }
            } else {
                if (!contactId) {
                    toast({ title: 'Contato não selecionado', variant: 'destructive' });
                    return;
                }
                const res = await createDeal({
                    workspace_id: workspaceId,
                    contact_id: contactId,
                    title: title.trim(),
                    value: numValue,
                    stage,
                    probability,
                    expected_close_date: expectedCloseDate || null,
                    notes: notes.trim() || null,
                });
                if (res.error) {
                    toast({ title: res.error, variant: 'destructive' });
                } else if (res.deal) {
                    toast({ title: 'Deal criado!' });
                    onSaved?.(res.deal);
                    setIsOpen(false);
                }
            }
        } catch (err) {
            toast({ title: 'Erro inesperado', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val: string) => {
        const n = parseFloat(val);
        if (isNaN(n)) return 'R$ 0,00';
        return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
                    {/* Title */}
                    <div className="space-y-2">
                        <Label htmlFor="deal-title">Título *</Label>
                        <Input
                            id="deal-title"
                            placeholder="Ex: Pacote Premium 2026"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                        />
                    </div>

                    {/* Value + Stage row */}
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
                                onChange={e => setValue(e.target.value)}
                            />
                            {value && (
                                <p className="text-xs text-muted-foreground">{formatCurrency(value)}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label>Estágio</Label>
                            <Select value={stage} onValueChange={setStage}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STAGES.map(s => (
                                        <SelectItem key={s.value} value={s.value}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Probability */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                            <Percent className="h-3.5 w-3.5" /> Probabilidade: {probability}%
                        </Label>
                        <Slider
                            value={[probability]}
                            onValueChange={val => setProbability(val[0])}
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

                    {/* Date */}
                    <div className="space-y-2">
                        <Label htmlFor="deal-date" className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" /> Previsão de Fechamento
                        </Label>
                        <Input
                            id="deal-date"
                            type="date"
                            value={expectedCloseDate}
                            onChange={e => setExpectedCloseDate(e.target.value)}
                        />
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="deal-notes" className="flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" /> Observações
                        </Label>
                        <Textarea
                            id="deal-notes"
                            placeholder="Detalhes sobre a negociação..."
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isEditing ? 'Salvar' : 'Criar Deal'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
