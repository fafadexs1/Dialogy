import React, { useState } from 'react';
import { Bot, Info, Loader2, MessageCircle, Sparkles, Webhook } from 'lucide-react';

import type { Action, ActionType, NexusFlowInstance } from '@/lib/types';
import { saveAutopilotRule } from '@/actions/autopilot';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

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

    if (!name.trim()) {
      toast({ title: 'Nome obrigatório', description: 'Dê um nome para a regra.', variant: 'destructive' });
      setIsSubmitting(false);
      return;
    }

    if (!trigger.trim()) {
      toast({ title: 'Gatilho obrigatório', description: 'Defina o que o cliente deve dizer.', variant: 'destructive' });
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
          toast({ title: 'Resposta obrigatória', description: 'Escreva a resposta do agente.', variant: 'destructive' });
          setIsSubmitting(false);
          return;
        }

        action = {
          type: 'reply',
          value: actionValue,
        };
      }
    } catch {
      toast({ title: 'Erro de formato', description: 'O body do webhook não é um JSON válido.', variant: 'destructive' });
      setIsSubmitting(false);
      return;
    }

    const ruleToSave: Omit<NexusFlowInstance, 'enabled'> = {
      id: instance?.id || '',
      name,
      trigger,
      action,
    };

    const result = await saveAutopilotRule(configId, ruleToSave);

    if (result.success) {
      toast({ title: 'Regra salva', description: 'Sua automação foi salva com sucesso.' });
      onSuccess();
    } else {
      toast({ title: 'Erro ao salvar regra', description: result.error, variant: 'destructive' });
    }

    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      <DialogHeader className="border-b border-border/60 bg-muted/30 px-6 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Autopilot Rules
            </div>
            <DialogTitle>{instance ? 'Editar habilidade' : 'Nova habilidade'}</DialogTitle>
            <DialogDescription>
              Ensine o agente a reconhecer uma intenção específica e responder de forma determinística.
            </DialogDescription>
          </div>

          <Badge variant="outline" className="rounded-full">
            {actionType === 'reply' ? 'Resposta textual' : 'Webhook/API'}
          </Badge>
        </div>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="grid gap-6">
          <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
            <CardContent className="grid gap-6 p-5 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <Label htmlFor="rule-name" className="text-base font-semibold">1. Nome da habilidade</Label>
                  <Input
                    id="rule-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Consultar status de entrega"
                    className="h-11 rounded-2xl bg-muted/30"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-base font-semibold">2. Tipo de ação</Label>
                    <Select value={actionType} onValueChange={(value) => setActionType(value as ActionType)}>
                      <SelectTrigger className="h-11 w-[210px] rounded-2xl bg-muted/30">
                        <SelectValue placeholder="Tipo de ação" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reply">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-3.5 w-3.5" />
                            Responder texto
                          </div>
                        </SelectItem>
                        <SelectItem value="webhook">
                          <div className="flex items-center gap-2">
                            <Webhook className="h-3.5 w-3.5" />
                            Webhook (API)
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    Use resposta para casos diretos e webhook quando o fluxo depender de dados externos.
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="rule-trigger" className="text-base font-semibold">3. Gatilho do cliente</Label>
                <p className="text-sm text-muted-foreground">
                  Descreva como o cliente costuma pedir essa ação. A IA vai reconhecer variações dessa intenção.
                </p>
                <Textarea
                  id="rule-trigger"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  placeholder="Ex: 'Quero rastrear meu pedido', 'Onde está minha entrega?', 'Status da encomenda'"
                  className="min-h-[120px] rounded-[24px] bg-muted/30"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
            <CardContent className="grid gap-5 p-5 sm:p-6">
              {actionType === 'reply' ? (
                <>
                  <div className="flex items-start gap-3 rounded-[20px] border border-blue-500/20 bg-blue-500/10 px-4 py-4 text-sm text-blue-700 dark:text-blue-300">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>O agente responderá imediatamente quando detectar essa intenção.</div>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="rule-action-value" className="text-base font-semibold">4. Resposta do agente</Label>
                    <Textarea
                      id="rule-action-value"
                      value={actionValue}
                      onChange={(e) => setActionValue(e.target.value)}
                      placeholder="Ex: 'Vou verificar isso para você agora. Pode me informar o número do pedido?'"
                      className="min-h-[180px] rounded-[24px] bg-muted/30"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3 rounded-[20px] border border-violet-500/20 bg-violet-500/10 px-4 py-4 text-sm text-violet-700 dark:text-violet-300">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      O agente enviará os dados do chat para seu sistema externo. Use isso para consulta de pedido, CRM,
                      status financeiro ou qualquer automação server-side.
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="space-y-3">
                      <Label htmlFor="webhook-url" className="text-base font-semibold">4. URL do endpoint</Label>
                      <Input
                        id="webhook-url"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://api.seusistema.com/webhook"
                        className="h-11 rounded-2xl bg-muted/30"
                      />
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="webhook-method" className="text-base font-semibold">Método HTTP</Label>
                      <Select value={webhookMethod} onValueChange={(val) => setWebhookMethod(val as 'GET' | 'POST')}>
                        <SelectTrigger id="webhook-method" className="h-11 rounded-2xl bg-muted/30">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="GET">GET</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="webhook-body" className="text-base font-semibold">5. JSON body opcional</Label>
                    <Textarea
                      id="webhook-body"
                      className="min-h-[220px] rounded-[24px] bg-muted/30 font-mono text-xs"
                      value={webhookBody}
                      onChange={(e) => setWebhookBody(e.target.value)}
                      placeholder={'{\n  "customerId": "{{contact.id}}"\n}'}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-4 sm:justify-between">
        <Button type="button" variant="ghost" onClick={onClose} className="rounded-full">Cancelar</Button>
        <Button type="submit" disabled={isSubmitting} className="rounded-full px-6">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar habilidade
        </Button>
      </DialogFooter>
    </form>
  );
}
