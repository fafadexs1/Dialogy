'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Sparkles,
  MessageSquare,
  HelpCircle,
  GitBranch,
  Database,
  Headphones,
  Plus,
  Play,
  Cloud,
  ChevronDown,
  ChevronRight,
  Pencil,
  GripVertical,
  CheckCircle2,
  FileText,
  Clock,
  RotateCcw,
  Send,
  Trash2,
  Bot,
  Zap,
  ShieldCheck,
  ArrowDown,
  FileDown,
  Info,
  Check,
  Sliders,
  Palette,
  BarChart3,
  ListChecks,
  ExternalLink,
  BookOpen,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AutopilotConfig, KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import type { AiModelCatalogEntry } from '@/lib/ai-models';
import type { ProcedureStudioRecord } from '@/services/procedures/repository';
import type { ProcedureStudioDocument, ProcedureStudioStep } from '@/services/procedures/schemas';
import { createProcedureStep, createBlankProcedure } from '@/services/procedures/studio';

export type JourneyStep = {
  id: string;
  category: 'message' | 'question' | 'decision' | 'action' | 'team';
  title: string;
  subtitle?: string;
  icon: 'message' | 'question' | 'decision' | 'action' | 'team' | 'sparkles';
  config?: Record<string, unknown>;
};

export type JourneyStage = {
  id: 'understand' | 'resolve' | 'conclude';
  number: number;
  title: string;
  description: string;
  steps: JourneyStep[];
  badgeColor?: string;
};

export type AiAgentJourneyStudioProps = {
  config: AutopilotConfig;
  initialTab?: 'flow' | 'appearance' | 'rules' | 'results';
  onSave?: (updatedConfig: Partial<AutopilotConfig>) => Promise<boolean | void>;
  onPublish?: () => Promise<boolean | void>;
  isSaving?: boolean;
  isPublishing?: boolean;
  models?: AiModelCatalogEntry[];
  knowledgeDocuments?: KnowledgeBaseDocument[];
  knowledgeCollections?: KnowledgeCollection[];
  procedures?: ProcedureStudioRecord[];
  onUpdateProcedures?: (procedures: ProcedureStudioRecord[]) => void;
  workspaceId: string;
  onBackToOverview?: () => void;
};

type TestChatMessage = {
  id: string;
  role: 'bot' | 'user' | 'system';
  text: string;
  time: string;
  file?: { name: string; size: string };
  options?: Array<{ id: string; label: string }>;
};

const DEFAULT_UNDERSTAND_STEPS: JourneyStep[] = [
  {
    id: 'step-welcome',
    category: 'message',
    title: 'Dar boas-vindas',
    subtitle: 'Olá! Sou o assistente virtual. Como posso te ajudar hoje?',
    icon: 'message',
  },
  {
    id: 'step-discover',
    category: 'question',
    title: 'Descobrir o que precisa',
    subtitle: 'Identificar a intenção e coletar dados iniciais',
    icon: 'question',
  },
];

const DEFAULT_CONCLUDE_STEPS: JourneyStep[] = [
  {
    id: 'step-resolved-yes',
    category: 'message',
    title: 'Responder e encerrar',
    subtitle: 'Agradecimento e mensagem final de resolução',
    icon: 'message',
  },
  {
    id: 'step-resolved-no',
    category: 'team',
    title: 'Chamar equipe de Suporte',
    subtitle: 'Transferência para a fila de atendimento humano',
    icon: 'team',
  },
];

export function AiAgentJourneyStudio({
  config,
  initialTab = 'flow',
  onSave,
  onPublish,
  isSaving = false,
  isPublishing = false,
  models = [],
  knowledgeDocuments = [],
  knowledgeCollections = [],
  procedures = [],
  onUpdateProcedures,
  workspaceId,
  onBackToOverview,
}: AiAgentJourneyStudioProps) {
  // Navigation & Tabs State
  const [activeTab, setActiveTab] = useState<'flow' | 'appearance' | 'rules' | 'results'>(initialTab);
  const [viewLevel, setViewLevel] = useState<'journey' | 'procedure'>('journey');
  const [activeProcedureId, setActiveProcedureId] = useState<string | null>(null);

  // Agent Name State
  const [agentName, setAgentName] = useState(config.name || 'Jornada conversacional');
  const [isEditingName, setIsEditingName] = useState(false);

  // Journey Stages State
  const [understandSteps, setUnderstandSteps] = useState<JourneyStep[]>(DEFAULT_UNDERSTAND_STEPS);
  const [concludeSteps, setConcludeSteps] = useState<JourneyStep[]>(DEFAULT_CONCLUDE_STEPS);
  const [concludeDecisionQuestion, setConcludeDecisionQuestion] = useState('Conseguiu resolver?');

  // Local Procedures list
  const [localProcedures, setLocalProcedures] = useState<ProcedureStudioRecord[]>(() => {
    if (procedures.length > 0) return procedures;
    return [
      {
        id: 'proc-fatura',
        workspace_id: workspaceId,
        autopilot_config_id: config.id,
        name: 'Segunda via de fatura',
        intent: 'billing_or_payment',
        keywords: ['fatura', 'boleto', 'segunda via', 'pix', 'pagamento'],
        status: 'published',
        published_version: 1,
        draft_document: {
          id: 'doc-fatura',
          documentId: 'doc-fatura',
          documentName: 'Segunda via de fatura',
          version: 1,
          description: 'A IA segue estas etapas quando o cliente pedir uma nova via.',
          compiledAt: new Date().toISOString(),
          triggerIntents: ['billing_or_payment'],
          triggerKeywords: ['fatura', 'boleto', 'segunda via', 'pix'],
          steps: [
            createProcedureStep(1, 'gather_data', {
              label: 'Identificar o cliente',
              semanticIntent: 'Pedir CPF ou CNPJ do titular',
              requiredSlots: ['cpf_cnpj'],
            }),
            createProcedureStep(2, 'retrieve_knowledge', {
              label: 'Consultar contratos',
              semanticIntent: 'Buscar contratos disponíveis',
            }),
            createProcedureStep(3, 'decide', {
              label: 'Escolher a fatura',
              semanticIntent: 'Mostrar as faturas encontradas',
            }),
            createProcedureStep(4, 'tool_call', {
              label: 'Gerar segunda via',
              semanticIntent: 'Criar PDF, boleto ou PIX',
              onFail: 'handoff',
              handoffReason: 'Chamar equipe de Cobrança',
            }),
            createProcedureStep(5, 'respond', {
              label: 'Enviar documento',
              semanticIntent: 'Entregar pelo mesmo canal',
            }),
          ],
        },
      },
      {
        id: 'proc-pedido',
        workspace_id: workspaceId,
        autopilot_config_id: config.id,
        name: 'Status do pedido',
        intent: 'order_or_request_status',
        keywords: ['pedido', 'status', 'rastreio', 'entrega', 'compra'],
        status: 'published',
        published_version: 1,
        draft_document: {
          id: 'doc-pedido',
          documentId: 'doc-pedido',
          documentName: 'Status do pedido',
          version: 1,
          description: 'Consulta o status de entrega do pedido do cliente.',
          compiledAt: new Date().toISOString(),
          triggerIntents: ['order_or_request_status'],
          triggerKeywords: ['pedido', 'status', 'rastreio'],
          steps: [
            createProcedureStep(1, 'gather_data', { label: 'Pedir número do pedido' }),
            createProcedureStep(2, 'tool_call', { label: 'Consultar sistema de entregas' }),
            createProcedureStep(3, 'respond', { label: 'Informar status atual e previsão' }),
          ],
        },
      },
      {
        id: 'proc-promessa',
        workspace_id: workspaceId,
        autopilot_config_id: config.id,
        name: 'Promessa de pagamento',
        intent: 'billing_or_payment',
        keywords: ['promessa', 'religar', 'desbloquear', 'pagar depois'],
        status: 'draft',
        published_version: null,
        draft_document: {
          id: 'doc-promessa',
          documentId: 'doc-promessa',
          documentName: 'Promessa de pagamento',
          version: 1,
          description: 'Registra a promessa de pagamento para liberação temporária.',
          compiledAt: new Date().toISOString(),
          triggerIntents: ['billing_or_payment'],
          triggerKeywords: ['promessa', 'religar', 'desbloquear'],
          steps: [
            createProcedureStep(1, 'gather_data', { label: 'Confirmar CPF' }),
            createProcedureStep(2, 'tool_call', { label: 'Registrar promessa no financeiro' }),
            createProcedureStep(3, 'respond', { label: 'Confirmar liberação do sinal' }),
          ],
        },
      },
    ];
  });

  // Selected Procedure in Level 2
  const activeProcedure = useMemo(() => {
    if (!activeProcedureId) return localProcedures[0] || null;
    return localProcedures.find((p) => p.id === activeProcedureId) || localProcedures[0] || null;
  }, [activeProcedureId, localProcedures]);

  // Step modal / edit state
  const [editingStep, setEditingStep] = useState<{
    stageId: 'understand' | 'conclude' | 'procedure';
    stepIndex?: number;
    step: Partial<JourneyStep> | Partial<ProcedureStudioStep>;
  } | null>(null);

  // Interactive Live Chat Test State
  const [chatMessages, setChatMessages] = useState<TestChatMessage[]>([
    {
      id: 'm1',
      role: 'user',
      text: 'Olá! Preciso da segunda via da minha fatura, por favor.',
      time: '09:41',
    },
    {
      id: 'm2',
      role: 'bot',
      text: 'Olá! Claro, posso te ajudar com isso. Para começar, me informe o CPF ou CNPJ do titular da conta.',
      time: '09:41',
    },
    {
      id: 'm3',
      role: 'user',
      text: '123.456.789-00',
      time: '09:41',
    },
    {
      id: 'm4',
      role: 'bot',
      text: 'Encontrei 2 faturas. Qual mês de referência você gostaria?',
      time: '09:42',
      options: [
        { id: 'opt1', label: 'Maio/2026' },
        { id: 'opt2', label: 'Abril/2026' },
      ],
    },
    {
      id: 'm5',
      role: 'user',
      text: 'Maio/2026',
      time: '09:42',
    },
    {
      id: 'm6',
      role: 'bot',
      text: 'Pronto! Aqui está a segunda via da sua fatura de maio/2026.',
      time: '09:43',
      file: { name: 'Fatura_Maio_2026.pdf', size: '218 KB' },
    },
    {
      id: 'm7',
      role: 'bot',
      text: 'Você pode baixar o arquivo acima. Precisa de mais alguma coisa?',
      time: '09:43',
    },
  ]);
  const [inputChatText, setInputChatText] = useState('');
  const [isTestTyping, setIsTestTyping] = useState(false);
  const [activeStepIndicator, setActiveStepIndicator] = useState<string>('Executando etapa 4 de 5 • Gerar segunda via');

  // Handle open Level 2 Procedure
  const handleOpenProcedure = (procedureId: string) => {
    setActiveProcedureId(procedureId);
    setViewLevel('procedure');
  };

  // Handle new procedure creation
  const handleCreateNewProcedure = () => {
    const newId = `proc-${Date.now()}`;
    const newDoc = createBlankProcedure(newId, 'Novo procedimento');
    const newProc: ProcedureStudioRecord = {
      id: newId,
      workspace_id: workspaceId,
      autopilot_config_id: config.id,
      name: 'Novo procedimento',
      intent: 'support_request',
      keywords: ['novo', 'ajuda'],
      status: 'draft',
      published_version: null,
      draft_document: newDoc,
    };
    const updated = [...localProcedures, newProc];
    setLocalProcedures(updated);
    if (onUpdateProcedures) onUpdateProcedures(updated);
    setActiveProcedureId(newId);
    setViewLevel('procedure');
  };

  // Handle Step adding from Category in Sidebar
  const handleAddCategoryStep = (category: 'message' | 'question' | 'decision' | 'action' | 'team') => {
    if (viewLevel === 'journey') {
      const newStep: JourneyStep = {
        id: `step-${Date.now()}`,
        category,
        title:
          category === 'message'
            ? 'Enviar mensagem'
            : category === 'question'
            ? 'Fazer pergunta ao cliente'
            : category === 'decision'
            ? 'Avaliar condição'
            : category === 'action'
            ? 'Executar ação no sistema'
            : 'Transferir para atendente',
        subtitle: 'Clique para configurar o texto e ações desta etapa.',
        icon: category,
      };
      setUnderstandSteps((prev) => [...prev, newStep]);
    } else if (viewLevel === 'procedure' && activeProcedure) {
      const typeMap: Record<string, ProcedureStudioStep['type']> = {
        message: 'respond',
        question: 'gather_data',
        decision: 'decide',
        action: 'tool_call',
        team: 'handoff',
      };
      const stepType = typeMap[category] || 'respond';
      const steps = activeProcedure.draft_document.steps || [];
      const newOrder = steps.length + 1;
      const step = createProcedureStep(newOrder, stepType, {
        label:
          stepType === 'gather_data'
            ? 'Pedir informação'
            : stepType === 'tool_call'
            ? 'Executar ação'
            : stepType === 'decide'
            ? 'Escolher caminho'
            : stepType === 'handoff'
            ? 'Chamar equipe'
            : 'Enviar mensagem',
      });
      const updatedSteps = [...steps, step];
      const updatedProc: ProcedureStudioRecord = {
        ...activeProcedure,
        draft_document: {
          ...activeProcedure.draft_document,
          steps: updatedSteps,
        },
      };
      const updatedAll = localProcedures.map((p) => (p.id === activeProcedure.id ? updatedProc : p));
      setLocalProcedures(updatedAll);
      if (onUpdateProcedures) onUpdateProcedures(updatedAll);
    }
  };

  // Handle live chat message submission
  const handleSendChatMessage = () => {
    if (!inputChatText.trim()) return;
    const userMsg: TestChatMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      text: inputChatText.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setInputChatText('');
    setIsTestTyping(true);

    setTimeout(() => {
      setIsTestTyping(false);
      const botReply: TestChatMessage = {
        id: `m-bot-${Date.now()}`,
        role: 'bot',
        text: 'Entendido! Estou processando o seu pedido com a IA...',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, botReply]);
    }, 1000);
  };

  const handleRestartChat = () => {
    setChatMessages([
      {
        id: 'm1',
        role: 'user',
        text: 'Olá! Preciso de ajuda.',
        time: '09:41',
      },
      {
        id: 'm2',
        role: 'bot',
        text: 'Olá! Como posso te ajudar hoje?',
        time: '09:41',
      },
    ]);
  };

  // Step type badge helper for Procedure Level 2
  const getStepBadgeInfo = (step: ProcedureStudioStep) => {
    switch (step.type) {
      case 'gather_data':
        return { label: 'Pergunta', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
      case 'retrieve_knowledge':
        return { label: 'Consulta', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
      case 'decide':
        return { label: 'Escolha', color: 'bg-purple-100 text-purple-800 border-purple-200' };
      case 'tool_call':
        return { label: 'Ação', color: 'bg-violet-100 text-violet-800 border-violet-200' };
      case 'handoff':
        return { label: 'Ação', color: 'bg-amber-100 text-amber-800 border-amber-200' };
      case 'respond':
      default:
        return { label: 'Mensagem', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    }
  };

  const getStepIcon = (step: ProcedureStudioStep) => {
    switch (step.type) {
      case 'gather_data':
        return <MessageSquare className="h-4 w-4 text-emerald-600" />;
      case 'retrieve_knowledge':
        return <Database className="h-4 w-4 text-indigo-600" />;
      case 'decide':
        return <ListChecks className="h-4 w-4 text-purple-600" />;
      case 'tool_call':
        return <Zap className="h-4 w-4 text-violet-600" />;
      case 'handoff':
        return <Headphones className="h-4 w-4 text-amber-600" />;
      case 'respond':
      default:
        return <Send className="h-4 w-4 text-emerald-600" />;
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#0b131f] text-slate-100 overflow-hidden font-sans">
      {/* 1. TOP GLOBAL HEADER */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-[#070b12] px-5">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">Dialogy AI</span>
          </div>

          {/* Title with edit pencil */}
          <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
            {isEditingName ? (
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setIsEditingName(false);
                }}
                autoFocus
                className="h-7 w-56 bg-slate-900 border-slate-700 text-xs text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white transition"
              >
                <span>{agentName}</span>
                <Pencil className="h-3.5 w-3.5 text-slate-500 hover:text-slate-300" />
              </button>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('flow')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'flow' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Fluxo
              {activeTab === 'flow' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('appearance')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'appearance' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Aparência
              {activeTab === 'appearance' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'rules' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Regras
              {activeTab === 'rules' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'results' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Resultados
              {activeTab === 'results' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestartChat}
            className="h-8 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <Play className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
            Testar
          </Button>

          <Button
            size="sm"
            onClick={() => onPublish && onPublish()}
            disabled={isPublishing || isSaving}
            className="h-8 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
          >
            <Cloud className="mr-1.5 h-3.5 w-3.5" />
            {isPublishing ? 'Publicando…' : 'Publicar'}
            <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
          </Button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE BODY */}
      <div className="flex flex-1 overflow-hidden">
        {/* 2A. LEFT SIDEBAR */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-[#070e17] p-4 text-slate-200">
          {viewLevel === 'journey' ? (
            /* Sidebar for Level 1 (Journey) */
            <>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Adicionar etapas</h3>
                <p className="mt-1 text-[11px] text-slate-500 leading-tight">
                  Arraste para o fluxo ou clique para adicionar.
                </p>
              </div>

              <div className="mt-5 space-y-4 overflow-y-auto pr-1">
                {/* Mensagens */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Mensagens</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('message')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                      <span>Enviar texto</span>
                    </div>
                    <GripVertical className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* Perguntas */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <HelpCircle className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Perguntas</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('question')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
                      <span>Pedir informação</span>
                    </div>
                    <GripVertical className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* Decisões */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Decisões</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('decision')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-3.5 w-3.5 text-slate-400" />
                      <span>Escolher caminho</span>
                    </div>
                    <GripVertical className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* Ações */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <Zap className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Ações</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('action')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-slate-400" />
                      <span>Consultar sistema</span>
                    </div>
                    <GripVertical className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* Equipe */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <Headphones className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Equipe</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('team')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Headphones className="h-3.5 w-3.5 text-slate-400" />
                      <span>Transferir atendimento</span>
                    </div>
                    <GripVertical className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Sidebar for Level 2 (Procedure List) */
            <>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Procedimentos do agente</h3>
                <p className="mt-1 text-[11px] text-slate-500 leading-tight">
                  Processos que a IA pode executar do início ao fim.
                </p>
              </div>

              <div className="mt-5 space-y-2 overflow-y-auto pr-1">
                {localProcedures.map((proc) => {
                  const isActive = proc.id === activeProcedure?.id;
                  return (
                    <button
                      key={proc.id}
                      type="button"
                      onClick={() => setActiveProcedureId(proc.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition shadow-sm',
                        isActive
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                          : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800/70'
                      )}
                    >
                      <FileText className={cn('h-4 w-4 shrink-0', isActive ? 'text-emerald-400' : 'text-slate-400')} />
                      <span className="truncate">{proc.name}</span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={handleCreateNewProcedure}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-700/80 bg-slate-900/30 px-3 py-2.5 text-xs text-slate-400 hover:border-emerald-500/50 hover:text-emerald-400 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Novo procedimento</span>
                </button>
              </div>
            </>
          )}
        </aside>

        {/* 2B. CENTER MAIN CANVAS */}
        <main className="flex-1 overflow-y-auto bg-[#f8fafc] p-8 text-slate-900">
          {viewLevel === 'journey' ? (
            /* ========================================================= */
            /* LEVEL 1: MAIN CONVERSATIONAL JOURNEY CANVAS              */
            /* ========================================================= */
            <div className="mx-auto max-w-2xl space-y-6">
              {/* STAGE 1: Entender o cliente */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow-sm">
                    1
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">1. Entender o cliente</h3>
                    <p className="text-xs text-slate-500">Receba o cliente e entenda rapidamente o que ele precisa.</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {understandSteps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="group flex items-center justify-between rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs hover:border-slate-300 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-slate-600 border border-slate-100">
                          {step.icon === 'message' ? (
                            <MessageSquare className="h-4 w-4 text-slate-600" />
                          ) : (
                            <HelpCircle className="h-4 w-4 text-slate-600" />
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{step.title}</p>
                          {step.subtitle && <p className="text-[11px] text-slate-500">{step.subtitle}</p>}
                        </div>
                      </div>
                      <GripVertical className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab transition" />
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('question')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50/50 hover:border-emerald-300 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Adicionar etapa</span>
                  </button>
                </div>
              </div>

              {/* Connecting Arrow */}
              <div className="flex justify-center">
                <ArrowDown className="h-5 w-5 text-slate-300" />
              </div>

              {/* STAGE 2: Resolver com IA */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white shadow-sm">
                    2
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">2. Resolver com IA</h3>
                    <p className="text-xs text-slate-500">
                      A IA busca a melhor resposta e realiza ações para resolver.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {/* Purple Interactive AI Card */}
                  <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 transition shadow-xs">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-900">Buscar resposta e executar ações</span>
                      </div>
                      <GripVertical className="h-4 w-4 text-slate-400" />
                    </div>

                    {/* Interactive Procedure Badges */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveTab('rules')}
                        className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-[11px] font-medium text-purple-900 hover:bg-purple-100/70 transition shadow-2xs"
                      >
                        <BookOpen className="h-3 w-3 text-purple-600" />
                        <span>Base de conhecimento</span>
                      </button>

                      {localProcedures.map((proc) => (
                        <button
                          key={proc.id}
                          type="button"
                          onClick={() => handleOpenProcedure(proc.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-[11px] font-medium text-purple-900 hover:bg-purple-100/70 transition shadow-2xs"
                          title="Clique para abrir as etapas deste procedimento"
                        >
                          <FileText className="h-3 w-3 text-purple-600" />
                          <span>{proc.name}</span>
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={handleCreateNewProcedure}
                        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-purple-300 bg-purple-100/50 px-2 py-1 text-[11px] font-medium text-purple-800 hover:bg-purple-200/60 transition"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Novo</span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateNewProcedure}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50/50 hover:border-emerald-300 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Adicionar procedimento</span>
                  </button>
                </div>
              </div>

              {/* Connecting Arrow */}
              <div className="flex justify-center">
                <ArrowDown className="h-5 w-5 text-slate-300" />
              </div>

              {/* STAGE 3: Concluir o atendimento */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow-sm">
                    3
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">3. Concluir o atendimento</h3>
                    <p className="text-xs text-slate-500">
                      Confirme a solução e encerre ou conecte com alguém do time.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {/* Decision Box */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <GitBranch className="h-4 w-4 text-slate-600" />
                        <span className="text-xs font-bold text-slate-900">{concludeDecisionQuestion}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          Sim
                        </span>
                        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          Não
                        </span>
                      </div>
                    </div>

                    {/* Two Branches */}
                    <div className="mt-3 grid grid-cols-2 gap-3 pt-2">
                      {/* Sim */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-emerald-700">Sim</span>
                        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-3.5 w-3.5 text-emerald-700" />
                            <span className="text-xs font-semibold text-slate-900">Responder e encerrar</span>
                          </div>
                          <GripVertical className="h-3.5 w-3.5 text-slate-400" />
                        </div>
                      </div>

                      {/* Não */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-amber-700">Não</span>
                        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/40 p-3 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <Headphones className="h-3.5 w-3.5 text-amber-700" />
                            <span className="text-xs font-semibold text-slate-900">Chamar equipe de Suporte</span>
                          </div>
                          <GripVertical className="h-3.5 w-3.5 text-slate-400" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAddCategoryStep('team')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50/50 hover:border-emerald-300 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Adicionar etapa</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ========================================================= */
            /* LEVEL 2: PROCEDURE STUDIO CANVAS                          */
            /* ========================================================= */
            <div className="mx-auto max-w-3xl space-y-6">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setViewLevel('journey')}
                  className="hover:text-emerald-700 transition"
                >
                  Jornada conversacional
                </button>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setViewLevel('journey')}
                  className="hover:text-emerald-700 transition"
                >
                  Resolver com IA
                </button>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold text-slate-900">{activeProcedure?.name}</span>
              </div>

              {/* Procedure Header Box */}
              <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Procedimento: {activeProcedure?.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    A IA segue estas etapas quando o cliente pedir uma nova via.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestartChat}
                    className="h-8 rounded-lg border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Testar procedimento
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => onSave && onSave({})}
                    disabled={isSaving}
                    className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    Salvar
                  </Button>
                </div>
              </div>

              {/* Linear Steps Flow */}
              <div className="space-y-4">
                {activeProcedure?.draft_document.steps.map((step, idx) => {
                  const badgeInfo = getStepBadgeInfo(step);
                  const icon = getStepIcon(step);

                  return (
                    <React.Fragment key={step.id}>
                      {/* Step Card */}
                      <div className="relative">
                        <div
                          className={cn(
                            'group flex items-center justify-between rounded-xl border bg-white p-4 shadow-xs hover:shadow-sm transition',
                            step.type === 'tool_call' && step.onFail === 'handoff'
                              ? 'border-violet-200'
                              : 'border-slate-200'
                          )}
                        >
                          <div className="flex items-center gap-4">
                            {/* Step Number Badge */}
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow-2xs">
                              {step.order || idx + 1}
                            </div>

                            {/* Icon Surface */}
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 border border-slate-100">
                              {icon}
                            </div>

                            {/* Title & Description */}
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-bold text-slate-900">{step.label}</h4>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {step.semanticIntent ||
                                  (step.type === 'gather_data'
                                    ? 'Pedir CPF ou CNPJ do titular'
                                    : step.type === 'retrieve_knowledge'
                                    ? 'Buscar contratos disponíveis'
                                    : step.type === 'decide'
                                    ? 'Mostrar as faturas encontradas'
                                    : step.type === 'tool_call'
                                    ? 'Criar PDF, boleto ou PIX'
                                    : 'Entregar pelo mesmo canal')}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className={cn('text-[10px] font-semibold', badgeInfo.color)}>
                              {badgeInfo.label}
                            </Badge>
                            <GripVertical className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab transition" />
                          </div>
                        </div>

                        {/* Error / Handoff Branch if configured on Step 4 */}
                        {step.type === 'tool_call' && step.onFail === 'handoff' && (
                          <div className="mt-2 flex items-center justify-end pr-2">
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-medium text-slate-400">Se falhar</span>
                              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 shadow-2xs">
                                <Headphones className="h-3.5 w-3.5 text-amber-600" />
                                <span className="text-xs font-semibold text-slate-900">
                                  {step.handoffReason || 'Chamar equipe de Cobrança'}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="bg-amber-100 text-amber-800 border-amber-300 text-[9px]"
                                >
                                  Ação
                                </Badge>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Arrow Down between steps */}
                      {idx < activeProcedure.draft_document.steps.length - 1 && (
                        <div className="flex justify-center py-0.5">
                          <ArrowDown className="h-4 w-4 text-slate-300" />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Add Step Button */}
                <button
                  type="button"
                  onClick={() => handleAddCategoryStep('action')}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/50 py-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50/60 hover:border-emerald-300 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar etapa</span>
                </button>
              </div>
            </div>
          )}
        </main>

        {/* 2C. RIGHT SIDEBAR: PREVIEW DA CONVERSA (EMULATOR) */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-800 bg-[#070e17] text-slate-100">
          {/* Emulator Header */}
          <div className="flex h-11 items-center justify-between border-b border-slate-800 px-4 bg-[#0a121d]">
            <span className="text-xs font-bold text-slate-200">Prévia da conversa</span>
            <Info className="h-3.5 w-3.5 text-slate-500" />
          </div>

          {/* Execution Step Banner (If in procedure level) */}
          {viewLevel === 'procedure' && (
            <div className="flex items-center gap-2 border-b border-purple-500/20 bg-purple-500/10 px-4 py-2 text-[11px] font-medium text-purple-300">
              <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0 animate-pulse" />
              <span className="truncate">{activeStepIndicator}</span>
            </div>
          )}

          {/* Chat Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#070e17]">
            {chatMessages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
                  <span className="text-[9px] text-slate-500 px-1 mb-0.5">
                    {isUser ? 'Cliente' : 'Atendimento'}
                  </span>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-sm',
                      isUser
                        ? 'bg-[#dcf8c6] text-slate-900 rounded-tr-none'
                        : 'bg-white text-slate-900 rounded-tl-none'
                    )}
                  >
                    <p>{msg.text}</p>

                    {/* File Attachment Card */}
                    {msg.file && (
                      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-900">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-600">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="flex-1 overflow-hidden text-left">
                          <p className="truncate text-xs font-bold">{msg.file.name}</p>
                          <p className="text-[10px] text-slate-500">PDF • {msg.file.size}</p>
                        </div>
                      </div>
                    )}

                    {/* Choice Buttons */}
                    {msg.options && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.options.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setInputChatText(opt.label);
                              handleSendChatMessage();
                            }}
                            className="rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-200 transition"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-400">
                      <span>{msg.time}</span>
                      {isUser && <Check className="h-3 w-3 text-emerald-600" />}
                    </div>
                  </div>
                </div>
              );
            })}

            {isTestTyping && (
              <div className="flex items-center gap-1.5 rounded-2xl bg-white px-3 py-2 text-slate-400 text-xs w-fit">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            )}
          </div>

          {/* Chat Input & Restart */}
          <div className="border-t border-slate-800 bg-[#0a121d] p-3">
            <div className="flex items-center gap-2">
              <Input
                value={inputChatText}
                onChange={(e) => setInputChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendChatMessage();
                }}
                placeholder="Digite para testar o fluxo..."
                className="h-8 bg-slate-900/90 border-slate-700 text-xs text-white placeholder:text-slate-500"
              />
              <Button
                size="icon"
                onClick={handleSendChatMessage}
                className="h-8 w-8 shrink-0 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>

            <button
              type="button"
              onClick={handleRestartChat}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Recomeçar teste</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
