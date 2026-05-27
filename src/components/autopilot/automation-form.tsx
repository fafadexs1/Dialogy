import React, { useMemo, useState } from 'react';
import { Bot, Info, Loader2, MessageCircle, Plus, Sparkles, Trash2, Webhook } from 'lucide-react';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type BodyType = 'json' | 'form-data';
type AuthType = 'none' | 'bearer' | 'basic' | 'api_key';
type KeyValueRow = { id: string; key: string; value: string };

function rowsFromRecord(record?: Record<string, unknown> | null): KeyValueRow[] {
  return Object.entries(record || {}).map(([key, value], index) => ({ id: `${key}-${index}`, key, value: String(value ?? '') }));
}

function recordFromRows(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
}

function KeyValueEditor({ rows, onChange }: { rows: KeyValueRow[]; onChange: (rows: KeyValueRow[]) => void }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] gap-2">
          <Input value={row.key} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, key: event.target.value } : item))} placeholder="chave" className="h-9 rounded-xl bg-muted/30 font-mono text-xs" />
          <Input value={row.value} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} placeholder="valor ou {{variavel}}" className="h-9 rounded-xl bg-muted/30 font-mono text-xs" />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => onChange(rows.filter((item) => item.id !== row.id))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="h-9 w-full rounded-xl border-dashed" onClick={() => onChange([...rows, { id: crypto.randomUUID(), key: '', value: '' }])}>
        <Plus className="mr-2 h-4 w-4" />
        Adicionar item
      </Button>
    </div>
  );
}

interface AutomationFormProps {
  configId: string;
  onSuccess: (rule?: NexusFlowInstance) => void;
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
  const [webhookMethod, setWebhookMethod] = useState<HttpMethod>(instance?.action.type === 'webhook' ? instance.action.method || 'POST' : 'POST');
  const [webhookDescription, setWebhookDescription] = useState(instance?.action.type === 'webhook' ? instance.action.description || '' : '');
  const [webhookBodyType, setWebhookBodyType] = useState<BodyType>(instance?.action.type === 'webhook' ? instance.action.bodyType || 'json' : 'json');
  const [webhookBody, setWebhookBody] = useState(instance?.action.type === 'webhook' && (!instance.action.bodyType || instance.action.bodyType === 'json') ? JSON.stringify(instance.action.body, null, 2) || '' : '');
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>(instance?.action.type === 'webhook' ? rowsFromRecord(instance.action.headers) : []);
  const [queryRows, setQueryRows] = useState<KeyValueRow[]>(instance?.action.type === 'webhook' ? rowsFromRecord(instance.action.query) : []);
  const [bodyRows, setBodyRows] = useState<KeyValueRow[]>(instance?.action.type === 'webhook' && instance.action.bodyType === 'form-data' ? rowsFromRecord(instance.action.body) : []);
  const [authType, setAuthType] = useState<AuthType>(instance?.action.type === 'webhook' ? instance.action.auth?.type || 'none' : 'none');
  const [authToken, setAuthToken] = useState(instance?.action.type === 'webhook' ? instance.action.auth?.token || '' : '');
  const [authUsername, setAuthUsername] = useState(instance?.action.type === 'webhook' ? instance.action.auth?.username || '' : '');
  const [authPassword, setAuthPassword] = useState(instance?.action.type === 'webhook' ? instance.action.auth?.password || '' : '');
  const [authKey, setAuthKey] = useState(instance?.action.type === 'webhook' ? instance.action.auth?.key || '' : '');
  const [authValue, setAuthValue] = useState(instance?.action.type === 'webhook' ? instance.action.auth?.value || '' : '');
  const [authPlacement, setAuthPlacement] = useState<'header' | 'query'>(instance?.action.type === 'webhook' ? instance.action.auth?.placement || 'header' : 'header');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const bodyPreview = useMemo(() => webhookBodyType === 'form-data' ? JSON.stringify(recordFromRows(bodyRows), null, 2) : webhookBody, [bodyRows, webhookBody, webhookBodyType]);

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
          description: webhookDescription || undefined,
          auth: authType === 'none' ? undefined : {
            type: authType,
            token: authToken || undefined,
            username: authUsername || undefined,
            password: authPassword || undefined,
            key: authKey || undefined,
            value: authValue || undefined,
            placement: authPlacement,
          },
          headers: recordFromRows(headerRows),
          query: recordFromRows(queryRows),
          bodyType: webhookBodyType,
          body: webhookBodyType === 'form-data' ? recordFromRows(bodyRows) : (webhookBody ? JSON.parse(webhookBody) : undefined),
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
      onSuccess(result.rule);
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
                      <Select value={webhookMethod} onValueChange={(val) => setWebhookMethod(val as HttpMethod)}>
                        <SelectTrigger id="webhook-method" className="h-11 rounded-2xl bg-muted/30">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="PUT">PUT</SelectItem>
                          <SelectItem value="PATCH">PATCH</SelectItem>
                          <SelectItem value="DELETE">DELETE</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="webhook-description" className="text-base font-semibold">5. Instrução da ferramenta</Label>
                    <Textarea
                      id="webhook-description"
                      className="min-h-[110px] rounded-[20px] bg-muted/30 text-sm"
                      value={webhookDescription}
                      onChange={(e) => setWebhookDescription(e.target.value)}
                      placeholder="Explique quando usar esta API, quais dados enviar e como interpretar a resposta."
                    />
                  </div>

                  <Tabs defaultValue="body" className="space-y-4">
                    <TabsList className="grid w-full grid-cols-4 rounded-2xl">
                      <TabsTrigger value="auth" className="rounded-xl">Auth</TabsTrigger>
                      <TabsTrigger value="headers" className="rounded-xl">Headers</TabsTrigger>
                      <TabsTrigger value="query" className="rounded-xl">Query</TabsTrigger>
                      <TabsTrigger value="body" className="rounded-xl">Corpo</TabsTrigger>
                    </TabsList>

                    <TabsContent value="auth" className="space-y-3">
                      <Select value={authType} onValueChange={(value) => setAuthType(value as AuthType)}>
                        <SelectTrigger className="h-11 rounded-2xl bg-muted/30"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem autenticação</SelectItem>
                          <SelectItem value="bearer">Bearer token</SelectItem>
                          <SelectItem value="basic">Basic auth</SelectItem>
                          <SelectItem value="api_key">API key</SelectItem>
                        </SelectContent>
                      </Select>
                      {authType === 'bearer' && (
                        <Input value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Token" className="h-10 rounded-xl bg-muted/30 font-mono text-xs" />
                      )}
                      {authType === 'basic' && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} placeholder="Usuário" className="h-10 rounded-xl bg-muted/30" />
                          <Input value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Senha" type="password" className="h-10 rounded-xl bg-muted/30" />
                        </div>
                      )}
                      {authType === 'api_key' && (
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_150px]">
                          <Input value={authKey} onChange={(e) => setAuthKey(e.target.value)} placeholder="Nome" className="h-10 rounded-xl bg-muted/30 font-mono text-xs" />
                          <Input value={authValue} onChange={(e) => setAuthValue(e.target.value)} placeholder="Valor" className="h-10 rounded-xl bg-muted/30 font-mono text-xs" />
                          <Select value={authPlacement} onValueChange={(value) => setAuthPlacement(value as 'header' | 'query')}>
                            <SelectTrigger className="h-10 rounded-xl bg-muted/30"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="header">Header</SelectItem>
                              <SelectItem value="query">Query</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="headers">
                      <KeyValueEditor rows={headerRows} onChange={setHeaderRows} />
                    </TabsContent>

                    <TabsContent value="query">
                      <KeyValueEditor rows={queryRows} onChange={setQueryRows} />
                    </TabsContent>

                    <TabsContent value="body" className="space-y-3">
                      <Select value={webhookBodyType} onValueChange={(value) => setWebhookBodyType(value as BodyType)}>
                        <SelectTrigger className="h-11 rounded-2xl bg-muted/30"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="json">JSON (application/json)</SelectItem>
                          <SelectItem value="form-data">Multipart (multipart/form-data)</SelectItem>
                        </SelectContent>
                      </Select>
                      {webhookBodyType === 'form-data' ? (
                        <KeyValueEditor rows={bodyRows} onChange={setBodyRows} />
                      ) : (
                        <Textarea
                          id="webhook-body"
                          className="min-h-[220px] rounded-[24px] bg-muted/30 font-mono text-xs"
                          value={webhookBody}
                          onChange={(e) => setWebhookBody(e.target.value)}
                          placeholder={'{\n  "customerId": "{{contact.id}}",\n  "message": "{{message}}"\n}'}
                        />
                      )}
                      <p className="break-words rounded-xl bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">Preview: {bodyPreview || '{}'}</p>
                    </TabsContent>
                  </Tabs>

                  <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    Variáveis disponíveis: <span className="font-mono">{'{{message}} {{resposta_agente}} {{agent.response}} {{contact.id}} {{contact.name}} {{contact.email}} {{chat.id}} {{chat.status}}'}</span>
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
