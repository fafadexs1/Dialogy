'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { toast } from '@/hooks/use-toast';
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
  AlertTriangle,
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
  LayoutGrid,
  Loader2,
  MessageSquareText,
  Monitor,
  MoreVertical,
  Play,
  Plus,
  Rocket,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  UserRound,
  Wrench,
  X,
  XCircle,
  Wand2,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  auditAutopilotFlowGraph,
  type AutopilotFlowAuditResult,
  type AutopilotFlowSimulationResult,
} from '@/services/autopilot/flow-audit';
import type {
  AutopilotFlowAiProposal,
  AutopilotFlowGraph,
  AutopilotFlowFormField,
  AutopilotFlowSwitchRoute,
  AutopilotFlowNodeKind,
  AutopilotFlowVariable,
  KnowledgeBaseDocument,
  KnowledgeCollection,
} from '@/lib/types';
import type {
  ConnectionType as WorkflowConnectionType,
  OperationalNodeState,
} from '@/services/workflow-runtime/types';
import { migrateAutopilotFlowGraphToV2 } from '@/services/autopilot/flow-v2';
import { autoLayoutFlowNodes } from '@/services/autopilot/flow-layout';
import {
  analyzeAutopilotToolCoverage,
  isAutopilotToolCoveragePublishBlocked,
  type AutopilotToolCoverageReport,
} from '@/services/autopilot/tool-coverage';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';

export type AgentEditorPanel =
  | 'settings'
  | 'knowledge'
  | 'capabilities'
  | 'playground'
  | 'decision'
  | 'analytics'
  | 'versions';

type ToolCatalogItem = {
  name: string;
  description: string;
  class: string;
  riskLevel: 'low' | 'medium' | 'high';
  sideEffect?: 'none' | 'low' | 'medium' | 'high';
  idempotent?: boolean;
  requiresHumanApproval?: boolean;
  source: 'dialogy' | 'mcp';
  serverName?: string;
  serverId?: string;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
};

type NodeKind = AutopilotFlowNodeKind;

type AttendantNodeData = {
  kind: NodeKind;
  title: string;
  subtitle: string;
  status?: string;
  risk?: 'low' | 'medium' | 'high';
  toolName?: string;
  toolHandlePosition?: Position;
  config?: {
    instructions?: string;
    message?: string;
    formFields?: AutopilotFlowFormField[];
    formMode?: 'static' | 'ai';
    requiredSlots?: string[];
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    successHandles?: string[];
    errorHandles?: string[];
    maxAttempts?: number;
    requiredKnowledgeCoverage?: 'high' | 'medium' | 'low' | 'none';
    referenceId?: string;
    variableName?: string;
    destination?: string;
    useAi?: boolean;
    returnToMainPrompt?: boolean;
    knowledgeCollectionIds?: string[];
    knowledgeDocumentIds?: string[];
    switchMode?: 'ai' | 'rules';
    confidenceThreshold?: number;
    fallbackRouteId?: string;
    routes?: AutopilotFlowSwitchRoute[];
  };
};

type AttendantNode = Node<AttendantNodeData, 'attendant'>;
type AttendantEdgeData = {
  routeId?: string;
  routeLabel?: string;
  connectionType?: WorkflowConnectionType;
};
type AttendantEdge = Edge<AttendantEdgeData>;
const SWITCH_EDGE_LABEL_BG_PADDING: [number, number] = [6, 3];

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
  onGenerateFlowWithAi: (input: {
    conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
    currentGraph: AutopilotFlowGraph;
    currentSystemPrompt: string;
    knowledgeDocuments?: KnowledgeBaseDocument[];
    knowledgeCollections?: KnowledgeCollection[];
  }) => Promise<{ proposal: AutopilotFlowAiProposal | null; error?: string }>;
  onApplyAiProposal: (proposal: AutopilotFlowAiProposal) => void;
}

const BUILT_IN_VARIABLES = [
  '{{system.customer_message}}',
  '{{system.contact.name}}',
  '{{flow.customer_identifier}}',
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

const NODE_SURFACES: Partial<Record<NodeKind, string>> = {
  start: 'border-blue-500/35 bg-blue-950/30 shadow-[0_0_26px_rgba(20,122,220,0.12)]',
  message: 'border-sky-500/35 bg-blue-950/25',
  decision: 'border-amber-400/45 bg-amber-950/25 shadow-[0_0_26px_rgba(245,158,11,0.12)]',
  knowledge: 'border-orange-400/65 bg-orange-950/35 shadow-[0_0_26px_rgba(251,146,60,0.16)]',
  collect: 'border-emerald-500/35 bg-emerald-950/25',
  sub_agent: 'border-cyan-400/30 bg-[#181a1d] shadow-[0_0_28px_rgba(42,150,220,0.1)]',
  handoff: 'border-violet-500/30 bg-[#181820]',
  end: 'border-emerald-500/30 bg-[#171c1b]',
  tool: 'border-sky-500/35 bg-[#141b22]',
};

const HANDLE_CLASS_NAMES = {
  vertical: '!h-2.5 !w-2.5 !border-[#16191d] !bg-sky-400 opacity-0 transition-opacity group-hover:opacity-100',
  knowledge: '!h-3 !w-3 !border-[#16191d] !bg-orange-400 opacity-0 transition-opacity group-hover:opacity-100',
  skill: '!h-3 !w-3 !border-[#16191d] !bg-red-400 opacity-0 transition-opacity group-hover:opacity-100',
};

const OPERATIONAL_STATUS_META: Partial<Record<OperationalNodeState, {
  label: string;
  className: string;
}>> = {
  queued: { label: 'Na fila', className: 'border-slate-500/30 bg-slate-500/10 text-slate-300' },
  running: { label: 'Executando', className: 'border-sky-500/35 bg-sky-500/10 text-sky-200' },
  thinking: { label: 'Pensando', className: 'border-violet-500/35 bg-violet-500/10 text-violet-200' },
  waiting_tool: { label: 'Aguardando tool', className: 'border-red-500/35 bg-red-500/10 text-red-200' },
  running_tool: { label: 'Executando tool', className: 'border-red-500/35 bg-red-500/10 text-red-200' },
  waiting_input: { label: 'Aguardando entrada', className: 'border-amber-500/35 bg-amber-500/10 text-amber-200' },
  completed: { label: 'Concluído', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200' },
  partially_completed: { label: 'Parcial', className: 'border-amber-500/35 bg-amber-500/10 text-amber-200' },
  skipped: { label: 'Ignorado', className: 'border-slate-500/30 bg-slate-500/10 text-slate-400' },
  retrying: { label: 'Tentando novamente', className: 'border-orange-500/35 bg-orange-500/10 text-orange-200' },
  failed: { label: 'Falhou', className: 'border-red-500/35 bg-red-500/10 text-red-200' },
  cancelled: { label: 'Cancelado', className: 'border-slate-500/30 bg-slate-500/10 text-slate-400' },
};

function isAgentNodeKind(kind: NodeKind): boolean {
  return kind === 'sub_agent';
}

function isPrimaryAgentNode(node: AttendantNode) {
  return node.id === 'sub-agent'
    || node.data.config?.referenceId === 'agente_principal'
    || node.data.config?.referenceId === 'sub_agente_principal';
}

function NodeIcon({ kind }: { kind: NodeKind }) {
  const className = 'h-5 w-5';
  if (kind === 'start') return <Play className={className} />;
  if (kind === 'message') return <MessageSquareText className={className} />;
  if (kind === 'decision') return <GitBranch className={className} />;
  if (kind === 'knowledge') return <Database className={className} />;
  if (kind === 'collect') return <ClipboardList className={className} />;
  if (kind === 'sub_agent') return <Bot className={className} />;
  if (kind === 'handoff') return <UserRound className={className} />;
  if (kind === 'end') return <CheckCircle2 className={className} />;
  return <Wrench className={className} />;
}

function AttendantNodeCard({ id, data, selected }: NodeProps<AttendantNode>) {
  const isAttachmentNode = data.kind === 'knowledge';
  const isKnowledgeNode = data.kind === 'knowledge';
  const acceptsKnowledge = isAgentNodeKind(data.kind);
  const exposesSkill = isAgentNodeKind(data.kind);
  const showMainTarget = data.kind !== 'start' && data.kind !== 'knowledge' && data.kind !== 'tool';
  const showMainSource = data.kind !== 'end' && data.kind !== 'handoff' && data.kind !== 'knowledge';
  const toolTargetPosition = data.toolHandlePosition || Position.Left;
  const operationalStatus = data.status
    ? OPERATIONAL_STATUS_META[data.status as OperationalNodeState]
    : undefined;

  return (
    <div
      className={cn(
        'group relative flex flex-col items-center justify-center border text-center text-[#e8edf3] transition-shadow',
        isAttachmentNode
          ? 'min-h-[124px] w-[124px] rounded-full px-4 py-4'
          : 'min-h-[112px] w-[188px] rounded-[20px] px-4 py-4',
        NODE_SURFACES[data.kind] || NODE_SURFACES.sub_agent,
        selected && 'border-sky-400/70 shadow-[0_0_0_1px_rgba(56,189,248,0.3),0_0_30px_rgba(14,165,233,0.2)]'
      )}
    >
      {showMainTarget && (
        <Handle id="target-top" type="target" position={Position.Top} className={HANDLE_CLASS_NAMES.vertical} />
      )}
      {acceptsKnowledge && (
        <Handle id="target-left-knowledge" type="target" position={Position.Left} className={HANDLE_CLASS_NAMES.knowledge} />
      )}
      {data.kind === 'tool' && (
        <Handle
          id={`target-${toolTargetPosition}-tool`}
          type="target"
          position={toolTargetPosition}
          className={HANDLE_CLASS_NAMES.skill}
        />
      )}
      <span
        className={cn(
          'nodrag absolute flex h-7 w-7 items-center justify-center rounded-md border text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100',
          isAttachmentNode ? 'right-1 top-1' : '-top-3 right-3',
          isKnowledgeNode
            ? 'border-orange-400/40 bg-orange-500'
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
      {operationalStatus && (
        <span
          className={cn(
            'absolute -bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-medium shadow-lg',
            operationalStatus.className,
          )}
        >
          {operationalStatus.label}
        </span>
      )}
      {showMainSource && (
        <Handle id="source-bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS_NAMES.vertical} />
      )}
      {isKnowledgeNode && (
        <Handle id="source-right-knowledge" type="source" position={Position.Right} className={HANDLE_CLASS_NAMES.knowledge} />
      )}
      {exposesSkill && (
        <Handle id="source-right-skill" type="source" position={Position.Right} className={HANDLE_CLASS_NAMES.skill} />
      )}
      {exposesSkill && (
        <Handle id="source-left-skill" type="source" position={Position.Left} className={HANDLE_CLASS_NAMES.skill} />
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
const SKILL_SOURCE_LEFT_HANDLE = 'source-left-skill';
const DEFAULT_EDGE_COLOR = '#4485a5';
const MODEL_EDGE_COLOR = '#a78bfa';
const KNOWLEDGE_EDGE_COLOR = '#fb923c';
const SKILL_EDGE_COLOR = '#f87171';
const MEMORY_EDGE_COLOR = '#c084fc';
const GUARDRAIL_EDGE_COLOR = '#34d399';
const ERROR_EDGE_COLOR = '#fb7185';
const EVENT_EDGE_COLOR = '#22d3ee';
const AGENT_TOOL_EDGE_COLOR = '#f472b6';
const SWITCH_EDGE_COLOR = '#f59e0b';

const CONNECTION_TYPE_META: Record<WorkflowConnectionType, {
  label: string;
  color: string;
}> = {
  main: { label: 'Fluxo', color: DEFAULT_EDGE_COLOR },
  model: { label: 'Modelo', color: MODEL_EDGE_COLOR },
  tool: { label: 'Ferramenta', color: SKILL_EDGE_COLOR },
  agent_tool: { label: 'Agente', color: AGENT_TOOL_EDGE_COLOR },
  memory: { label: 'Memória', color: MEMORY_EDGE_COLOR },
  knowledge: { label: 'Conhecimento', color: KNOWLEDGE_EDGE_COLOR },
  guardrail: { label: 'Guardrail', color: GUARDRAIL_EDGE_COLOR },
  error: { label: 'Erro', color: ERROR_EDGE_COLOR },
  event: { label: 'Evento', color: EVENT_EDGE_COLOR },
};

function toolTargetPosition(source: AttendantNode, target: AttendantNode): Position {
  const dx = source.position.x - target.position.x;
  const dy = source.position.y - target.position.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? Position.Left : Position.Right;
  return dy < 0 ? Position.Top : Position.Bottom;
}

function agentSkillSourceHandle(source: AttendantNode, target: AttendantNode) {
  return target.position.x < source.position.x ? SKILL_SOURCE_LEFT_HANDLE : SKILL_SOURCE_HANDLE;
}

function connectionVisual(source: AttendantNode, target: AttendantNode): {
  sourceHandle: string;
  targetHandle: string;
  color: string;
  connectionType: WorkflowConnectionType;
  toolHandlePosition?: Position;
} {
  const sourceKind = source.data.kind;
  const targetKind = target.data.kind;
  if (sourceKind === 'knowledge' && isAgentNodeKind(targetKind)) {
    return {
      sourceHandle: KNOWLEDGE_SOURCE_HANDLE,
      targetHandle: KNOWLEDGE_TARGET_HANDLE,
      color: KNOWLEDGE_EDGE_COLOR,
      connectionType: 'knowledge',
    };
  }
  if (isAgentNodeKind(sourceKind) && targetKind === 'tool') {
    const targetPosition = toolTargetPosition(source, target);
    return {
      sourceHandle: agentSkillSourceHandle(source, target),
      targetHandle: `target-${targetPosition}-tool`,
      color: SKILL_EDGE_COLOR,
      connectionType: 'tool',
      toolHandlePosition: targetPosition,
    };
  }
  if (sourceKind === 'decision') {
    return {
      sourceHandle: VERTICAL_SOURCE_HANDLE,
      targetHandle: VERTICAL_TARGET_HANDLE,
      color: SWITCH_EDGE_COLOR,
      connectionType: 'main',
    };
  }
  return {
    sourceHandle: VERTICAL_SOURCE_HANDLE,
    targetHandle: VERTICAL_TARGET_HANDLE,
    color: DEFAULT_EDGE_COLOR,
    connectionType: 'main',
  };
}

function canConnectNodeKinds(sourceKind: NodeKind, targetKind: NodeKind): boolean {
  if (sourceKind === 'knowledge' || targetKind === 'knowledge') {
    return sourceKind === 'knowledge' && isAgentNodeKind(targetKind);
  }
  if (sourceKind === 'tool' || targetKind === 'tool') {
    if (targetKind === 'tool') {
      return isAgentNodeKind(sourceKind) || sourceKind === 'collect' || sourceKind === 'message';
    }
    if (sourceKind === 'tool') {
      return isAgentNodeKind(targetKind)
        || targetKind === 'collect'
        || targetKind === 'message'
        || targetKind === 'handoff'
        || targetKind === 'end';
    }
  }
  if (sourceKind === 'handoff' || sourceKind === 'end') return false;
  if (targetKind === 'start') return false;
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

// ---------------------------------------------------------------------------
// Auto-layout: organizes nodes into clean, layered positions using a
// simplified Sugiyama-style algorithm. Attachment nodes (knowledge, tool)
// are placed as satellites to their connected sub-agent node.
// ---------------------------------------------------------------------------

const LAYOUT_NODE_W = 188;
const LAYOUT_NODE_H = 132;
const LAYOUT_GAP_X = 80;
const LAYOUT_GAP_Y = 70;
const LAYOUT_SATELLITE_OFFSET_X = 240;
const LAYOUT_SATELLITE_GAP_Y = 50;
const LAYOUT_COLLISION_GAP = 36;

function layoutBoxesOverlap(left: { x: number; y: number }, right: { x: number; y: number }) {
  return !(
    left.x + LAYOUT_NODE_W + LAYOUT_COLLISION_GAP <= right.x ||
    right.x + LAYOUT_NODE_W + LAYOUT_COLLISION_GAP <= left.x ||
    left.y + LAYOUT_NODE_H + LAYOUT_COLLISION_GAP <= right.y ||
    right.y + LAYOUT_NODE_H + LAYOUT_COLLISION_GAP <= left.y
  );
}

function resolveLayoutCollisions(nodes: AttendantNode[], positionMap: Map<string, { x: number; y: number }>) {
  const placed: Array<{ id: string; x: number; y: number }> = [];
  const ordered = [...nodes].sort((left, right) => {
    const leftPos = positionMap.get(left.id) || left.position;
    const rightPos = positionMap.get(right.id) || right.position;
    return leftPos.y - rightPos.y || leftPos.x - rightPos.x || left.id.localeCompare(right.id);
  });

  for (const node of ordered) {
    const original = positionMap.get(node.id) || node.position;
    let next = { x: Math.max(40, original.x), y: Math.max(40, original.y) };
    let guard = 0;
    while (placed.some((candidate) => layoutBoxesOverlap(next, candidate)) && guard < nodes.length * 4) {
      const blocker = placed.find((candidate) => layoutBoxesOverlap(next, candidate));
      next = {
        x: next.x,
        y: blocker ? blocker.y + LAYOUT_NODE_H + LAYOUT_COLLISION_GAP : next.y + LAYOUT_NODE_H + LAYOUT_COLLISION_GAP,
      };
      guard += 1;
    }
    positionMap.set(node.id, next);
    placed.push({ id: node.id, ...next });
  }
}

function autoLayoutNodes(nodes: AttendantNode[], edges: Edge[]): AttendantNode[] {
  if (nodes.length === 0) return nodes;

  // Separate main-flow nodes from satellite/attachment nodes
  const satelliteKinds = new Set<NodeKind>(['knowledge', 'tool']);
  const mainNodes = nodes.filter((n) => !satelliteKinds.has(n.data.kind));
  const satelliteNodes = nodes.filter((n) => satelliteKinds.has(n.data.kind));

  // Build adjacency from edges (only for main nodes)
  const mainIds = new Set(mainNodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const n of mainNodes) {
    children.set(n.id, []);
    parents.set(n.id, []);
  }
  for (const e of edges) {
    if (!mainIds.has(e.source) || !mainIds.has(e.target)) continue;
    children.get(e.source)?.push(e.target);
    parents.get(e.target)?.push(e.source);
  }

  // Assign layers via BFS from roots (nodes with no incoming edges from main nodes)
  const layer = new Map<string, number>();
  const roots = mainNodes.filter((n) => (parents.get(n.id)?.length || 0) === 0);
  if (roots.length === 0 && mainNodes.length > 0) roots.push(mainNodes[0]);

  // Find back-edges to break cycles
  const visited = new Set<string>();
  const stack = new Set<string>();
  const backEdges = new Set<string>();

  function dfs(nodeId: string) {
    visited.add(nodeId);
    stack.add(nodeId);
    for (const childId of children.get(nodeId) || []) {
      if (stack.has(childId)) {
        backEdges.add(`${nodeId}->${childId}`);
      } else if (!visited.has(childId)) {
        dfs(childId);
      }
    }
    stack.delete(nodeId);
  }

  // Run DFS from all roots to ensure we cover reachable components
  for (const r of roots) {
    if (!visited.has(r.id)) {
      dfs(r.id);
    }
  }
  // Also run DFS from any other unvisited nodes just in case they are part of a disconnected cycle
  for (const n of mainNodes) {
    if (!visited.has(n.id)) {
      dfs(n.id);
    }
  }

  const queue: string[] = [];
  for (const r of roots) {
    layer.set(r.id, 0);
    queue.push(r.id);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layer.get(current)!;
    for (const child of children.get(current) || []) {
      if (backEdges.has(`${current}->${child}`)) continue;

      const existingLayer = layer.get(child);
      if (existingLayer === undefined || existingLayer < currentLayer + 1) {
        if (currentLayer + 1 < mainNodes.length) {
          layer.set(child, currentLayer + 1);
          queue.push(child);
        }
      }
    }
  }
  // Any unvisited main nodes get appended to the last layer
  let maxLayer = 0;
  for (const l of layer.values()) if (l > maxLayer) maxLayer = l;
  for (const n of mainNodes) {
    if (!layer.has(n.id)) {
      maxLayer++;
      layer.set(n.id, maxLayer);
    }
  }

  // Group nodes by layer
  const layerGroups = new Map<number, AttendantNode[]>();
  for (const n of mainNodes) {
    const l = layer.get(n.id) || 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(n);
  }

  // Position main nodes
  const positionMap = new Map<string, { x: number; y: number }>();
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);
  let yOffset = 60;
  for (const l of sortedLayers) {
    const group = layerGroups.get(l)!;
    const totalWidth = group.length * LAYOUT_NODE_W + (group.length - 1) * LAYOUT_GAP_X;
    let xStart = Math.max(60, (800 - totalWidth) / 2); // Center around 800px wide canvas
    for (const n of group) {
      positionMap.set(n.id, { x: xStart, y: yOffset });
      xStart += LAYOUT_NODE_W + LAYOUT_GAP_X;
    }
    yOffset += LAYOUT_NODE_H + LAYOUT_GAP_Y;
  }

  // Position satellite nodes next to their parent agent node
  const satelliteCountByParent = new Map<string, number>();
  for (const sat of satelliteNodes) {
    // Find connected parent sub-agent from edges
    let parentId: string | null = null;
    for (const e of edges) {
      if (e.target === sat.id && mainIds.has(e.source)) { parentId = e.source; break; }
      if (e.source === sat.id && mainIds.has(e.target)) { parentId = e.target; break; }
    }
    if (!parentId) {
      // No connected parent — find nearest agent node
      const agents = mainNodes.filter((n) => isAgentNodeKind(n.data.kind));
      if (agents.length > 0) parentId = agents[0].id;
    }
    const parentPos = parentId ? positionMap.get(parentId) : null;
    const baseX = parentPos ? parentPos.x : 60;
    const baseY = parentPos ? parentPos.y : 60;
    const satIndex = satelliteCountByParent.get(parentId || '') || 0;
    satelliteCountByParent.set(parentId || '', satIndex + 1);

    const side = sat.data.kind === 'knowledge' ? -1 : 1; // knowledge on left, tools on right
    positionMap.set(sat.id, {
      x: baseX + side * LAYOUT_SATELLITE_OFFSET_X,
      y: baseY + satIndex * (124 + LAYOUT_SATELLITE_GAP_Y),
    });
  }

  resolveLayoutCollisions(nodes, positionMap);

  // Apply positions
  return nodes.map((n) => {
    const pos = positionMap.get(n.id);
    return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n;
  });
}

function autoLayoutNodesStable(nodes: AttendantNode[], edges: Edge[]): AttendantNode[] {
  const layoutNodes = nodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    position: node.position,
  }));
  const layoutEdges = edges.map((flowEdge) => ({
    source: flowEdge.source,
    target: flowEdge.target,
  }));
  const organized = autoLayoutFlowNodes(layoutNodes, layoutEdges);
  const positionById = new Map(organized.map((node) => [node.id, node.position]));
  return nodes.map((node) => {
    const position = positionById.get(node.id);
    return position ? { ...node, position } : node;
  });
}

function findSwitchRouteForEdge(source: AttendantNode | undefined, targetId: string, routeId?: string | null): AutopilotFlowSwitchRoute | null {
  if (!source || source.data.kind !== 'decision') return null;
  const routes = source.data.config?.routes || [];
  return routes.find((route) => route.id === routeId && (!route.targetNodeId || route.targetNodeId === targetId))
    || routes.find((route) => route.targetNodeId === targetId)
    || null;
}

function edge(
  id: string,
  source: string,
  target: string,
  options?: {
    sourceHandle?: string;
    targetHandle?: string;
    color?: string;
    routeId?: string;
    routeLabel?: string;
    connectionType?: WorkflowConnectionType;
  },
): AttendantEdge {
  const color = options?.color || DEFAULT_EDGE_COLOR;
  const routeData: AttendantEdgeData = {
    connectionType: options?.connectionType || 'main',
    ...(options?.routeId
      ? {
          routeId: options.routeId,
          routeLabel: options.routeLabel || options.routeId,
        }
      : {}),
  };
  return {
    id,
    source,
    target,
    sourceHandle: options?.sourceHandle || VERTICAL_SOURCE_HANDLE,
    targetHandle: options?.targetHandle || VERTICAL_TARGET_HANDLE,
    type: 'smoothstep',
    animated: false,
    data: routeData,
    label: routeData.routeLabel,
    labelStyle: routeData.routeId ? { fill: '#fbbf24', fontSize: 11, fontWeight: 600 } : undefined,
    labelBgStyle: routeData.routeId ? { fill: '#17191c', fillOpacity: 0.92 } : undefined,
    labelBgPadding: routeData.routeId ? SWITCH_EDGE_LABEL_BG_PADDING : undefined,
    labelBgBorderRadius: routeData.routeId ? 6 : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    style: { stroke: color, strokeWidth: 1.6 },
  };
}

function edgeForNodes(
  id: string,
  source: AttendantNode,
  target: AttendantNode,
  routeId?: string | null,
  connectionType?: WorkflowConnectionType,
): AttendantEdge {
  const visual = connectionVisual(source, target);
  const route = findSwitchRouteForEdge(source, target.id, routeId);
  const resolvedType = connectionType || visual.connectionType;
  return edge(id, source.id, target.id, {
    ...visual,
    connectionType: resolvedType,
    color: CONNECTION_TYPE_META[resolvedType].color,
    routeId: route?.id,
    routeLabel: route?.label,
  });
}

function buildInitialGraph(agentName: string) {
  const nodes: AttendantNode[] = [
    {
      id: 'start',
      type: 'attendant',
      position: { x: 100, y: 140 },
      data: {
        kind: 'start',
        title: 'Start',
        subtitle: 'Inicio do fluxo',
        config: { instructions: 'Inicie a execucao do fluxo e avance para o primeiro passo conectado.', referenceId: 'start', variableName: 'start' },
      },
    },
    {
      id: 'welcome',
      type: 'attendant',
      position: { x: 382, y: 140 },
      data: {
        kind: 'message',
        title: 'Acolher cliente',
        subtitle: 'Mensagem inicial',
        config: { message: `Ola! Eu sou ${agentName || 'o agente IA'} e vou te ajudar. Me conte rapidamente o que voce precisa.`, referenceId: 'acolhimento', variableName: 'mensagem_acolhimento' },
      },
    },
    {
      id: 'decision',
      type: 'attendant',
      position: { x: 650, y: 140 },
      data: {
        kind: 'decision',
        title: 'Decidir caminho',
        subtitle: 'Rotas com fallback',
        config: {
          instructions: 'Escolha somente uma rota configurada. Use fallback quando faltar evidencia.',
          switchMode: 'ai',
          confidenceThreshold: 0.8,
          fallbackRouteId: 'atender',
          referenceId: 'decidir_caminho',
          variableName: 'rota_escolhida',
          routes: [
            {
              id: 'coletar',
              label: 'Coletar dados',
              description: 'Use quando faltarem dados obrigatorios para seguir.',
              examples: ['Quero agendar', 'Preciso passar meus dados'],
              targetNodeId: 'collect',
            },
            {
              id: 'atender',
              label: 'Atender com IA',
              description: 'Use para responder a solicitacao principal com contexto e seguranca.',
              examples: ['Tenho uma duvida', 'Preciso de ajuda'],
              targetNodeId: 'sub-agent',
            },
            {
              id: 'humano',
              label: 'Transferir humano',
              description: 'Use quando o cliente pedir atendimento humano ou o fluxo exigir escalonamento.',
              examples: ['Quero falar com atendente', 'Me transfira'],
              targetNodeId: 'handoff',
            },
          ],
        },
      },
    },
    {
      id: 'knowledge',
      type: 'attendant',
      position: { x: 922, y: 80 },
      data: {
        kind: 'knowledge',
        title: 'Conhecimento',
        subtitle: 'Consultar base',
        config: { instructions: 'Buscar chunks relevantes para a solicitacao atual antes do sub-agente responder.', message: '{{system.customer_message}}', requiredKnowledgeCoverage: 'low', referenceId: 'conhecimento', variableName: 'conhecimento_encontrado' },
      },
    },
    {
      id: 'collect',
      type: 'attendant',
      position: { x: 922, y: 260 },
      data: {
        kind: 'collect',
        title: 'Coletar dados',
        subtitle: 'Slots tipados',
        config: {
          message: 'Para seguir com seguranca, me informe os dados abaixo:',
          formMode: 'ai',
          maxAttempts: 2,
          referenceId: 'coletar_dados',
          variableName: 'dados_coletados',
          formFields: [
            { id: 'field-name', label: 'Nome completo', fieldKey: 'name', type: 'name', aliases: ['nome'], required: true },
            { id: 'field-phone', label: 'Telefone com DDD', fieldKey: 'phone', type: 'phone', aliases: ['whatsapp', 'celular'], required: true },
          ],
        },
      },
    },
    {
      id: 'sub-agent',
      type: 'attendant',
      position: { x: 1190, y: 140 },
      data: {
        kind: 'sub_agent',
        title: agentName || 'Agente principal',
        subtitle: 'Raiz do atendimento',
        config: {
          instructions: 'Atenda o cliente nesta etapa usando somente slots confirmados, resultados de tools e chunks de knowledge recuperados. Se faltar base, diga que nao encontrou informacao suficiente e siga o proximo passo seguro.',
          message: 'Componha a resposta para o cliente com linguagem natural e segura.',
          referenceId: 'agente_principal',
          variableName: 'resposta_agente_principal',
          useAi: true,
          requiredKnowledgeCoverage: 'low',
          returnToMainPrompt: false,
        },
      },
    },
    {
      id: 'handoff',
      type: 'attendant',
      position: { x: 1190, y: 340 },
      data: {
        kind: 'handoff',
        title: 'Transferir humano',
        subtitle: 'Se necessario',
        config: { destination: 'Equipe de atendimento', message: 'Vou encaminhar voce para um atendente.', referenceId: 'transferir', variableName: 'transferencia_humana' },
      },
    },
    {
      id: 'end',
      type: 'attendant',
      position: { x: 1460, y: 140 },
      data: {
        kind: 'end',
        title: 'End',
        subtitle: 'Fim da execucao',
        config: { message: 'Seu atendimento foi finalizado. Precisa de mais alguma coisa?', referenceId: 'finalizar', variableName: 'conversa_finalizada' },
      },
    },
  ];

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const buildEdge = (id: string, source: string, target: string) => {
    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    return sourceNode && targetNode ? edgeForNodes(id, sourceNode, targetNode) : edge(id, source, target);
  };
  const edges = [
    buildEdge('start-welcome', 'start', 'welcome'),
    buildEdge('welcome-decision', 'welcome', 'decision'),
    edge('decision-collect', 'decision', 'collect', { routeId: 'coletar', routeLabel: 'Coletar dados', color: SWITCH_EDGE_COLOR }),
    edge('decision-sub-agent', 'decision', 'sub-agent', { routeId: 'atender', routeLabel: 'Atender com IA', color: SWITCH_EDGE_COLOR }),
    edge('decision-handoff', 'decision', 'handoff', { routeId: 'humano', routeLabel: 'Transferir humano', color: SWITCH_EDGE_COLOR }),
    buildEdge('collect-sub-agent', 'collect', 'sub-agent'),
    buildEdge('knowledge-sub-agent', 'knowledge', 'sub-agent'),
    buildEdge('sub-agent-end', 'sub-agent', 'end'),
  ];
  return { nodes, edges, variables: [] as AutopilotFlowVariable[] };
}

function restoreFlowGraph(graph: AutopilotFlowGraph) {
  const v2Graph = migrateAutopilotFlowGraphToV2(graph) || graph;
  let nodes = v2Graph.nodes.map((node): AttendantNode => ({
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
  const edges = v2Graph.edges.map((savedEdge) => {
    const source = nodeById.get(savedEdge.source);
    const target = nodeById.get(savedEdge.target);
    return source && target
      ? edgeForNodes(savedEdge.id, source, target, savedEdge.routeId, savedEdge.connectionType)
      : edge(savedEdge.id, savedEdge.source, savedEdge.target, {
          connectionType: savedEdge.connectionType || 'main',
          color: CONNECTION_TYPE_META[savedEdge.connectionType || 'main'].color,
        });
  });
  nodes = nodes.map((node) => {
    if (node.data.kind !== 'tool') return node;
    const incomingEdge = edges.find((flowEdge) => flowEdge.target === node.id);
    const source = incomingEdge ? nodeById.get(incomingEdge.source) : null;
    return source
      ? { ...node, data: { ...node.data, toolHandlePosition: toolTargetPosition(source, node) } }
      : node;
  });
  return {
    nodes,
    edges: keepValidGraphEdges(nodes, edges),
    variables: v2Graph.variables || [],
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
      routeId: typeof savedEdge.data?.routeId === 'string' ? savedEdge.data.routeId : undefined,
      label: typeof savedEdge.data?.routeLabel === 'string' ? savedEdge.data.routeLabel : undefined,
      connectionType: typeof savedEdge.data?.connectionType === 'string'
        ? savedEdge.data.connectionType as WorkflowConnectionType
        : undefined,
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

function FlowV2BlockButton({
  kind,
  title,
  subtitle,
  icon,
  tone,
}: {
  kind: Extract<NodeKind, 'start' | 'message' | 'collect' | 'decision' | 'knowledge' | 'sub_agent' | 'handoff' | 'end'>;
  title: string;
  subtitle: string;
  icon: ReactNode;
  tone: string;
}) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/dialogy-attendant-block', kind);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-white/[0.05]"
      title={`${title}: ${subtitle}`}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tone)}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        <span className="block text-[11px] text-slate-500">{subtitle}</span>
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

function NodeInspector({
  node,
  flowNodes,
  availableNodeVariables,
  systemVariables,
  knowledgeDocuments,
  knowledgeCollections,
  knowledgeAttachment,
  knownReferenceIds,
  variableNameConflict,
  referenceIdConflict,
  onClose,
  onUpdate,
  onDeleteSwitchRoute,
  onDelete,
}: {
  node: AttendantNode;
  flowNodes: AttendantNode[];
  availableNodeVariables: string[];
  systemVariables: AutopilotFlowVariable[];
  knowledgeDocuments: KnowledgeBaseDocument[];
  knowledgeCollections: KnowledgeCollection[];
  knowledgeAttachment?: {
    targetTitle: string;
    targetKind: 'sub_agent';
    documentIds: string[];
    collectionNames: string[];
    documents: KnowledgeBaseDocument[];
  } | null;
  knownReferenceIds: Set<string>;
  variableNameConflict: boolean;
  referenceIdConflict: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<AttendantNodeData>) => void;
  onDeleteSwitchRoute: (routeId: string) => void;
  onDelete: () => void;
}) {
  const config = node.data.config || {};
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const updateConfig = (patch: NonNullable<AttendantNodeData['config']>) => {
    onUpdate({ config: { ...config, ...patch } });
  };
  const switchRoutes = config.routes || [];
  const updateSwitchRoute = (routeId: string, patch: Partial<AutopilotFlowSwitchRoute>) => {
    updateConfig({
      routes: switchRoutes.map((route) => (
        route.id === routeId ? { ...route, ...patch } : route
      )),
      ...(patch.id && config.fallbackRouteId === routeId ? { fallbackRouteId: patch.id } : {}),
    });
  };
  const deleteSwitchRoute = (routeId: string) => {
    const nextRoutes = switchRoutes.filter((route) => route.id !== routeId);
    onDeleteSwitchRoute(routeId);
    updateConfig({
      routes: nextRoutes,
      fallbackRouteId: config.fallbackRouteId === routeId ? nextRoutes.at(-1)?.id : config.fallbackRouteId,
    });
  };
  const addSwitchRoute = () => {
    const nextIndex = switchRoutes.length + 1;
    const id = `rota_${nextIndex}_${Date.now()}`;
    updateConfig({
      routes: [
        ...switchRoutes,
        {
          id,
          label: 'Nova rota',
          description: 'Descreva quando o atendimento deve seguir por este caminho.',
          examples: [],
        },
      ],
      fallbackRouteId: config.fallbackRouteId || id,
    });
  };
  const variables = [
    ...BUILT_IN_VARIABLES,
    ...systemVariables.map((variable) => `{{system.${variable.name}}}`),
    ...availableNodeVariables.map((variable) => `{{${variable}}}`),
  ];
  const mainField = node.data.kind === 'message'
    || node.data.kind === 'collect'
    || node.data.kind === 'sub_agent'
    || node.data.kind === 'handoff'
    || node.data.kind === 'end'
    ? 'message'
    : 'instructions';
  const insertVariable = (variable: string) => {
    updateConfig({ [mainField]: `${config[mainField] || ''}${config[mainField] ? ' ' : ''}${variable}` });
  };
  const selectedKnowledgeCollectionIds = config.knowledgeCollectionIds || [];
  const selectedKnowledgeDocumentIds = config.knowledgeDocumentIds || [];
  const visibleKnowledgeDocuments = knowledgeDocuments.filter((document) => {
    if (document.status === 'archived' || document.status === 'expired') return false;
    const collectionIds = document.collectionIds?.length ? document.collectionIds : ['general'];
    const matchesCollection = selectedKnowledgeCollectionIds.length === 0
      || collectionIds.some((collectionId) => selectedKnowledgeCollectionIds.includes(collectionId));
    const query = knowledgeQuery.trim().toLocaleLowerCase('pt-BR');
    const matchesQuery = !query
      || `${document.name} ${document.category || ''}`.toLocaleLowerCase('pt-BR').includes(query);
    return matchesCollection && matchesQuery;
  });
  const toggleKnowledgeCollection = (collectionId: string) => {
    const nextCollectionIds = selectedKnowledgeCollectionIds.includes(collectionId)
      ? selectedKnowledgeCollectionIds.filter((id) => id !== collectionId)
      : [...selectedKnowledgeCollectionIds, collectionId];
    const allowedDocumentIds = new Set(knowledgeDocuments
      .filter((document) => {
        if (nextCollectionIds.length === 0) return true;
        const documentCollectionIds = document.collectionIds?.length ? document.collectionIds : ['general'];
        return documentCollectionIds.some((id) => nextCollectionIds.includes(id));
      })
      .map((document) => document.id));
    updateConfig({
      knowledgeCollectionIds: nextCollectionIds,
      knowledgeDocumentIds: selectedKnowledgeDocumentIds.filter((id) => allowedDocumentIds.has(id)),
    });
  };
  const toggleKnowledgeDocument = (documentId: string) => {
    updateConfig({
      knowledgeDocumentIds: selectedKnowledgeDocumentIds.includes(documentId)
        ? selectedKnowledgeDocumentIds.filter((id) => id !== documentId)
        : [...selectedKnowledgeDocumentIds, documentId],
    });
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

        {node.data.kind === 'knowledge' && (
          <div className="space-y-4 rounded-xl border border-orange-500/25 bg-orange-500/[0.05] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">Conhecimento vinculado</p>
              {knowledgeAttachment ? (
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  Este bloco libera consulta de base para o sub-agente <span className="text-slate-300">{knowledgeAttachment.targetTitle}</span>.
                </p>
              ) : (
                <p className="mt-1 text-[11px] leading-4 text-amber-200">
                  Conecte este bloco na lateral esquerda de um sub-agente para liberar consulta RAG.
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

            <div className="space-y-3 border-t border-orange-500/15 pt-4">
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">Consulta enviada ao RAG</Label>
                <HighlightedReferenceTextarea
                  value={config.message || ''}
                  onChange={(value) => updateConfig({ message: value })}
                  placeholder="{{system.customer_message}}"
                  knownReferenceIds={knownReferenceIds}
                  className="min-h-[88px] border-white/10 bg-[#17191c] text-sm text-slate-100"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">Cobertura minima exigida</Label>
                <select
                  value={config.requiredKnowledgeCoverage || 'low'}
                  onChange={(event) => updateConfig({
                    requiredKnowledgeCoverage: event.target.value as NonNullable<AttendantNodeData['config']>['requiredKnowledgeCoverage'],
                  })}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#17191c] px-3 text-sm text-slate-100 outline-none focus:border-orange-400/50"
                >
                  <option value="none">Nao bloquear por cobertura</option>
                  <option value="low">Baixa</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>
            </div>

            <div className="space-y-3 border-t border-orange-500/15 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Colecoes permitidas</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  Se nenhuma estiver marcada, o bloco consulta todas as colecoes.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {knowledgeCollections.map((collection) => {
                  const selected = selectedKnowledgeCollectionIds.includes(collection.id);
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => toggleKnowledgeCollection(collection.id)}
                      aria-pressed={selected}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                        selected
                          ? 'border-orange-400/45 bg-orange-500/15 text-orange-100'
                          : 'border-white/10 bg-[#17191c] text-slate-400 hover:border-orange-500/25 hover:text-slate-200',
                      )}
                    >
                      {collection.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 border-t border-orange-500/15 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Documentos permitidos</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  Se nenhum estiver marcado, todos os documentos das colecoes acima ficam disponiveis.
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <Input
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                  placeholder="Buscar documento"
                  className="h-10 border-white/10 bg-[#17191c] pl-9 text-xs text-slate-100 focus-visible:ring-orange-500/30"
                />
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {visibleKnowledgeDocuments.map((document) => {
                  const selected = selectedKnowledgeDocumentIds.includes(document.id);
                  return (
                    <label
                      key={document.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                        selected
                          ? 'border-orange-400/35 bg-orange-500/10'
                          : 'border-white/10 bg-[#17191c] hover:border-orange-500/20',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleKnowledgeDocument(document.id)}
                        className="mt-0.5 h-4 w-4 accent-orange-500"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-slate-200">{document.name}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {document.tokens || 0} tokens{document.category ? ` · ${document.category}` : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {visibleKnowledgeDocuments.length === 0 && (
                  <p className="rounded-lg border border-white/10 bg-[#17191c] px-3 py-3 text-xs text-slate-500">
                    Nenhum documento encontrado neste escopo.
                  </p>
                )}
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
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {knowledgeAttachment.documentIds.length > 0 ? 'Documentos autorizados' : 'Documentos disponiveis'}
                  </p>
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

        {node.data.kind === 'decision' && (
          <div className="space-y-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Decision de caminhos</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                A IA escolhe uma rota configurada e o fluxo segue para o bloco destino dessa rota.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">Modo</Label>
                <select
                  value={config.switchMode || 'ai'}
                  onChange={(event) => updateConfig({ switchMode: event.target.value as 'ai' | 'rules' })}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#17191c] px-3 text-sm text-slate-100 outline-none focus:border-amber-400/50"
                >
                  <option value="ai">IA</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">Confianca minima</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.confidenceThreshold ?? 0.75}
                  onChange={(event) => updateConfig({
                    confidenceThreshold: Math.max(0, Math.min(1, Number(event.target.value) || 0)),
                  })}
                  className="h-10 border-white/10 bg-[#17191c] text-slate-100 focus-visible:ring-amber-500/30"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Rota fallback</Label>
              <select
                value={config.fallbackRouteId || switchRoutes.at(-1)?.id || ''}
                onChange={(event) => updateConfig({ fallbackRouteId: event.target.value })}
                className="h-10 w-full rounded-md border border-white/10 bg-[#17191c] px-3 text-sm text-slate-100 outline-none focus:border-amber-400/50"
              >
                {switchRoutes.map((route) => (
                  <option key={route.id} value={route.id}>{route.label || route.id}</option>
                ))}
              </select>
            </div>

            <div className="space-y-3 border-t border-amber-500/15 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rotas</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">Cada rota representa uma saida possivel do Decision.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addSwitchRoute}
                  className="h-9 border-amber-500/25 bg-amber-500/[0.06] px-3 text-amber-300 hover:bg-amber-500/15 hover:text-amber-200"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Rota
                </Button>
              </div>

              {switchRoutes.map((route, index) => (
                <div key={route.id} className="space-y-2 rounded-xl border border-white/10 bg-[#17191c] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rota {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => deleteSwitchRoute(route.id)}
                      className="text-slate-500 hover:text-red-300"
                      aria-label={`Excluir rota ${route.label || route.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-[0.85fr_1fr] gap-2">
                    <Input
                      value={route.id}
                      onChange={(event) => updateSwitchRoute(route.id, { id: normalizeVariableName(event.target.value) || route.id })}
                      placeholder="alterar_wifi"
                      className="h-10 border-white/10 bg-[#111316] font-mono text-xs text-slate-100 focus-visible:ring-amber-500/30"
                    />
                    <Input
                      value={route.label}
                      onChange={(event) => updateSwitchRoute(route.id, { label: event.target.value })}
                      placeholder="Alterar nome/senha"
                      className="h-10 border-white/10 bg-[#111316] text-slate-100 focus-visible:ring-amber-500/30"
                    />
                  </div>
                  <Textarea
                    value={route.description}
                    onChange={(event) => updateSwitchRoute(route.id, { description: event.target.value })}
                    placeholder="Quando usar esta rota?"
                    className="min-h-[74px] resize-none border-white/10 bg-[#111316] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-amber-500/30"
                  />
                  <Textarea
                    value={(route.examples || []).join('\n')}
                    onChange={(event) => updateSwitchRoute(route.id, {
                      examples: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                    })}
                    placeholder="Exemplos, um por linha"
                    className="min-h-[74px] resize-none border-white/10 bg-[#111316] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-amber-500/30"
                  />
                  <Input
                    value={(route.requiredSlots || []).join(', ')}
                    onChange={(event) => updateSwitchRoute(route.id, {
                      requiredSlots: event.target.value.split(',').map((slot) => normalizeVariableName(slot)).filter(Boolean),
                    })}
                    placeholder="Slots obrigatorios: wifi_ssid, wifi_password"
                    className="h-10 border-white/10 bg-[#111316] text-slate-100 focus-visible:ring-amber-500/30"
                  />
                  <select
                    value={route.targetNodeId || ''}
                    onChange={(event) => updateSwitchRoute(route.id, { targetNodeId: event.target.value || undefined })}
                    className="h-10 w-full rounded-md border border-white/10 bg-[#111316] px-3 text-sm text-slate-100 outline-none focus:border-amber-400/50"
                  >
                    <option value="">Destino ainda nao definido</option>
                    {flowNodes
                      .filter((candidate) => candidate.id !== node.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.data.title} ({candidate.data.kind})
                        </option>
                      ))}
                  </select>
                </div>
              ))}

              {switchRoutes.length === 0 && (
                <p className="rounded-lg border border-white/10 bg-[#17191c] px-3 py-3 text-xs text-slate-500">
                  Nenhuma rota configurada. Adicione pelo menos duas rotas antes de publicar.
                </p>
              )}
            </div>
          </div>
        )}

        {(node.data.kind === 'decision' || node.data.kind === 'sub_agent' || node.data.kind === 'knowledge' || node.data.kind === 'tool' || node.data.kind === 'start') && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">
              {node.data.kind === 'tool'
                ? 'Instrucao para montar o payload'
                : node.data.kind === 'decision'
                  ? 'Objetivo do decisor'
                : node.data.kind === 'sub_agent'
                  ? isPrimaryAgentNode(node) ? 'System prompt do agente principal' : 'System prompt do sub-agente'
                  : 'Instrucao'}
            </Label>
            <HighlightedReferenceTextarea
              value={config.instructions || ''}
              onChange={(value) => updateConfig({ instructions: value })}
              placeholder="Defina o comportamento deste passo..."
              knownReferenceIds={knownReferenceIds}
              className="min-h-[118px] border-white/10 bg-[#17191c] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-sky-500/30"
            />
            {node.data.kind === 'tool' && (
              <p className="text-[11px] leading-4 text-slate-500">
                Esta instrucao sera enviada para a IA junto do schema da tool quando este bloco estiver conectado ao agente ativo. O servidor ainda valida o JSON antes de executar.
              </p>
            )}
          </div>
        )}

        {(node.data.kind === 'message' || node.data.kind === 'collect' || node.data.kind === 'sub_agent' || node.data.kind === 'handoff' || node.data.kind === 'end') && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">
              {node.data.kind === 'message'
                ? 'Mensagem fixa ao cliente'
                : node.data.kind === 'collect'
                  ? 'Introducao da coleta'
                : node.data.kind === 'sub_agent'
                  ? isPrimaryAgentNode(node) ? 'Composicao do agente principal' : 'Instrucao de composicao do sub-agente'
                  : 'Mensagem ao cliente'}
            </Label>
            <HighlightedReferenceTextarea
              value={config.message || ''}
              onChange={(value) => updateConfig({ message: value })}
              placeholder="Digite a mensagem ou insira variaveis..."
              knownReferenceIds={knownReferenceIds}
              className="min-h-[126px] border-white/10 bg-[#17191c] text-sm text-slate-100 placeholder:text-slate-600 focus-visible:ring-sky-500/30"
            />
            {node.data.kind === 'collect' && (
              <p className="text-[11px] leading-4 text-slate-500">
                Esta coleta pode ser conduzida pela IA sem repetir dados ja informados.
              </p>
            )}
          </div>
        )}

        {node.data.kind === 'collect' && (
          <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Campos para coletar</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Escolha se a coleta sera enviada como mensagem fixa ou conduzida pela IA durante a conversa.
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
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Tentativas antes do fallback</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={config.maxAttempts ?? 2}
                onChange={(event) => updateConfig({
                  maxAttempts: Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                })}
                className="h-10 border-white/10 bg-[#17191c] text-slate-100 focus-visible:ring-emerald-500/30"
              />
            </div>
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
                <div className="grid grid-cols-[1fr_0.9fr] gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-slate-400">Chave da variavel</Label>
                    <Input
                      value={field.fieldKey || ''}
                      onChange={(event) => updateConfig({
                        formFields: (config.formFields || []).map((item) => (
                          item.id === field.id ? { ...item, fieldKey: normalizeVariableName(event.target.value) } : item
                        )),
                      })}
                      placeholder="nome_completo"
                      className="h-10 border-white/10 bg-[#111316] font-mono text-xs text-slate-100 focus-visible:ring-emerald-500/30"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-slate-400">Tipo do dado</Label>
                    <select
                      value={field.type || 'text'}
                      onChange={(event) => updateConfig({
                        formFields: (config.formFields || []).map((item) => (
                          item.id === field.id
                            ? { ...item, type: event.target.value as AutopilotFlowFormField['type'] }
                            : item
                        )),
                      })}
                      className="h-10 w-full rounded-md border border-white/10 bg-[#111316] px-3 text-xs text-slate-100 outline-none focus:border-emerald-400/50"
                    >
                      <option value="text">Texto</option>
                      <option value="name">Nome</option>
                      <option value="phone">Telefone</option>
                      <option value="email">E-mail</option>
                      <option value="document">Documento</option>
                      <option value="date">Data</option>
                      <option value="time">Horario</option>
                      <option value="address">Endereco</option>
                      <option value="number">Numero</option>
                      <option value="boolean">Sim/nao</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-slate-400">Outros nomes aceitos</Label>
                  <Input
                    key={`${field.id}-aliases`}
                    defaultValue={(field.aliases || []).join(', ')}
                    onBlur={(event) => updateConfig({
                      formFields: (config.formFields || []).map((item) => (
                        item.id === field.id
                          ? {
                              ...item,
                              aliases: event.target.value
                                .split(',')
                                .map((alias) => alias.trim())
                                .filter(Boolean),
                            }
                          : item
                      )),
                    })}
                    placeholder="nome, nome do cliente"
                    className="h-10 border-white/10 bg-[#111316] text-xs text-slate-100 focus-visible:ring-emerald-500/30"
                  />
                </div>
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
                      type: 'text',
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

        {node.data.kind === 'sub_agent' && !isPrimaryAgentNode(node) && (
          <label className="flex items-center justify-between rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] px-3 py-3">
            <span>
              <span className="block text-sm text-slate-200">Voltar ao fluxo principal</span>
              <span className="block text-[11px] text-slate-500">Depois da resposta do especialista</span>
            </span>
            <Switch
              checked={config.returnToMainPrompt === true}
              onCheckedChange={(checked) => updateConfig({ returnToMainPrompt: checked })}
            />
          </label>
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
  onRouteChange,
}: {
  edge: Edge;
  nodes: AttendantNode[];
  onClose: () => void;
  onDelete: () => void;
  onRouteChange: (routeId: string) => void;
}) {
  const sourceNode = nodes.find((node) => node.id === selectedEdge.source);
  const targetNode = nodes.find((node) => node.id === selectedEdge.target);
  const source = sourceNode?.data.title || selectedEdge.source;
  const target = targetNode?.data.title || selectedEdge.target;
  const switchRoutes = sourceNode?.data.kind === 'decision' ? sourceNode.data.config?.routes || [] : [];
  const selectedRouteId = typeof selectedEdge.data?.routeId === 'string'
    ? selectedEdge.data.routeId
    : switchRoutes.find((route) => route.targetNodeId === selectedEdge.target)?.id || '';
  const connectionType = (
    typeof selectedEdge.data?.connectionType === 'string'
      ? selectedEdge.data.connectionType
      : 'main'
  ) as WorkflowConnectionType;
  const connectionMeta = CONNECTION_TYPE_META[connectionType];

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
        <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-[#17191c] px-4 py-3">
          <span className="text-xs text-slate-500">Tipo da conexão</span>
          <span
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-200"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: connectionMeta.color }} />
            {connectionMeta.label}
          </span>
        </div>
        {switchRoutes.length > 0 && (
          <div className="mt-4 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
            <Label className="text-xs text-amber-200">Rota desta conexao</Label>
            <select
              value={selectedRouteId}
              onChange={(event) => onRouteChange(event.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-[#17191c] px-3 text-sm text-slate-100 outline-none focus:border-amber-400/50"
            >
              <option value="">Sem rota vinculada</option>
              {switchRoutes.map((route) => (
                <option key={route.id} value={route.id}>{route.label || route.id}</option>
              ))}
            </select>
            <p className="text-[11px] leading-4 text-slate-500">
              Quando esta rota for escolhida, o runtime usa este bloco como destino do caminho.
            </p>
          </div>
        )}
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

function publishGateTone(audit: AutopilotFlowAuditResult) {
  if (audit.status === 'failed') {
    return {
      label: 'Bloqueado',
      className: 'border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/15',
      icon: XCircle,
    };
  }
  if (audit.issues.some((issue) => issue.severity === 'warning') || audit.simulations.some((simulation) => simulation.status === 'warning')) {
    return {
      label: 'Com avisos',
      className: 'border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15',
      icon: AlertTriangle,
    };
  }
  return {
    label: 'Aprovado',
    className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15',
    icon: ShieldCheck,
  };
}

function ConnectionLegend() {
  const visibleTypes: WorkflowConnectionType[] = [
    'main',
    'model',
    'tool',
    'agent_tool',
    'memory',
    'knowledge',
    'guardrail',
    'error',
    'event',
  ];
  return (
    <div className="pointer-events-none absolute left-7 top-[102px] z-10 hidden max-w-[620px] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-[#15181b]/90 px-3 py-2 shadow-lg backdrop-blur lg:flex">
      {visibleTypes.map((type) => (
        <span key={type} className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: CONNECTION_TYPE_META[type].color }} />
          {CONNECTION_TYPE_META[type].label}
        </span>
      ))}
    </div>
  );
}

function toolForCoverage(tool: ToolCatalogItem): AgentToolCatalogItem {
  const sideEffect = tool.sideEffect
    || (tool.class === 'read_only' || tool.class === 'compute_only' ? 'none' : tool.riskLevel === 'high' ? 'high' : 'medium');
  return {
    name: tool.name as any,
    version: 'editor',
    description: tool.description,
    class: tool.class as AgentToolCatalogItem['class'],
    riskLevel: tool.riskLevel,
    sideEffect,
    idempotent: tool.idempotent ?? sideEffect === 'none',
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: tool.requiresHumanApproval ?? false,
    customerVisible: true,
    allowedIntents: [],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: tool.source,
    enabledByDefault: false,
    serverId: tool.serverId,
    serverName: tool.serverName,
    inputSchema: tool.inputSchema || null,
    outputSchema: tool.outputSchema || null,
  };
}

function simulationStatusMeta(status: AutopilotFlowSimulationResult['status']) {
  if (status === 'failed') {
    return {
      label: 'Falhou',
      className: 'border-red-500/30 bg-red-500/10 text-red-200',
      icon: XCircle,
    };
  }
  if (status === 'warning') {
    return {
      label: 'Aviso',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
      icon: AlertTriangle,
    };
  }
  if (status === 'skipped') {
    return {
      label: 'Ignorado',
      className: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
      icon: CircleHelp,
    };
  }
  return {
    label: 'Passou',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    icon: CheckCircle2,
  };
}

function PublishGatePanel({
  audit,
  toolCoverage,
  open,
  onToggle,
  onRepairWithAi,
  isRepairing,
}: {
  audit: AutopilotFlowAuditResult;
  toolCoverage: AutopilotToolCoverageReport;
  open: boolean;
  onToggle: () => void;
  onRepairWithAi?: () => void;
  isRepairing?: boolean;
}) {
  const criticalIssues = audit.issues.filter((issue) => issue.severity === 'critical');
  const warningIssues = audit.issues.filter((issue) => issue.severity === 'warning');
  const failedSimulations = audit.simulations.filter((simulation) => simulation.status === 'failed');
  const warningSimulations = audit.simulations.filter((simulation) => simulation.status === 'warning');
  const passedSimulations = audit.simulations.filter((simulation) => simulation.status === 'passed');
  const skippedSimulations = audit.simulations.filter((simulation) => simulation.status === 'skipped');
  const tone = publishGateTone({
    ...audit,
    issues: toolCoverage.status === 'covered'
      ? audit.issues
      : [
        ...audit.issues,
        {
          severity: 'warning',
          code: 'tool_coverage_incomplete',
          message: 'Existem ferramentas habilitadas que nao estao declaradas no fluxo.',
        },
      ],
  });
  const ToneIcon = tone.icon;
  const visibleIssues = [...criticalIssues, ...warningIssues];
  const visibleSimulations = [
    ...failedSimulations,
    ...warningSimulations,
    ...passedSimulations,
    ...skippedSimulations,
  ];
  const canRepairWithAi = criticalIssues.length > 0 || failedSimulations.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        title="Ver gate de publicacao"
        className={cn(
          'pointer-events-auto flex h-[54px] items-center gap-2 rounded-xl border px-4 text-sm shadow-xl backdrop-blur',
          tone.className,
        )}
      >
        <ToneIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Gate</span>
        <span className="rounded-lg bg-black/20 px-2 py-1 text-[11px]">
          {passedSimulations.length}/{audit.simulations.length || 0}
        </span>
      </button>

      {open && (
        <div className="pointer-events-auto absolute bottom-[76px] left-1/2 flex max-h-[calc(100vh_-_132px)] min-h-0 w-[min(720px,calc(100vw_-_2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111417]/98 shadow-2xl backdrop-blur">
          <div className="flex shrink-0 flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide', tone.className)}>
                  <ToneIcon className="h-3.5 w-3.5" />
                  {tone.label}
                </span>
                <span className="text-xs leading-5 text-slate-500">
                  {criticalIssues.length} critico(s), {warningIssues.length + warningSimulations.length + (toolCoverage.status === 'covered' ? 0 : 1)} aviso(s)
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">Gate de publicacao</h3>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">
                Simulacoes deterministicamente geradas para validar rotas, fallback, confirmacao, falha de ferramenta e pedido por humano.
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              {onRepairWithAi && canRepairWithAi && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRepairWithAi}
                  disabled={isRepairing}
                  className="h-9 max-w-full shrink border-purple-500/30 bg-purple-500/10 px-3 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200"
                >
                  {isRepairing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  <span className="truncate">{isRepairing ? 'Corrigindo...' : 'Corrigir erros com IA'}</span>
                </Button>
              )}
              <button type="button" onClick={onToggle} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                <div className="text-[11px] text-emerald-200">Passou</div>
                <div className="mt-1 text-xl font-semibold text-white">{passedSimulations.length}</div>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3">
                <div className="text-[11px] text-red-200">Falhou</div>
                <div className="mt-1 text-xl font-semibold text-white">{failedSimulations.length}</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                <div className="text-[11px] text-amber-200">Avisos</div>
                <div className="mt-1 text-xl font-semibold text-white">{warningSimulations.length + warningIssues.length}</div>
              </div>
              <div className="rounded-xl border border-slate-500/20 bg-slate-500/[0.06] p-3">
                <div className="text-[11px] text-slate-300">Ignorado</div>
                <div className="mt-1 text-xl font-semibold text-white">{skippedSimulations.length}</div>
              </div>
            </div>

            {visibleIssues.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bloqueios e avisos</div>
                {visibleIssues.map((issue) => {
                  const isCritical = issue.severity === 'critical';
                  const IssueIcon = isCritical ? XCircle : AlertTriangle;
                  return (
                    <div key={`${issue.code}-${issue.nodeId || ''}-${issue.routeId || ''}`} className={cn(
                      'flex min-w-0 gap-2 rounded-xl border p-3 text-xs leading-5',
                      isCritical ? 'border-red-500/20 bg-red-500/[0.06] text-red-100' : 'border-amber-500/20 bg-amber-500/[0.06] text-amber-100',
                    )}>
                      <IssueIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{issue.message}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {toolCoverage.status !== 'covered' && (
              <div className="mt-4 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cobertura de ferramentas</div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs leading-5 text-amber-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{Math.round(toolCoverage.coverageRatio * 100)}% coberto para execucao segura</span>
                    <span className="text-amber-200/70">
                      {toolCoverage.attachedEnabledToolNames.length}/{toolCoverage.enabledToolNames.length} declaradas
                    </span>
                  </div>
                  {toolCoverage.safeFallbackToolNames.length > 0 && (
                    <p className="mt-2 break-words text-emerald-200 [overflow-wrap:anywhere]">
                      Fallback read-only: {toolCoverage.safeFallbackToolNames.join(', ')}
                    </p>
                  )}
                  {toolCoverage.branchRequiredToolNames.length > 0 && (
                    <p className="mt-2 break-words text-amber-100 [overflow-wrap:anywhere]">
                      Exigem branch explicito: {toolCoverage.branchRequiredToolNames.join(', ')}
                    </p>
                  )}
                  {toolCoverage.unguardedToolNames.length > 0 && (
                    <p className="mt-2 break-words text-red-200 [overflow-wrap:anywhere]">
                      Sem confirmacao explicita: {toolCoverage.unguardedToolNames.join(', ')}
                    </p>
                  )}
                  {toolCoverage.unknownEnabledToolNames.length > 0 && (
                    <p className="mt-2 break-words text-red-200 [overflow-wrap:anywhere]">
                      Ausentes do catalogo: {toolCoverage.unknownEnabledToolNames.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Simulacoes</div>
              <div className="grid gap-2">
                {visibleSimulations.map((simulation, index) => {
                  const meta = simulationStatusMeta(simulation.status);
                  const SimulationIcon = meta.icon;
                  return (
                    <div key={`${simulation.caseId}-${simulation.nodeId || ''}-${simulation.routeId || ''}-${index}`} className="grid min-w-0 gap-2 rounded-xl border border-white/10 bg-[#17191c] p-3">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <TestTube2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                          <span className="min-w-0 break-words text-xs font-medium leading-5 text-slate-100 [overflow-wrap:anywhere]">{simulation.title}</span>
                        </div>
                        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]', meta.className)}>
                          <SimulationIcon className="h-3 w-3" />
                          {meta.label}
                        </span>
                      </div>
                      <p className="min-w-0 break-words text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">{simulation.message}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
  knowledgeDocuments,
  knowledgeCollections,
  mainSystemPrompt,
  flowGraph,
  onFlowGraphChange,
  onBack,
  onOpenPanel,
  inlinePanel,
  inlinePanelName,
  onSave,
  onPublish,
  onDiscard,
  onGenerateFlowWithAi,
  onApplyAiProposal,
}: AutopilotFlowBuilderProps) {
  const initialGraph = useMemo(
    () => flowGraph ? restoreFlowGraph(flowGraph) : buildInitialGraph(agentName),
    [agentName, flowGraph]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<AttendantNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [systemVariables, setSystemVariables] = useState<AutopilotFlowVariable[]>(initialGraph.variables);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<AttendantNode, Edge> | null>(null);
  const [toolQuery, setToolQuery] = useState('');
  const [isSystemVariablesOpen, setIsSystemVariablesOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isAiBuilderOpen, setIsAiBuilderOpen] = useState(false);
  const [aiBuilderInput, setAiBuilderInput] = useState('');
  const [isGeneratingAiFlow, setIsGeneratingAiFlow] = useState(false);
  const [aiFlowProposal, setAiFlowProposal] = useState<AutopilotFlowAiProposal | null>(null);
  const [aiBuilderError, setAiBuilderError] = useState('');
  const [aiBuilderMessages, setAiBuilderMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: 'Descreva o atendimento que deseja montar. Posso criar um flow novo ou revisar o atual usando as ferramentas disponiveis.',
    },
  ]);
  const [isPublishGateOpen, setIsPublishGateOpen] = useState(false);
  const suppressNextGraphChange = useRef(true);
  const lastSerializedGraph = useRef(JSON.stringify(serializeFlowGraph(initialGraph.nodes, initialGraph.edges, initialGraph.variables)));
  const currentFlowGraph = useMemo(
    () => serializeFlowGraph(nodes, edges, systemVariables),
    [edges, nodes, systemVariables],
  );
  const toolCoverage = useMemo(() => analyzeAutopilotToolCoverage({
    graph: currentFlowGraph,
    enabledToolNames,
    toolCatalog: tools.map(toolForCoverage),
  }), [currentFlowGraph, enabledToolNames, tools]);
  // Debounced audit: avoid running 11 heavy simulations on every micro-change
  const [publishAudit, setPublishAudit] = useState<AutopilotFlowAuditResult>(() => auditAutopilotFlowGraph(currentFlowGraph));
  useEffect(() => {
    const timer = setTimeout(() => {
      setPublishAudit(auditAutopilotFlowGraph(currentFlowGraph));
    }, 500);
    return () => clearTimeout(timer);
  }, [currentFlowGraph]);
  const hasPublishGateBlockers = publishAudit.status === 'failed'
    || isAutopilotToolCoveragePublishBlocked(toolCoverage);

  const [isRepairingGate, setIsRepairingGate] = useState(false);

  const handleRepairWithAi = useCallback(async () => {
    if (!onGenerateFlowWithAi || !onApplyAiProposal) return;
    try {
      setIsRepairingGate(true);
      const repairableIssues = publishAudit.issues.filter((issue) => issue.severity === 'critical');
      const repairableSimulations = publishAudit.simulations.filter((simulation) => simulation.status === 'failed');
      const uncoveredTools = [
        ...toolCoverage.branchRequiredToolNames,
        ...toolCoverage.unknownEnabledToolNames,
      ];
      if (repairableIssues.length === 0 && repairableSimulations.length === 0 && uncoveredTools.length === 0) {
        toast({ title: 'Nao ha erros criticos para corrigir com IA.' });
        return;
      }

      const issues = repairableIssues
        .map((issue, index) => [
          `${index + 1}. ${issue.message}`,
          `   code: ${issue.code}`,
          issue.nodeId ? `   nodeId afetado: ${issue.nodeId}` : null,
          issue.routeId ? `   routeId afetado: ${issue.routeId}` : null,
        ].filter(Boolean).join('\n'))
        .join('\n');
      const simulations = repairableSimulations
        .map((simulation, index) => [
          `${index + 1}. ${simulation.title}: ${simulation.message}`,
          `   caseId: ${simulation.caseId}`,
          simulation.nodeId ? `   nodeId afetado: ${simulation.nodeId}` : null,
          simulation.routeId ? `   routeId afetado: ${simulation.routeId}` : null,
        ].filter(Boolean).join('\n'))
        .join('\n');
      const repairPrompt = [
        'Modo patch cirurgico do Gate de Validacao.',
        'Corrija somente os erros criticos e as simulacoes falhas listados abaixo.',
        'Nao redesenhe, reordene ou reescreva o fluxo inteiro.',
        'Preserve textos, IDs, posicoes, variaveis, rotas, ferramentas e conhecimento que nao estejam diretamente ligados aos itens listados.',
        'Nao altere simulacoes que ja passaram e nao corrija avisos que nao bloqueiam publicacao.',
        'Se precisar criar no ou aresta, crie apenas o minimo necessario para resolver o item afetado.',
        '',
        'Erros criticos:',
        issues || '- Nenhum erro critico estrutural.',
        '',
        'Simulacoes falhas:',
        simulations || '- Nenhuma simulacao falha.',
        '',
        'Ferramentas habilitadas sem branch seguro:',
        uncoveredTools.length > 0 ? uncoveredTools.map((toolName) => `- ${toolName}`).join('\n') : '- Nenhuma.',
      ].join('\n');
      
      const { proposal, error } = await onGenerateFlowWithAi({
        conversation: [{ role: 'user', content: repairPrompt }],
        currentGraph: currentFlowGraph,
        currentSystemPrompt: mainSystemPrompt,
        knowledgeDocuments,
        knowledgeCollections,
      });
      if (error || !proposal) {
        throw new Error(error || 'Falha ao gerar proposta de reparo');
      }
      onApplyAiProposal(proposal);
      toast({ title: 'Reparo com IA concluído! O fluxo foi atualizado.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Falha ao tentar reparar o fluxo usando IA.', variant: 'destructive' });
    } finally {
      setIsRepairingGate(false);
    }
  }, [publishAudit, toolCoverage, currentFlowGraph, knowledgeCollections, knowledgeDocuments, mainSystemPrompt, onGenerateFlowWithAi, onApplyAiProposal]);

  useEffect(() => {
    const currentSignature = JSON.stringify(currentFlowGraph);
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
    const nextTitle = agentName || 'Agente principal';
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.data.kind !== 'sub_agent' || !isPrimaryAgentNode(node) || node.data.title === nextTitle) return node;
        changed = true;
        return { ...node, data: { ...node.data, title: nextTitle } };
      });
      return changed ? next : current;
    });
  }, [agentName, setNodes]);

  // Debounced propagation to parent: avoids dozens of onFlowGraphChange calls during stabilization
  useEffect(() => {
    if (suppressNextGraphChange.current) {
      suppressNextGraphChange.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const nextGraph = currentFlowGraph;
      const nextSignature = JSON.stringify(nextGraph);
      if (lastSerializedGraph.current === nextSignature) return;
      lastSerializedGraph.current = nextSignature;
      onFlowGraphChange(nextGraph);
    }, 300);
    return () => clearTimeout(timer);
  }, [currentFlowGraph, onFlowGraphChange]);

  // Deferred tool-handle adjustment: breaks the synchronous cascade that freezes the UI
  // by deferring the edge/node adjustment to the next idle frame
  useEffect(() => {
    const timer = setTimeout(() => {
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const toolPositions = new Map<string, Position>();
      setEdges((current) => {
        let changed = false;
        const next = current.map((flowEdge) => {
          const source = nodeById.get(flowEdge.source);
          const target = nodeById.get(flowEdge.target);
          if (!source || !target || !isAgentNodeKind(source.data.kind) || target.data.kind !== 'tool') {
            return flowEdge;
          }
          const visual = connectionVisual(source, target);
          if (visual.toolHandlePosition) toolPositions.set(target.id, visual.toolHandlePosition);
          const route = findSwitchRouteForEdge(
            source,
            target.id,
            typeof flowEdge.data?.routeId === 'string' ? flowEdge.data.routeId : undefined,
          );
          const routeData: AttendantEdgeData = {
            connectionType: visual.connectionType,
            ...(route ? { routeId: route.id, routeLabel: route.label } : {}),
          };
          if (
            flowEdge.sourceHandle === visual.sourceHandle &&
            flowEdge.targetHandle === visual.targetHandle &&
            flowEdge.style?.stroke === visual.color &&
            (typeof flowEdge.data?.routeId === 'string' ? flowEdge.data.routeId : undefined) === routeData?.routeId &&
            flowEdge.label === routeData?.routeLabel
          ) {
            return flowEdge;
          }
          changed = true;
          return {
            ...flowEdge,
            sourceHandle: visual.sourceHandle,
            targetHandle: visual.targetHandle,
            data: routeData,
            label: routeData.routeLabel,
            labelStyle: routeData.routeId ? { fill: '#fbbf24', fontSize: 11, fontWeight: 600 } : undefined,
            labelBgStyle: routeData.routeId ? { fill: '#17191c', fillOpacity: 0.92 } : undefined,
            labelBgPadding: routeData.routeId ? SWITCH_EDGE_LABEL_BG_PADDING : undefined,
            labelBgBorderRadius: routeData.routeId ? 6 : undefined,
            markerEnd: { type: MarkerType.ArrowClosed, color: visual.color, width: 16, height: 16 },
            style: { ...flowEdge.style, stroke: visual.color, strokeWidth: 1.6 },
          };
        });
        return changed ? next : current;
      });
      if (toolPositions.size === 0) return;
      setNodes((current) => {
        let changed = false;
        const next = current.map((node) => {
          const nextPosition = toolPositions.get(node.id);
          if (!nextPosition || node.data.toolHandlePosition === nextPosition) return node;
          changed = true;
          return { ...node, data: { ...node.data, toolHandlePosition: nextPosition } };
        });
        return changed ? next : current;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [edges, nodes, setEdges, setNodes]);

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
      const visual = connectionVisual(source, target);
      const routeForConnection = source.data.kind === 'decision'
        ? (
            (source.data.config?.routes || []).find((route) => route.targetNodeId === target.id)
            || (source.data.config?.routes || []).find((route) => !route.targetNodeId)
            || null
          )
        : null;
      if (target.data.kind === 'tool' && visual.toolHandlePosition) {
        setNodes((current) => current.map((node) => (
          node.id === target.id
            ? { ...node, data: { ...node.data, toolHandlePosition: visual.toolHandlePosition } }
            : node
        )));
      }
      if (source.data.kind === 'decision' && routeForConnection && !routeForConnection.targetNodeId) {
        setNodes((current) => current.map((node) => (
          node.id === source.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  config: {
                    ...node.data.config,
                    routes: (node.data.config?.routes || []).map((route) => (
                      route.id === routeForConnection.id ? { ...route, targetNodeId: target.id } : route
                    )),
                  },
                },
              }
            : node
        )));
      }
      setEdges((current) => addEdge({
        ...connection,
        sourceHandle: visual.sourceHandle,
        targetHandle: visual.targetHandle,
        type: 'smoothstep',
        data: {
          connectionType: visual.connectionType,
          ...(routeForConnection
            ? { routeId: routeForConnection.id, routeLabel: routeForConnection.label }
            : {}),
        },
        label: routeForConnection?.label,
        labelStyle: routeForConnection ? { fill: '#fbbf24', fontSize: 11, fontWeight: 600 } : undefined,
        labelBgStyle: routeForConnection ? { fill: '#17191c', fillOpacity: 0.92 } : undefined,
        labelBgPadding: routeForConnection ? SWITCH_EDGE_LABEL_BG_PADDING : undefined,
        labelBgBorderRadius: routeForConnection ? 6 : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: visual.color, width: 16, height: 16 },
        style: { stroke: visual.color, strokeWidth: 1.6 },
      }, current));
    },
    [isValidConnection, nodes, setEdges, setNodes]
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEdge = edges.find((selectedFlowEdge) => selectedFlowEdge.id === selectedEdgeId) || null;
  const selectedKnowledgeAttachment = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== 'knowledge') return null;
    const targetId = edges.find((flowEdge) => flowEdge.source === selectedNode.id)?.target;
    const targetNode = targetId ? nodes.find((node) => node.id === targetId) : null;
    if (!targetNode || !isAgentNodeKind(targetNode.data.kind)) return null;

    const allowedDocumentIds = Array.from(new Set([
      ...(selectedNode.data.config?.knowledgeDocumentIds || []),
      ...(targetNode.data.config?.knowledgeDocumentIds || []),
    ].filter(Boolean)));
    const allowedCollectionIds = Array.from(new Set([
      ...(selectedNode.data.config?.knowledgeCollectionIds || []),
      ...(targetNode.data.config?.knowledgeCollectionIds || []),
    ].filter(Boolean)));
    const allowedSet = new Set(allowedCollectionIds);
    const collectionNames = knowledgeCollections
      .filter((collection) => allowedSet.has(collection.id))
      .map((collection) => collection.name);
    const documentSet = new Set(allowedDocumentIds);
    const scopedDocuments = allowedDocumentIds.length > 0
      ? knowledgeDocuments.filter((document) => documentSet.has(document.id))
      : knowledgeDocuments.filter((document) => {
          const documentCollectionIds = document.collectionIds?.length ? document.collectionIds : ['general'];
          return (allowedCollectionIds.length > 0 ? documentCollectionIds.some((collectionId) => allowedSet.has(collectionId)) : true);
        });

    return {
      targetTitle: targetNode.data.title,
      targetKind: 'sub_agent' as const,
      documentIds: allowedDocumentIds,
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
  const hasVariableConflicts = useMemo(() => nodes.some((node, index) => (
    Boolean(node.data.config?.variableName) &&
    nodes.some((otherNode, otherIndex) => (
      index !== otherIndex && otherNode.data.config?.variableName === node.data.config?.variableName
    ))
  )), [nodes]);
  const hasReferenceConflicts = useMemo(() => nodes.some((node, index) => (
    Boolean(node.data.config?.referenceId) &&
    nodes.some((otherNode, otherIndex) => (
      index !== otherIndex && otherNode.data.config?.referenceId === node.data.config?.referenceId
    ))
  )), [nodes]);
  const knownReferenceIds = useMemo<Set<string>>(() => new Set(
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
  const deleteSelectedSwitchRoute = useCallback((routeId: string) => {
    if (!selectedNodeId) return;
    setEdges((current) => current.filter((flowEdge) => !(
      flowEdge.source === selectedNodeId && flowEdge.data?.routeId === routeId
    )));
  }, [selectedNodeId, setEdges]);
  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges((current) => current.filter((flowEdge) => flowEdge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);
  const updateSelectedEdgeRoute = useCallback((routeId: string) => {
    if (!selectedEdgeId) return;
    const selectedFlowEdge = edges.find((flowEdge) => flowEdge.id === selectedEdgeId);
    if (!selectedFlowEdge) return;
    const sourceNode = nodes.find((node) => node.id === selectedFlowEdge.source);
    if (!sourceNode || sourceNode.data.kind !== 'decision') return;
    const route = routeId
      ? (sourceNode.data.config?.routes || []).find((candidate) => candidate.id === routeId)
      : null;
    const previousRouteId = typeof selectedFlowEdge.data?.routeId === 'string'
      ? selectedFlowEdge.data.routeId
      : '';

    setNodes((current) => current.map((node) => {
      if (node.id !== sourceNode.id) return node;
      return {
        ...node,
        data: {
          ...node.data,
          config: {
            ...node.data.config,
            routes: (node.data.config?.routes || []).map((candidate) => {
              if (route && candidate.id === route.id) {
                return { ...candidate, targetNodeId: selectedFlowEdge.target };
              }
              if (previousRouteId && candidate.id === previousRouteId && candidate.targetNodeId === selectedFlowEdge.target) {
                return { ...candidate, targetNodeId: undefined };
              }
              return candidate;
            }),
          },
        },
      };
    }));

    setEdges((current) => current.map((flowEdge) => {
      if (flowEdge.id !== selectedEdgeId) return flowEdge;
      const existingType = typeof flowEdge.data?.connectionType === 'string'
        ? flowEdge.data.connectionType as WorkflowConnectionType
        : 'main';
      const routeData: AttendantEdgeData = {
        connectionType: existingType,
        ...(route ? { routeId: route.id, routeLabel: route.label } : {}),
      };
      return {
        ...flowEdge,
        data: routeData,
        label: routeData.routeLabel,
        labelStyle: routeData.routeId ? { fill: '#fbbf24', fontSize: 11, fontWeight: 600 } : undefined,
        labelBgStyle: routeData.routeId ? { fill: '#17191c', fillOpacity: 0.92 } : undefined,
        labelBgPadding: routeData.routeId ? SWITCH_EDGE_LABEL_BG_PADDING : undefined,
        labelBgBorderRadius: routeData.routeId ? 6 : undefined,
      };
    }));
  }, [edges, nodes, selectedEdgeId, setEdges, setNodes]);
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
    if (['start', 'message', 'collect', 'decision', 'knowledge', 'sub_agent', 'handoff', 'end'].includes(blockKind)) {
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const timestamp = Date.now();
      const nodeKind = blockKind as Extract<NodeKind, 'start' | 'message' | 'collect' | 'decision' | 'knowledge' | 'sub_agent' | 'handoff' | 'end'>;
      const id = `${nodeKind}-${timestamp}`;
      const defaults: Record<typeof nodeKind, AttendantNode['data']> = {
        start: {
          kind: 'start',
          title: 'Inicio do fluxo',
          subtitle: 'Entrada sequencial',
          config: {
            instructions: 'Inicie a execucao deste fluxo e avance para o primeiro passo conectado.',
            referenceId: `inicio_${timestamp}`,
            variableName: `inicio_${timestamp}`,
          },
        },
        message: {
          kind: 'message',
          title: 'Mensagem',
          subtitle: 'Texto fixo',
          config: {
            message: 'Digite a mensagem que sera enviada ao cliente.',
            referenceId: `mensagem_${timestamp}`,
            variableName: `mensagem_${timestamp}`,
          },
        },
        collect: {
          kind: 'collect',
          title: 'Coletar dados',
          subtitle: 'Slots tipados',
          config: {
            message: 'Para seguir, me informe os dados abaixo:',
            formMode: 'ai',
            maxAttempts: 2,
            referenceId: `coletar_${timestamp}`,
            variableName: `coleta_${timestamp}`,
            formFields: [
              { id: `field-name-${timestamp}`, label: 'Nome completo', fieldKey: 'name', type: 'name', aliases: ['nome'], required: true },
              { id: `field-phone-${timestamp}`, label: 'Telefone com DDD', fieldKey: 'phone', type: 'phone', aliases: ['whatsapp', 'celular'], required: true },
            ],
          },
        },
        decision: {
          kind: 'decision',
          title: 'Decisao',
          subtitle: 'Rotas configuradas',
          config: {
            instructions: 'Escolha somente uma rota configurada. Use fallback quando faltar evidencia.',
            switchMode: 'ai',
            confidenceThreshold: 0.8,
            fallbackRouteId: 'fallback',
            referenceId: `decisao_${timestamp}`,
            variableName: `rota_${timestamp}`,
            routes: [
              {
                id: 'principal',
                label: 'Rota principal',
                description: 'Use quando a mensagem se encaixar no objetivo principal deste fluxo.',
                examples: ['Quero seguir com o atendimento'],
              },
              {
                id: 'fallback',
                label: 'Esclarecer',
                description: 'Use quando nao houver confianca suficiente para escolher outra rota.',
                examples: ['Nao entendi', 'Pode explicar melhor?'],
              },
            ],
          },
        },
        knowledge: {
          kind: 'knowledge',
          title: 'Conhecimento',
          subtitle: 'Consultar base',
          config: {
            instructions: 'Busque chunks relevantes na base antes do sub-agente responder. Entregue apenas contexto recuperado e seguro para o proximo no.',
            message: '{{system.customer_message}}',
            requiredKnowledgeCoverage: 'medium',
            referenceId: `conhecimento_${timestamp}`,
            variableName: `conhecimento_${timestamp}`,
          },
        },
        sub_agent: {
          kind: 'sub_agent',
          title: 'Especialista IA',
          subtitle: 'Sub-agente especialista',
          config: {
            instructions: 'Atue como um especialista desta rota. Use apenas slots confirmados, resultados de tools e chunks de knowledge recuperados. Ao concluir sua resposta, devolva o contexto para o fluxo principal.',
            message: 'Componha uma resposta natural, objetiva e segura para o cliente dentro da sua especialidade.',
            requiredKnowledgeCoverage: 'low',
            useAi: true,
            returnToMainPrompt: true,
            referenceId: `sub_agente_${timestamp}`,
            variableName: `resposta_sub_agente_${timestamp}`,
          },
        },
        handoff: {
          kind: 'handoff',
          title: 'Transferir humano',
          subtitle: 'Escalonamento',
          config: {
            destination: 'Equipe de atendimento',
            message: 'Vou transferir voce para um atendente humano. Aguarde um momento, por favor.',
            referenceId: `transferir_${timestamp}`,
            variableName: `transferencia_${timestamp}`,
          },
        },
        end: {
          kind: 'end',
          title: 'Fim',
          subtitle: 'Encerrar execucao',
          config: {
            message: 'Atendimento concluido. Fico a disposicao se precisar de algo mais.',
            referenceId: `fim_${timestamp}`,
            variableName: `fim_${timestamp}`,
          },
        },
      };
      setNodes((current) => current.concat({
        id,
        type: 'attendant',
        position,
        data: defaults[nodeKind],
      }));
      setSelectedNodeId(id);
      return;
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
            maxAttempts: 3,
            errorHandles: ['error'],
          },
        },
      }));
      setSelectedNodeId(id);
    } catch {
      return;
    }
  }, [agentName, flowInstance, setNodes]);

  const submitAiBuilderMessage = useCallback(async () => {
    const content = aiBuilderInput.trim();
    if (!content || isGeneratingAiFlow) return;
    const conversation = [...aiBuilderMessages, { role: 'user' as const, content }];
    setAiBuilderMessages(conversation);
    setAiBuilderInput('');
    setAiBuilderError('');
    setIsGeneratingAiFlow(true);
    try {
      const result = await onGenerateFlowWithAi({
        conversation,
        currentGraph: currentFlowGraph,
        currentSystemPrompt: mainSystemPrompt,
        knowledgeDocuments,
        knowledgeCollections,
      });
      if (!result.proposal) {
        setAiBuilderError(result.error || 'Nao foi possivel gerar uma proposta de flow.');
        return;
      }
      setAiFlowProposal(result.proposal);
      setAiBuilderMessages((current) => current.concat({
        role: 'assistant',
        content: result.proposal!.summary,
      }));
    } catch (error) {
      setAiBuilderError(error instanceof Error ? error.message : 'Falha ao gerar flow com IA.');
    } finally {
      setIsGeneratingAiFlow(false);
    }
  }, [
    aiBuilderInput,
    aiBuilderMessages,
    currentFlowGraph,
    isGeneratingAiFlow,
    knowledgeCollections,
    knowledgeDocuments,
    mainSystemPrompt,
    onGenerateFlowWithAi,
  ]);

  const organizeLayout = useCallback(() => {
    setNodes((currentNodes) => {
      const organized = autoLayoutNodesStable(currentNodes, edges);
      return organized;
    });
    requestAnimationFrame(() => {
      flowInstance?.fitView({ padding: 0.25, maxZoom: 1, duration: 400 });
    });
  }, [edges, flowInstance, setNodes]);

  const applyAiFlowProposal = useCallback(() => {
    if (!aiFlowProposal) return;
    const restored = restoreFlowGraph(aiFlowProposal.flowGraph);
    const organizedNodes = autoLayoutNodesStable(restored.nodes, restored.edges);
    suppressNextGraphChange.current = true;
    setNodes(organizedNodes);
    setEdges(restored.edges);
    setSystemVariables(restored.variables);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    onApplyAiProposal(aiFlowProposal);
    setIsAiBuilderOpen(false);
    requestAnimationFrame(() => {
      flowInstance?.fitView({ padding: 0.25, maxZoom: 1, duration: 400 });
    });
  }, [aiFlowProposal, flowInstance, onApplyAiProposal, setEdges, setNodes]);

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
              <button
                type="button"
                onClick={() => onOpenPanel('decision')}
                title="Motor auto evolutivo"
                className={cn('flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/5 hover:text-white', inlinePanelName === 'decision' ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400')}
              >
                <BrainCircuit className="h-5 w-5" />
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
            <button
              type="button"
              onClick={() => setIsAiBuilderOpen(true)}
              title="Construir flow com IA"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
            >
              <Sparkles className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={organizeLayout}
              title="Organizar blocos"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
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

        {!inlinePanel && <ConnectionLegend />}

        <footer className="pointer-events-none absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3">
          <Button
            onClick={() => onOpenPanel('playground')}
            className="pointer-events-auto h-[54px] rounded-xl border border-sky-500/35 bg-sky-700/70 px-5 text-white hover:bg-sky-600"
          >
            <Play className="mr-2 h-4 w-4 fill-current" />
            Testar atendimento
          </Button>
          <PublishGatePanel
            audit={publishAudit}
            toolCoverage={toolCoverage}
            open={isPublishGateOpen}
            onToggle={() => setIsPublishGateOpen((open) => !open)}
            onRepairWithAi={handleRepairWithAi}
            isRepairing={isRepairingGate}
          />
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
              disabled={isPublishing || hasVariableConflicts || hasReferenceConflicts || hasPublishGateBlockers || (!hasDraft && !isDirty)}
              onClick={onPublish}
              title={hasPublishGateBlockers ? 'Resolva o gate de publicacao antes de publicar' : 'Publicar rascunho'}
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
            flowNodes={nodes}
            availableNodeVariables={availableNodeVariables}
            systemVariables={systemVariables}
            knowledgeDocuments={knowledgeDocuments}
            knowledgeCollections={knowledgeCollections}
            knowledgeAttachment={selectedKnowledgeAttachment}
            knownReferenceIds={knownReferenceIds}
            variableNameConflict={variableNameConflict}
            referenceIdConflict={referenceIdConflict}
            onClose={() => setSelectedNodeId(null)}
            onUpdate={updateSelectedNode}
            onDeleteSwitchRoute={deleteSelectedSwitchRoute}
            onDelete={deleteSelectedNode}
          />
        ) : selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            nodes={nodes}
            onClose={() => setSelectedEdgeId(null)}
            onDelete={deleteSelectedEdge}
            onRouteChange={updateSelectedEdgeRoute}
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
          <Accordion type="multiple" defaultValue={['flow-v2', 'control', 'tools', 'messages']} className="space-y-3">
            <AccordionItem value="flow-v2" className="rounded-xl border border-emerald-500/20 bg-[#111a17] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-emerald-300 hover:no-underline">
                <span className="flex items-center gap-3"><GitBranch className="h-4 w-4" /> Fluxo sequencial v2</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                <FlowV2BlockButton kind="start" title="Start" subtitle="Entrada do fluxo" icon={<Play className="h-4 w-4" />} tone="bg-blue-500/15 text-blue-300" />
                <FlowV2BlockButton kind="message" title="Message" subtitle="Texto fixo" icon={<MessageSquareText className="h-4 w-4" />} tone="bg-sky-500/15 text-sky-300" />
                <FlowV2BlockButton kind="collect" title="Collect" subtitle="Slots tipados" icon={<ClipboardList className="h-4 w-4" />} tone="bg-emerald-500/15 text-emerald-300" />
                <FlowV2BlockButton kind="decision" title="Decision" subtitle="Rotas com fallback" icon={<GitBranch className="h-4 w-4" />} tone="bg-amber-500/15 text-amber-300" />
                <FlowV2BlockButton kind="knowledge" title="Knowledge" subtitle="Busca RAG" icon={<Database className="h-4 w-4" />} tone="bg-orange-500/15 text-orange-300" />
                <FlowV2BlockButton kind="handoff" title="Handoff" subtitle="Humano" icon={<UserRound className="h-4 w-4" />} tone="bg-violet-500/15 text-violet-300" />
                <FlowV2BlockButton kind="end" title="End" subtitle="Fim da execucao" icon={<CheckCircle2 className="h-4 w-4" />} tone="bg-emerald-500/15 text-emerald-300" />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="control" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                <span className="flex items-center gap-3"><Settings2 className="h-4 w-4" /> Controle do agente</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
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
                <p className="px-2 py-2 text-xs leading-5 text-slate-500">
                  Use os blocos V2 Message e Collect no grupo Fluxo sequencial v2.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="routing" className="rounded-xl border border-white/[0.08] bg-[#15171a] px-4">
              <AccordionTrigger className="py-4 text-sm font-medium text-slate-300 hover:no-underline">
                <span className="flex items-center gap-3"><GitBranch className="h-4 w-4" /> Rotas e sub-agentes</span>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/[0.08] pt-3">
                <FlowV2BlockButton kind="sub_agent" title="Especialista IA" subtitle="Sub-agente com prompt proprio" icon={<Bot className="h-4 w-4" />} tone="bg-cyan-500/15 text-cyan-300" />
                <p className="px-2 py-2 text-xs leading-5 text-slate-500">
                  O agente principal ja fica no canvas. Use especialistas para rotas especificas.
                </p>
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
                <p className="px-2 py-2 text-xs leading-5 text-slate-500">
                  Novos flows usam somente blocos V2. Habilidades legadas ficam disponiveis apenas nas configuracoes.
                </p>
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
      <Dialog open={isAiBuilderOpen} onOpenChange={setIsAiBuilderOpen}>
        <DialogContent className="flex h-[88vh] max-h-[88vh] w-[min(920px,94vw)] max-w-none flex-col overflow-hidden rounded-[26px] border-white/10 bg-[#111316] p-0 text-slate-100 shadow-2xl">
          <DialogHeader className="border-b border-white/10 bg-violet-500/[0.04] px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-violet-300" />
              Construtor de flow com IA
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Descreva o atendimento. A IA pode montar blocos, associar tools reais, escrever instrucoes de payload e revisar o prompt system.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-h-0 flex-col border-r border-white/10">
              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {aiBuilderMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={cn(
                      'max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6',
                      message.role === 'user'
                        ? 'ml-auto bg-violet-500/15 text-violet-100'
                        : 'border border-white/10 bg-white/[0.04] text-slate-300'
                    )}
                  >
                    {message.content}
                  </div>
                ))}
                {isGeneratingAiFlow && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                    Projetando o flow e validando ferramentas...
                  </div>
                )}
                {aiBuilderError && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {aiBuilderError}
                  </div>
                )}
              </div>
              <div className="border-t border-white/10 p-4">
                <div className="flex gap-2">
                  <Textarea
                    value={aiBuilderInput}
                    onChange={(event) => setAiBuilderInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void submitAiBuilderMessage();
                      }
                    }}
                    placeholder="Ex.: monte um atendimento comercial com coleta de dados, consulta de contratos somente quando necessario e transferencia para vendas ao final..."
                    className="min-h-[92px] resize-none border-white/10 bg-[#17191c] text-slate-100 placeholder:text-slate-600 focus-visible:ring-violet-500/30"
                  />
                  <Button
                    type="button"
                    onClick={() => void submitAiBuilderMessage()}
                    disabled={!aiBuilderInput.trim() || isGeneratingAiFlow}
                    className="h-[92px] w-14 shrink-0 bg-violet-600 text-white hover:bg-violet-500"
                  >
                    {isGeneratingAiFlow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Enter envia. Shift + Enter quebra linha. A proposta altera somente o rascunho depois da sua confirmacao.</p>
              </div>
            </div>
            <aside className="min-h-0 overflow-y-auto bg-[#0e1012] p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Preview da proposta</p>
              {aiFlowProposal ? (
                <div className="mt-4 space-y-4">
                  <p className="text-sm leading-6 text-slate-300">{aiFlowProposal.summary}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Blocos</p>
                      <p className="mt-1 text-xl font-semibold text-white">{aiFlowProposal.flowGraph.nodes.length}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Tools</p>
                      <p className="mt-1 text-xl font-semibold text-white">{aiFlowProposal.enabledToolNames.length}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tools associadas</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {aiFlowProposal.enabledToolNames.map((toolName) => (
                        <Badge key={toolName} className="border border-violet-500/20 bg-violet-500/10 font-mono text-[10px] text-violet-200">
                          {toolName}
                        </Badge>
                      ))}
                      {aiFlowProposal.enabledToolNames.length === 0 && <span className="text-xs text-slate-500">Nenhuma tool necessaria.</span>}
                    </div>
                  </div>
                  <Button type="button" onClick={applyAiFlowProposal} className="w-full bg-violet-600 text-white hover:bg-violet-500">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Aplicar ao rascunho
                  </Button>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Converse com a IA para receber uma proposta validada. Voce pode pedir ajustes antes de aplicar.
                </p>
              )}
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
