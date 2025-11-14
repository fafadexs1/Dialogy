

'use client';

import React, { useState, useEffect, useActionState, useMemo, useCallback, useRef } from 'react';
import type { User, NexusFlowInstance, Action, ActionType, AutopilotConfig, AutopilotUsageLog, KnowledgeBaseDocument } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Bot, DollarSign, BrainCircuit, Cog, ArrowDown, ArrowUp, KeyRound, Loader2, MessageCircle, Webhook, Save, History, Sparkles, BookText, UploadCloud, ShieldCheck, AlertTriangle, PlayCircle, FilePlus2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAutopilotConfig, saveAutopilotConfig, saveAutopilotRule, deleteAutopilotRule, toggleAutopilotRule, getAutopilotUsageLogs, createAutopilotAgent, setPrimaryAutopilotAgent } from '@/actions/autopilot';
import { useFormStatus } from 'react-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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

function SaveButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending || disabled}>
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
    const { toast } = useToast();
    const [user, setUser] = useState<User | null>(null);
    const [config, setConfig] = useState<AutopilotConfig | null>(null);
    const [instances, setInstances] = useState<NexusFlowInstance[]>([]);
    const [usageLogs, setUsageLogs] = useState<AutopilotUsageLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [agents, setAgents] = useState<AutopilotConfig[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    
    // Form-specific states
    const [aiModel, setAiModel] = useState<string>('googleai/gemini-2.0-flash');
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [knowledgeBase, setKnowledgeBase] = useState('');
    const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeBaseDocument[]>([]);
    const [defaultFallbackReply, setDefaultFallbackReply] = useState('');
    const [isAutopilotActive, setIsAutopilotActive] = useState(false);
    const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
    const knowledgeFileInputRef = useRef<HTMLInputElement | null>(null);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [loadingStats, setLoadingStats] = useState(true);
    const [agentName, setAgentName] = useState('');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInstance, setEditingInstance] = useState<NexusFlowInstance | null>(null);
    const [testMessage, setTestMessage] = useState('');
    const [testHistory, setTestHistory] = useState('');
    const [testContactName, setTestContactName] = useState('Cliente em teste');
    const [testContactEmail, setTestContactEmail] = useState('');
    const [testResult, setTestResult] = useState<{ response?: string | null; triggeredRule?: string | null } | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    
    const [saveState, saveAction] = useActionState(saveAutopilotConfig, { success: false });
    const estimateTokens = useCallback((content: string) => {
        const normalized = content?.trim() || '';
        if (normalized.length === 0) return 0;
        return Math.max(1, Math.ceil(normalized.length / 4));
    }, []);
    const serializedDocuments = useMemo(() => JSON.stringify(knowledgeDocuments), [knowledgeDocuments]);
    const docsTokenEstimate = useMemo(() => {
        if (knowledgeDocuments.length === 0) return 0;
        return knowledgeDocuments.reduce((acc, doc) => acc + (doc.tokens ?? estimateTokens(doc.content)), 0);
    }, [knowledgeDocuments, estimateTokens]);
    const activeRulesCount = useMemo(() => instances.filter(rule => rule.enabled).length, [instances]);
    const runTestFlight = useCallback(async () => {
        if (!user?.activeWorkspaceId) {
            toast({ title: 'Selecione um workspace ativo para testar', variant: 'destructive' });
            return;
        }
        if (!selectedAgentId) {
            toast({ title: 'Selecione um agente para testar', variant: 'destructive' });
            return;
        }
        if (!testMessage.trim()) {
            toast({ title: 'Informe uma mensagem para o teste', variant: 'destructive' });
            return;
        }
        try {
            setIsTesting(true);
            setTestResult(null);
            const res = await fetch('/api/autopilot/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceId: user.activeWorkspaceId,
                    agentId: selectedAgentId,
                    message: testMessage,
                    chatHistory: testHistory,
                    contactName: testContactName,
                    contactEmail: testContactEmail || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Falha na simulação.');
            }
            setTestResult(data.result);
            toast({
                title: 'Simulação executada',
                description: data.result?.triggeredRule
                    ? `A regra ${data.result.triggeredRule} foi acionada.`
                    : 'O agente respondeu usando a base de conhecimento.',
            });
        } catch (error: any) {
            toast({
                title: 'Erro ao testar',
                description: error.message || 'Nǜo conseguimos executar esse teste agora.',
                variant: 'destructive',
            });
        } finally {
            setIsTesting(false);
        }
    }, [testMessage, testHistory, testContactName, testContactEmail, user?.activeWorkspaceId, toast, selectedAgentId]);

    const handleKnowledgeFiles = useCallback(async (files: FileList | null) => {
        if (!config?.id) {
            toast({ title: 'Crie um agente primeiro', description: 'Selecione ou crie um agente antes de treinar a base.', variant: 'default' });
            return;
        }
        if (!files || files.length === 0) {
            return;
        }
        try {
            setIsUploadingDocuments(true);
            const additions: KnowledgeBaseDocument[] = [];
            for (const file of Array.from(files)) {
                const text = (await file.text()).trim();
                additions.push({
                    id: globalThis.crypto?.randomUUID?.() || `${file.name}-${Date.now()}`,
                    name: file.name,
                    content: text,
                    tokens: estimateTokens(text),
                });
            }
            setKnowledgeDocuments(prev => [...prev, ...additions]);
            toast({
                title: 'Base atualizada',
                description: `Carregamos ${additions.length} arquivo(s).`,
            });
        } catch (error) {
            console.error('[KNOWLEDGE_UPLOAD] Failed to ingest files:', error);
            toast({ title: 'Falha ao processar arquivo', variant: 'destructive' });
        } finally {
            setIsUploadingDocuments(false);
        }
    }, [estimateTokens, toast, config?.id]);

    const handleManualDocumentAdd = useCallback(() => {
        if (!config?.id) {
            toast({ title: 'Crie um agente primeiro', description: 'Selecione um agente para armazenar os documentos.', variant: 'default' });
            return;
        }
        const newDoc: KnowledgeBaseDocument = {
            id: globalThis.crypto?.randomUUID?.() || `manual-${Date.now()}`,
            name: `Nota ${(knowledgeDocuments.length + 1).toString().padStart(2, '0')}`,
            content: '',
            tokens: 0,
        };
        setKnowledgeDocuments(prev => [...prev, newDoc]);
    }, [knowledgeDocuments.length, config?.id, toast]);

    const handleDocumentNameChange = useCallback((id: string, value: string) => {
        setKnowledgeDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, name: value } : doc));
    }, []);

    const handleDocumentContentChange = useCallback((id: string, value: string) => {
        setKnowledgeDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, content: value, tokens: estimateTokens(value) } : doc));
    }, [estimateTokens]);

    const handleDocumentRemove = useCallback((id: string) => {
        setKnowledgeDocuments(prev => prev.filter(doc => doc.id !== id));
    }, []);

    const handleDropZoneDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDraggingFiles(true);
    }, []);

    const handleDropZoneLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDraggingFiles(false);
    }, []);

    const handleDropZoneDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDraggingFiles(false);
        handleKnowledgeFiles(event.dataTransfer.files);
    }, [handleKnowledgeFiles]);

    useEffect(() => {
        const fetchUser = async () => {
            const res = await fetch('/api/user');
            if (res.ok) {
                setUser(await res.json());
            } else {
                setLoading(false);
            }
        };
        fetchUser();
    }, []);

    const fetchData = React.useCallback(async (preferredAgentId?: string) => {
        if (!user?.activeWorkspaceId) return;

        setLoading(true);
        try {
            const data = await getAutopilotConfig(user.activeWorkspaceId, preferredAgentId || selectedAgentId || undefined);
            if (data.error) {
                toast({ title: "Erro ao carregar configurações", description: data.error, variant: 'destructive' });
                setLoadingStats(false);
            } else {
                setAgents(data.agents || []);
                setConfig(data.config);
                setInstances(data.rules || []);

                if (data.config) {
                    setSelectedAgentId(data.config.id);
                    setAiModel(data.config.ai_model || 'googleai/gemini-2.0-flash');
                    setGeminiApiKey(data.config.gemini_api_key || '');
                    setKnowledgeBase(data.config.knowledge_base || '');
                    setKnowledgeDocuments(data.config.knowledge_base_documents || []);
                    setDefaultFallbackReply(data.config.default_fallback_reply || '');
                    setIsAutopilotActive(Boolean(data.config.is_active));
                    setAgentName(data.config.name || '');

                    setLoadingStats(true);
                    const logsData = await getAutopilotUsageLogs(data.config.id);
                    if (logsData.logs) {
                        setUsageLogs(logsData.logs);
                    } else {
                        setUsageLogs([]);
                    }
                    setLoadingStats(false);
                } else {
                    setSelectedAgentId(null);
                    setAiModel('googleai/gemini-2.0-flash');
                    setGeminiApiKey('');
                    setKnowledgeBase('');
                    setKnowledgeDocuments([]);
                    setDefaultFallbackReply('');
                    setIsAutopilotActive(false);
                    setAgentName('');
                    setUsageLogs([]);
                    setLoadingStats(false);
                }
            }
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId, toast, selectedAgentId]);

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
            fetchData(selectedAgentId ?? undefined);
        } else if (saveState.error) {
            toast({ title: 'Erro ao Salvar', description: saveState.error, variant: 'destructive'});
        }
    }, [saveState, toast, fetchData, selectedAgentId]);

    const handleSaveSuccess = () => {
        setIsModalOpen(false);
        setEditingInstance(null);
        fetchData(selectedAgentId ?? undefined);
    }

    const handleEditClick = (instance: NexusFlowInstance) => {
        setEditingInstance(instance);
        setIsModalOpen(true);
    };

    const handleAddNewClick = () => {
        if (!config?.id) {
            toast({ title: 'Crie um agente primeiro', description: 'Selecione ou crie um agente antes de configurar regras.', variant: 'default' });
            return;
        }
        setEditingInstance(null);
        setIsModalOpen(true);
    };

    const handleRemoveInstance = async (id: string) => {
        const result = await deleteAutopilotRule(id);
        if (result.success) {
            toast({ title: "Regra Removida!" });
            fetchData(selectedAgentId ?? undefined);
        } else {
            toast({ title: "Erro ao Remover", description: result.error, variant: 'destructive' });
        }
    };

    const handleToggleEnabled = async (id: string, enabled: boolean) => {
        const result = await toggleAutopilotRule(id, enabled);
        if (result.success) {
            toast({ title: `Regra ${enabled ? 'ativada' : 'desativada'}.` });
            fetchData(selectedAgentId ?? undefined);
        } else {
            toast({ title: "Erro ao Atualizar", description: result.error, variant: 'destructive' });
        }
    };

    const handleCreateAgent = async () => {
        if (!user?.activeWorkspaceId) return;
        const nextName = `Agente ${agents.length + 1}`;
        const result = await createAutopilotAgent(user.activeWorkspaceId, nextName);
        if (result.success && result.id) {
            toast({ title: 'Agente criado!', description: 'Configure o novo agente e defina suas regras.' });
            fetchData(result.id);
        } else {
            toast({ title: 'Erro ao criar agente', description: result.error, variant: 'destructive' });
        }
    };

    const handleSelectAgent = (agentId: string) => {
        fetchData(agentId);
    };

    const handleSetPrimaryAgent = async (agentId: string) => {
        const result = await setPrimaryAutopilotAgent(agentId);
        if (result.success) {
            toast({ title: 'Agente principal atualizado!' });
            fetchData(agentId);
        } else {
            toast({ title: 'Erro ao definir principal', description: result.error, variant: 'destructive' });
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
    const hasSelectedAgent = Boolean(config && selectedAgentId);
    const autopilotStatusText = !hasSelectedAgent
        ? 'Nenhum agente selecionado'
        : isAutopilotActive ? 'Piloto automático ligado' : 'Piloto automático em espera';
    const autopilotStatusDescription = !hasSelectedAgent
        ? 'Crie ou selecione um agente acima para liberar o piloto automático.'
        : isAutopilotActive
            ? 'O agente pode assumir novos chats automaticamente com as regras abaixo.'
            : 'Ative o piloto automático para que o agente responda sozinho aos seus contatos.';
    const autopilotStatusIcon = !hasSelectedAgent
        ? <AlertTriangle className="h-5 w-5 text-amber-500" />
        : isAutopilotActive
            ? <ShieldCheck className="h-5 w-5 text-emerald-500" />
            : <AlertTriangle className="h-5 w-5 text-amber-500" />;
    const docsCount = knowledgeDocuments.length;

    if (!user || loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Bot /> Agente de IA</h1>
                    <p className="text-muted-foreground">Crie e gerencie seu agente de IA para responder e agir por você.</p>
                </div>
                <Button onClick={handleAddNewClick} disabled={!config}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar Automação
                </Button>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">

                <Card className="mb-6">
                    <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <CardTitle>Meus agentes</CardTitle>
                            <CardDescription>Crie quantos copilotos quiser e escolha qual deles estará ativo.</CardDescription>
                        </div>
                        <Button onClick={handleCreateAgent}>
                            <Plus className="mr-2 h-4 w-4" />
                            Novo agente
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {agents.length === 0 ? (
                            <div className="border-2 border-dashed rounded-lg p-6 text-center text-muted-foreground">
                                Nenhum agente criado ainda. Clique em <span className="font-semibold">Novo agente</span> para começar.
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {agents.map(agent => (
                                    <div
                                        key={agent.id}
                                        className={cn(
                                            'border rounded-lg p-4 transition',
                                            agent.id === selectedAgentId ? 'border-primary ring-1 ring-primary bg-background' : 'border-muted'
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="font-semibold">{agent.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {agent.ai_model ? `Modelo: ${agent.ai_model}` : 'Modelo não definido'}
                                                </p>
                                            </div>
                                            <span className={cn(
                                                'text-xs font-medium flex items-center gap-1',
                                                agent.is_primary ? 'text-emerald-600' : 'text-muted-foreground'
                                            )}>
                                                {agent.is_primary ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                                                {agent.is_primary ? 'Principal' : 'Secundário'}
                                            </span>
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <Button size="sm" variant={agent.id === selectedAgentId ? 'default' : 'outline'} onClick={() => handleSelectAgent(agent.id)}>
                                                {agent.id === selectedAgentId ? 'Selecionado' : 'Selecionar'}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={agent.is_primary}
                                                onClick={() => handleSetPrimaryAgent(agent.id)}
                                            >
                                                Definir principal
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="mb-6">
                    <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Piloto Automático</p>
                            <div className="flex items-center gap-2 text-lg font-semibold">
                                {autopilotStatusIcon}
                                {autopilotStatusText}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                                {autopilotStatusDescription}
                            </p>
                        </div>
                        <div className="flex gap-4 text-sm">
                            <div className="p-3 rounded-lg border bg-background min-w-[140px]">
                                <p className="text-muted-foreground text-xs uppercase tracking-wide">Regras ativas</p>
                                <p className="text-xl font-semibold">{activeRulesCount}</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-background min-w-[140px]">
                                <p className="text-muted-foreground text-xs uppercase tracking-wide">Arquivos treinados</p>
                                <p className="text-xl font-semibold">{docsCount}</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-background min-w-[140px]">
                                <p className="text-muted-foreground text-xs uppercase tracking-wide">Tokens da base</p>
                                <p className="text-xl font-semibold">{docsTokenEstimate.toLocaleString('pt-BR')}</p>
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                
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
                                <input type="hidden" name="configId" value={config?.id || ''} />
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2"><Cog/> Configurações do Agente</CardTitle>
                                        <CardDescription>Selecione o "cérebro" do seu agente de IA.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-2">
                                            <Label htmlFor="agent-name">Nome do agente</Label>
                                            <Input
                                                id="agent-name"
                                                name="agentName"
                                                placeholder="Ex: Atendente comercial"
                                                value={agentName}
                                                disabled={!config}
                                                onChange={(e) => setAgentName(e.target.value)}
                                            />
                                        </div>
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
                                    
                                        <div className="mt-6 space-y-3 border rounded-lg p-4 bg-background/80">
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <p className="font-semibold">Piloto Automático</p>
                                                    <p className="text-sm text-muted-foreground">Quando ativo, o agente assume conversas automaticamente.</p>
                                                </div>
                                                <Switch checked={isAutopilotActive} onCheckedChange={setIsAutopilotActive} disabled={!config} />
                                            </div>
                                            <input type="hidden" name="isActive" value={isAutopilotActive ? 'true' : 'false'} />
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            <Label htmlFor="fallback-reply">Mensagem de contingência</Label>
                                            <Textarea
                                                id="fallback-reply"
                                                name="defaultFallbackReply"
                                                rows={3}
                                                placeholder="Ex: Estou verificando essas informações e retornarei em instantes."
                                                value={defaultFallbackReply}
                                                disabled={!config}
                                                onChange={(e) => setDefaultFallbackReply(e.target.value)}
                                            />
                                            <p className="text-xs text-muted-foreground">Usada quando nenhuma regra ou documento consegue responder com segurança.</p>
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
                                                disabled={!config}
                                                onChange={(e) => setGeminiApiKey(e.target.value)}
                                            />
                                            <p className="text-xs text-muted-foreground pt-1">Sua chave é armazenada de forma segura e usada apenas para as chamadas de IA.</p>
                                        </div>
                                    </CardContent>
                                    <CardFooter>
                                        <SaveButton disabled={!config}>
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
                            <input type="hidden" name="configId" value={config?.id || ''} />
                            <Card>
                                <CardHeader>
                                    <CardTitle>Base de Conhecimento do Agente</CardTitle>
                                    <CardDescription>
                                        Forneça ao agente de IA o contexto sobre seu negócio, produtos e políticas.
                                        Ele usará esse conhecimento para responder às perguntas dos clientes de forma precisa.
                                    </CardDescription>
                                </CardHeader>
                                                                <CardContent className="space-y-6">
                                    <Textarea 
                                        name="knowledgeBase"
                                        placeholder="Exemplo: Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. O prazo para devoluções é de 7 dias úteis..."
                                        className="min-h-[160px]"
                                        value={knowledgeBase}
                                        disabled={!config}
                                        onChange={(e) => setKnowledgeBase(e.target.value)}
                                    />
                                    <input type="hidden" name="knowledgeBaseDocuments" value={serializedDocuments} />
                                    <input
                                        type="file"
                                        ref={knowledgeFileInputRef}
                                        className="hidden"
                                        multiple
                                        accept=".txt,.md,.csv,.json,text/plain,application/json"
                                        onChange={(event) => {
                                            handleKnowledgeFiles(event.target.files);
                                            event.currentTarget.value = '';
                                        }}
                                    />
                                    <div
                                        onDragOver={handleDropZoneDragOver}
                                        onDragLeave={handleDropZoneLeave}
                                        onDrop={handleDropZoneDrop}
                                        className={`border-2 border-dashed rounded-lg p-6 text-center transition ${isDraggingFiles ? 'border-primary bg-primary/10' : 'border-muted-foreground/40 bg-background'}`}
                                    >
                                        <UploadCloud className="mx-auto h-8 w-8 text-primary" />
                                        <p className="mt-2 font-medium">Arraste arquivos .txt, .md, .csv ou JSON</p>
                                        <p className="text-xs text-muted-foreground">Conteúdo é convertido automaticamente em conhecimento para o agente.</p>
                                        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                                            <Button type="button" variant="outline" size="sm" onClick={handleManualDocumentAdd}>
                                                <FilePlus2 className="mr-2 h-4 w-4" /> Criar nota vazia
                                            </Button>
                                            <Button type="button" variant="secondary" size="sm" onClick={() => knowledgeFileInputRef.current?.click()} disabled={!config}>
                                                <UploadCloud className="mr-2 h-4 w-4" /> Selecionar arquivos
                                            </Button>
                                        </div>
                                        {isUploadingDocuments && (
                                            <p className="mt-2 text-xs text-primary">Processando arquivos...</p>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {knowledgeDocuments.length === 0 ? (
                                            <div className="border rounded-lg p-4 text-sm text-muted-foreground bg-background">
                                                Nenhum arquivo treinado ainda. Adicione um documento ou crie uma nota manual para ensinar o agente.
                                            </div>
                                        ) : (
                                            knowledgeDocuments.map((doc) => (
                                                <div key={doc.id} className="border rounded-lg p-4 bg-background/80 space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            value={doc.name}
                                                            disabled={!config}
                                                            onChange={(e) => handleDocumentNameChange(doc.id, e.target.value)}
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDocumentRemove(doc.id)}
                                                        disabled={!config}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                    <div>
                                                        <Textarea
                                                            value={doc.content}
                                                            rows={4}
                                                            disabled={!config}
                                                            onChange={(e) => handleDocumentContentChange(doc.id, e.target.value)}
                                                        />
                                                        <p className="text-xs text-muted-foreground mt-1">~{(doc.tokens ?? estimateTokens(doc.content)).toLocaleString('pt-BR')} tokens estimados</p>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <SaveButton disabled={!config}>
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
                                        <Button type="button" variant="link" onClick={handleAddNewClick}>Adicionar a primeira automação</Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        </form>

                        <div className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Simulador do copiloto</CardTitle>
                                    <CardDescription>Teste gatilhos e respostas antes de liberar o piloto automático para os clientes.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div>
                                        <Label htmlFor="test-message">Mensagem do cliente</Label>
                                        <Textarea
                                            id="test-message"
                                            placeholder="Ex: Olá, meu pedido atrasou. Vocês conseguem me ajudar?"
                                            value={testMessage}
                                            onChange={(e) => setTestMessage(e.target.value)}
                                            rows={4}
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="test-history">Histórico do chat (opcional)</Label>
                                        <Textarea
                                            id="test-history"
                                            placeholder="Agente: Olá, tudo bem?
Cliente: ..."
                                            value={testHistory}
                                            onChange={(e) => setTestHistory(e.target.value)}
                                            rows={3}
                                        />
                                    </div>
                                    <div className="grid md:grid-cols-2 gap-3">
                                        <div>
                                            <Label htmlFor="test-name">Nome do contato</Label>
                                            <Input id="test-name" value={testContactName} onChange={(e) => setTestContactName(e.target.value)} />
                                        </div>
                                        <div>
                                            <Label htmlFor="test-email">E-mail</Label>
                                            <Input id="test-email" type="email" value={testContactEmail} onChange={(e) => setTestContactEmail(e.target.value)} />
                                        </div>
                                    </div>
                                    {testResult && (
                                        <div className="rounded-lg border bg-background p-4 text-sm">
                                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resposta simulada</p>
                                            <p className="mt-2 whitespace-pre-wrap">{testResult.response || 'Nenhuma resposta sugerida. Revise as regras ou a base.'}</p>
                                            {testResult.triggeredRule && (
                                                <p className="text-xs text-muted-foreground mt-2">Regra acionada: {testResult.triggeredRule}</p>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                                <CardFooter className="flex flex-col gap-2">
                                    <Button type="button" onClick={runTestFlight} disabled={isTesting || !testMessage.trim() || !selectedAgentId} className="w-full">
                                        {isTesting ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <PlayCircle className="mr-2 h-4 w-4" />
                                        )}
                                        Executar teste
                                    </Button>
                                    <p className="text-xs text-muted-foreground text-center">
                                        {selectedAgentId ? `Os testes usam o agente "${config?.name || 'sem nome'}" com as mesmas regras e arquivos configurados acima.` : 'Selecione um agente para liberar o simulador.'}
                                    </p>
                                </CardFooter>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Histórico de execuções</CardTitle>
                                    <CardDescription>
                                        Últimas 20 execuções do piloto automático e seus custos em tokens.
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
                    </div>
            </main>
        </div>
    );
}
