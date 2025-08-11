
'use client';

import React, { useState, useEffect, useActionState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance, Action, ActionType } from '@/lib/types';
import { nexusFlowInstances as mockInstances } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Zap, Bot, DollarSign, BrainCircuit, Cog, ArrowDown, ArrowUp, KeyRound, Loader2, MessageCircle, Webhook } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarChart, ResponsiveContainer, XAxis, YAxis, Bar } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { Textarea } from '@/components/ui/textarea';


type ModelInfo = {
    name: string;
    description: string;
    inputCost: string;
    outputCost: string;
    contextWindow: string;
}

const modelInfo: Record<string, ModelInfo> = {
    'googleai/gemini-2.0-flash': {
        name: 'Gemini 2.0 Flash',
        description: 'Otimizado para velocidade e custo, ideal para respostas rápidas e automações de alto volume.',
        inputCost: 'R$ 0,94',
        outputCost: 'R$ 1,87',
        contextWindow: '1M tokens'
    },
    'googleai/gemini-1.5-pro': {
        name: 'Gemini 1.5 Pro',
        description: 'Modelo mais poderoso, ideal para tarefas complexas que exigem raciocínio avançado.',
        inputCost: 'R$ 18,70',
        outputCost: 'R$ 56,10',
        contextWindow: '1M tokens'
    }
}

const chartData = [
  { month: "Jan", executions: 186 },
  { month: "Fev", executions: 305 },
  { month: "Mar", executions: 237 },
  { month: "Abr", executions: 73 },
  { month: "Mai", executions: 209 },
  { month: "Jun", executions: 214 },
]

const chartConfig = {
  executions: {
    label: "Execuções",
    color: "hsl(var(--primary))",
  },
}

function AutomationForm({
  onSave,
  onClose,
  instance,
}: {
  onSave: (instance: NexusFlowInstance) => void;
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
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let action: Action;

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

    onSave({
      id: instance?.id || `inst-${Date.now()}`,
      name,
      trigger,
      action,
      enabled: instance?.enabled ?? true,
    });
  };

  return (
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
                      <SelectItem value="reply"><div className='flex items-center gap-2'><MessageCircle/> Responder com Texto</div></SelectItem>
                      <SelectItem value="webhook"><div className='flex items-center gap-2'><Webhook/> Chamar Webhook (HTTP Request)</div></SelectItem>
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
                          className='font-code'
                          value={webhookBody}
                          onChange={(e) => setWebhookBody(e.target.value)}
                          placeholder={'{\\n  "customerId": "{{contact.id}}",\\n  "message": "{{customerMessage}}"\\n}'}
                      />
                      <p className="text-xs text-muted-foreground">
                          Use a sintaxe `{{variável}}` para inserir dados dinâmicos do chat, como `{{contact.id}}` ou `{{customerMessage}}`.
                      </p>
                  </div>
              </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Salvar Automação</Button>
        </DialogFooter>
      </form>
  );
}


export default function AutopilotPage() {
    const user = useAuth();
    const [instances, setInstances] = useState<NexusFlowInstance[]>(mockInstances);
    const [aiModel, setAiModel] = useState<string>('googleai/gemini-2.0-flash');
    const [knowledgeBase, setKnowledgeBase] = useState('');
    const [geminiApiKey, setGeminiApiKey] = useState('');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInstance, setEditingInstance] = useState<NexusFlowInstance | null>(null);

    const estimatedMonthlyCost = 12.50;
    const currentMonthCost = 4.75;
    const executionsThisMonth = 950;
    const tokensThisMonth = 254000;
    
    const selectedModelInfo = modelInfo[aiModel];

    const handleSaveInstance = (instanceToSave: NexusFlowInstance) => {
        setInstances(prev => {
            const exists = prev.some(i => i.id === instanceToSave.id);
            if (exists) {
                return prev.map(i => (i.id === instanceToSave.id ? instanceToSave : i));
            }
            return [...prev, instanceToSave];
        });
        setIsModalOpen(false);
        setEditingInstance(null);
    };

    const handleEditClick = (instance: NexusFlowInstance) => {
        setEditingInstance(instance);
        setIsModalOpen(true);
    };

    const handleAddNewClick = () => {
        setEditingInstance(null);
        setIsModalOpen(true);
    };

    const handleRemoveInstance = (id: string) => {
        setInstances(prev => prev.filter(i => i.id !== id));
    };

    const handleToggleEnabled = (id: string, enabled: boolean) => {
        setInstances(prev => prev.map(i => (i.id === id ? { ...i, enabled } : i)));
    };

    const handleSaveSettings = () => {
        // TODO: Implement saving logic to backend
        console.log("Saving settings:", { aiModel, geminiApiKey });
    }


    if (!user) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        )
    }

    return (
        <MainLayout user={user}>
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
                                    <div className="grid grid-cols-2 gap-4 text-center">
                                        <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Execuções</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <BrainCircuit className="h-6 w-6 text-primary"/>
                                                {executionsThisMonth.toLocaleString('pt-BR')}
                                            </p>
                                        </div>
                                         <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Tokens Usados</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <BrainCircuit className="h-6 w-6 text-purple-500"/>
                                                {Math.round(tokensThisMonth / 1000)}k
                                            </p>
                                        </div>
                                        <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Custo Atual</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <DollarSign className="h-6 w-6 text-green-500"/>
                                                {currentMonthCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </p>
                                        </div>
                                        <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Custo Estimado</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <DollarSign className="h-6 w-6 text-amber-500"/>
                                                {estimatedMonthlyCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </p>
                                        </div>
                                    </div>
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
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Cog/> Configurações do Agente</CardTitle>
                                    <CardDescription>Selecione o "cérebro" do seu agente de IA.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        <Label htmlFor="ai-model">Modelo de IA</Label>
                                        <Select value={aiModel} onValueChange={setAiModel}>
                                            <SelectTrigger id="ai-model">
                                                <SelectValue placeholder="Selecione um modelo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="googleai/gemini-2.0-flash">Gemini 2.0 Flash (Rápido)</SelectItem>
                                                <SelectItem value="googleai/gemini-1.5-pro">Gemini 1.5 Pro (Avançado)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {selectedModelInfo && (
                                            <div className="pt-2 space-y-3 animate-in fade-in-50">
                                                <p className="text-xs text-muted-foreground">{selectedModelInfo.description}</p>
                                                <div className="grid grid-cols-2 gap-3 text-center">
                                                    <div className="p-2 border rounded-lg">
                                                        <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><ArrowDown className='text-green-500'/> Entrada</p>
                                                        <p className="text-sm font-bold">{selectedModelInfo.inputCost}*</p>
                                                    </div>
                                                    <div className="p-2 border rounded-lg">
                                                        <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><ArrowUp className='text-blue-500'/> Saída</p>
                                                        <p className="text-sm font-bold">{selectedModelInfo.outputCost}*</p>
                                                    </div>
                                                </div>
                                                <div className="p-2 border rounded-lg text-center">
                                                    <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><BrainCircuit className='text-purple-500'/> Janela de Contexto</p>
                                                    <p className="text-sm font-bold">{selectedModelInfo.contextWindow}</p>
                                                </div>
                                                <p className="text-[10px] text-muted-foreground/80 leading-tight">* Preços por 1 milhão de tokens. Os valores são estimativas e podem variar.</p>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                             <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><KeyRound/> Credenciais da API Gemini</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        <Label htmlFor="gemini-api-key">Sua Chave de API</Label>
                                        <Input 
                                            id="gemini-api-key" 
                                            type="password" 
                                            placeholder="••••••••••••••••••••••••••" 
                                            value={geminiApiKey}
                                            onChange={(e) => setGeminiApiKey(e.target.value)}
                                        />
                                        <p className='text-xs text-muted-foreground pt-1'>Sua chave é armazenada de forma segura e usada apenas para as chamadas de IA.</p>
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button onClick={handleSaveSettings}>Salvar</Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </div>
                    
                    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                        <DialogContent className="max-w-2xl">
                            <AutomationForm 
                                instance={editingInstance}
                                onSave={handleSaveInstance}
                                onClose={() => setIsModalOpen(false)}
                            />
                        </DialogContent>
                    </Dialog>


                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                                    placeholder="Exemplo: Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. O prazo para devoluções é de 7 dias úteis..."
                                    className="min-h-[200px]"
                                    value={knowledgeBase}
                                    onChange={(e) => setKnowledgeBase(e.target.value)}
                                />
                            </CardContent>
                            <CardFooter>
                                <Button>Salvar Base de Conhecimento</Button>
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
                                                className='opacity-0 group-hover:opacity-100 transition-opacity'
                                            />
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
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
                                            <p className='text-muted-foreground'><span className="font-semibold text-foreground">QUANDO:</span> {instance.trigger}</p>
                                            <div className='text-muted-foreground flex items-start gap-1.5'>
                                              <span className="font-semibold text-foreground shrink-0">ENTÃO:</span> 
                                              {instance.action.type === 'reply' ? (
                                                  <span>{instance.action.value}</span>
                                              ) : (
                                                  <div className='flex items-center gap-1.5'>
                                                    <Webhook className='h-3 w-3'/>
                                                    <span className='font-mono text-xs bg-muted px-1 py-0.5 rounded'>{instance.action.method}</span>
                                                    <span className='truncate'>{instance.action.url}</span>
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
                    </div>
                </main>
            </div>
        </MainLayout>
    );

    
}
