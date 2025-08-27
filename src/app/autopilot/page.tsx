

'use client';

import React, { useState, useEffect, useActionState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance, Action, ActionType, AutopilotConfig, AutopilotUsageLog } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Bot, DollarSign, BrainCircuit, Cog, ArrowDown, ArrowUp, KeyRound, Loader2, MessageCircle, Webhook, Save, History, Sparkles, BookText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarChart, ResponsiveContainer, XAxis, YAxis, Bar } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth.tsx';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAutopilotConfig, saveAutopilotConfig, saveAutopilotRule, deleteAutopilotRule, toggleAutopilotRule, getAutopilotUsageLogs } from '@/actions/autopilot';
import { useFormStatus } from 'react-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type ModelInfo = {
    name: string;
    description: string;
    inputCost: number; // Price per 1M tokens
    outputCost: number; // Price per 1M tokens
    contextWindow: string;
}

const modelInfo: Record<string, ModelInfo> = {
    'googleai/gemini-2.0-flash': {
        name: 'Gemini 2.0 Flash',
        description: 'Otimizado para velocidade e custo, ideal para respostas rápidas e automações de alto volume.',
        inputCost: 0.18, 
        outputCost: 0.36,
        contextWindow: '1M tokens'
    },
    'googleai/gemini-2.5-flash-lite': {
        name: 'Gemini 2.5 Flash Lite',
        description: 'Uma versão ainda mais leve e rápida, perfeita para tarefas simples e de altíssima velocidade.',
        inputCost: 0.15,
        outputCost: 0.30,
        contextWindow: '1M tokens'
    },
    'googleai/gemini-1.5-pro': {
        name: 'Gemini 1.5 Pro',
        description: 'Modelo mais poderoso, ideal para tarefas complexas que exigem raciocínio avançado.',
        inputCost: 3.5,
        outputCost: 10.5,
        contextWindow: '1M tokens'
    }
}

const chartData = [
  { month: "Jan", executions: 0 },
  { month: "Fev", executions: 0 },
  { month: "Mar", executions: 0 },
  { month: "Abr", executions: 0 },
  { month: "Mai", executions: 0 },
  { month: "Jun", executions: 0 },
]

const chartConfig = {
  executions: {
    label: "Execuções",
    color: "hsl(var(--primary))",
  },
}

interface UsageStats {
    executions: number;
    tokens: number;
    currentCost: number;
}

function SaveButton({ children }: { children: React.ReactNode }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {children}
        </Button>
    )
}

function AutomationForm({
  configId,
  onSuccess,
  onClose,
  instance,
}: {
  configId: string;
  onSuccess: () => void;
  onClose: () => void;
  instance?: NexusFlowInstance | null;
}) {
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
            action = {
                type: 'reply',
                value: actionValue,
            };
        }
    } catch (error) {
        toast({ title: 'Erro de Formato', description: 'O corpo (body) do webhook não é um JSON válido.', variant: 'destructive'});
        setIsSubmitting(false);
        return;
    }

    const ruleToSave: Omit<NexusFlowInstance, 'enabled'> = {
      id: instance?.id || null, 
      name,
      trigger,
      action,
    };
    
    const result = await saveAutopilotRule(configId, ruleToSave);

    if (result.success) {
        toast({ title: "Regra Salva!", description: "Sua automação foi salva com sucesso."});
        onSuccess();
    } else {
        toast({ title: "Erro ao Salvar Regra", description: result.error, variant: 'destructive'});
    }
    
    setIsSubmitting(false);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>{instance ? 'Editar Automação' : 'Adicionar Nova Automação'}</DialogTitle>
          <DialogDescription>
            Defina o gatilho e a ação que o agente de IA deve executar.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto p-1">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Nome da Automação</Label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Verificar status do pedido" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-trigger">QUANDO o cliente disser algo como...</Label>
            <Textarea id="rule-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Ex: 'Qual o status do meu pedido?' ou 'Onde está minha encomenda?'" />
          </div>
          
          <Separator />

          <div className="space-y-2">
            <Label>ENTÃO o agente deve...</Label>
              <Select value={actionType} onValueChange={(value) => setActionType(value as ActionType)}>
                  <SelectTrigger>
                      <SelectValue placeholder="Selecione um tipo de ação" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="reply"><div className="flex items-center gap-2"><MessageCircle/> Responder com Texto</div></SelectItem>
                      <SelectItem value="webhook"><div className="flex items-center gap-2"><Webhook/> Chamar Webhook (HTTP Request)</div></SelectItem>
                  </SelectContent>
              </Select>
          </div>

          {actionType === 'reply' ? (
              <div className="space-y-2 animate-in fade-in-50">
                  <Label htmlFor="rule-action-value">Texto da Resposta</Label>
                  <Textarea id="rule-action-value" value={actionValue} onChange={(e) => setActionValue(e.target.value)} placeholder="Ex: 'Verificando o status do seu pedido...'" />
              </div>
          ) : (
              <div className="space-y-4 p-4 border rounded-lg bg-secondary/50 animate-in fade-in-50">
                  <div className="space-y-2">
                      <Label htmlFor="webhook-url">URL do Webhook</Label>
                      <Input id="webhook-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.meusistema.com/pedido" />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="webhook-method">Método</Label>
                      <Select value={webhookMethod} onValueChange={setWebhookMethod}>
                          <SelectTrigger id="webhook-method">
                              <SelectValue placeholder="Selecione o método" />
                          </SelectTrigger>
                          <SelectContent>
                              <SelectItem value="POST">POST</SelectItem>
                              <SelectItem value="GET">GET</SelectItem>
                          </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="webhook-body">Corpo (Body) da Requisição (JSON)</Label>
                      <Textarea 
                          id="webhook-body"
                          className="font-code"
                          value={webhookBody}
                          onChange={(e) => setWebhookBody(e.target.value)}
                          placeholder={'{\\n  "customerId": "{{contact.id}}",\\n  "message": "{{customerMessage}}"\\n}'}
                      />
                      <p className="text-xs text-muted-foreground">
                          Use a sintaxe {`{{variável}}`} para inserir dados dinâmicos do chat, como {`{{contact.id}}`} ou {`{{customerMessage}}`}.
                      </p>
                  </div>
              </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Automação
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}


export default function AutopilotPage() {
    const user = useAuth();
    const { toast } = useToast();

    const [config, setConfig] = useState<AutopilotConfig | null>(null);
    const [instances, setInstances] = useState<NexusFlowInstance[]>([]);
    const [usageLogs, setUsageLogs] = useState<AutopilotUsageLog[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Form-specific states
    const [aiModel, setAiModel] = useState<string>('googleai/gemini-2.0-flash');
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [knowledgeBase, setKnowledgeBase] = useState('');
    const [loadingStats, setLoadingStats] = useState(true);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInstance, setEditingInstance] = useState<NexusFlowInstance | null>(null);
    
    const [saveState, saveAction] = useActionState(saveAutopilotConfig, { success: false });

    const fetchData = React.useCallback(async () => {
        if (!user?.activeWorkspaceId) return;

        setLoading(true);
        try {
            const data = await getAutopilotConfig(user.activeWorkspaceId);
            if (data.error) {
                toast({ title: "Erro ao carregar configurações", description: data.error, variant: 'destructive' });
            } else {
                setConfig(data.config);
                setInstances(data.rules || []);
                if (data.config) {
                    setAiModel(data.config.ai_model || 'googleai/gemini-2.0-flash');
                    setGeminiApiKey(data.config.gemini_api_key || '');
                    setKnowledgeBase(data.config.knowledge_base || '');

                    // Fetch usage logs if config exists
                    setLoadingStats(true);
                    const logsData = await getAutopilotUsageLogs(data.config.id);
                    if (logsData.logs) {
                        setUsageLogs(logsData.logs);
                    }
                    setLoadingStats(false);
                } else {
                   setLoadingStats(false);
                }
            }
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId, toast]);

     const usageStats: UsageStats | null = useMemo(() => {
        if (!usageLogs || usageLogs.length === 0) {
            return { executions: 0, tokens: 0, currentCost: 0 };
        }
        
        const executions = usageLogs.length;
        const tokens = usageLogs.reduce((acc, log) => acc + log.total_tokens, 0);
        
        const currentCost = usageLogs.reduce((acc, log) => {
            const model = modelInfo[log.model_name];
            if (!model) return acc;
            const inputCost = (log.input_tokens / 1000000) * model.inputCost;
            const outputCost = (log.output_tokens / 1000000) * model.outputCost;
            return acc + inputCost + outputCost;
        }, 0);

        return { executions, tokens, currentCost };
    }, [usageLogs]);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            fetchData();
        }
    }, [user?.activeWorkspaceId, fetchData]);

    useEffect(() => {
        if (saveState.success) {
            toast({ title: 'Configurações Salvas!', description: 'Suas alterações foram salvas com sucesso.'});
            fetchData();
        } else if (saveState.error) {
            toast({ title: 'Erro ao Salvar', description: saveState.error, variant: 'destructive'});
        }
    }, [saveState, toast, fetchData]);

    const handleSaveSuccess = () => {
        setIsModalOpen(false);
        setEditingInstance(null);
        fetchData();
    }

    const handleEditClick = (instance: NexusFlowInstance) => {
        setEditingInstance(instance);
        setIsModalOpen(true);
    };

    const handleAddNewClick = () => {
        if (!config?.id) {
            toast({ title: 'Ação Necessária', description: 'Por favor, salve as configurações (Chave API ou Modelo) primeiro para obter um ID de configuração antes de adicionar uma regra.', variant: 'default' });
            return;
        }
        setEditingInstance(null);
        setIsModalOpen(true);
    };

    const handleRemoveInstance = async (id: string) => {
        const result = await deleteAutopilotRule(id);
        if (result.success) {
            toast({ title: "Regra Removida!" });
            fetchData();
        } else {
            toast({ title: "Erro ao Remover", description: result.error, variant: 'destructive' });
        }
    };

    const handleToggleEnabled = async (id: string, enabled: boolean) => {
        const result = await toggleAutopilotRule(id, enabled);
        if (result.success) {
            toast({ title: `Regra ${enabled ? 'ativada' : 'desativada'}.` });
            fetchData();
        } else {
            toast({ title: "Erro ao Atualizar", description: result.error, variant: 'destructive' });
        }
    };
    
    const getFlowIcon = (flowName: string) => {
        if (flowName.includes('autoResponder')) return <Bot className="h-4 w-4 text-primary" />;
        if (flowName.includes('summarize')) return <BookText className="h-4 w-4 text-purple-500" />;
        if (flowName.includes('smartReplies')) return <Sparkles className="h-4 w-4 text-amber-500" />;
        return <BrainCircuit className="h-4 w-4 text-muted-foreground" />;
    };

    const selectedModelInfo = modelInfo[aiModel];
    const BRL_USD_RATE = 5.2; // Approximate rate

    if (!user || loading) {
        return (
            <MainLayout>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainLayout>
        )
    }

    return (
        <MainLayout>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Bot /> Agente de IA</h1>
                        <p className="text-muted-foreground">Crie e gerencie seu agente de IA para responder e agir por você.</p>
                    </div>
                    <Button onClick={handleAddNewClick}>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Automação
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
                            <Card className="lg:col-span-8">
                                <CardHeader>
                                    <CardTitle>Visão Geral de Custos e Uso</CardTitle>
                                    <CardDescription>Acompanhe o consumo e os custos gerados pelas execuções do Agente de IA.</CardDescription>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-muted-foreground">Métricas do Mês Atual</h3>
                                        {loadingStats ? (
                                            <div className="grid grid-cols-2 gap-4">
                                                <Skeleton className="h-24" />
                                                <Skeleton className="h-24" />
                                            </div>
                                        ) : (
                                        <div className="grid grid-cols-2 gap-4 text-center">
                                            <div className="p-4 rounded-lg bg-secondary/50">
                                                <p className="text-sm text-muted-foreground font-semibold">Execuções</p>
                                                <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                    <BrainCircuit className="h-6 w-6 text-primary"/>
                                                    {usageStats?.executions.toLocaleString('pt-BR') || '0'}
                                                </p>
                                            </div>
                                            <div className="p-4 rounded-lg bg-secondary/50">
                                                <p className="text-sm text-muted-foreground font-semibold">Tokens Usados</p>
                                                <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                    <BrainCircuit className="h-6 w-6 text-purple-500"/>
                                                    {usageStats?.tokens ? `${(usageStats.tokens / 1000).toFixed(1)}k` : '0'}
                                                </p>
                                            </div>
                                            <div className="p-4 rounded-lg bg-secondary/50 col-span-2">
                                                <p className="text-sm text-muted-foreground font-semibold">Custo Atual (USD)</p>
                                                <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                    <DollarSign className="h-6 w-6 text-green-500"/>
                                                    {usageStats?.currentCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) || '$0.00'}
                                                </p>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-muted-foreground">Execuções nos Últimos 6 Meses</h3>
                                        <ChartContainer config={chartConfig} className="h-[200px] w-full">
                                            <BarChart accessibilityLayer data={chartData}>
                                                <XAxis
                                                dataKey="month"
                                                tickLine={false}
                                                tickMargin={10}
                                                axisLine={false}
                                                tickFormatter={(value) => value.slice(0, 3)}
                                                />
                                                <YAxis tickLine={false} axisLine={false} />
                                                <ChartTooltip
                                                cursor={false}
                                                content={<ChartTooltipContent indicator="dot" />}
                                                />
                                                <Bar dataKey="executions" fill="var(--color-executions)" radius={4} />
                                            </BarChart>
                                        </ChartContainer>
                                    </div>
                                </CardContent>
                            </Card>
                            <div className="lg:col-span-4 space-y-6">
                                <form action={saveAction}>
                                    <input type="hidden" name="workspaceId" value={user.activeWorkspaceId || ''} />
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2"><Cog/> Configurações do Agente</CardTitle>
                                            <CardDescription>Selecione o "cérebro" do seu agente de IA.</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                <Label htmlFor="ai-model">Modelo de IA</Label>
                                                <Select name="aiModel" value={aiModel} onValueChange={setAiModel}>
                                                    <SelectTrigger id="ai-model">
                                                        <SelectValue placeholder="Selecione um modelo" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="googleai/gemini-2.0-flash">Gemini 2.0 Flash (Rápido)</SelectItem>
                                                        <SelectItem value="googleai/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (Ultra Rápido)</SelectItem>
                                                        <SelectItem value="googleai/gemini-1.5-pro">Gemini 1.5 Pro (Avançado)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                {selectedModelInfo && (
                                                    <div className="pt-2 space-y-3 animate-in fade-in-50">
                                                        <p className="text-xs text-muted-foreground">{selectedModelInfo.description}</p>
                                                        <div className="grid grid-cols-2 gap-3 text-center">
                                                            <div className="p-2 border rounded-lg">
                                                                <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><ArrowDown className="text-green-500"/> Entrada</p>
                                                                <p className="text-sm font-bold">{(selectedModelInfo.inputCost).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}*</p>
                                                            </div>
                                                            <div className="p-2 border rounded-lg">
                                                                <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><ArrowUp className="text-blue-500"/> Saída</p>
                                                                <p className="text-sm font-bold">{(selectedModelInfo.outputCost).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}*</p>
                                                            </div>
                                                        </div>
                                                        <div className="p-2 border rounded-lg text-center">
                                                            <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><BrainCircuit className="text-purple-500"/> Janela de Contexto</p>
                                                            <p className="text-sm font-bold">{selectedModelInfo.contextWindow}</p>
                                                        </div>
                                                        <p className="text-[10px] text-muted-foreground/80 leading-tight">* Preços em USD por 1 milhão de tokens. Os valores são estimativas e podem variar.</p>
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                    <Card className="mt-6">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2"><KeyRound/> Credenciais da API Gemini</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                <Label htmlFor="gemini-api-key">Sua Chave de API</Label>
                                                <Input 
                                                    id="gemini-api-key"
                                                    name="geminiApiKey" 
                                                    type="password" 
                                                    placeholder="••••••••••••••••••••••••••" 
                                                    value={geminiApiKey}
                                                    onChange={(e) => setGeminiApiKey(e.target.value)}
                                                />
                                                <p className="text-xs text-muted-foreground pt-1">Sua chave é armazenada de forma segura e usada apenas para as chamadas de IA.</p>
                                            </div>
                                        </CardContent>
                                        <CardFooter>
                                            <SaveButton>
                                                <Save className='mr-2 h-4 w-4'/> Salvar Chave & Modelo
                                            </SaveButton>
                                        </CardFooter>
                                    </Card>
                                </form>
                            </div>
                        </div>
                        
                        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                            <DialogContent className="max-w-2xl">
                                {config?.id && (
                                    <AutomationForm 
                                        configId={config.id}
                                        instance={editingInstance}
                                        onSuccess={handleSaveSuccess}
                                        onClose={() => setIsModalOpen(false)}
                                    />
                                )}
                            </DialogContent>
                        </Dialog>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <form action={saveAction} className='lg:col-span-2 space-y-6'>
                                <input type="hidden" name="workspaceId" value={user.activeWorkspaceId || ''} />
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Base de Conhecimento do Agente</CardTitle>
                                        <CardDescription>
                                            Forneça ao agente de IA o contexto sobre seu negócio, produtos e políticas.
                                            Ele usará esse conhecimento para responder às perguntas dos clientes de forma precisa.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Textarea 
                                            name="knowledgeBase"
                                            placeholder="Exemplo: Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. O prazo para devoluções é de 7 dias úteis..."
                                            className="min-h-[200px]"
                                            value={knowledgeBase}
                                            onChange={(e) => setKnowledgeBase(e.target.value)}
                                        />
                                    </CardContent>
                                    <CardFooter>
                                        <SaveButton>
                                            <Save className='mr-2 h-4 w-4'/> Salvar Base de Conhecimento
                                        </SaveButton>
                                    </CardFooter>
                                </Card>
                                 <Card>
                                <CardHeader>
                                    <CardTitle>Regras de Automação</CardTitle>
                                    <CardDescription>
                                        Defina gatilhos e ações específicas para situações comuns. As regras têm prioridade sobre a base de conhecimento.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {instances.map(instance => (
                                        <div key={instance.id} className="p-4 border rounded-lg bg-background relative group">
                                            <div className="absolute top-3 right-3 flex items-center gap-1">
                                                <Switch
                                                    id={`status-${instance.id}`}
                                                    checked={instance.enabled}
                                                    onCheckedChange={(checked) => handleToggleEnabled(instance.id, checked)}
                                                />
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7">
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => handleEditClick(instance)}><Edit className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => handleRemoveInstance(instance.id)}><Trash2 className="mr-2 h-4 w-4" />Remover</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                            <p className="text-sm font-semibold pr-20">{instance.name}</p>
                                            <div className="mt-2 space-y-2 text-xs">
                                                <p className="text-muted-foreground"><span className="font-semibold text-foreground">QUANDO:</span> {instance.trigger}</p>
                                                <div className="text-muted-foreground flex items-start gap-1.5">
                                                <span className="font-semibold text-foreground shrink-0">ENTÃO:</span> 
                                                {instance.action.type === 'reply' ? (
                                                    <span>{instance.action.value}</span>
                                                ) : (
                                                    <div className="flex items-center gap-1.5">
                                                        <Webhook className="h-3 w-3"/>
                                                        <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{instance.action.method}</span>
                                                        <span className="truncate">{instance.action.url}</span>
                                                    </div>
                                                )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {instances.length === 0 && (
                                        <div className="text-center p-6 border-2 border-dashed rounded-lg">
                                            <p className="text-muted-foreground">Nenhuma automação criada.</p>
                                            <Button variant="link" onClick={handleAddNewClick}>Adicionar a primeira automação</Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                            </form>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Histórico de Execuções</CardTitle>
                                    <CardDescription>
                                        Últimas 20 execuções do Piloto Automático e seus custos em tokens.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Ação</TableHead>
                                                <TableHead>Tokens</TableHead>
                                                <TableHead>Quando</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {usageLogs.map((log) => (
                                                <TableRow key={log.id}>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            {getFlowIcon(log.flow_name)}
                                                            <div>
                                                                <p className="font-medium">{log.rule_name || log.flow_name}</p>
                                                                <p className="text-xs text-muted-foreground">{log.model_name}</p>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-mono">{log.total_tokens}</TableCell>
                                                    <TableCell className="text-muted-foreground text-xs">
                                                        {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: ptBR })}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {usageLogs.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={3} className="text-center h-24 text-muted-foreground">
                                                        Nenhuma execução registrada ainda.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </div>
                </main>
            </div>
        </MainLayout>
    );
}
