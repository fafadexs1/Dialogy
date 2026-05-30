'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  Database,
  FlaskConical,
  GitBranch,
  History,
  Loader2,
  MessageSquareText,
  Monitor,
  MoreVertical,
  Play,
  Plus,
  Rocket,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  AutopilotFlowGraph,
  AutopilotFlowFormField,
  AutopilotFlowNodeKind,
  AutopilotFlowVariable,
  KnowledgeBaseDocument,
  KnowledgeCollection,
  NexusFlowInstance,
} from '@/lib/types';
import type { UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

export type AgentEditorPanel =
  | 'settings'
  | 'knowledge'
  | 'capabilities'
  | 'playground'
  | 'analytics'
  | 'versions';

type ToolCatalogItem = {
  name: string;
  description: string;
  class: string;
  riskLevel: 'low' | 'medium' | 'high';
  source: 'dialogy' | 'mcp';
  serverName?: string;
};

type NodeKind = AutopilotFlowNodeKind;

type AttendantNodeData = {
  kind: NodeKind;
  title: string;
  subtitle: string;
  status?: string;
  risk?: 'low' | 'medium' | 'high';
  toolName?: string;
  config?: {
    instructions?: string;
    message?: string;
    formFields?: AutopilotFlowFormField[];
    formMode?: 'static' | 'ai';
    referenceId?: string;
    variableName?: string;
    destination?: string;
    useAi?: boolean;
    intent?: string;
    customIntentLabel?: string;
    returnToMainPrompt?: boolean;
    knowledgeCollectionIds?: string[];
  };
};

type AttendantNode = Node<AttendantNodeData, 'attendant'>;

interface AutopilotFlowBuilderProps {
  agentId: string;
  agentName: string;
  modelName: string;
  isActive: boolean;
  isPrivate: boolean;
  isPrimary: boolean;
  hasDraft: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  isDiscarding: boolean;
  enabledToolNames: string[];
  tools: ToolCatalogItem[];
  rules: NexusFlowInstance[];
  knowledgeDocuments: KnowledgeBaseDocument[];
  knowledgeCollections: KnowledgeCollection[];
  mainSystemPrompt: string;
  flowGraph: AutopilotFlowGraph | null;
  onMainSystemPromptChange: (prompt: string) => void;
  onFlowGraphChange: (graph: AutopilotFlowGraph) => void;
  onBack: () => void;
  onOpenPanel: (panel: AgentEditorPanel) => void;
  inlinePanel?: ReactNode;
  inlinePanelName?: AgentEditorPanel | null;
  onSave: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onAddRule: () => void;
}

const BUILT_IN_VARIABLES = [
  '{{system.customer_message}}',
  '{{system.contact.name}}',
  '{{flow.customer_identifier}}',
];

const INTENT_OPTIONS: Array<{ value: UniversalAutopilotIntent; label: string }> = [
  { value: 'greeting', label: 'Saudacao' },
  { value: 'billing_or_payment', label: 'Financeiro / pagamento' },
  { value: 'purchase_inquiry', label: 'Compra / contratacao' },
  { value: 'catalog_request', label: 'Catalogo' },
  { value: 'pricing_request', label: 'Preco' },
  { value: 'promotion_request', label: 'Promocao' },
  { value: 'availability_request', label: 'Disponibilidade' },
  { value: 'scheduling_request', label: 'Agendamento' },
  { value: 'order_or_request_status', label: 'Status de solicitacao' },
  { value: 'support_request', label: 'Suporte' },
  { value: 'troubleshooting', label: 'Problema tecnico' },
  { value: 'change_request', label: 'Alteracao de servico' },
  { value: 'return_or_refund', label: 'Devolucao / reembolso' },
  { value: 'cancellation_request', label: 'Cancelamento' },
  { value: 'document_request', label: 'Documento' },
  { value: 'complaint', label: 'Reclamacao' },
  { value: 'human_handoff', label: 'Atendimento humano' },
  { value: 'thanks', label: 'Agradecimento' },
  { value: 'unknown', label: 'Outros / nao identificado' },
];

function normalizeVariableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '');
}

const NODE_SURFACES: Record<NodeKind, string> = {
  trigger: 'border-blue-500/35 bg-blue-950/30 shadow-[0_0_26px_rgba(20,122,220,0.12)]',
  understand: 'border-cyan-500/30 bg-[#15191d]',
  intent: 'border-fuchsia-500/30 bg-[#1b1520]',
  assistant: 'border-cyan-400/30 bg-[#181a1d] shadow-[0_0_28px_rgba(42,150,220,0.1)]',
  knowledge: 'border-orange-400/65 bg-orange-950/35 shadow-[0_0_26px_rgba(251,146,60,0.16)]',
  reply: 'border-cyan-500/35 bg-blue-950/25',
  send_message: 'border-sky-500/35 bg-blue-950/25',
  form: 'border-emerald-500/35 bg-emerald-950/25',
  handoff: 'border-violet-500/30 bg-[#181820]',
  close: 'border-emerald-500/30 bg-[#171c1b]',
  tool: 'border-sky-500/35 bg-[#141b22]',
  rule: 'border-red-400/65 bg-red-950/35 shadow-[0_0_26px_rgba(248,113,113,0.16)]',
};

const HANDLE_CLASS_NAMES = {
  vertical: '!h-2.5 !w-2.5 !border-[#16191d] !bg-sky-400',
  knowledge: '!h-3 !w-3 !border-[#16191d] !bg-orange-400',
  skill: '!h-3 !w-3 !border-[#16191d] !bg-red-400',
};

function isAgentNodeKind(kind: NodeKind): boolean {
  return kind === 'assistant' || kind === 'intent';
}

function NodeIcon({ kind }: { kind: NodeKind }) {
  const className = 'h-5 w-5';
  if (kind === 'trigger') return <Zap className={className} />;
  if (kind === 'understand') return <BrainCircuit className={className} />;
  if (kind === 'intent') return <GitBranch className={className} />;
  if (kind === 'assistant') return <Bot className={className} />;
  if (kind === 'knowledge') return <Database className={className} />;
  if (kind === 'reply') return <MessageSquareText className={className} />;
  if (kind === 'send_message') return <MessageSquareText className={className} />;
  if (kind === 'form') return <ClipboardList className={className} />;
  if (kind === 'handoff') return <UserRound className={className} />;
  if (kind === 'close') return <CheckCircle2 className={className} />;
  if (kind === 'rule') return <GitBranch className={className} />;
  return <Wrench className={className} />;
}

function AttendantNodeCard({ data, selected }: NodeProps<AttendantNode>) {
  const isAttachmentNode = data.kind === 'knowledge' || data.kind === 'rule';
  const isKnowledgeNode = data.kind === 'knowledge';
  const isSkillNode = data.kind === 'rule';
  const acceptsKnowledge = isAgentNodeKind(data.kind);
  const exposesSkill = isAgentNodeKind(data.kind);

  return (
    <div
      className={cn(
        'group relative flex flex-col items-center justify-center border text-center text-[#e8edf3] transition-shadow',
        isAttachmentNode
          ? 'min-h-[124px] w-[124px] rounded-full px-4 py-4'
          : 'min-h-[112px] w-[188px] rounded-[20px] px-4 py-4',
        NODE_SURFACES[data.kind],
        selected && 'border-sky-400/70 shadow-[0_0_0_1px_rgba(56,189,248,0.3),0_0_30px_rgba(14,165,233,0.2)]'
      )}
    >
      {!isAttachmentNode && (
        <Handle id="target-top" type="target" position={Position.Top} className={HANDLE_CLASS_NAMES.vertical} />
      )}
      {acceptsKnowledge && (
        <Handle id="target-left-knowledge" type="target" position={Position.Left} className={HANDLE_CLASS_NAMES.knowledge} />
      )}
      {isSkillNode && (
        <Handle id="target-left-skill" type="target" position={Position.Left} className={HANDLE_CLASS_NAMES.skill} />
      )}
      <span
        className={cn(
          'nodrag absolute flex h-7 w-7 items-center justify-center rounded-md border text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100',
          isAttachmentNode ? 'right-1 top-1' : '-top-3 right-3',
          isKnowledgeNode
            ? 'border-orange-400/40 bg-orange-500'
            : isSkillNode
              ? 'border-red-400/40 bg-red-500'
              : 'border-sky-500/40 bg-sky-600'
        )}
      >
        <Plus className="h-4 w-4" />
      </span>
      <div className={cn(
        'mb-2.5 flex items-center justify-center rounded-xl',
        isAttachmentNode ? 'h-9 w-9' : 'h-10 w-10',
        isKnowledgeNode
          ? 'bg-orange-500/15 text-orange-300'
          : isSkillNode
            ? 'bg-red-500/15 text-red-300'
            : 'bg-sky-500/15 text-sky-400'
      )}>
        <NodeIcon kind={data.kind} />
      </div>
      <div className={cn('font-medium leading-5', isAttachmentNode ? 'text-[13px]' : 'text-[15px]')}>{data.title}</div>
      <div className={cn('mt-0.5 leading-4 text-slate-400', isAttachmentNode ? 'text-[11px]' : 'text-xs')}>{data.subtitle}</div>
      {data.risk === 'high' && (
        <span className="mt-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
          Confirmacao necessaria
        </span>
      )}
      {!isAttachmentNode && (
        <Handle id="source-bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS_NAMES.vertical} />
      )}
      {isKnowledgeNode && (
        <Handle id="source-right-knowledge" type="source" position={Position.Right} className={HANDLE_CLASS_NAMES.knowledge} />
      )}
      {exposesSkill && (
        <Handle id="source-right-skill" type="source" position={Position.Right} className={HANDLE_CLASS_NAMES.skill} />
      )}
    </div>
  );
}

const nodeTypes = { attendant: AttendantNodeCard };

const VERTICAL_SOURCE_HANDLE = 'source-bottom';
const VERTICAL_TARGET_HANDLE = 'target-top';
const KNOWLEDGE_SOURCE_HANDLE = 'source-right-knowledge';
const KNOWLEDGE_TARGET_HANDLE = 'target-left-knowledge';
const SKILL_SOURCE_HANDLE = 'source-right-skill';
const SKILL_TARGET_HANDLE = 'target-left-skill';
const DEFAULT_EDGE_COLOR = '#4485a5';
const KNOWLEDGE_EDGE_COLOR = '#fb923c';
const SKILL_EDGE_COLOR = '#f87171';

function connectionVisual(sourceKind: NodeKind, targetKind: NodeKind) {
  if (sourceKind === 'knowledge' && isAgentNodeKind(targetKind)) {
    return {
      sourceHandle: KNOWLEDGE_SOURCE_HANDLE,
      targetHandle: KNOWLEDGE_TARGET_HANDLE,
      color: KNOWLEDGE_EDGE_COLOR,
    };
  }
  if (isAgentNodeKind(sourceKind) && targetKind === 'rule') {
    return {
      sourceHandle: SKILL_SOURCE_HANDLE,
      targetHandle: SKILL_TARGET_HANDLE,
      color: SKILL_EDGE_COLOR,
    };
  }
  return {
    sourceHandle: VERTICAL_SOURCE_HANDLE,
    targetHandle: VERTICAL_TARGET_HANDLE,
    color: DEFAULT_EDGE_COLOR,
  };
}

function canConnectNodeKinds(sourceKind: NodeKind, targetKind: NodeKind): boolean {
  if (sourceKind === 'knowledge' || targetKind === 'knowledge') {
    return sourceKind === 'knowledge' && isAgentNodeKind(targetKind);
  }
  if (sourceKind === 'rule' || targetKind === 'rule') {
    return isAgentNodeKind(sourceKind) && targetKind === 'rule';
  }
  return true;
}

function keepValidGraphEdges(nodes: AttendantNode[], edges: Edge[]): Edge[] {
  return edges.filter((flowEdge) => {
    const source = nodes.find((node) => node.id === flowEdge.source);
    const target = nodes.find((node) => node.id === flowEdge.target);
    if (!source || !target) return false;
    return canConnectNodeKinds(source.data.kind, target.data.kind);
  });
}

function edge(
  id: string,
  source: string,
  target: string,
  options?: { sourceHandle?: string; targetHandle?: string; color?: string },
): Edge {
  const color = options?.color || DEFAULT_EDGE_COLOR;
  return {
    id,
    source,
    target,
    sourceHandle: options?.sourceHandle || VERTICAL_SOURCE_HANDLE,
    targetHandle: options?.targetHandle || VERTICAL_TARGET_HANDLE,
    type: 'smoothstep',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    style: { stroke: color, strokeWidth: 1.6 },
  };
}

function edgeForNodes(id: string, source: AttendantNode, target: AttendantNode): Edge {
  return edge(id, source.id, target.id, connectionVisual(source.data.kind, target.data.kind));
}

function buildInitialGraph(agentName: string, rules: NexusFlowInstance[]) {
  const nodes: AttendantNode[] = [
    {
      id: 'incoming',
      type: 'attendant',
      position: { x: 100, y: 140 },
      data: {
        kind: 'trigger',
        title: 'Mensagem recebida',
        subtitle: 'Inicio do atendimento',
        config: { instructions: 'Iniciar quando chegar uma nova mensagem do cliente.', referenceId: 'entrada', variableName: 'mensagem_recebida' },
      },
    },
    {
      id: 'intent',
      type: 'attendant',
      position: { x: 382, y: 140 },
      data: {
        kind: 'understand',
        title: 'Entender cliente',
        subtitle: 'Intencao e dados',
        config: { instructions: 'Identifique a necessidade do cliente e os dados ja informados.', referenceId: 'entender', variableName: 'entender_cliente' },
      },
    },
    {
      id: 'assistant',
      type: 'attendant',
      position: { x: 382, y: 350 },
      data: {
        kind: 'assistant',
        title: agentName || 'Agente IA',
        subtitle: 'Responder com IA',
        config: { instructions: 'Responda usando apenas informacoes seguras do atendimento.', referenceId: 'agente', variableName: 'resposta_ia', useAi: true },
      },
    },
    {
      id: 'knowledge',
      type: 'attendant',
      position: { x: 92, y: 352 },
      data: {
        kind: 'knowledge',
        title: 'Conhecimento',
        subtitle: 'Consultar base',
        config: { instructions: 'Buscar documentos relevantes para a solicitacao atual.', referenceId: 'conhecimento', variableName: 'conhecimento_encontrado' },
      },
    },
    {
      id: 'reply',
      type: 'attendant',
      position: { x: 112, y: 582 },
      data: {
        kind: 'reply',
        title: 'Enviar resposta',
        subtitle: 'Mensagem ao cliente',
        config: { message: 'Olá {{system.contact.name}}, vou ajudar com sua solicitacao.', referenceId: 'resposta', variableName: 'resposta_enviada' },
      },
    },
    {
      id: 'handoff',
      type: 'attendant',
      position: { x: 382, y: 582 },
      data: {
        kind: 'handoff',
        title: 'Transferir humano',
        subtitle: 'Se necessario',
        config: { destination: 'Equipe de atendimento', message: 'Vou encaminhar voce para um atendente.', referenceId: 'transferir', variableName: 'transferencia_humana' },
      },
    },
    {
      id: 'resolved',
      type: 'attendant',
      position: { x: 650, y: 582 },
      data: {
        kind: 'close',
        title: 'Finalizar conversa',
        subtitle: 'Problema resolvido',
        config: { message: 'Seu atendimento foi finalizado. Precisa de mais alguma coisa?', referenceId: 'finalizar', variableName: 'conversa_finalizada' },
      },
    },
  ];

  const activeRules = rules.filter((rule) => rule.enabled);
  activeRules.forEach((activeRule, index) => {
    nodes.push({
      id: `rule-${activeRule.id}`,
      type: 'attendant',
      position: { x: 650, y: 300 + index * 150 },
      data: ruleNodeData(activeRule),
    });
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const buildEdge = (id: string, source: string, target: string) => {
    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    return sourceNode && targetNode ? edgeForNodes(id, sourceNode, targetNode) : edge(id, source, target);
  };
  const edges = [
    buildEdge('incoming-intent', 'incoming', 'intent'),
    buildEdge('intent-assistant', 'intent', 'assistant'),
    buildEdge('knowledge-assistant', 'knowledge', 'assistant'),
    buildEdge('assistant-reply', 'assistant', 'reply'),
    buildEdge('assistant-handoff', 'assistant', 'handoff'),
    buildEdge('assistant-resolved', 'assistant', 'resolved'),
  ];
  activeRules.forEach((activeRule) => {
    edges.push(buildEdge(`assistant-rule-${activeRule.id}`, 'assistant', `rule-${activeRule.id}`));
  });

  return { nodes, edges, variables: [] as AutopilotFlowVariable[] };
}

function restoreFlowGraph(graph: AutopilotFlowGraph) {
  const nodes = graph.nodes.map((node): AttendantNode => ({
    id: node.id,
    type: 'attendant',
    position: node.position,
    data: {
      kind: node.kind,
      title: node.title,
      subtitle: node.subtitle,
      status: node.status,
      risk: node.risk,
      toolName: node.toolName,
      config: node.config,
    },
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.map((savedEdge) => {
    const source = nodeById.get(savedEdge.source);
    const target = nodeById.get(savedEdge.target);
    return source && target
      ? edgeForNodes(savedEdge.id, source, target)
      : edge(savedEdge.id, savedEdge.source, savedEdge.target);
  });
  return {
    nodes,
    edges: keepValidGraphEdges(nodes, edges),
    variables: graph.variables || [],
  };
}

function serializeFlowGraph(nodes: AttendantNode[], edges: Edge[], variables: AutopilotFlowVariable[]): AutopilotFlowGraph {
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      position: node.position,
      kind: node.data.kind,
      title: node.data.title,
      subtitle: node.data.subtitle,
      status: node.data.status,
      risk: node.data.risk,
      toolName: node.data.toolName,
      config: node.data.config,
    })),
    edges: edges.map((savedEdge) => ({
      id: savedEdge.id,
      source: savedEdge.source,
      target: savedEdge.target,
      sourceHandle: savedEdge.sourceHandle,
      targetHandle: savedEdge.targetHandle,
    })),
    variables,
  };
}

function toolDisplayName(tool: ToolCatalogItem) {
  const labels: Record<string, string> = {
    transfer_chat: 'Transferir atendimento',
    close_chat: 'Encerrar conversa',
    add_internal_note: 'Adicionar nota interna',
    crm_update_contact_custom_fields: 'Atualizar contato',
    sgp_fetch_contracts: 'Consultar contratos',
    sgp_fetch_contact_panel_data: 'Consultar cliente SGP',
    sgp_generate_invoice_pix: 'Gerar PIX',
    sgp_create_payment_promise: 'Promessa de pagamento',
    sgp_open_support_ticket: 'Abrir chamado',
  };
  return labels[tool.name] || tool.name.replaceAll('_', ' ');
}

function ToolButton({
  tool,
  enabled,
}: {
  tool: ToolCatalogItem;
  enabled: boolean;
}) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-tool', JSON.stringify(tool));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title={tool.description}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-sky-400">
        <Wrench className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{toolDisplayName(tool)}</span>
      <span className={cn('h-2 w-2 rounded-full', enabled ? 'bg-emerald-400' : 'bg-slate-600')} />
    </button>
  );
}

function ruleNodeData(rule: NexusFlowInstance): AttendantNodeData {
  const normalizedRuleName = normalizeVariableName(rule.name) || 'ativa';
  return {
    kind: 'rule',
    title: rule.name,
    subtitle: rule.enabled ? 'Habilidade ativa' : 'Habilidade pausada',
    config: {
      instructions: rule.trigger,
      referenceId: `habilidade_${normalizedRuleName}`,
      variableName: `regra_${normalizedRuleName}`,
    },
  };
}

function RuleBlockButton({ rule }: { rule: NexusFlowInstance }) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-rule', JSON.stringify(rule));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title={rule.trigger}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-300">
        <GitBranch className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{rule.name}</span>
        <span className="block text-[11px] text-slate-500">{rule.enabled ? 'Arrastar habilidade' : 'Pausada'}</span>
      </span>
      <span className={cn('h-2 w-2 rounded-full', rule.enabled ? 'bg-emerald-400' : 'bg-slate-600')} />
    </button>
  );
}

function SubAgentBlockButton() {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-block', 'intent');
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title="Cria um sub-agente especializado ativado pela intencao do cliente."
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-300">
        <GitBranch className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">Sub-agente</span>
        <span className="block text-[11px] text-slate-500">Prompt por assunto</span>
      </span>
    </button>
  );
}

function MainAgentBlockButton() {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-block', 'assistant');
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title="Representa o agente principal e o prompt system padrao do atendimento."
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
        <Bot className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">Agente principal</span>
        <span className="block text-[11px] text-slate-500">Persona / system prompt</span>
      </span>
    </button>
  );
}

function DeterministicMessageBlockButton() {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-block', 'send_message');
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title="Envia uma mensagem configurada sem chamar a IA."
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
        <MessageSquareText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">Enviar mensagem</span>
        <span className="block text-[11px] text-slate-500">Texto fixo / sem IA</span>
      </span>
    </button>
  );
}

function HighlightedReferenceTextarea({
  value,
  onChange,
  placeholder,
  knownReferenceIds,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  knownReferenceIds: Set<string>;
  className?: string;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const chunks: ReactNode[] = [];
  const referencePattern = /@([a-zA-Z0-9_:-]+)/g;
  let lastIndex = 0;

  for (const match of value.matchAll(referencePattern)) {
    const index = match.index ?? 0;
    const referenceId = match[1] || '';
    if (index > lastIndex) chunks.push(value.slice(lastIndex, index));
    chunks.push(
      <span
        key={`${index}-${referenceId}`}
        className={cn(
          'rounded-sm ring-1 ring-inset',
          knownReferenceIds.has(referenceId)
            ? 'bg-sky-500/15 text-sky-300 ring-sky-500/35'
            : 'bg-red-500/15 text-red-300 ring-red-500/35'
        )}
      >
        @{referenceId}
      </span>
    );
    lastIndex = index + match[0].length;
  }

  if (lastIndex < value.length) chunks.push(value.slice(lastIndex));
  if (value.endsWith('\n')) chunks.push('\n');

  return (
    <div
      className={cn(
        'relative min-h-[118px] overflow-hidden rounded-md border border-white/10 bg-[#17191c] font-sans text-sm leading-6 focus-within:ring-2 focus-within:ring-sky-500/30',
        className
      )}
    >
      <pre
        ref={highlightRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-inherit text-sm leading-6 text-slate-100 [font:inherit] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {value ? chunks : <span className="text-slate-600">{placeholder}</span>}
      </pre>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (!highlightRef.current) return;
          highlightRef.current.scrollTop = event.currentTarget.scrollTop;
          highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        placeholder={placeholder}
        className="relative z-10 h-full min-h-[inherit] w-full resize-none overflow-auto rounded-md border-0 bg-transparent px-3 py-2 text-sm leading-6 text-transparent caret-slate-100 outline-none placeholder:text-transparent selection:bg-sky-500/25 [font:inherit] [-webkit-text-fill-color:transparent]"
        spellCheck={false}
      />
    </div>
  );
}

function FormBlockButton() {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-block', 'form');
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title="Envia uma lista fixa de dados que devem ser coletados do cliente."
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
        <ClipboardList className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">Formulario</span>
        <span className="block text-[11px] text-slate-500">Coleta de dados / sem IA</span>
      </span>
    </button>
  );
}

function NodeInspector({
  node,
  availableNodeVariables,
  systemVariables,
  knowledgeCollections,
  knowledgeAttachment,
  knownReferenceIds,
  mainSystemPrompt,
  variableNameConflict,
  referenceIdConflict,
  onMainSystemPromptChange,
  onClose,
  onUpdate,
  onDelete,
}: {
  node: AttendantNode;
  availableNodeVariables: string[];
  systemVariables: AutopilotFlowVariable[];
  knowledgeCollections: KnowledgeCollection[];
  knowledgeAttachment?: {
    targetTitle: string;
    targetKind: 'assistant' | 'intent';
    collectionNames: string[];
    documents: KnowledgeBaseDocument[];
  } | null;
  knownReferenceIds: Set<string>;
  mainSystemPrompt: string;
  variableNameConflict: boolean;
  referenceIdConflict: boolean;
  onMainSystemPromptChange: (prompt: string) => void;
  onClose: () => void;
  onUpdate: (patch: Partial<AttendantNodeData>) => void;
  onDelete: () => void;
}) {
  const config = node.data.config || {};
  const updateConfig = (patch: NonNullable<AttendantNodeData['config']>) => {
    onUpdate({ config: { ...config, ...patch } });
  };
  const variables = [
    ...BUILT_IN_VARIABLES,
    ...systemVariables.map((variable) => `{{system.${variable.name}}}`),
    ...availableNodeVariables.map((variable) => `{{${variable}}}`),
  ];
  const mainField = node.data.kind === 'reply' || node.data.kind === 'send_message' || node.data.kind === 'form' || node.data.kind === 'handoff' || node.data.kind === 'close'
    ? 'message'
    : 'instructions';
  const insertVariable = (variable: string) => {
    updateConfig({ [mainField]: `${config[mainField] || ''}${config[mainField] ? ' ' : ''}${variable}` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/[0.08] px-5 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <NodeIcon kind={node.data.kind} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-400">Configurar bloco</p>
              <h2 className="truncate text-sm font-semibold text-slate-100">{node.data.title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
            aria-label="Voltar para biblioteca de blocos"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Nome do bloco</Label>
          <Input
            value={node.data.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            className="h-11 border-white/10 bg-[#17191c] text-slate-100 focus-visible:ring-sky-500/30"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Descricao curta</Label>
          <Input
            value={node.data.subtitle}
            onChange={(event) => onUpdate({ subtitle: event.target.value })}
            className="h-11 border-white/10 bg-[#17191c] text-slate-100 focus-visible:ring-sky-500/30"
          />
        </div>

        <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
          <Label className="text-xs text-slate-300">ID de referencia para IA</Label>
          <div className="flex items-center rounded-lg border border-white/10 bg-[#17191c] font-mono text-sm text-slate-300">
            <span className="pl-3 text-slate-500">@</span>
            <Input
              value={config.referenceId || ''}
              onChange={(event) => updateConfig({ referenceId: normalizeVariableName(event.target.value) })}
              placeholder="coletar_dados"
              className="h-11 border-0 bg-transparent px-1 font-mono text-sky-300 focus-visible:ring-0"
            />
          </div>
          {referenceIdConflict ? (
            <p className="text-[11px] text-red-300">Este ID ja esta sendo usado por outro bloco.</p>
          ) : (
            <p className="text-[11px] leading-4 text-slate-500">Use este ID em prompts e instrucoes como @{config.referenceId || 'id_do_bloco'}.</p>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
          <Label className="text-xs text-slate-300">Variavel de saida deste bloco</Label>
          <div className="flex items-center rounded-lg border border-white/10 bg-[#17191c] font-mono text-sm text-slate-300">
            <span className="pl-3 text-slate-500">{'{{'}</span>
            <Input
              value={config.variableName || ''}
              onChange={(event) => updateConfig({ variableName: normalizeVariableName(event.target.value) })}
              placeholder="entender_cliente_2026"
              className="h-11 border-0 bg-transparent px-1 font-mono text-sky-300 focus-visible:ring-0"
            />
            <span className="pr-3 text-slate-500">{'}}'}</span>
          </div>
          {variableNameConflict ? (
            <p className="text-[11px] text-red-300">Este nome ja esta sendo usado por outro bloco.</p>
          ) : (
            <p className="text-[11px] leading-4 text-slate-500">Os blocos seguintes podem inserir o valor gerado por este passo.</p>
          )}
        </div>

        {node.data.kind === 'trigger' && (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-4 text-xs leading-5 text-slate-400">
            Este bloco representa a entrada do procedimento. No runtime futuro ele sera vinculado a uma intencao ou evento do atendimento.
          </div>
        )}

        {node.data.kind === 'knowledge' && (
          <div className="space-y-4 rounded-xl border border-orange-500/25 bg-orange-500/[0.05] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">Conhecimento vinculado</p>
              {knowledgeAttachment ? (
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  Este bloco libera consulta de base para {knowledgeAttachment.targetKind === 'assistant' ? 'o agente principal' : 'o sub-agente'} <span className="text-slate-300">{knowledgeAttachment.targetTitle}</span>.
                </p>
              ) : (
                <p className="mt-1 text-[11px] leading-4 text-amber-200">
                  Conecte este bloco na lateral esquerda de um agente principal ou sub-agente para liberar consulta RAG.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/10 bg-[#17191c] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Colecoes</p>
                <p className="mt-1 text-lg font-semibold text-orange-200">{knowledgeAttachment?.collectionNames.length || 0}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#17191c] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Documentos</p>
                <p className="mt-1 text-lg font-semibold text-orange-200">{knowledgeAttachment?.documents.length || 0}</p>
              </div>
            </div>

            {knowledgeAttachment && (
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Colecoes autorizadas</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {knowledgeAttachment.collectionNames.map((name) => (
                      <Badge key={name} className="border border-orange-500/25 bg-orange-500/10 text-orange-200">{name}</Badge>
                    ))}
                    {knowledgeAttachment.collectionNames.length === 0 && (
                      <span className="text-xs text-slate-500">Nenhuma colecao autorizada.</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Documentos disponiveis</p>
                  <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">
                    {knowledgeAttachment.documents.slice(0, 8).map((document) => (
                      <div key={document.id} className="rounded-lg border border-white/10 bg-[#17191c] px-3 py-2">
                        <p className="truncate text-xs font-medium text-slate-200">{document.name}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {document.tokens || 0} tokens{document.category ? ` · ${document.category}` : ''}
                        </p>
                      </div>
                    ))}
                    {knowledgeAttachment.documents.length > 8 && (
                      <p className="text-[11px] text-slate-500">+{knowledgeAttachment.documents.length - 8} documento(s) adicionais.</p>
                    )}
                    {knowledgeAttachment.documents.length === 0 && (
                      <p className="text-xs text-slate-500">Nenhum documento atende este escopo.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {node.data.kind === 'assistant' && (
          <div className="space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Agente principal</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Este bloco representa o prompt system padrao. Sub-agentes podem assumir assuntos especificos e retornar para esta persona principal.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Prompt system / persona</Label>
              <HighlightedReferenceTextarea
                value={mainSystemPrompt}
                onChange={onMainSystemPromptChange}
                placeholder="Descreva quem e o agente, como deve falar, limites, objetivo operacional e quando deve escalar."
                knownReferenceIds={knownReferenceIds}
                className="min-h-[180px] border-white/10 bg-[#17191c] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-cyan-500/30"
              />
              <p className="text-[11px] leading-4 text-slate-500">
                Este e o mesmo prompt base configurado nos ajustes gerais do agente.
              </p>
            </div>
          </div>
        )}

        {node.data.kind === 'intent' && (
          <div className="space-y-4 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4">
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Ativar sub-agente quando a intencao for</Label>
              <select
                value={config.intent || 'support_request'}
                onChange={(event) => updateConfig({
                  intent: event.target.value as UniversalAutopilotIntent,
                  ...(event.target.value !== 'unknown' ? { customIntentLabel: '' } : {}),
                })}
                className="h-11 w-full rounded-md border border-white/10 bg-[#17191c] px-3 text-sm text-slate-100 outline-none focus:border-fuchsia-400/50"
              >
                {INTENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {config.intent === 'unknown' && (
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">Qual intencao este sub-agente deve atender?</Label>
                <Input
                  value={config.customIntentLabel || ''}
                  onChange={(event) => updateConfig({ customIntentLabel: event.target.value })}
                  placeholder="Ex.: negociar renovacao de contrato"
                  className="h-11 border-white/10 bg-[#17191c] text-slate-100 placeholder:text-slate-600 focus-visible:ring-fuchsia-500/30"
                />
              </div>
            )}
            <p className="text-[11px] leading-4 text-slate-500">
              Quando esta intencao for identificada, este sub-agente assume a resposta com as instrucoes abaixo.
            </p>
            <div className="space-y-2 border-t border-fuchsia-500/15 pt-4">
              <Label className="text-xs text-slate-300">Conhecimento permitido</Label>
              <p className="text-[11px] leading-4 text-slate-500">
                Selecione as colecoes da base que este sub-agente pode consultar.
              </p>
              <div className="space-y-2 pt-1">
                {knowledgeCollections.map((collection) => {
                  const selectedIds = config.knowledgeCollectionIds || [];
                  const checked = selectedIds.includes(collection.id);
                  return (
                    <label key={collection.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#17191c] px-3 py-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? Array.from(new Set([...selectedIds, collection.id]))
                            : selectedIds.filter((id) => id !== collection.id);
                          updateConfig({
                            knowledgeCollectionIds: nextIds.length > 0 ? nextIds : ['general'],
                          });
                        }}
                      />
                      {collection.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm text-slate-200">Retorno ao agente principal</span>
                <span className="block text-[11px] text-slate-500">Quando a proxima mensagem sair desta intencao.</span>
              </span>
              <Badge className="border-0 bg-emerald-500/15 text-emerald-300">Automatico</Badge>
            </div>
          </div>
        )}

        {(node.data.kind === 'understand' || node.data.kind === 'intent' || node.data.kind === 'knowledge' || node.data.kind === 'rule' || node.data.kind === 'tool' || node.data.kind === 'trigger') && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">
              {node.data.kind === 'tool'
                ? 'Payload / instrucao da ferramenta'
                : node.data.kind === 'intent'
                  ? 'System prompt do sub-agente'
                  : 'Instrucao'}
            </Label>
            <HighlightedReferenceTextarea
              value={config.instructions || ''}
              onChange={(value) => updateConfig({ instructions: value })}
              placeholder="Defina o comportamento deste passo..."
              knownReferenceIds={knownReferenceIds}
              className="min-h-[118px] border-white/10 bg-[#17191c] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-sky-500/30"
            />
          </div>
        )}

        {(node.data.kind === 'reply' || node.data.kind === 'send_message' || node.data.kind === 'form' || node.data.kind === 'handoff' || node.data.kind === 'close') && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">
              {node.data.kind === 'send_message'
                ? 'Mensagem fixa ao cliente'
                : node.data.kind === 'form'
                  ? 'Introducao do formulario'
                  : 'Mensagem ao cliente'}
            </Label>
            <HighlightedReferenceTextarea
              value={config.message || ''}
              onChange={(value) => updateConfig({ message: value })}
              placeholder="Digite a mensagem ou insira variaveis..."
              knownReferenceIds={knownReferenceIds}
              className="min-h-[126px] border-white/10 bg-[#17191c] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-sky-500/30"
            />
            {node.data.kind === 'send_message' && (
              <p className="text-[11px] leading-4 text-slate-500">
                Este texto sera enviado diretamente, sem gerar resposta com IA.
              </p>
            )}
            {node.data.kind === 'form' && (
              <p className="text-[11px] leading-4 text-slate-500">
                Este formulario sera enviado como mensagem fixa de WhatsApp, sem gerar resposta com IA.
              </p>
            )}
          </div>
        )}

        {node.data.kind === 'form' && (
          <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Campos para coletar</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Escolha se o formulario sera enviado como mensagem fixa ou conduzido pela IA durante a conversa.
              </p>
            </div>
            <label className="flex items-center justify-between rounded-xl border border-white/10 bg-[#17191c] px-3 py-3">
              <span>
                <span className="block text-sm text-slate-200">Conduzir com IA</span>
                <span className="block text-[11px] text-slate-500">Pergunta os campos aos poucos, tira duvidas e retoma a coleta.</span>
              </span>
              <Switch
                checked={config.formMode === 'ai'}
                onCheckedChange={(checked) => {
                  updateConfig({ formMode: checked ? 'ai' : 'static' });
                  onUpdate({ subtitle: checked ? 'Formulario com IA' : 'Formulario sem IA' });
                }}
              />
            </label>
            {(config.formFields || []).map((field, index) => (
              <div key={field.id} className="space-y-2 rounded-xl border border-white/10 bg-[#17191c] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Campo {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => updateConfig({ formFields: (config.formFields || []).filter((item) => item.id !== field.id) })}
                    className="text-slate-500 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input
                  value={field.label}
                  onChange={(event) => updateConfig({
                    formFields: (config.formFields || []).map((item) => (
                      item.id === field.id
                        ? {
                            ...item,
                            label: event.target.value,
                            fieldKey: item.fieldKey || normalizeVariableName(event.target.value),
                          }
                        : item
                    )),
                  })}
                  placeholder="Nome completo"
                  className="h-10 border-white/10 bg-[#111316] text-slate-100 focus-visible:ring-emerald-500/30"
                />
                <Input
                  value={field.placeholder || ''}
                  onChange={(event) => updateConfig({
                    formFields: (config.formFields || []).map((item) => (
                      item.id === field.id ? { ...item, placeholder: event.target.value } : item
                    )),
                  })}
                  placeholder="Exemplo opcional"
                  className="h-10 border-white/10 bg-[#111316] text-slate-100 focus-visible:ring-emerald-500/30"
                />
                <label className="flex items-center justify-between rounded-lg border border-white/10 bg-[#111316] px-3 py-2 text-xs text-slate-300">
                  Obrigatorio
                  <Switch
                    checked={field.required !== false}
                    onCheckedChange={(checked) => updateConfig({
                      formFields: (config.formFields || []).map((item) => (
                        item.id === field.id ? { ...item, required: checked } : item
                      )),
                    })}
                  />
                </label>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const id = `field-${Date.now()}`;
                updateConfig({
                  formFields: [
                    ...(config.formFields || []),
                    {
                      id,
                      label: 'Novo dado',
                      fieldKey: `dado_${(config.formFields || []).length + 1}`,
                      required: true,
                    },
                  ],
                });
              }}
              className="h-10 w-full border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200"
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar campo
            </Button>
          </div>
        )}

        {node.data.kind === 'handoff' && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Equipe destino</Label>
            <Input
              value={config.destination || ''}
              onChange={(event) => updateConfig({ destination: event.target.value })}
              placeholder="Financeiro, Suporte..."
              className="h-11 border-white/10 bg-[#17191c] text-slate-100 focus-visible:ring-sky-500/30"
            />
          </div>
        )}

        {node.data.kind === 'assistant' && (
          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-[#17191c] px-4 py-3">
            <span>
              <span className="block text-sm text-slate-200">Usar IA para redigir</span>
              <span className="block text-xs text-slate-500">Formula uma resposta natural com contexto.</span>
            </span>
            <Switch
              checked={config.useAi !== false}
              onCheckedChange={(checked) => updateConfig({ useAi: checked })}
            />
          </label>
        )}

        {node.data.kind === 'tool' && node.data.toolName && (
          <div className="rounded-xl border border-white/10 bg-[#17191c] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tool vinculada</p>
            <p className="mt-2 truncate font-mono text-xs text-sky-300">{node.data.toolName}</p>
            {node.data.risk === 'high' && (
              <Badge className="mt-3 border border-amber-500/30 bg-amber-500/10 text-amber-300">
                Alto risco
              </Badge>
            )}
          </div>
        )}

        <div className="space-y-3 border-t border-white/[0.08] pt-5">
          <div>
            <p className="text-xs font-medium text-slate-300">Variaveis disponiveis</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              Insira valores recebidos do atendimento ou produzidos por blocos anteriores.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {variables.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => insertVariable(variable)}
                className="rounded-lg border border-white/10 bg-[#17191c] px-2.5 py-2 font-mono text-[10px] text-sky-300 hover:border-sky-500/30 hover:bg-sky-500/5"
              >
                {variable}
              </button>
            ))}
          </div>
        </div>

      </div>

      <div className="border-t border-white/[0.08] p-5">
        <Button
          type="button"
          variant="outline"
          onClick={onDelete}
          className="mb-4 h-11 w-full border-red-500/25 bg-red-500/[0.06] text-red-300 hover:bg-red-500/15 hover:text-red-200"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir bloco
        </Button>
        <p className="text-[11px] leading-4 text-slate-500">
          Clique em Salvar para registrar esta configuracao como rascunho do agente.
        </p>
      </div>
    </div>
  );
}

function SystemVariablesPanel({
  variables,
  onClose,
  onAdd,
  onDelete,
}: {
  variables: AutopilotFlowVariable[];
  onClose: () => void;
  onAdd: (name: string, defaultValue: string) => boolean;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [defaultValue, setDefaultValue] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="absolute right-0 top-[74px] w-[330px] rounded-2xl border border-white/10 bg-[#111417]/98 p-4 shadow-2xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">Variaveis do sistema</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">Disponiveis em qualquer bloco do fluxo.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3">
        <Input
          value={name}
          onChange={(event) => {
            setName(normalizeVariableName(event.target.value));
            setError('');
          }}
          placeholder="canal_origem"
          className="h-10 border-white/10 bg-[#17191c] font-mono text-slate-100 focus-visible:ring-sky-500/30"
        />
        <Input
          value={defaultValue}
          onChange={(event) => setDefaultValue(event.target.value)}
          placeholder="Valor inicial opcional"
          className="h-10 border-white/10 bg-[#17191c] text-slate-100 focus-visible:ring-sky-500/30"
        />
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!name) {
              setError('Informe um nome valido para a variavel.');
              return;
            }
            if (!onAdd(name, defaultValue)) {
              setError('Esta variavel do sistema ja existe.');
              return;
            }
            setName('');
            setDefaultValue('');
          }}
          className="h-10 w-full border-white/10 bg-[#17191c] text-slate-200 hover:bg-white/5 hover:text-white"
        >
          <Plus className="mr-2 h-4 w-4" />
          Criar variavel
        </Button>
        {variables.length > 0 && (
          <div className="max-h-[180px] space-y-2 overflow-y-auto border-t border-white/[0.08] pt-3">
            {variables.map((variable) => (
              <div key={variable.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#17191c] px-3 py-2">
                <span className="min-w-0 truncate font-mono text-[11px] text-sky-300">{`{{system.${variable.name}}}`}</span>
                <button
                  type="button"
                  onClick={() => onDelete(variable.id)}
                  aria-label={`Excluir variavel ${variable.name}`}
                  className="text-slate-500 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EdgeInspector({
  edge: selectedEdge,
  nodes,
  onClose,
  onDelete,
}: {
  edge: Edge;
  nodes: AttendantNode[];
  onClose: () => void;
  onDelete: () => void;
}) {
  const source = nodes.find((node) => node.id === selectedEdge.source)?.data.title || selectedEdge.source;
  const target = nodes.find((node) => node.id === selectedEdge.target)?.data.title || selectedEdge.target;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/[0.08] px-5 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-400">Conexao</p>
            <h2 className="mt-1 text-sm font-semibold text-slate-100">Fluxo entre blocos</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
            aria-label="Voltar para biblioteca de blocos"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 px-5 py-5">
        <div className="rounded-xl border border-white/10 bg-[#17191c] p-4 text-sm text-slate-300">
          <p className="truncate">{source}</p>
          <p className="my-2 text-sky-400">para</p>
          <p className="truncate">{target}</p>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Selecione a corda e exclua para remover apenas esta passagem do fluxo.
        </p>
      </div>
      <div className="border-t border-white/[0.08] p-5">
        <Button
          type="button"
          variant="outline"
          onClick={onDelete}
          className="h-11 w-full border-red-500/25 bg-red-500/[0.06] text-red-300 hover:bg-red-500/15 hover:text-red-200"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir conexao
        </Button>
      </div>
    </div>
  );
}

export function AutopilotFlowBuilder({
  agentId,
  agentName,
  modelName,
  isActive,
  isPrivate,
  isPrimary,
  hasDraft,
  isDirty,
  isSaving,
  isPublishing,
  isDiscarding,
  enabledToolNames,
  tools,
  rules,
  knowledgeDocuments,
  knowledgeCollections,
  mainSystemPrompt,
  flowGraph,
  onMainSystemPromptChange,
  onFlowGraphChange,
  onBack,
  onOpenPanel,
  inlinePanel,
  inlinePanelName,
  onSave,
  onPublish,
  onDiscard,
  onAddRule,
}: AutopilotFlowBuilderProps) {
  const initialGraph = useMemo(
    () => flowGraph ? restoreFlowGraph(flowGraph) : buildInitialGraph(agentName, rules),
    [agentName, flowGraph, rules]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<AttendantNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [systemVariables, setSystemVariables] = useState<AutopilotFlowVariable[]>(initialGraph.variables);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<AttendantNode, Edge> | null>(null);
  const [toolQuery, setToolQuery] = useState('');
  const [isSystemVariablesOpen, setIsSystemVariablesOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const suppressNextGraphChange = useRef(true);
  const lastSerializedGraph = useRef(JSON.stringify(serializeFlowGraph(initialGraph.nodes, initialGraph.edges, initialGraph.variables)));

  useEffect(() => {
    const currentSignature = JSON.stringify(serializeFlowGraph(nodes, edges, systemVariables));
    const nextSignature = JSON.stringify(serializeFlowGraph(initialGraph.nodes, initialGraph.edges, initialGraph.variables));
    if (currentSignature === nextSignature) return;
    lastSerializedGraph.current = nextSignature;
    suppressNextGraphChange.current = true;
    setNodes(initialGraph.nodes);
    setEdges(initialGraph.edges);
    setSystemVariables(initialGraph.variables);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  // The incoming graph changes only after loading, discard/restore, or an emitted local update.
  // The signature guard prevents local edits echoed by the parent from resetting the canvas.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, flowGraph]);

  useEffect(() => {
    const nextTitle = agentName || 'Agente IA';
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.id !== 'assistant' || node.data.title === nextTitle) return node;
        changed = true;
        return { ...node, data: { ...node.data, title: nextTitle } };
      });
      return changed ? next : current;
    });
  }, [agentName, setNodes]);

  useEffect(() => {
    if (suppressNextGraphChange.current) {
      suppressNextGraphChange.current = false;
      return;
    }
    const nextGraph = serializeFlowGraph(nodes, edges, systemVariables);
    const nextSignature = JSON.stringify(nextGraph);
    if (lastSerializedGraph.current === nextSignature) return;
    lastSerializedGraph.current = nextSignature;
    onFlowGraphChange(nextGraph);
  }, [edges, nodes, onFlowGraphChange, systemVariables]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target) return false;
    return canConnectNodeKinds(source.data.kind, target.data.kind);
  }, [nodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      if (!source || !target) return;
      const visual = connectionVisual(source.data.kind, target.data.kind);
      setEdges((current) => addEdge({
        ...connection,
        sourceHandle: visual.sourceHandle,
        targetHandle: visual.targetHandle,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: visual.color, width: 16, height: 16 },
        style: { stroke: visual.color, strokeWidth: 1.6 },
      }, current));
    },
    [isValidConnection, nodes, setEdges]
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEdge = edges.find((selectedFlowEdge) => selectedFlowEdge.id === selectedEdgeId) || null;
  const selectedKnowledgeAttachment = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== 'knowledge') return null;
    const targetId = edges.find((flowEdge) => flowEdge.source === selectedNode.id)?.target;
    const targetNode = targetId ? nodes.find((node) => node.id === targetId) : null;
    if (!targetNode || !isAgentNodeKind(targetNode.data.kind)) return null;

    const allowedCollectionIds = targetNode.data.kind === 'intent'
      ? targetNode.data.config?.knowledgeCollectionIds?.filter(Boolean) || ['general']
      : knowledgeCollections.map((collection) => collection.id);
    const allowedSet = new Set(allowedCollectionIds);
    const collectionNames = knowledgeCollections
      .filter((collection) => allowedSet.has(collection.id))
      .map((collection) => collection.name);
    const scopedDocuments = knowledgeDocuments.filter((document) => {
      if (targetNode.data.kind === 'assistant') return true;
      const documentCollectionIds = document.collectionIds?.length ? document.collectionIds : ['general'];
      return documentCollectionIds.some((collectionId) => allowedSet.has(collectionId));
    });

    return {
      targetTitle: targetNode.data.title,
      targetKind: targetNode.data.kind as 'assistant' | 'intent',
      collectionNames,
      documents: scopedDocuments,
    };
  }, [edges, knowledgeCollections, knowledgeDocuments, nodes, selectedNode]);
  const availableNodeVariables = useMemo(() => {
    if (!selectedNodeId) return [];
    const upstreamIds = new Set<string>();
    const pending = [selectedNodeId];
    while (pending.length > 0) {
      const targetId = pending.pop();
      edges
        .filter((flowEdge) => flowEdge.target === targetId)
        .forEach((flowEdge) => {
          if (upstreamIds.has(flowEdge.source)) return;
          upstreamIds.add(flowEdge.source);
          pending.push(flowEdge.source);
        });
    }
    return nodes
      .filter((node) => upstreamIds.has(node.id))
      .map((node) => node.data.config?.variableName)
      .filter((name): name is string => Boolean(name));
  }, [edges, nodes, selectedNodeId]);
  const variableNameConflict = Boolean(
    selectedNode?.data.config?.variableName &&
    nodes.some((node) => node.id !== selectedNode.id && node.data.config?.variableName === selectedNode.data.config?.variableName)
  );
  const referenceIdConflict = Boolean(
    selectedNode?.data.config?.referenceId &&
    nodes.some((node) => node.id !== selectedNode.id && node.data.config?.referenceId === selectedNode.data.config?.referenceId)
  );
  const hasVariableConflicts = nodes.some((node, index) => (
    Boolean(node.data.config?.variableName) &&
    nodes.some((otherNode, otherIndex) => (
      index !== otherIndex && otherNode.data.config?.variableName === node.data.config?.variableName
    ))
  ));
  const hasReferenceConflicts = nodes.some((node, index) => (
    Boolean(node.data.config?.referenceId) &&
    nodes.some((otherNode, otherIndex) => (
      index !== otherIndex && otherNode.data.config?.referenceId === node.data.config?.referenceId
    ))
  ));
  const knownReferenceIds = useMemo(() => new Set(
    nodes
      .flatMap((node) => [
        node.id,
        normalizeVariableName(node.id),
        normalizeVariableName(node.data.title),
        node.data.config?.referenceId,
        node.data.config?.variableName,
      ])
      .filter((value): value is string => Boolean(value))
  ), [nodes]);
  const updateSelectedNode = useCallback((patch: Partial<AttendantNodeData>) => {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => (
      node.id === selectedNodeId ? { ...node, data: { ...node.data, ...patch } } : node
    )));
  }, [selectedNodeId, setNodes]);
  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) => current.filter((flowEdge) => flowEdge.source !== selectedNodeId && flowEdge.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, setEdges, setNodes]);
  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges((current) => current.filter((flowEdge) => flowEdge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);
  const addSystemVariable = useCallback((name: string, defaultValue: string) => {
    const normalizedName = normalizeVariableName(name);
    if (
      !normalizedName ||
      BUILT_IN_VARIABLES.includes(`{{system.${normalizedName}}}`) ||
      systemVariables.some((variable) => variable.name === normalizedName)
    ) return false;
    setSystemVariables((current) => current.concat({
      id: `system-${normalizedName}-${Date.now()}`,
      name: normalizedName,
      defaultValue: defaultValue.trim() || undefined,
      scope: 'system',
    }));
    return true;
  }, [systemVariables]);
  const deleteSystemVariable = useCallback((id: string) => {
    setSystemVariables((current) => current.filter((variable) => variable.id !== id));
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!flowInstance) return;
    const blockKind = event.dataTransfer.getData('application/dialogy-attendant-block');
    if (blockKind === 'intent') {
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `intent-${Date.now()}`;
      setNodes((current) => current.concat({
        id,
        type: 'attendant',
        position,
        data: {
          kind: 'intent',
          title: 'Sub-agente: Suporte',
          subtitle: 'Ativado por intencao',
          config: {
            intent: 'support_request',
            instructions: 'Atenda este assunto com instrucoes especificas, sem fugir do escopo definido.',
            referenceId: `sub_agente_suporte_${Date.now()}`,
            variableName: `intencao_suporte_${Date.now()}`,
            returnToMainPrompt: true,
            knowledgeCollectionIds: ['general'],
          },
        },
      }));
      setSelectedNodeId(id);
      return;
    }
    if (blockKind === 'assistant') {
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      let selectedAssistantId = 'assistant';
      setNodes((current) => {
        const existingAssistant = current.find((node) => node.id === 'assistant' || node.data.kind === 'assistant');
        if (existingAssistant) {
          selectedAssistantId = existingAssistant.id;
          return current.map((node) => (
            node.id === existingAssistant.id
              ? {
                  ...node,
                  position,
                  data: {
                    ...node.data,
                    title: agentName || node.data.title || 'Agente IA',
                    subtitle: 'Responder com IA',
                  },
                }
              : node
          ));
        }
        return current.concat({
          id: 'assistant',
          type: 'attendant',
          position,
          data: {
            kind: 'assistant',
            title: agentName || 'Agente IA',
            subtitle: 'Responder com IA',
            config: {
              instructions: 'Use o prompt system principal para responder ao cliente.',
              referenceId: 'agente',
              variableName: 'resposta_ia',
              useAi: true,
            },
          },
        });
      });
      setSelectedNodeId(selectedAssistantId);
      return;
    }
    if (blockKind === 'send_message') {
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `message-${Date.now()}`;
      setNodes((current) => current.concat({
        id,
        type: 'attendant',
        position,
        data: {
          kind: 'send_message',
          title: 'Enviar mensagem',
          subtitle: 'Sem IA',
          config: {
            message: 'Digite a mensagem que sera enviada ao cliente.',
            referenceId: `mensagem_${Date.now()}`,
            variableName: `mensagem_enviada_${Date.now()}`,
          },
        },
      }));
      setSelectedNodeId(id);
      return;
    }
    if (blockKind === 'form') {
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `form-${Date.now()}`;
      setNodes((current) => current.concat({
        id,
        type: 'attendant',
        position,
        data: {
          kind: 'form',
          title: 'Coletar dados',
          subtitle: 'Formulario com IA',
          config: {
            message: 'Para continuar, me envie os dados abaixo:',
            formMode: 'ai',
            referenceId: `coletar_dados_${Date.now()}`,
            formFields: [
              { id: `field-name-${Date.now()}`, label: 'Nome completo', fieldKey: 'nome_completo', required: true },
              { id: `field-address-${Date.now()}`, label: 'Endereco de instalacao', fieldKey: 'endereco_instalacao', required: true },
              { id: `field-plan-${Date.now()}`, label: 'Plano escolhido', fieldKey: 'plano_escolhido', required: true },
            ],
            variableName: `formulario_enviado_${Date.now()}`,
          },
        },
      }));
      setSelectedNodeId(id);
      return;
    }
    const rawRule = event.dataTransfer.getData('application/dialogy-attendant-rule');
    if (rawRule) {
      try {
        const rule = JSON.parse(rawRule) as NexusFlowInstance;
        const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const id = `rule-${rule.id}`;
        setNodes((current) => {
          const existing = current.some((node) => node.id === id);
          if (existing) {
            return current.map((node) => (
              node.id === id
                ? { ...node, position, data: ruleNodeData(rule) }
                : node
            ));
          }
          return current.concat({
            id,
            type: 'attendant',
            position,
            data: ruleNodeData(rule),
          });
        });
        setSelectedNodeId(id);
        return;
      } catch {
        return;
      }
    }
    const raw = event.dataTransfer.getData('application/dialogy-attendant-tool');
    if (!raw) return;

    try {
      const tool = JSON.parse(raw) as ToolCatalogItem;
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `tool-${tool.name}-${Date.now()}`;
      setNodes((current) => current.concat({
        id,
        type: 'attendant',
        position,
        data: {
          kind: 'tool',
          title: toolDisplayName(tool),
          subtitle: tool.source === 'mcp' ? tool.serverName || 'MCP' : 'Ferramenta Dialogy',
          risk: tool.riskLevel,
          toolName: tool.name,
          config: {
            instructions: 'Use os valores dos blocos anteriores para montar os parametros desta ferramenta.',
            referenceId: `ferramenta_${normalizeVariableName(toolDisplayName(tool)) || 'acao'}`,
            variableName: `resultado_${normalizeVariableName(toolDisplayName(tool)) || 'ferramenta'}`,
          },
        },
      }));
      setSelectedNodeId(id);
    } catch {
      return;
    }
  }, [agentName, flowInstance, setNodes]);

  const filteredTools = tools.filter((tool) => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return true;
    return `${tool.name} ${tool.description} ${toolDisplayName(tool)}`.toLowerCase().includes(query);
  });
  const dialogyTools = filteredTools.filter((tool) => tool.source === 'dialogy');
  const mcpTools = filteredTools.filter((tool) => tool.source === 'mcp');

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#101214] text-slate-100">
      <section className="relative min-w-0 flex-1 overflow-hidden border-r border-white/[0.08]">
        {inlinePanel ? (
          <div className="h-full overflow-y-auto bg-[#101214] px-7 pb-[96px] pt-[108px]">
            {inlinePanel}
          </div>
        ) : (
          <ReactFlow<AttendantNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_event, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
              setIsSystemVariablesOpen(false);
            }}
            onEdgeClick={(_event, selectedFlowEdge) => {
              setSelectedEdgeId(selectedFlowEdge.id);
              setSelectedNodeId(null);
              setIsSystemVariablesOpen(false);
            }}
            onNodesDelete={(deletedNodes) => {
              if (deletedNodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(null);
            }}
            onEdgesDelete={(deletedEdges) => {
              if (deletedEdges.some((deletedEdge) => deletedEdge.id === selectedEdgeId)) setSelectedEdgeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              setIsSystemVariablesOpen(false);
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.35}
            maxZoom={1.55}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            className="attendant-flow-canvas"
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="#30343a" gap={33} size={1.4} />
            <MiniMap
              className="!bottom-20 !left-5 !right-auto !h-[104px] !w-[168px] !rounded-xl !border !border-white/10 !bg-[#121519]/90"
              nodeColor="#1e668f"
              maskColor="rgba(5, 7, 9, 0.52)"
              pannable
            />
            <Controls
              position="bottom-right"
              orientation="horizontal"
              showInteractive={false}
              className="!bottom-7 !right-7 !overflow-hidden !rounded-xl !border !border-white/10 !bg-[#15181b] !shadow-xl [&>button]:!h-11 [&>button]:!w-11 [&>button]:!border-white/10 [&>button]:!bg-transparent [&>button]:!fill-slate-300 [&>button]:!text-slate-300 [&>button:hover]:!bg-white/5"
            />
          </ReactFlow>
        )}

        <header className="pointer-events-none absolute left-7 right-7 top-6 z-10 flex items-start justify-between gap-5">
          <div className="pointer-events-auto flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="h-[62px] w-[62px] rounded-[20px] border border-white/10 bg-[#17191b]/95 text-slate-300 hover:bg-[#1d2024] hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <nav className="flex h-[62px] items-center gap-1 rounded-[20px] border border-white/10 bg-[#17191b]/95 px-2 shadow-xl">
              <button type="button" onClick={() => inlinePanelName && onOpenPanel(inlinePanelName)} className={cn('flex h-11 w-11 items-center justify-center rounded-xl', inlinePanelName ? 'text-slate-400 hover:bg-white/5 hover:text-white' : 'bg-sky-500/15 text-sky-400')}>
                <Bot className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => onOpenPanel('knowledge')} className={cn('flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/5 hover:text-white', inlinePanelName === 'knowledge' ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400')}>
                <BookOpen className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => onOpenPanel('capabilities')} className={cn('flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/5 hover:text-white', inlinePanelName === 'capabilities' ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400')}>
                <Wrench className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => onOpenPanel('analytics')} className={cn('flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/5 hover:text-white', inlinePanelName === 'analytics' ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400')}>
                <GitBranch className="h-5 w-5" />
              </button>
              <span className="mx-2 h-8 w-px bg-white/10" />
              <button type="button" onClick={() => onOpenPanel('settings')} className={cn('flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/5 hover:text-white', inlinePanelName === 'settings' ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400')}>
                <Settings2 className="h-5 w-5" />
              </button>
            </nav>
            <div className="hidden rounded-2xl border border-white/10 bg-[#17191b]/95 px-4 py-2.5 lg:block">
              <p className="max-w-[220px] truncate text-sm font-medium">{agentName}</p>
              <p className="text-[11px] text-slate-400">{modelName}</p>
            </div>
          </div>

          <div className="pointer-events-auto relative flex h-[62px] items-center gap-1 rounded-[20px] border border-white/10 bg-[#17191b]/95 px-2 shadow-xl">
            <Badge className={cn(
              'mx-2 border-0',
              isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'
            )}>
              {isActive ? 'Operando' : 'Pausado'}
            </Badge>
            <button type="button" onClick={() => onOpenPanel('playground')} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white">
              <FlaskConical className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => onOpenPanel('versions')} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white">
              <History className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setIsSystemVariablesOpen((open) => !open)}
              title="Variaveis do sistema"
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl font-mono text-sm hover:bg-white/5 hover:text-white',
                isSystemVariablesOpen ? 'bg-sky-500/15 text-sky-300' : 'text-slate-400'
              )}
            >
              {'{x}'}
            </button>
            <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white">
              <CircleHelp className="h-5 w-5" />
            </button>
            <span className="mx-2 h-8 w-px bg-white/10" />
            <Avatar className="h-10 w-10 border border-white/10">
              <AvatarFallback className="bg-sky-600/20 text-sm text-sky-300">IA</AvatarFallback>
            </Avatar>
            {isSystemVariablesOpen && (
              <SystemVariablesPanel
                variables={systemVariables}
                onClose={() => setIsSystemVariablesOpen(false)}
                onAdd={addSystemVariable}
                onDelete={deleteSystemVariable}
              />
            )}
          </div>
        </header>

        <footer className="pointer-events-none absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3">
          <Button
            onClick={() => onOpenPanel('playground')}
            className="pointer-events-auto h-[54px] rounded-xl border border-sky-500/35 bg-sky-700/70 px-5 text-white hover:bg-sky-600"
          >
            <Play className="mr-2 h-4 w-4 fill-current" />
            Testar atendimento
          </Button>
          <div className="pointer-events-auto flex h-[54px] items-center gap-1 rounded-xl border border-white/10 bg-[#15181b]/95 px-2 shadow-xl">
            {(hasDraft || isDirty) && (
              <button
                type="button"
                disabled={isDiscarding}
                onClick={onDiscard}
                className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {isDiscarding ? 'Descartando...' : 'Descartar'}
              </button>
            )}
            <button
              type="button"
              disabled={!isDirty || isSaving || hasVariableConflicts || hasReferenceConflicts}
              onClick={onSave}
              className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
            <span className="mx-1 h-7 w-px bg-white/10" />
            <button
              type="button"
              disabled={isPublishing || hasVariableConflicts || hasReferenceConflicts || (!hasDraft && !isDirty)}
              onClick={onPublish}
              className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Publicar
            </button>
            <span className="mx-1 h-7 w-px bg-white/10" />
            <button type="button" onClick={() => onOpenPanel('settings')} className={cn('flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/5', inlinePanelName === 'settings' ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400')}>
              <Settings2 className="h-4 w-4" />
            </button>
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </section>

      <aside className="flex h-full w-[350px] shrink-0 flex-col bg-[#0e1012]">
        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            availableNodeVariables={availableNodeVariables}
            systemVariables={systemVariables}
            knowledgeCollections={knowledgeCollections}
            knowledgeAttachment={selectedKnowledgeAttachment}
            knownReferenceIds={knownReferenceIds}
            mainSystemPrompt={mainSystemPrompt}
            variableNameConflict={variableNameConflict}
            referenceIdConflict={referenceIdConflict}
            onMainSystemPromptChange={onMainSystemPromptChange}
            onClose={() => setSelectedNodeId(null)}
            onUpdate={updateSelectedNode}
            onDelete={deleteSelectedNode}
          />
        ) : selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            nodes={nodes}
            onClose={() => setSelectedEdgeId(null)}
            onDelete={deleteSelectedEdge}
          />
        ) : (
          <>
        <div className="border-b border-white/[0.08] px-5 pb-5 pt-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={toolQuery}
              onChange={(event) => setToolQuery(event.target.value)}
              placeholder="Buscar ferramentas..."
              className="h-12 rounded-xl border-white/10 bg-[#17191c] pl-11 text-slate-200 placeholder:text-slate-500 focus-visible:ring-sky-500/30"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Accordion type="multiple" defaultValue={['control', 'tools', 'messages']} className="space-y-3">
            <AccordionItem value="control" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                <span className="flex items-center gap-3"><Settings2 className="h-4 w-4" /> Controle do agente</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                <MainAgentBlockButton />
                <button type="button" onClick={() => onOpenPanel('settings')} className="w-full rounded-lg px-2 py-2 text-left text-sm text-slate-400 hover:bg-white/5">
                  Configuracoes gerais
                </button>
                <button type="button" onClick={() => onOpenPanel('knowledge')} className="w-full rounded-lg px-2 py-2 text-left text-sm text-slate-400 hover:bg-white/5">
                  Base de conhecimento
                </button>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tools" className="rounded-xl border border-sky-500/30 bg-[#111a20] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-sky-400 hover:no-underline">
                <span className="flex items-center gap-3"><Wrench className="h-4 w-4" /> Ferramentas do atendimento</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                {dialogyTools.map((tool) => (
                  <ToolButton key={tool.name} tool={tool} enabled={enabledToolNames.includes(tool.name)} />
                ))}
                {dialogyTools.length === 0 && (
                  <p className="px-3 py-3 text-xs text-slate-500">Nenhuma ferramenta encontrada.</p>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="messages" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                <span className="flex items-center gap-3"><MessageSquareText className="h-4 w-4" /> Mensagens</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                <DeterministicMessageBlockButton />
                <FormBlockButton />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="routing" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                <span className="flex items-center gap-3"><GitBranch className="h-4 w-4" /> Sub-agentes</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                <SubAgentBlockButton />
              </AccordionContent>
            </AccordionItem>

            {mcpTools.length > 0 && (
              <AccordionItem value="connected" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
                <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                  <span className="flex items-center gap-3"><Monitor className="h-4 w-4" /> Conectores de atendimento</span>
                </AccordionTrigger>
                <AccordionContent>
                  {mcpTools.map((tool) => (
                    <ToolButton key={tool.name} tool={tool} enabled={enabledToolNames.includes(tool.name)} />
                  ))}
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem value="skills" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                <span className="flex items-center gap-3"><GitBranch className="h-4 w-4" /> Habilidades</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                {rules.map((rule) => (
                  <RuleBlockButton key={rule.id} rule={rule} />
                ))}
                {rules.length === 0 && (
                  <p className="px-3 py-3 text-xs text-slate-500">Nenhuma habilidade criada.</p>
                )}
                <button type="button" onClick={onAddRule} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-300 hover:bg-white/5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 text-sky-400"><Plus className="h-4 w-4" /></span>
                  Nova habilidade
                </button>
                <button type="button" onClick={() => onOpenPanel('capabilities')} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-500 hover:text-slate-300">
                  Ver permissoes e regras configuradas
                </button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="border-t border-white/[0.08] p-5">
          <button
            type="button"
            onClick={() => onOpenPanel('playground')}
            className="flex h-14 w-full items-center justify-between rounded-xl border border-sky-500/25 bg-sky-950/35 px-4 text-sm font-medium text-sky-300 hover:bg-sky-950/55"
          >
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Assistente de teste</span>
            <Badge className="border-0 bg-sky-600 text-white">beta</Badge>
          </button>
          <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-slate-500">
            <span>{isPrivate ? 'Privado' : 'Workspace'}</span>
            <span>{isPrimary ? 'Agente principal' : 'Agente secundario'}</span>
          </div>
        </div>
          </>
        )}
      </aside>
    </div>
  );
}
