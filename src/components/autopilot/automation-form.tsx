import React, { useState } from 'react';
import type { NexusFlowInstance, Action, ActionType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, MessageCircle, Webhook, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveAutopilotRule } from '@/actions/autopilot';

interface AutomationFormProps {
    configId: string;
    onSuccess: () => void;
    onClose: () => void;
    instance?: NexusFlowInstance | null;
}

export function AutomationForm({
    configId,
    onSuccess,
    onClose,
    instance,
}: AutomationFormProps) {
    const [name, setName] = useState(instance?.name || '');
    const [trigger, setTrigger] = useState(instance?.trigger || '');
    const [actionType, setActionType] = useState<ActionType>(instance?.action.type || 'reply');
    const [actionValue, setActionValue] = useState(instance?.action.type === 'reply' ? instance.action.value : '');
    const [webhookUrl, setWebhookUrl] = useState(instance?.action.type === 'webhook' ? instance.action.url || '' : '');
    const [webhookMethod, setWebhookMethod] = useState(instance?.action.type === 'webhook' ? instance.action.method || 'POST' : 'POST');
    const [webhookBody, setWebhookBody] = useState(instance?.action.type === 'webhook' ? JSON.stringify(instance.action.body, null, 2) || '' : '');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        // Validation
        if (!name.trim()) {
            toast({ title: 'Nome Obrigatório', description: 'Dê um nome para a regra.', variant: 'destructive' });
            setIsSubmitting(false);
            return;
        }
        if (!trigger.trim()) {
            toast({ title: 'Gatilho Obrigatório', description: 'Defina o que o cliente deve dizer.', variant: 'destructive' });
            setIsSubmitting(false);
            return;
        }

        let action: Action;

        try {
            if (actionType === 'webhook') {
                action = {
                    type: 'webhook',
                    url: webhookUrl,
                    method: webhookMethod,
                    body: webhookBody ? JSON.parse(webhookBody) : undefined,
                };
            } else {
                if (!actionValue.trim()) {
                    toast({ title: 'Resposta Obrigatória', description: 'Escreva a resposta do agente.', variant: 'destructive' });
                    setIsSubmitting(false);
                    return;
                }
                action = {
                    type: 'reply',
                    value: actionValue,
                };
            }
        } catch (error) {
            toast({ title: 'Erro de Formato', description: 'O corpo (body) do webhook não é um JSON válido.', variant: 'destructive' });
            setIsSubmitting(false);
            return;
        }

        const ruleToSave: Omit<NexusFlowInstance, 'enabled'> = {
            id: instance?.id || '', // Empty for create
            name,
            trigger,
            action,
        };

        const result = await saveAutopilotRule(configId, ruleToSave);

        if (result.success) {
            toast({ title: "Regra Salva!", description: "Sua automação foi salva com sucesso." });
            onSuccess();
        } else {
            toast({ title: "Erro ao Salvar Regra", description: result.error, variant: 'destructive' });
        }

        setIsSubmitting(false);
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <DialogHeader className="px-6 py-4 border-b">
                <DialogTitle>{instance ? 'Editar Habilidade' : 'Nova Habilidade'}</DialogTitle>
                <DialogDescription>
                    Ensine o agente a reconhecer e agir sobre uma intenção específica.
                </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                <div className="space-y-3">
                    <Label htmlFor="rule-name" className="text-base font-semibold">1. Nome da Habilidade</Label>
                    <Input
                        id="rule-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Consultar Status de Entrega"
                        className="bg-muted/30"
                    />
                </div>

                <div className="space-y-3">
                    <Label htmlFor="rule-trigger" className="text-base font-semibold">2. Gatilho (Intenção do Cliente)</Label>
                    <p className="text-sm text-muted-foreground">
                        Descreva o que o cliente geralmente pergunta. O agente usará IA para entender variações disso.
                    </p>
                    <Textarea
                        id="rule-trigger"
                        value={trigger}
                        onChange={(e) => setTrigger(e.target.value)}
                        placeholder="Ex: 'Quero saber onde está meu pedido', 'Rastrear encomenda', 'Status da entrega'"
                        className="min-h-[80px] bg-muted/30 resize-none"
                    />
                </div>

                <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">3. Ação do Agente</Label>
                        <Select value={actionType} onValueChange={(value) => setActionType(value as ActionType)}>
                            <SelectTrigger className="w-[200px] h-8 text-xs">
                                <SelectValue placeholder="Tipo de Ação" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="reply"><div className="flex items-center gap-2"><MessageCircle className="h-3 w-3" /> Responder Texto</div></SelectItem>
                                <SelectItem value="webhook"><div className="flex items-center gap-2"><Webhook className="h-3 w-3" /> Webhook (API)</div></SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="p-4 border rounded-lg bg-secondary/20">
                        {actionType === 'reply' ? (
                            <div className="space-y-2 animate-in fade-in-50">
                                <Label htmlFor="rule-action-value">Resposta do Agente</Label>
                                <Textarea
                                    id="rule-action-value"
                                    value={actionValue}
                                    onChange={(e) => setActionValue(e.target.value)}
                                    placeholder="Ex: 'Vou verificar isso para você agora mesmo. Qual o número do pedido?'"
                                    className="min-h-[100px]"
                                />
                            </div>
                        ) : (
                            <div className="space-y-4 animate-in fade-in-50">
                                <div className="flex items-center gap-2 p-3 bg-blue-500/10 text-blue-500 rounded text-sm mb-2">
                                    <Info className="h-4 w-4" />
                                    <span>O agente enviará os dados do chat para o seu sistema.</span>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="webhook-url">URL do Endpoint</Label>
                                    <Input id="webhook-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.seusistema.com/webhook" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="webhook-method">Método HTTP</Label>
                                        <Select value={webhookMethod} onValueChange={(val) => setWebhookMethod(val as "GET" | "POST")}>
                                            <SelectTrigger id="webhook-method">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="POST">POST</SelectItem>
                                                <SelectItem value="GET">GET</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="webhook-body">JSON Body (Opcional)</Label>
                                    <Textarea
                                        id="webhook-body"
                                        className="font-mono text-xs"
                                        value={webhookBody}
                                        onChange={(e) => setWebhookBody(e.target.value)}
                                        placeholder={'{\n  "customerId": "{{contact.id}}"\n}'}
                                        rows={5}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t bg-muted/20">
                <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar Habilidade
                </Button>
            </DialogFooter>
        </form>
    );
}
