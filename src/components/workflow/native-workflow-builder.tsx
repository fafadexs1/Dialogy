'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Bot,
  Braces,
  BrainCircuit,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  CircleStop,
  Clock,
  Clock3,
  CloudCog,
  Code2,
  ContactRound,
  Copy,
  CornerDownRight,
  Cpu,
  Database,
  DatabaseBackup,
  DatabaseZap,
  Download,
  ExternalLink,
  FileCode2,
  FileImage,
  FileUp,
  GitBranch,
  Globe2,
  Goal,
  History,
  Images,
  KeyRound,
  LayoutGrid,
  LineChart,
  ListChecks,
  ListRestart,
  ListTree,
  Loader2,
  Mail,
  Merge,
  MessageCircleMore,
  MessageSquareText,
  Network,
  NotebookTabs,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  Play,
  PlaySquare,
  PlugZap,
  Plus,
  Puzzle,
  Radio,
  ReceiptText,
  Repeat2,
  Route,
  Save,
  ScanText,
  Search,
  Send,
  Settings2,
  Sheet,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Split,
  Star,
  Tag,
  TableProperties,
  TerminalSquare,
  TestTube2,
  TextCursorInput,
  Timer,
  Trash2,
  UserRound,
  Upload,
  Undo2,
  UsersRound,
  Waypoints,
  Webhook,
  Workflow,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getAiModelRuntimeProvider, type AiModelCatalogEntry } from '@/lib/ai-models';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import type { NexusDialogyResources } from '@/modules/nexus/services/dialogy-resources';
import {
  NATIVE_WORKFLOW_CATEGORY_COLOR,
  NATIVE_WORKFLOW_CONNECTION_META,
  NATIVE_WORKFLOW_SHELL_CLASS,
} from '@/components/workflow/native-workflow-visuals';
import {
  createWorkflowNode,
  getWorkflowNodeManifest,
  listStableWorkflowNodeManifests,
  type WorkflowNodeCategory,
  type WorkflowNodeManifest,
} from '@/services/workflow-runtime/catalog';
import {
  type ConnectionType,
  type ModelConfiguration,
  type WorkflowConnection,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import {
  WorkflowExecutionDebugger,
  type DebugPayload,
} from '@/components/workflow/workflow-execution-debugger';
import {
  deriveWorkflowDebugNodeStates,
  type WorkflowDebugNodeState,
} from '@/components/workflow/workflow-debug-state';
import {
  hasSpecializedWorkflowInspector,
  NativeSpecializedNodeInspector,
} from '@/components/workflow/native-specialized-inspectors';
import { applyWorkflowModelSelection } from '@/components/workflow/native-model-selection';
import { createNativeWorkflowLayout } from '@/components/workflow/native-workflow-layout';
import { getPrimaryWorkflowAgentId } from '@/services/workflow-runtime/model-selection';
import {
  buildNativeAgentToolConfig,
  getNativeAgentToolLabel,
  getNativeAgentToolUnavailableReason,
  getWorkflowToolName,
  groupNativeAgentTools,
  isNativeAgentToolAttachable,
  isNativeAgentToolRecommended,
  nativeAgentToolTestId,
  type NativeAgentToolCatalogItem,
} from '@/services/workflow-runtime/native-agent-tools';
import {
  createPrivateAgentResourceBundle,
  deleteWorkflowNodesAndPrivateAttachments,
  detachWorkflowConnectionsAndPrune,
  pruneOrphanedWorkflowAttachments,
} from '@/services/workflow-runtime/native-agent-attachments';
import {
  NativeWorkflowTestChat,
} from '@/components/workflow/native-workflow-test-chat';
import {
  NativeWorkflowCatalog,
} from '@/components/workflow/native-workflow-catalog';
import type { WorkflowBlockTestFixtures, WorkflowTestExecutionResult } from '@/services/workflow-runtime/types';

type CatalogTool = NativeAgentToolCatalogItem;

const EMPTY_DIALOGY_RESOURCES: NexusDialogyResources = {
  teams: [],
  tags: [],
  members: [],
  systemAgents: [],
  intelligentAgents: [],
  instances: [],
  workflows: [],
};

type FocusedWorkflowRoute = {
  sourceNodeId: string;
  sourcePortId: string;
};

type WorkflowNodeData = {
  workflowNode: WorkflowNode;
  errorCount: number;
  operationalState?: WorkflowDebugNodeState;
  connectedOutputPortIds?: string[];
  focusedOutputPortId?: string;
  showAdvancedRoutes?: boolean;
  onAddNext?: (nodeId: string, sourcePortId: string) => void;
  onFocusRoute?: (nodeId: string, sourcePortId: string) => void;
};

type CanvasNode = Node<WorkflowNodeData, 'workflow'>;
type CanvasEdge = Edge<{ connection: WorkflowConnection }>;

const CONNECTION_META = NATIVE_WORKFLOW_CONNECTION_META;

const DEBUG_STATE_META: Record<WorkflowDebugNodeState, { label: string; color: string; className: string }> = {
  queued: { label: 'Na fila', color: '#94a3b8', className: 'border-slate-400/40 bg-slate-400/15 text-slate-200' },
  thinking: { label: 'Pensando', color: '#89819b', className: 'border-violet-300/25 bg-violet-300/[0.07] text-violet-200' },
  running_tool: { label: 'Executando tool', color: '#9c747b', className: 'border-rose-300/25 bg-rose-300/[0.07] text-rose-200' },
  completed: { label: 'Concluído', color: '#759184', className: 'border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-200' },
  waiting: { label: 'Aguardando', color: '#a18e63', className: 'border-amber-300/25 bg-amber-300/[0.07] text-amber-200' },
  failed: { label: 'Falhou', color: '#a87373', className: 'border-red-300/25 bg-red-300/[0.07] text-red-200' },
};

const CATEGORY_META: Record<WorkflowNodeCategory, { label: string; icon: typeof Bot }> = {
  triggers: { label: 'Entradas', icon: Play },
  interaction: { label: 'Interação', icon: ListChecks },
  data: { label: 'Dados', icon: Braces },
  logic: { label: 'Lógica', icon: GitBranch },
  ai: { label: 'Inteligência', icon: Sparkles },
  knowledge_memory: { label: 'Conhecimento e memória', icon: Database },
  tools: { label: 'Ferramentas', icon: Wrench },
  integrations: { label: 'Integrações', icon: Zap },
  utilities: { label: 'Utilidades', icon: Settings2 },
  output: { label: 'Saídas', icon: Send },
  error: { label: 'Erros', icon: AlertTriangle },
};

const WORKFLOW_ICON_BY_NAME: Record<string, LucideIcon> = {
  Activity,
  BadgeCheck,
  BookOpen,
  Bot,
  Braces,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  CircleStop,
  Clock,
  Clock3,
  CloudCog,
  Code2,
  ContactRound,
  CornerDownRight,
  Cpu,
  Database,
  DatabaseBackup,
  DatabaseZap,
  ExternalLink,
  FileCode2,
  FileImage,
  FileUp,
  GitBranch,
  Globe2,
  Goal,
  History,
  Images,
  ListChecks,
  ListRestart,
  ListTree,
  Mail,
  Merge,
  MessageCircleMore,
  MessageSquareText,
  Network,
  NotebookTabs,
  PanelsTopLeft,
  Play,
  PlaySquare,
  PlugZap,
  Puzzle,
  Radio,
  ReceiptText,
  Repeat2,
  Route,
  Save,
  ScanText,
  Send,
  Sheet,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Split,
  Star,
  Tag,
  TableProperties,
  TerminalSquare,
  TextCursorInput,
  Timer,
  UserRound,
  UsersRound,
  Waypoints,
  Webhook,
  Workflow,
  Wrench,
};

export function workflowNodeIcon(type: string): LucideIcon {
  const iconName = getWorkflowNodeManifest(type)?.icon || '';
  return WORKFLOW_ICON_BY_NAME[iconName] || Braces;
}

export function visibleWorkflowOutputPorts(node: WorkflowNode) {
  return node.outputPorts.filter((port) => (
    port.connectionType !== 'error' || node.config.customErrorRoute === true
  ));
}

function portPosition(connectionType: ConnectionType, direction: 'input' | 'output') {
  if (connectionType === 'main' || connectionType === 'event') {
    return direction === 'input' ? Position.Left : Position.Right;
  }
  if (connectionType === 'error') return direction === 'input' ? Position.Top : Position.Bottom;
  return direction === 'input' ? Position.Left : Position.Right;
}

function portOffset(index: number, total: number) {
  if (total <= 1) return '50%';
  return `${Math.round(((index + 1) / (total + 1)) * 100)}%`;
}

function handleStyle(
  ports: WorkflowNode['inputPorts'] | WorkflowNode['outputPorts'],
  portId: string,
  position: Position,
  connectionType: ConnectionType,
) {
  const portsAtPosition = ports.filter((port) => portPosition(port.connectionType, port.direction) === position);
  const index = portsAtPosition.findIndex((port) => port.id === portId);
  const offset = portOffset(Math.max(0, index), portsAtPosition.length);
  const meta = CONNECTION_META[connectionType];
  return {
    ...(position === Position.Left || position === Position.Right ? { top: offset } : { left: offset }),
    backgroundColor: meta.color,
    borderColor: '#9aa8b4',
    boxShadow: '0 0 0 2.5px #ffffff, 0 1px 3px rgba(0,0,0,0.2)',
  };
}

type WorkflowNodeDisplayOption = {
  id: string;
  label: string;
  portId?: string;
};

export type WorkflowNodeDisplayContent = {
  text?: string;
  options: WorkflowNodeDisplayOption[];
};

const DISPLAY_TEXT_CONFIG_KEYS = [
  'message',
  'prompt',
  'caption',
  'publicMessage',
  'template',
  'reason',
] as const;

function readableConfigText(config: WorkflowNode['config']) {
  for (const key of DISPLAY_TEXT_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Builds the read-only preview shown on a workflow card. Keeping this as a pure
 * function makes the card cheap to memoize while nodes are being dragged.
 */
export function workflowNodeDisplayContent(node: WorkflowNode): WorkflowNodeDisplayContent {
  const rawOptions = node.type === 'interaction.options' && Array.isArray(node.config.options)
    ? node.config.options
    : [];
  const mainOutputIds = new Set(
    node.outputPorts
      .filter((port) => port.connectionType === 'main')
      .map((port) => port.id),
  );
  const options = rawOptions.flatMap((rawOption, index) => {
    if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) return [];
    const option = rawOption as Record<string, unknown>;
    const id = String(option.id || option.value || `option_${index + 1}`);
    const label = String(option.label || option.value || `Opção ${index + 1}`).trim();
    if (!label) return [];
    return [{ id, label, portId: mainOutputIds.has(id) ? id : undefined }];
  });

  return {
    text: readableConfigText(node.config),
    options,
  };
}

const WorkflowNodeCard = memo(function WorkflowNodeCard({ data, selected, dragging }: NodeProps<CanvasNode>) {
  const node = data.workflowNode;
  const manifest = getWorkflowNodeManifest(node.type);
  const displayCopy = manifest ? friendlyNodeCopy(manifest) : null;
  const displayContent = workflowNodeDisplayContent(node);
  const hasOptionDisplay = displayContent.options.length > 0;
  const Icon = workflowNodeIcon(node.type);
  const accent = NATIVE_WORKFLOW_CATEGORY_COLOR[manifest?.category || 'data'];
  const debugState = data.operationalState ? DEBUG_STATE_META[data.operationalState] : null;
  const visibleOutputs = visibleWorkflowOutputPorts(node).filter((port) => !['model', 'memory', 'knowledge', 'tool', 'agent_tool', 'guardrail'].includes(port.connectionType));
  const connectedOutputPortIds = new Set(data.connectedOutputPortIds || []);
  const availableNextOutputs = visibleOutputs.filter((port) => (
    ['main', 'error'].includes(port.connectionType)
    && (port.multiple || !connectedOutputPortIds.has(port.id))
  ));
  const totalMainOutputCount = visibleOutputs.filter((port) => port.connectionType === 'main').length;
  const optionOutputPortIds = new Set(
    displayContent.options.flatMap((option) => option.portId ? [option.portId] : []),
  );
  const optionRoutePorts = hasOptionDisplay
    ? visibleOutputs.filter((port) => port.connectionType === 'main')
    : [];
  const optionRoutes = hasOptionDisplay
    ? [
        ...displayContent.options.map((option) => ({
          id: option.id,
          label: option.label,
          port: option.portId
            ? optionRoutePorts.find((port) => port.id === option.portId)
            : undefined,
          fallback: false,
        })),
        ...optionRoutePorts
          .filter((port) => data.showAdvancedRoutes && !optionOutputPortIds.has(port.id))
          .map((port) => ({ id: port.id, label: port.label, port, fallback: true })),
      ]
    : [];
  const genericOutputPorts = hasOptionDisplay
    ? visibleOutputs.filter((port) => port.connectionType !== 'main')
    : visibleOutputs;
  return (
    <div
      className={cn(
        'group relative overflow-visible rounded-[14px] border bg-[#121b23] text-slate-100 transition-colors duration-100',
        hasOptionDisplay ? 'w-[440px]' : displayContent.text ? 'w-[270px]' : 'w-[220px]',
        data.errorCount > 0 && '!border-[#6f6265]',
      )}
      style={{
        borderColor: debugState?.color || (selected ? accent : '#34485a'),
        boxShadow: dragging
          ? 'none'
          : debugState || selected
          ? '0 0 0 1px rgba(203,213,225,.2), 0 8px 18px rgba(0,0,0,.3)'
          : '0 3px 9px rgba(0,0,0,.2)',
        contain: 'layout style',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-4 left-0 w-[3px] rounded-r-full opacity-80"
        style={{ backgroundColor: accent }}
      />
      {node.inputPorts.map((port) => {
        const position = portPosition(port.connectionType, 'input');
        return (
          <Handle
            key={`input-${port.id}`}
            id={`in:${port.id}`}
            type="target"
            position={position}
            title={`${port.label} · ${CONNECTION_META[port.connectionType].label}`}
            aria-label={`Entrada ${port.label}: ${CONNECTION_META[port.connectionType].label}`}
            style={handleStyle(node.inputPorts, port.id, position, port.connectionType)}
            className="!h-3 !w-3 !border-[2px] transition-transform hover:!scale-125 focus-visible:!scale-125"
          />
        );
      })}
      <div className={cn(hasOptionDisplay && 'grid grid-cols-[255px_185px]')}>
        <div className="px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border"
              style={{ color: accent, backgroundColor: `${accent}16`, borderColor: `${accent}35` }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold leading-4 text-slate-50">{node.name}</span>
              <span className="mt-0.5 block truncate text-[8px] font-semibold uppercase tracking-[0.13em]" style={{ color: `${accent}d9` }}>{displayCopy?.label || node.type}</span>
            </span>
            {data.errorCount > 0 ? <Badge title={`${data.errorCount} pendência${data.errorCount === 1 ? '' : 's'} neste bloco`} className="h-5 border-[#80646a]/55 bg-[#80646a]/10 px-1.5 text-[9px] text-slate-300">{data.errorCount}</Badge> : null}
          </div>
          {displayContent.text ? (
            <p
              title={displayContent.text}
              className={cn(
                'mt-2.5 whitespace-pre-line rounded-lg border border-white/[0.055] bg-black/15 px-2.5 py-2 text-[10px] leading-[1.5] text-slate-300',
                !selected && 'line-clamp-5',
              )}
            >
              {displayContent.text}
            </p>
          ) : selected && displayCopy?.description ? (
            <p className="mt-2.5 line-clamp-2 text-[9px] leading-[1.45] text-slate-400">{displayCopy.description}</p>
          ) : null}
          {debugState ? (
            <Badge className={cn('mt-2.5 border text-[8px] uppercase tracking-wide', debugState.className)}>
              {data.operationalState === 'thinking' || data.operationalState === 'running_tool' ? (
                <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              ) : null}
              {debugState.label}
            </Badge>
          ) : null}
        </div>
        {hasOptionDisplay ? (
          <div className="border-l border-white/[0.07] bg-black/[0.08] px-2.5 py-2.5">
            <p className="mb-1.5 px-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-500">Opções</p>
            <div className="space-y-1">
              {optionRoutes.map((route, index) => (
                <div
                  key={`${route.fallback ? 'fallback' : 'option'}-${route.id}-${index}`}
                  role={route.port ? 'button' : undefined}
                  tabIndex={route.port ? 0 : undefined}
                  className={cn(
                    'nodrag nopan relative flex min-h-7 items-center rounded-md border px-2 py-1.5 pr-3 text-[9px] leading-3.5 outline-none transition-colors',
                    route.fallback
                      ? 'border-dashed border-white/[0.07] bg-transparent text-slate-500'
                      : 'border-white/[0.075] bg-white/[0.035] font-medium text-slate-300',
                    route.port && 'cursor-pointer hover:border-violet-300/35 hover:bg-violet-300/[0.075] focus-visible:ring-2 focus-visible:ring-violet-300/45',
                    route.port?.id === data.focusedOutputPortId && '!border-violet-300/55 !bg-violet-300/[0.12] !text-violet-100',
                  )}
                  title={route.fallback ? `Rota alternativa: ${route.label}` : route.label}
                  onClick={(event) => {
                    if (!route.port) return;
                    event.stopPropagation();
                    data.onFocusRoute?.(node.id, route.port.id);
                  }}
                  onKeyDown={(event) => {
                    if (!route.port || !['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    data.onFocusRoute?.(node.id, route.port.id);
                  }}
                >
                  <span className="mr-1 text-[8px] tabular-nums text-slate-600">{route.fallback ? '↳' : `${index + 1}.`}</span>
                  <span className="line-clamp-2">{route.label}</span>
                  {route.port ? (
                    <Handle
                      id={`out:${route.port.id}`}
                      type="source"
                      position={Position.Right}
                      title={`${route.port.label} · ${CONNECTION_META[route.port.connectionType].label}`}
                      aria-label={`Saída ${route.port.label}: ${CONNECTION_META[route.port.connectionType].label}`}
                      style={{
                        right: -16,
                        top: '50%',
                        backgroundColor: CONNECTION_META[route.port.connectionType].color,
                        borderColor: '#9aa8b4',
                        boxShadow: '0 0 0 2.5px #ffffff, 0 1px 3px rgba(0,0,0,0.2)',
                      }}
                      className="!h-3 !w-3 !border-[2px] transition-transform hover:!scale-125 focus-visible:!scale-125"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {!hasOptionDisplay ? <div className="flex min-h-9 items-center border-t border-white/[0.065] px-2.5 py-2">
        {availableNextOutputs.length > 0 ? (
          <div className={cn('grid w-full gap-1', availableNextOutputs.length > 1 && 'grid-cols-2')}>
            {availableNextOutputs.map((port) => (
              <button
                key={port.id}
                type="button"
                className="nodrag nopan flex min-w-0 items-center justify-center gap-1 rounded-md border border-slate-600/70 bg-slate-300/[0.045] px-2 py-1 text-[8px] font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-300/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onAddNext?.(node.id, port.id);
                }}
                title={`Adicionar etapa no caminho ${port.label}`}
              >
                <Plus className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{port.connectionType === 'error'
                  ? 'Se der erro'
                  : totalMainOutputCount > 1
                    ? port.label
                    : availableNextOutputs.length === 1
                      ? 'Próximo passo'
                      : 'Se der certo'}</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="w-full text-center text-[8px] font-medium text-slate-500">
            {visibleOutputs.length === 0 ? (node.outputPorts.length === 0 ? 'Fim deste caminho' : 'Recurso do agente') : 'Próximo passo conectado'}
          </span>
        )}
      </div> : null}
      {genericOutputPorts.map((port) => {
        const position = portPosition(port.connectionType, 'output');
        return (
          <Handle
            key={`output-${port.id}`}
            id={`out:${port.id}`}
            type="source"
            position={position}
            title={`${port.label} · ${CONNECTION_META[port.connectionType].label}`}
            aria-label={`Saída ${port.label}: ${CONNECTION_META[port.connectionType].label}`}
            style={handleStyle(visibleOutputs, port.id, position, port.connectionType)}
            className="!h-3 !w-3 !border-[2px] transition-transform hover:!scale-125 focus-visible:!scale-125"
          />
        );
      })}
    </div>
  );
});

const nodeTypes = { workflow: WorkflowNodeCard };

function canvasNodes(
  definition: WorkflowDefinition,
  issues: ReturnType<typeof validateWorkflowDefinition>['errors'],
  selectedNodeId?: string | null,
  operationalStates: Record<string, WorkflowDebugNodeState> = {},
  onAddNext?: (nodeId: string, sourcePortId: string) => void,
  onFocusRoute?: (nodeId: string, sourcePortId: string) => void,
  focusedRoute?: FocusedWorkflowRoute | null,
  showAdvancedRoutes = false,
): CanvasNode[] {
  const issueCount = new Map<string, number>();
  const connectedOutputPortIds = new Map<string, Set<string>>();
  for (const issue of issues) {
    if (issue.nodeId) issueCount.set(issue.nodeId, (issueCount.get(issue.nodeId) || 0) + 1);
  }
  for (const connection of definition.connections) {
    const connected = connectedOutputPortIds.get(connection.sourceNodeId) || new Set<string>();
    connected.add(connection.sourcePortId);
    connectedOutputPortIds.set(connection.sourceNodeId, connected);
  }
  return definition.nodes.map((workflowNode) => ({
    id: workflowNode.id,
    type: 'workflow',
    position: workflowNode.position,
    selected: workflowNode.id === selectedNodeId,
    data: {
      workflowNode,
      errorCount: issueCount.get(workflowNode.id) || 0,
      operationalState: operationalStates[workflowNode.id],
      connectedOutputPortIds: [...(connectedOutputPortIds.get(workflowNode.id) || [])],
      focusedOutputPortId: focusedRoute?.sourceNodeId === workflowNode.id ? focusedRoute.sourcePortId : undefined,
      showAdvancedRoutes: showAdvancedRoutes && workflowNode.config.customFallbackRoutes === true,
      onAddNext,
      onFocusRoute,
    },
  }));
}

export function canvasEdge(connection: WorkflowConnection): CanvasEdge {
  const meta = CONNECTION_META[connection.connectionType];
  const isMain = connection.connectionType === 'main';
  return {
    id: connection.id,
    source: connection.sourceNodeId,
    target: connection.targetNodeId,
    sourceHandle: `out:${connection.sourcePortId}`,
    targetHandle: `in:${connection.targetPortId}`,
    type: 'smoothstep',
    animated: connection.connectionType === 'event',
    markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 14, height: 14 },
    style: {
      stroke: meta.color,
      strokeWidth: isMain ? 2.25 : 1.75,
      strokeDasharray: meta.dashed ? '6 5' : undefined,
      opacity: 0.95,
    },
    interactionWidth: 20,
    data: { connection },
  };
}

function canvasEdges(definition: WorkflowDefinition): CanvasEdge[] {
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  return definition.connections
    .filter((connection) => (
      connection.connectionType !== 'error'
      || nodeById.get(connection.sourceNodeId)?.config.customErrorRoute === true
    ))
    .map((connection) => canvasEdge(connection));
}

export function traceWorkflowRouteEdgeIds(
  definition: WorkflowDefinition,
  sourceNodeId: string,
  sourcePortId: string,
): Set<string> {
  const executable = definition.connections.filter((connection) => (
    ['main', 'error', 'event'].includes(connection.connectionType)
  ));
  const outgoing = new Map<string, WorkflowConnection[]>();
  for (const connection of executable.filter((candidate) => candidate.connectionType === 'main')) {
    const routes = outgoing.get(connection.sourceNodeId) || [];
    routes.push(connection);
    outgoing.set(connection.sourceNodeId, routes);
  }
  const initial = executable.filter((connection) => (
    connection.sourceNodeId === sourceNodeId && connection.sourcePortId === sourcePortId
  ));
  const traced = new Set<string>();
  const pendingNodeIds: string[] = [];
  for (const connection of initial) {
    traced.add(connection.id);
    pendingNodeIds.push(connection.targetNodeId);
  }
  const visitedNodes = new Set<string>();
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.shift()!;
    if (visitedNodes.has(nodeId)) continue;
    visitedNodes.add(nodeId);
    const nextConnections = outgoing.get(nodeId) || [];
    // A route stays unequivocal only while there is a single normal way out.
    // At the next decision/menu we stop instead of lighting every new branch.
    if (nextConnections.length !== 1) continue;
    const [connection] = nextConnections;
    if (!connection || traced.has(connection.id)) continue;
    traced.add(connection.id);
    pendingNodeIds.push(connection.targetNodeId);
  }
  return traced;
}

export const LARGE_WORKFLOW_NODE_THRESHOLD = 36;

export function initialWorkflowViewportNodeIds(definition: WorkflowDefinition, limit = 8): string[] {
  if (definition.nodes.length === 0 || limit <= 0) return [];
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, WorkflowConnection[]>();
  for (const connection of definition.connections) {
    if (!nodeIds.has(connection.sourceNodeId) || !nodeIds.has(connection.targetNodeId)) continue;
    incoming.set(connection.targetNodeId, (incoming.get(connection.targetNodeId) || 0) + 1);
    const connections = outgoing.get(connection.sourceNodeId) || [];
    connections.push(connection);
    outgoing.set(connection.sourceNodeId, connections);
  }
  const start = definition.nodes.find((node) => node.type.startsWith('trigger.'))
    || definition.nodes.find((node) => (incoming.get(node.id) || 0) === 0)
    || definition.nodes[0];
  const priority: Record<ConnectionType, number> = {
    main: 0,
    event: 1,
    error: 2,
    model: 3,
    memory: 3,
    knowledge: 3,
    tool: 3,
    agent_tool: 3,
    guardrail: 3,
  };
  const queue = [start.id];
  const visited = new Set<string>();
  const result: string[] = [];
  while (queue.length > 0 && result.length < limit) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    result.push(nodeId);
    const next = [...(outgoing.get(nodeId) || [])]
      .sort((left, right) => priority[left.connectionType] - priority[right.connectionType]);
    for (const connection of next) {
      if (!visited.has(connection.targetNodeId)) queue.push(connection.targetNodeId);
    }
  }
  return result;
}

function reconcileCanvasGraph(
  currentNodes: CanvasNode[],
  currentEdges: CanvasEdge[],
  graph: { nodes: WorkflowNode[]; connections: WorkflowConnection[] },
) {
  const workflowNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const connectionIds = new Set(graph.connections.map((connection) => connection.id));
  return {
    nodes: currentNodes
      .filter((node) => workflowNodes.has(node.id))
      .map((node) => ({
        ...node,
        data: { ...node.data, workflowNode: workflowNodes.get(node.id)! },
      })),
    edges: currentEdges.filter((edge) => connectionIds.has(edge.id)),
  };
}

function manifestMatches(manifest: WorkflowNodeManifest, query: string) {
  if (!query) return true;
  const haystack = `${manifest.label} ${manifest.description} ${manifest.type}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

const ESSENTIAL_WORKFLOW_NODE_TYPES = new Set([
  'trigger.received_message',
  'trigger.webhook',
  'trigger.schedule',
  'trigger.manual',
  'interaction.input',
  'interaction.options',
  'interaction.date',
  'interaction.file',
  'interaction.rating',
  'data.set',
  'data.transform',
  'data.extract',
  'data.code',
  'data.log',
  'data.template',
  'logic.if',
  'logic.switch',
  'logic.ai_router',
  'logic.goal_completion',
  'logic.merge',
  'logic.loop',
  'logic.parallel',
  'logic.time_window',
  'logic.wait',
  'logic.goto',
  'integration.http_request',
  'integration.email',
  'integration.google_sheets_append',
  'integration.database',
  'dialogy.crm_update',
  'dialogy.sgp_contract_status',
  'dialogy.sgp_second_copy',
  'dialogy.sgp_payment_promise',
  'dialogy.team_availability',
  'dialogy.chat_tag',
  'whatsapp.group_create',
  'tool.http',
  'tool.database',
  'ai.agent',
  'output.respond',
  'output.media',
  'output.redirect',
  'output.handoff',
  'output.close_conversation',
  'output.end',
  'error.handler',
]);

const FRIENDLY_NODE_COPY: Record<string, { label: string; description: string }> = {
  'trigger.received_message': { label: 'Quando chegar uma mensagem', description: 'Começa o fluxo assim que o cliente enviar uma mensagem.' },
  'trigger.webhook': { label: 'Quando uma integração chamar', description: 'Começa o fluxo quando outro sistema enviar uma solicitação.' },
  'trigger.schedule': { label: 'Em um dia ou horário', description: 'Começa automaticamente no horário configurado.' },
  'trigger.manual': { label: 'Iniciar manualmente', description: 'Começa quando alguém executar o fluxo.' },
  'data.set': { label: 'Guardar informação', description: 'Salva um dado para usar nos próximos passos.' },
  'data.extract': { label: 'Entender informações', description: 'Identifica dados importantes no texto do cliente.' },
  'data.template': { label: 'Montar um texto', description: 'Cria uma mensagem usando dados do atendimento.' },
  'logic.if': { label: 'Criar uma condição', description: 'Divide o caminho entre verdadeiro e falso.' },
  'logic.switch': { label: 'Criar vários caminhos', description: 'Escolhe uma rota entre várias opções definidas.' },
  'logic.ai_router': { label: 'Decidir com IA', description: 'Deixa a IA escolher o caminho mais adequado.' },
  'logic.goal_completion': { label: 'Verificar se concluiu', description: 'Confirma se informações e etapas obrigatórias foram concluídas.' },
  'logic.wait': { label: 'Esperar', description: 'Pausa até um tempo, evento ou nova resposta.' },
  'dialogy.sgp_contract_status': { label: 'Consultar status no SGP', description: 'Seleciona o contrato e separa ativos de suspensos.' },
  'dialogy.sgp_second_copy': { label: 'Entregar segunda via SGP', description: 'Conduz a escolha da fatura e entrega PIX, boleto ou link.' },
  'dialogy.sgp_payment_promise': { label: 'Registrar promessa no SGP', description: 'Seleciona o contrato e tenta a liberação provisória.' },
  'dialogy.team_availability': { label: 'Consultar expediente', description: 'Segue por aberto ou fechado usando o horário da equipe no Dialogy.' },
  'dialogy.chat_tag': { label: 'Aplicar etiqueta', description: 'Atualiza a etiqueta do atendimento atual no próprio Dialogy.' },
  'whatsapp.group_create': { label: 'Criar grupo no WhatsApp', description: 'Cria um grupo na instância autorizada e adiciona participantes.' },
  'ai.agent': { label: 'Atender com IA', description: 'Entende o pedido, conversa e usa as habilidades permitidas.' },
  'output.respond': { label: 'Enviar mensagem', description: 'Responde ao cliente pelo canal atual.' },
  'output.handoff': { label: 'Transferir para uma pessoa', description: 'Entrega o atendimento para a equipe com contexto.' },
  'output.close_conversation': { label: 'Encerrar atendimento', description: 'Fecha o atendimento com motivo e registro.' },
  'output.end': { label: 'Finalizar caminho', description: 'Marca este caminho como concluído.' },
  'error.handler': { label: 'Se algo der errado', description: 'Define o que fazer quando uma etapa falhar.' },
};

function friendlyNodeCopy(manifest: WorkflowNodeManifest) {
  return FRIENDLY_NODE_COPY[manifest.type] || { label: manifest.label, description: manifest.description };
}

function recommendedNodeTypes(
  node: WorkflowNode | null,
  connectionType?: ConnectionType,
  surface: 'agent' | 'standalone' = 'agent',
): string[] {
  if (connectionType === 'error') return ['error.handler'];
  if (!node) return surface === 'standalone'
    ? ['trigger.manual', 'trigger.webhook', 'trigger.schedule', 'trigger.received_message']
    : ['trigger.received_message', 'trigger.webhook', 'trigger.schedule'];
  const category = getWorkflowNodeManifest(node.type)?.category;
  if (category === 'triggers') return surface === 'standalone'
    ? ['data.set', 'logic.if', 'logic.switch', 'output.respond', 'output.end']
    : ['ai.agent', 'logic.if', 'data.set', 'output.respond'];
  if (category === 'ai') return ['output.respond', 'logic.if', 'output.handoff', 'output.close_conversation'];
  if (category === 'logic') return surface === 'standalone'
    ? ['data.set', 'data.transform', 'output.respond', 'output.end']
    : ['ai.agent', 'output.respond', 'output.handoff', 'output.end'];
  if (category === 'output') return ['logic.if', 'output.respond', 'output.end'];
  return surface === 'standalone'
    ? ['logic.if', 'data.transform', 'output.respond', 'output.end']
    : ['ai.agent', 'logic.if', 'output.respond', 'output.end'];
}

function EditableStringList({ id, value, onChange, placeholder, className }: {
  id?: string;
  value: unknown;
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const externalValue = Array.isArray(value) ? value.map(String).join('\n') : '';
  const [draft, setDraft] = useState(externalValue);
  useEffect(() => setDraft(externalValue), [externalValue]);
  const commit = () => {
    const normalized = draft.split('\n').map((item) => item.trim()).filter(Boolean);
    setDraft(normalized.join('\n'));
    onChange(normalized);
  };
  return <Textarea id={id} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} placeholder={placeholder} className={className} />;
}

function WorkflowNameInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const normalized = draft.trim() || value;
    setDraft(normalized);
    if (normalized !== value) onCommit(normalized);
  };
  return (
    <input
      aria-label="Nome do fluxo"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className="mt-0.5 block h-6 max-w-[260px] truncate rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold text-slate-50 outline-none transition hover:border-white/[0.08] hover:bg-white/[0.03] focus:border-slate-500 focus:bg-[#081018]"
    />
  );
}

function InspectorSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-slate-700/55 bg-[#131d26] shadow-[0_8px_20px_rgba(0,0,0,.12)]">
      <div className="border-b border-white/[0.06] px-4 py-3.5"><h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-200">{title}</h3><p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{description}</p></div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

function AgentInspector({
  node, onUpdate, modelOptions, connectedModel, connectedKnowledge, connectedMemory, connectedGuardrail,
  connectedToolNames, tools, toolsLoading, onModelChange, onConfigureKnowledge, onToggleMemory, onToggleGuardrail, onToggleTool,
  onSetTools, onOpenTools, onOpenModels, knowledgeDocumentCount, onDelete,
}: {
  node: WorkflowNode;
  onUpdate: (node: WorkflowNode) => void;
  modelOptions: AiModelCatalogEntry[];
  connectedModel: WorkflowNode | null;
  connectedKnowledge: WorkflowNode | null;
  connectedMemory: WorkflowNode | null;
  connectedGuardrail: WorkflowNode | null;
  connectedToolNames: Set<string>;
  tools: CatalogTool[];
  toolsLoading: boolean;
  onModelChange: (modelId: string) => void;
  onConfigureKnowledge: () => void;
  onToggleMemory: () => void;
  onToggleGuardrail: () => void;
  onToggleTool: (tool: CatalogTool) => void;
  onSetTools: (tools: CatalogTool[]) => void;
  onOpenTools: () => void;
  onOpenModels: () => void;
  knowledgeDocumentCount: number;
  onDelete: () => void;
}) {
  const config = node.config;
  const set = (key: string, value: unknown) => onUpdate({ ...node, config: { ...config, [key]: value } });
  const [toolQuery, setToolQuery] = useState('');
  const normalizedToolQuery = toolQuery.trim().toLocaleLowerCase('pt-BR');
  const visibleTools = tools
    .filter((tool) => isNativeAgentToolAttachable(tool) || connectedToolNames.has(tool.name))
    .filter((tool) => !normalizedToolQuery || `${getNativeAgentToolLabel(tool)} ${tool.name} ${tool.description} ${tool.serverName || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedToolQuery))
    .sort((left, right) => Number(connectedToolNames.has(right.name)) - Number(connectedToolNames.has(left.name)));
  const toolGroups = groupNativeAgentTools(visibleTools);
  const eligibleToolCount = tools.filter(isNativeAgentToolAttachable).length;
  const selectedToolCount = tools.filter((tool) => connectedToolNames.has(tool.name)).length;
  const recommendedTools = tools.filter(isNativeAgentToolRecommended);
  const connectedRetainedTools = tools.filter((tool) => (
    connectedToolNames.has(tool.name) && !isNativeAgentToolAttachable(tool)
  ));
  const selectableOrRetainedToolCount = eligibleToolCount + connectedRetainedTools.length;
  const selectedModel = String(connectedModel?.config.model || '');
  const selectedDocumentCount = Array.isArray(connectedKnowledge?.config.documentIds) ? connectedKnowledge.config.documentIds.length : 0;
  const knowledgeFilters = connectedKnowledge?.config.filters && typeof connectedKnowledge.config.filters === 'object'
    ? connectedKnowledge.config.filters as Record<string, unknown> : {};
  const selectedCollectionCount = Array.isArray(knowledgeFilters.collectionIds) ? knowledgeFilters.collectionIds.length : 0;
  const fieldId = (field: string) => `agent-${node.id}-${field}`;

  return (
    <div className="space-y-4">
      <InspectorSection title="Identidade" description="Defina quem atende e qual responsabilidade este agente possui.">
        <div className="space-y-2"><Label htmlFor={fieldId('role')} className="text-xs text-slate-300">Papel do agente</Label><Input id={fieldId('role')} value={String(config.role || '')} onChange={(event) => set('role', event.target.value)} className="rounded-xl border-slate-700/70 bg-[#0a121a] text-slate-100 shadow-inner placeholder:text-slate-600" placeholder="Ex.: especialista de suporte e retenção" /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('language')} className="text-xs text-slate-300">Idioma</Label><select id={fieldId('language')} value={String(config.language || 'pt-BR')} onChange={(event) => set('language', event.target.value)} className="h-10 w-full rounded-xl border border-slate-700/70 bg-[#0a121a] px-3 text-sm text-slate-200 shadow-inner"><option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option></select></div>
        <div className="space-y-2"><Label htmlFor={fieldId('persona')} className="text-xs text-slate-300">Tom e personalidade</Label><Textarea id={fieldId('persona')} value={String(config.persona || '')} onChange={(event) => set('persona', event.target.value)} className="min-h-28 rounded-xl border-slate-700/70 bg-[#0a121a] text-slate-100 shadow-inner placeholder:text-slate-600" placeholder="Ex.: cordial, objetivo e didático. Não use jargões técnicos." /></div>
      </InspectorSection>

      <InspectorSection title="Recursos da IA" description="Configure aqui o que este agente pode usar. As conexões técnicas são gerenciadas automaticamente.">
        <div className="space-y-2">
          <Label htmlFor={fieldId('model')} className="text-xs text-slate-300">Modelo de IA</Label>
          <select id={fieldId('model')} data-testid="agent-model-select" value={selectedModel} onChange={(event) => onModelChange(event.target.value)} disabled={modelOptions.length === 0} aria-describedby={modelOptions.length === 0 ? fieldId('model-empty') : undefined} className="h-10 w-full rounded-xl border border-slate-700/70 bg-[#0a121a] px-3 text-sm text-slate-200 shadow-inner disabled:cursor-not-allowed disabled:opacity-60">{!selectedModel ? <option value="">Selecione um modelo</option> : null}{selectedModel && !modelOptions.some((model) => model.id === selectedModel) ? <option value={selectedModel}>{selectedModel} (não configurado)</option> : null}{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
          {modelOptions.length === 0 ? <div id={fieldId('model-empty')} role="status" className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-3"><p className="text-xs leading-relaxed text-amber-100">Nenhum modelo com credencial está disponível neste workspace.</p><Button type="button" size="sm" variant="outline" onClick={onOpenModels} className="mt-2 border-amber-300/30 text-amber-100">Configurar modelos</Button></div> : null}
        </div>

        <div className="rounded-xl border border-orange-300/15 bg-orange-300/[0.045] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-200">Base de conhecimento</p><p className="mt-1 text-[11px] leading-relaxed text-slate-400">{connectedKnowledge ? (selectedDocumentCount || selectedCollectionCount ? `${selectedDocumentCount} documento(s) · ${selectedCollectionCount} coleção(ões)` : knowledgeDocumentCount > 0 ? `Todos os ${knowledgeDocumentCount} documento(s)` : 'Nenhum documento cadastrado') : 'Não conectada'}</p></div><Button type="button" size="sm" variant="outline" data-testid="agent-knowledge-configure" onClick={onConfigureKnowledge} className="h-8 border-orange-300/20 bg-orange-300/[0.04] text-xs text-orange-100 hover:bg-orange-300/10">{connectedKnowledge ? 'Configurar' : 'Adicionar'}</Button></div></div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-testid="agent-memory-toggle" aria-pressed={Boolean(connectedMemory)} onClick={onToggleMemory} className={cn('rounded-xl border p-3 text-left transition', connectedMemory ? 'border-slate-500/55 bg-slate-300/[0.055]' : 'border-white/10 bg-white/[0.02]')}><p className="text-xs font-medium text-slate-200">Memória</p><p className="mt-1 text-[10px] text-slate-500">{connectedMemory ? 'Ativa' : 'Desativada'}</p></button>
          <button type="button" data-testid="agent-guardrail-toggle" aria-pressed={Boolean(connectedGuardrail)} onClick={onToggleGuardrail} className={cn('rounded-xl border p-3 text-left transition', connectedGuardrail ? 'border-slate-500/55 bg-slate-300/[0.055]' : 'border-white/10 bg-white/[0.02]')}><p className="text-xs font-medium text-slate-200">Proteções</p><p className="mt-1 text-[10px] text-slate-500">{connectedGuardrail ? 'Ativas' : 'Desativadas'}</p></button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={fieldId('tool-search')}>Ferramentas permitidas</Label>
            <span data-testid="agent-tool-selection-count" aria-live="polite" className="text-xs text-slate-400">{toolsLoading ? 'Carregando catálogo…' : `${selectedToolCount} de ${selectableOrRetainedToolCount} ativas`}</span>
          </div>
          <Input id={fieldId('tool-search')} value={toolQuery} onChange={(event) => setToolQuery(event.target.value)} className="rounded-xl border-slate-700/70 bg-[#0a121a] text-slate-100 shadow-inner placeholder:text-slate-600" placeholder="Buscar por nome, função ou integração" />
          <div className="flex flex-wrap gap-1.5">
            {recommendedTools.length > 0 ? <Button type="button" size="sm" variant="outline" data-testid="agent-tools-select-recommended" onClick={() => onSetTools([...recommendedTools, ...connectedRetainedTools])} disabled={toolsLoading} className="h-7 border-white/10 px-2 text-[10px]">Selecionar recomendadas</Button> : null}
            <Button type="button" size="sm" variant="outline" data-testid="agent-tools-select-all-eligible" onClick={() => onSetTools([...tools.filter(isNativeAgentToolAttachable), ...connectedRetainedTools])} disabled={toolsLoading || eligibleToolCount === 0} className="h-7 border-white/10 px-2 text-[10px]">Todas elegíveis</Button>
            <Button type="button" size="sm" variant="ghost" data-testid="agent-tools-clear" onClick={() => onSetTools([])} disabled={toolsLoading || selectedToolCount === 0} className="h-7 px-2 text-[10px] text-slate-400">Limpar</Button>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-slate-700/55 bg-[#0a121a]/55 p-2">
            {toolsLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-300"><Loader2 className="h-4 w-4 animate-spin text-slate-400" />Carregando todas as ferramentas do workspace…</div>
            ) : toolGroups.map((group) => (
              <section key={group.id} className="space-y-1">
                <div className="px-2 pb-1 pt-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">{group.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{group.description}</p>
                </div>
                {group.tools.map((tool) => {
                  const unavailableReason = getNativeAgentToolUnavailableReason(tool);
                  const selected = connectedToolNames.has(tool.name);
                  return (
                    <label
                      key={tool.name}
                      data-testid={nativeAgentToolTestId(tool.name)}
                      data-tool-name={tool.name}
                      title={unavailableReason || tool.description}
                      className={cn(
                        'flex items-start gap-3 rounded-lg p-2 transition',
                        unavailableReason ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-white/[0.04]',
                        selected && 'bg-white/[0.045]',
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        disabled={Boolean(unavailableReason)}
                        onCheckedChange={() => onToggleTool(tool)}
                        aria-label={`${selected ? 'Desativar' : 'Ativar'} ${getNativeAgentToolLabel(tool)}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-slate-200">{getNativeAgentToolLabel(tool)}</span>
                          <Badge variant="outline" className={cn(
                            'h-4 rounded-full px-1.5 text-[8px] font-medium',
                            tool.riskLevel === 'high' ? 'border-red-400/25 text-red-300' : tool.riskLevel === 'medium' ? 'border-amber-400/25 text-amber-300' : 'border-emerald-400/20 text-emerald-300',
                          )}>{tool.riskLevel === 'high' ? 'alto risco' : tool.riskLevel === 'medium' ? 'atenção' : 'baixo risco'}</Badge>
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-slate-400">{unavailableReason || tool.description}</span>
                        <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{tool.name}</span>
                      </span>
                    </label>
                  );
                })}
              </section>
            ))}
            {!toolsLoading && visibleTools.length === 0 ? (
              <div className="space-y-2 p-3 text-center"><p className="text-xs text-slate-300">{tools.length === 0 ? 'Nenhuma ferramenta configurada neste workspace.' : 'Nenhuma ferramenta corresponde à busca.'}</p>{tools.length === 0 ? <Button type="button" size="sm" variant="outline" onClick={onOpenTools} className="border-white/10">Configurar ferramentas</Button> : null}</div>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-slate-400">Ao ativar, nome, schemas, risco, timeout e permissão são preenchidos automaticamente.</p>
        </div>
      </InspectorSection>

      <InspectorSection title="Comportamento" description="Explique o resultado esperado; cada instrução ou critério deve ocupar uma linha.">
        <div className="space-y-2"><Label htmlFor={fieldId('objective')}>Objetivo principal</Label><Textarea id={fieldId('objective')} value={String(config.objective || '')} onChange={(event) => set('objective', event.target.value)} className="min-h-24" placeholder="Ex.: resolver dúvidas de cobrança e encaminhar exceções ao financeiro." /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('instructions')}>Instruções</Label><EditableStringList id={fieldId('instructions')} value={config.instructions} onChange={(value) => set('instructions', value)} className="min-h-32" placeholder={'Consulte a base antes de responder\nConfirme dados antes de executar ferramentas'} /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('completion')}>Quando considerar concluído</Label><EditableStringList id={fieldId('completion')} value={config.completionCriteria} onChange={(value) => set('completionCriteria', value)} className="min-h-24" placeholder={'Dúvida respondida com fonte válida\nPróximo passo confirmado com o cliente'} /></div>
      </InspectorSection>

      <details className="rounded-[18px] border border-slate-700/55 bg-[#111c27] p-4"><summary className="cursor-pointer text-sm font-medium text-slate-300">Limites avançados</summary><div className="mt-4 grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor={fieldId('max-turns')}>Máx. turnos</Label><Input id={fieldId('max-turns')} type="number" min={1} max={100} value={Number(config.maxTurns || 8)} onChange={(event) => set('maxTurns', Number(event.target.value))} /></div><div className="space-y-2"><Label htmlFor={fieldId('max-tools')}>Máx. ferramentas</Label><Input id={fieldId('max-tools')} type="number" min={0} max={100} value={Number(config.maxToolCalls || 20)} onChange={(event) => set('maxToolCalls', Number(event.target.value))} /></div></div></details>
      <Button type="button" variant="ghost" onClick={onDelete} className="w-full text-red-300 hover:bg-red-500/10 hover:text-red-200"><Trash2 className="mr-2 h-4 w-4" />Excluir este agente</Button>
    </div>
  );
}

function GenericInspector({ node, manifest, onUpdate }: { node: WorkflowNode; manifest: WorkflowNodeManifest; onUpdate: (node: WorkflowNode) => void }) {
  const updateConfig = (path: string, value: unknown) => {
    let next = { ...node, config: { ...node.config, [path]: value } };
    if (node.type === 'logic.ai_router' && path === 'routes' && Array.isArray(value)) {
      const reserved = node.outputPorts.filter((port) => ['default', 'low_confidence', 'error'].includes(port.id));
      const routes = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((route) => ({
          id: String(route.id || ''), label: String(route.label || route.id || ''), direction: 'output' as const,
          connectionType: 'main' as const, required: true, multiple: false,
        })).filter((route) => route.id);
      next = { ...next, outputPorts: [...routes, ...reserved] };
    }
    onUpdate(next);
  };
  return (
    <div className="space-y-5">
      {manifest.editorFields.map((field) => {
        const value = node.config[field.path];
        if (field.control === 'boolean') {
          return <label key={field.path} className="flex items-center justify-between gap-3 text-sm text-slate-300"><span>{field.label}</span><input type="checkbox" checked={value === true} onChange={(event) => updateConfig(field.path, event.target.checked)} /></label>;
        }
        if (field.control === 'json' || field.control === 'string_list') {
          return (
            <div key={`${node.id}-${field.path}-${JSON.stringify(value)}`} className="space-y-2">
              <Label>{field.label}</Label>
              <Textarea
                defaultValue={field.control === 'json' ? JSON.stringify(value ?? {}, null, 2) : Array.isArray(value) ? value.join('\n') : ''}
                onBlur={(event) => {
                  try {
                    updateConfig(field.path, field.control === 'json'
                      ? JSON.parse(event.target.value || '{}')
                      : event.target.value.split('\n').map((item) => item.trim()).filter(Boolean));
                  } catch {
                    toast({ title: 'JSON inválido', description: `Revise o campo ${field.label}.`, variant: 'destructive' });
                  }
                }}
                className="min-h-28 font-mono text-xs"
              />
            </div>
          );
        }
        return (
          <div key={field.path} className="space-y-2">
            <Label>{field.label}</Label>
            <Input
              type={field.control === 'number' ? 'number' : 'text'}
              value={field.control === 'number' ? Number(value || 0) : String(value || '')}
              onChange={(event) => updateConfig(field.path, field.control === 'number' ? Number(event.target.value) : event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

export function NativeWorkflowBuilder({
  definition,
  defaultModel,
  modelOptions,
  knowledgeDocuments,
  knowledgeCollections,
  tools,
  toolsLoading,
  isSaving,
  isPublishing,
  isDirty,
  hasDraft,
  onChange,
  onBack,
  onOpenSettings,
  onOpenModelSettings,
  onOpenPanel,
  onExport,
  onImport,
  onTest,
  onResumeTest,
  onTestNode,
  onSave,
  onPublish,
  activePanelContent,
  surface = 'agent',
  credentialOptions = [],
  dialogyResources = EMPTY_DIALOGY_RESOURCES,
  onManageCredentials,
}: {
  definition: WorkflowDefinition;
  defaultModel: ModelConfiguration;
  modelOptions: AiModelCatalogEntry[];
  knowledgeDocuments: KnowledgeBaseDocument[];
  knowledgeCollections: KnowledgeCollection[];
  tools: CatalogTool[];
  toolsLoading: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  isDirty: boolean;
  hasDraft: boolean;
  onChange: (definition: WorkflowDefinition) => void;
  onBack: () => void;
  onOpenSettings?: () => void;
  onOpenModelSettings?: () => void;
  onOpenPanel?: (panel: 'procedures' | 'knowledge' | 'capabilities' | 'analytics' | 'executions' | 'decision' | 'settings' | 'playground' | 'versions') => void;
  onExport?: () => void;
  onImport?: () => void;
  activePanelContent?: React.ReactNode;
  surface?: 'agent' | 'standalone';
  credentialOptions?: Array<{ id: string; name: string; type: string }>;
  dialogyResources?: NexusDialogyResources;
  onManageCredentials?: () => void;
  onTest?: (payload: { message: string; fixtures?: WorkflowBlockTestFixtures }) => Promise<WorkflowTestExecutionResult | string | null | undefined> | WorkflowTestExecutionResult | string | null | undefined;
  onResumeTest?: (payload: { resumeToken: string; message: string }) => Promise<WorkflowTestExecutionResult | string | null | undefined> | WorkflowTestExecutionResult | string | null | undefined;
  onTestNode?: (
    nodeId: string,
    payload: { message: string; fixtures?: WorkflowBlockTestFixtures },
  ) => Promise<WorkflowTestExecutionResult | string | null | undefined> | WorkflowTestExecutionResult | string | null | undefined;
  onSave: () => void;
  onPublish: () => void;
}) {
  const validation = useMemo(() => validateWorkflowDefinition(definition, {
    availableModelIds: modelOptions.map((model) => model.id),
  }), [definition, modelOptions]);
  const [nodes, setNodes] = useNodesState<CanvasNode>(canvasNodes(definition, validation.errors));
  const [edges, setEdges] = useEdgesState<CanvasEdge>(canvasEdges(definition));
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [editorMode, setEditorMode] = useState<'essential' | 'advanced'>('essential');
  const showAdvancedResources = editorMode === 'advanced';
  const visibleWorkflowNodeCount = useMemo(() => definition.nodes.filter((node) => (
    showAdvancedResources || !getWorkflowNodeManifest(node.type)?.attachment
  )).length, [definition.nodes, showAdvancedResources]);
  const isLargeWorkflow = visibleWorkflowNodeCount > LARGE_WORKFLOW_NODE_THRESHOLD;
  const initialViewportNodeIds = useMemo(() => initialWorkflowViewportNodeIds(definition, isLargeWorkflow ? 4 : 8), [definition, isLargeWorkflow]);
  const initialViewportNodeIdKey = initialViewportNodeIds.join('|');
  const [pendingConnection, setPendingConnection] = useState<{ nodeId: string; sourcePortId: string } | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [focusedRoute, setFocusedRoute] = useState<FocusedWorkflowRoute | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const catalogPanelRef = useRef<HTMLElement | null>(null);
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const panelReturnFocusRef = useRef<HTMLElement | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const initialViewportSignatureRef = useRef<string | null>(null);
  const layoutBeforeOrganizingRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  const [canUndoAutoLayout, setCanUndoAutoLayout] = useState(false);
  const [query, setQuery] = useState('');
  const [debugExecutionId, setDebugExecutionId] = useState<string | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugPayload | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testTarget, setTestTarget] = useState<{ kind: 'workflow' } | { kind: 'node'; nodeId: string } | null>(null);
  const debugNodeStates = useMemo(() => debugSnapshot
    ? deriveWorkflowDebugNodeStates(debugSnapshot.execution, debugSnapshot.events)
    : {}, [debugSnapshot]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    layoutBeforeOrganizingRef.current = null;
    setCanUndoAutoLayout(false);
  }, [definition.id]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 767px)');
    const synchronizePanels = (matches: boolean) => {
      setIsNarrowViewport(matches);
      if (matches) {
        setCatalogOpen(false);
        setInspectorOpen(false);
      }
    };
    synchronizePanels(viewport.matches);
    const handleChange = (event: MediaQueryListEvent) => synchronizePanels(event.matches);
    viewport.addEventListener('change', handleChange);
    return () => viewport.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!flowInstance) return;
    const signature = `${definition.id}:${isNarrowViewport ? 'narrow' : 'wide'}`;
    if (initialViewportSignatureRef.current === signature) return;
    initialViewportSignatureRef.current = signature;
    const frame = window.requestAnimationFrame(() => {
      if (isLargeWorkflow && initialViewportNodeIds.length > 0) {
        void flowInstance.fitView({
          nodes: initialViewportNodeIds.map((id) => ({ id })),
          padding: isNarrowViewport ? 0.2 : 0.5,
          minZoom: isNarrowViewport ? 0.42 : 0.62,
          maxZoom: isNarrowViewport ? 0.72 : 0.92,
          duration: 0,
        });
        return;
      }
      void flowInstance.fitView({
        padding: isNarrowViewport ? 0.12 : 0.24,
        minZoom: isNarrowViewport ? 0.28 : 0.58,
        maxZoom: isNarrowViewport ? 0.68 : 0.94,
        duration: 0,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [definition.id, flowInstance, initialViewportNodeIdKey, initialViewportNodeIds, isLargeWorkflow, isNarrowViewport]);

  const openCatalogPanel = useCallback(() => {
    panelReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCatalogOpen(true);
    if (isNarrowViewport) setInspectorOpen(false);
  }, [isNarrowViewport]);

  const openInspectorPanel = useCallback(() => {
    panelReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspectorOpen(true);
    if (isNarrowViewport) setCatalogOpen(false);
  }, [isNarrowViewport]);

  const requestNextStep = useCallback((nodeId: string, sourcePortId: string) => {
    setSelectedNodeId(nodeId);
    setPendingConnection({ nodeId, sourcePortId });
    setQuery('');
    openCatalogPanel();
  }, [openCatalogPanel]);

  const focusWorkflowRoute = useCallback((sourceNodeId: string, sourcePortId: string) => {
    setFocusedRoute((current) => (
      current?.sourceNodeId === sourceNodeId && current.sourcePortId === sourcePortId
        ? null
        : { sourceNodeId, sourcePortId }
    ));
  }, []);

  useEffect(() => {
    if (!isNarrowViewport || (!catalogOpen && !inspectorOpen)) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setCatalogOpen(false);
      setInspectorOpen(false);
      setPendingConnection(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [catalogOpen, inspectorOpen, isNarrowViewport]);

  useEffect(() => {
    if (!isNarrowViewport) return;
    const panel = catalogOpen ? catalogPanelRef.current : inspectorOpen ? inspectorPanelRef.current : null;
    if (!panel) return;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...panel.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((element) => element.offsetParent !== null);
    window.requestAnimationFrame(() => focusables()[0]?.focus());
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', trapFocus);
    return () => {
      panel.removeEventListener('keydown', trapFocus);
      window.requestAnimationFrame(() => panelReturnFocusRef.current?.focus());
    };
  }, [catalogOpen, inspectorOpen, isNarrowViewport]);
  useEffect(() => {
    setNodes(canvasNodes(
      definition,
      validation.errors,
      selectedNodeId,
      debugNodeStates,
      requestNextStep,
      focusWorkflowRoute,
      focusedRoute,
      editorMode === 'advanced',
    ));
    setEdges(canvasEdges(definition));
  }, [debugNodeStates, definition, editorMode, focusWorkflowRoute, focusedRoute, requestNextStep, selectedNodeId, setEdges, setNodes, validation.errors]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const warnBeforeInternalNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || event.defaultPrevented) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (window.confirm('Existem alterações não salvas. Deseja sair mesmo assim?')) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', warnBeforeInternalNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', warnBeforeInternalNavigation, true);
    };
  }, [isDirty]);

  const handleBack = useCallback(() => {
    if (isDirty && !window.confirm('Existem alterações não salvas. Deseja sair mesmo assim?')) return;
    onBack();
  }, [isDirty, onBack]);

  const commit = useCallback((nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => {
    let nextDefinition: WorkflowDefinition = {
      ...definition,
      nodes: nextNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      connections: nextEdges.map((edge) => edge.data!.connection),
      updatedAt: new Date().toISOString(),
    };
    const primaryAgentId = getPrimaryWorkflowAgentId(nextDefinition);
    if (primaryAgentId && nextDefinition.metadata?.primaryAgentId !== primaryAgentId) {
      nextDefinition = {
        ...nextDefinition,
        metadata: { ...nextDefinition.metadata, primaryAgentId },
      };
    }
    onChange(nextDefinition);
  }, [definition, onChange]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const removedNodeIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    if (removedNodeIds.size === 0) {
      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(changes, currentNodes);
        nodesRef.current = nextNodes;
        return nextNodes;
      });
      return;
    }
    const currentEdges = edgesRef.current;
    const changedNodes = applyNodeChanges(changes, nodesRef.current);
    const lifecycle = deleteWorkflowNodesAndPrivateAttachments({
      nodes: changedNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      connections: currentEdges.map((edge) => edge.data!.connection),
      nodeIds: removedNodeIds,
    });
    const reconciled = reconcileCanvasGraph(changedNodes, currentEdges, lifecycle);
    nodesRef.current = reconciled.nodes;
    edgesRef.current = reconciled.edges;
    setNodes(reconciled.nodes);
    setEdges(reconciled.edges);
    commit(reconciled.nodes, reconciled.edges);
    if (selectedNodeId && removedNodeIds.has(selectedNodeId)) setSelectedNodeId(null);
  }, [commit, selectedNodeId, setEdges, setNodes]);

  const persistNodePosition = useCallback((draggedNode: CanvasNode) => {
    const nextNodes = nodesRef.current.map((node) => node.id === draggedNode.id
      ? { ...node, position: draggedNode.position }
      : node);
    nodesRef.current = nextNodes;
    layoutBeforeOrganizingRef.current = null;
    setCanUndoAutoLayout(false);
    commit(nextNodes, edgesRef.current);
    setDraggedNodeId(null);
  }, [commit]);

  const organizeWorkflow = useCallback(() => {
    if (nodes.length < 2) return;
    const previousPositions = new Map(nodes.map((node) => [node.id, { ...node.position }]));
    const positions = createNativeWorkflowLayout(
      nodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      edges.map((edge) => edge.data!.connection),
    );
    const nextNodes = nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) || node.position,
    }));
    layoutBeforeOrganizingRef.current = previousPositions;
    setCanUndoAutoLayout(true);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    commit(nextNodes, edges);
    window.requestAnimationFrame(() => {
      void flowInstance?.fitView({ padding: 0.2, duration: 260, maxZoom: 0.94 });
    });
    toast({ title: 'Fluxo organizado', description: 'Rotas, ramificações e recursos foram distribuídos automaticamente.' });
  }, [commit, edges, flowInstance, nodes, setNodes]);

  const undoWorkflowOrganization = useCallback(() => {
    const previousPositions = layoutBeforeOrganizingRef.current;
    if (!previousPositions) return;
    const nextNodes = nodes.map((node) => ({
      ...node,
      position: previousPositions.get(node.id) || node.position,
    }));
    layoutBeforeOrganizingRef.current = null;
    setCanUndoAutoLayout(false);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    commit(nextNodes, edges);
    window.requestAnimationFrame(() => {
      void flowInstance?.fitView({ padding: 0.2, duration: 220, maxZoom: 0.94 });
    });
    toast({ title: 'Organização desfeita', description: 'As posições anteriores foram restauradas.' });
  }, [commit, edges, flowInstance, nodes, setNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange<CanvasEdge>[]) => {
    let nextEdges = applyEdgeChanges(changes, edges);
    const removedEdgeIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    let nextNodes = nodes;
    if (removedEdgeIds.size > 0) {
      const lifecycle = detachWorkflowConnectionsAndPrune({
        nodes: nodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
        connections: edges.map((edge) => edge.data!.connection),
        shouldDetach: (connection) => removedEdgeIds.has(connection.id),
      });
      const reconciled = reconcileCanvasGraph(nodes, nextEdges, lifecycle);
      nextNodes = reconciled.nodes;
      nextEdges = reconciled.edges;
      setNodes(nextNodes);
    }
    setEdges(nextEdges);
    if (removedEdgeIds.size > 0) commit(nextNodes, nextEdges);
  }, [commit, edges, nodes, setEdges, setNodes]);

  const onConnect = useCallback((candidate: Connection) => {
    const source = nodes.find((node) => node.id === candidate.source)?.data.workflowNode;
    const target = nodes.find((node) => node.id === candidate.target)?.data.workflowNode;
    const sourcePortId = candidate.sourceHandle?.replace(/^out:/, '') || '';
    const targetPortId = candidate.targetHandle?.replace(/^in:/, '') || '';
    const sourcePort = source?.outputPorts.find((port) => port.id === sourcePortId);
    const targetPort = target?.inputPorts.find((port) => port.id === targetPortId);
    if (!source || !target || !sourcePort || !targetPort || sourcePort.connectionType !== targetPort.connectionType) {
      toast({ title: 'Conexão incompatível', description: 'Use portas do mesmo tipo.', variant: 'destructive' });
      return;
    }
    if (!targetPort.multiple && edges.some((edge) => edge.target === target.id && edge.targetHandle === candidate.targetHandle)) {
      toast({ title: 'Entrada já conectada', description: `${targetPort.label} aceita somente uma conexão.`, variant: 'destructive' });
      return;
    }
    if (!sourcePort.multiple && edges.some((edge) => edge.source === source.id && edge.sourceHandle === candidate.sourceHandle)) {
      toast({ title: 'Saída já conectada', description: `${sourcePort.label} aceita somente uma conexão.`, variant: 'destructive' });
      return;
    }
    const id = `conn_${crypto.randomUUID()}`;
    const connection: WorkflowConnection = {
      id,
      sourceNodeId: source.id,
      sourcePortId,
      targetNodeId: target.id,
      targetPortId,
      connectionType: sourcePort.connectionType,
    };
    const nextEdge = canvasEdge(connection);
    const nextEdges = [...edges, nextEdge];
    setEdges(nextEdges);
    commit(nodes, nextEdges);
  }, [commit, edges, nodes, setEdges]);

  const createAgentDefaults = useCallback((agent: WorkflowNode, position: { x: number; y: number }, currentNodes: CanvasNode[], currentEdges: CanvasEdge[]) => {
    const bundle = createPrivateAgentResourceBundle({ agent, position, model: defaultModel });
    const additionNodes = bundle.nodes.map((workflowNode) => ({ id: workflowNode.id, type: 'workflow' as const, position: workflowNode.position, data: { workflowNode, errorCount: 0 } }));
    const additionEdges = bundle.connections.map((connection) => canvasEdge(connection));
    return { nodes: [...currentNodes, ...additionNodes], edges: [...currentEdges, ...additionEdges] };
  }, [defaultModel]);

  const addCatalogItem = useCallback((input: {
    type?: string;
    tool?: CatalogTool;
    position: { x: number; y: number };
    smartPosition?: boolean;
  }) => {
    const { type, tool, position, smartPosition = false } = input;
    const originNodeId = pendingConnection?.nodeId || selectedNodeId;
    const originCanvasNode = originNodeId ? nodes.find((node) => node.id === originNodeId) : null;
    const originWorkflowNode = originCanvasNode?.data.workflowNode || null;
    const targetManifest = type ? getWorkflowNodeManifest(type) : null;
    const targetIsExecutable = tool ? false : !targetManifest?.attachment;
    const originFlowPorts = originWorkflowNode
      ? visibleWorkflowOutputPorts(originWorkflowNode).filter((port) => ['main', 'error'].includes(port.connectionType))
      : [];
    const preferredSourcePort = originFlowPorts.find((port) => port.id === pendingConnection?.sourcePortId);
    const sourcePort = (preferredSourcePort && (preferredSourcePort.multiple || !edges.some((edge) => (
      edge.source === originWorkflowNode?.id && edge.sourceHandle === `out:${preferredSourcePort.id}`
    ))))
      ? preferredSourcePort
      : originFlowPorts.find((port) => port.connectionType === 'main' && (port.multiple || !edges.some((edge) => (
        edge.source === originWorkflowNode?.id && edge.sourceHandle === `out:${port.id}`
      ))));
    const sourcePortIndex = sourcePort ? originFlowPorts.findIndex((port) => port.id === sourcePort.id) : 0;
    const resolvedPosition = smartPosition && originCanvasNode && targetIsExecutable
      ? {
          x: originCanvasNode.position.x + 300,
          y: originCanvasNode.position.y + (originFlowPorts.length > 1
            ? (sourcePortIndex - ((originFlowPorts.length - 1) / 2)) * 180
            : 0),
        }
      : position;
    let workflowNode: WorkflowNode | null = null;
    if (tool) {
      if (!isNativeAgentToolAttachable(tool)) return;
      workflowNode = createWorkflowNode(tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal', {
        id: `tool_${crypto.randomUUID()}`,
        name: getNativeAgentToolLabel(tool),
        position: resolvedPosition,
        config: buildNativeAgentToolConfig(tool),
      });
    } else if (type) {
      if (!targetManifest || targetManifest.availability !== 'stable') return;
      workflowNode = createWorkflowNode(type, {
        id: `${type.replace('.', '_')}_${crypto.randomUUID()}`,
        position: resolvedPosition,
        config: type === 'ai.agent' ? {
          name: 'Novo agente', role: 'especialista', persona: '', language: 'pt-BR', objective: '',
          instructions: [], completionCriteria: ['Concluir a tarefa com segurança.'], availableContext: ['input', 'context', 'variables'],
        } : {},
      });
    }
    if (!workflowNode) return;
    let nextNodes: CanvasNode[] = [...nodes, { id: workflowNode.id, type: 'workflow', position: resolvedPosition, data: { workflowNode, errorCount: 0 } }];
    let nextEdges = edges;
    if (workflowNode.type === 'ai.agent') {
      const withDefaults = createAgentDefaults(workflowNode, resolvedPosition, nextNodes, nextEdges);
      nextNodes = withDefaults.nodes;
      nextEdges = withDefaults.edges;
    }
    const isExecutableNode = !getWorkflowNodeManifest(workflowNode.type)?.attachment;
    if (originWorkflowNode && isExecutableNode) {
      const targetPort = workflowNode.inputPorts.find((port) => port.connectionType === sourcePort?.connectionType);
      if (sourcePort && targetPort) {
        nextEdges = [...nextEdges, canvasEdge({
          id: `conn_${crypto.randomUUID()}`,
          sourceNodeId: originWorkflowNode.id,
          sourcePortId: sourcePort.id,
          targetNodeId: workflowNode.id,
          targetPortId: targetPort.id,
          connectionType: sourcePort.connectionType,
        })];
      }
    }
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(workflowNode.id);
    setPendingConnection(null);
    setCatalogOpen(false);
    if (getWorkflowNodeManifest(workflowNode.type)?.attachment) setEditorMode('advanced');
    openInspectorPanel();
    commit(nextNodes, nextEdges);
  }, [commit, createAgentDefaults, edges, nodes, openInspectorPanel, pendingConnection, selectedNodeId, setEdges, setNodes]);

  const centerCanvasPosition = useCallback(() => flowInstance
    ? flowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    : { x: 420, y: 260 }, [flowInstance]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/dialogy-workflow-node');
    const toolRaw = event.dataTransfer.getData('application/dialogy-workflow-tool');
    const position = flowInstance
      ? flowInstance.screenToFlowPosition({ x: event.clientX - 110, y: event.clientY - 50 })
      : { x: event.clientX - event.currentTarget.getBoundingClientRect().left - 105, y: event.clientY - event.currentTarget.getBoundingClientRect().top - 50 };
    let tool: CatalogTool | undefined;
    if (toolRaw) {
      try { tool = JSON.parse(toolRaw) as CatalogTool; } catch { return; }
    }
    addCatalogItem({ type: type || undefined, tool, position });
  }, [addCatalogItem, flowInstance]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedWorkflowNode = selectedNode?.data.workflowNode || null;
  const catalogSourcePort = selectedWorkflowNode
    ? selectedWorkflowNode.outputPorts.find((port) => port.id === pendingConnection?.sourcePortId)
      || selectedWorkflowNode.outputPorts.find((port) => (
        port.connectionType === 'main'
        && (port.multiple || !edges.some((edge) => edge.source === selectedWorkflowNode.id && edge.sourceHandle === `out:${port.id}`))
      ))
      || null
    : null;
  const connectedResource = (connectionType: ConnectionType) => {
    if (!selectedWorkflowNode) return null;
    const resourceEdge = edges.find((edge) => (
      edge.target === selectedWorkflowNode.id && edge.data?.connection.connectionType === connectionType
    ));
    return resourceEdge
      ? nodes.find((node) => node.id === resourceEdge.source)?.data.workflowNode || null
      : null;
  };
  const connectedModel = connectedResource('model');
  const connectedKnowledge = connectedResource('knowledge');
  const connectedMemory = connectedResource('memory');
  const connectedGuardrail = connectedResource('guardrail');
  const connectedToolNodes = selectedWorkflowNode
    ? edges
      .filter((edge) => edge.target === selectedWorkflowNode.id && edge.data?.connection.connectionType === 'tool')
      .map((edge) => nodes.find((node) => node.id === edge.source)?.data.workflowNode)
      .filter((node): node is WorkflowNode => Boolean(node))
    : [];
  const connectedToolNames = new Set(connectedToolNodes.map(getWorkflowToolName).filter(Boolean));

  const attachResourceToSelectedAgent = (
    type: 'ai.model' | 'knowledge.rag_retriever' | 'memory.session' | 'guardrail.policy' | 'tool.internal' | 'tool.mcp',
    connectionType: 'model' | 'knowledge' | 'memory' | 'guardrail' | 'tool',
    config: Record<string, unknown> = {},
  ) => {
    if (!selectedNode || selectedWorkflowNode?.type !== 'ai.agent') return null;
    const workflowNode = createWorkflowNode(type, {
      id: `${type.replace('.', '_')}_${crypto.randomUUID()}`,
      name: typeof config.displayName === 'string' ? config.displayName : undefined,
      position: { x: selectedNode.position.x - 320, y: selectedNode.position.y + 120 },
      config,
    });
    const sourcePort = workflowNode.outputPorts.find((port) => port.connectionType === connectionType);
    const targetPort = selectedWorkflowNode.inputPorts.find((port) => port.connectionType === connectionType);
    if (!sourcePort || !targetPort) return null;
    const connection: WorkflowConnection = {
      id: `conn_${crypto.randomUUID()}`,
      sourceNodeId: workflowNode.id,
      sourcePortId: sourcePort.id,
      targetNodeId: selectedWorkflowNode.id,
      targetPortId: targetPort.id,
      connectionType,
    };
    const nextNodes = [...nodes, {
      id: workflowNode.id,
      type: 'workflow' as const,
      position: workflowNode.position,
      data: { workflowNode, errorCount: 0 },
    }];
    const nextEdges = [...edges, canvasEdge(connection)];
    setNodes(nextNodes);
    setEdges(nextEdges);
    commit(nextNodes, nextEdges);
    return workflowNode;
  };

  const detachResourceFromSelectedAgent = (connectionType: 'memory' | 'guardrail') => {
    if (!selectedWorkflowNode) return;
    const lifecycle = detachWorkflowConnectionsAndPrune({
      nodes: nodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      connections: edges.map((edge) => edge.data!.connection),
      shouldDetach: (connection) => (
        connection.targetNodeId === selectedWorkflowNode.id
        && connection.connectionType === connectionType
      ),
    });
    const next = reconcileCanvasGraph(nodes, edges, lifecycle);
    setNodes(next.nodes);
    setEdges(next.edges);
    commit(next.nodes, next.edges);
  };

  const handleAgentModelChange = (modelId: string) => {
    if (!modelId) return;
    if (connectedModel) {
      const updatedModel = applyWorkflowModelSelection(connectedModel, modelId);
      const nextNodes = nodes.map((candidate) => candidate.id === updatedModel.id
        ? { ...candidate, data: { ...candidate.data, workflowNode: updatedModel } }
        : candidate);
      setNodes(nextNodes);
      commit(nextNodes, edges);
      return;
    }
    attachResourceToSelectedAgent('ai.model', 'model', {
      ...defaultModel,
      model: modelId,
      provider: getAiModelRuntimeProvider(modelId),
    });
  };

  const handleConfigureAgentKnowledge = () => {
    const knowledge = connectedKnowledge || attachResourceToSelectedAgent('knowledge.rag_retriever', 'knowledge');
    if (knowledge) {
      setSelectedNodeId(knowledge.id);
      openInspectorPanel();
    }
  };

  const handleToggleAgentTool = (tool: CatalogTool) => {
    if (!selectedWorkflowNode) return;
    const connectedTool = connectedToolNodes.find((node) => getWorkflowToolName(node) === tool.name);
    if (connectedTool) {
      const lifecycle = detachWorkflowConnectionsAndPrune({
        nodes: nodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
        connections: edges.map((edge) => edge.data!.connection),
        shouldDetach: (connection) => (
          connection.sourceNodeId === connectedTool.id
          && connection.targetNodeId === selectedWorkflowNode.id
          && connection.connectionType === 'tool'
        ),
      });
      const next = reconcileCanvasGraph(nodes, edges, lifecycle);
      setNodes(next.nodes);
      setEdges(next.edges);
      commit(next.nodes, next.edges);
      return;
    }
    if (!isNativeAgentToolAttachable(tool)) return;
    attachResourceToSelectedAgent(
      tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal',
      'tool',
      buildNativeAgentToolConfig(tool),
    );
  };

  const handleSetAgentTools = (requestedTools: CatalogTool[]) => {
    if (!selectedNode || !selectedWorkflowNode || selectedWorkflowNode.type !== 'ai.agent') return;
    const desiredTools = new Map(
      requestedTools
        .filter((tool) => isNativeAgentToolAttachable(tool) || connectedToolNames.has(tool.name))
        .map((tool) => [tool.name, tool]),
    );
    const currentWorkflowNodes = new Map(nodes.map((node) => [node.id, node.data.workflowNode]));
    let nextNodes = [...nodes];
    const detachedToolNodeIds = edges
      .filter((edge) => {
        if (edge.target !== selectedWorkflowNode.id || edge.data?.connection.connectionType !== 'tool') return false;
        const toolNode = currentWorkflowNodes.get(edge.source);
        return !toolNode || !desiredTools.has(getWorkflowToolName(toolNode));
      })
      .map((edge) => edge.source);
    let nextEdges = edges.filter((edge) => {
      if (edge.target !== selectedWorkflowNode.id || edge.data?.connection.connectionType !== 'tool') return true;
      const toolNode = currentWorkflowNodes.get(edge.source);
      return Boolean(toolNode && desiredTools.has(getWorkflowToolName(toolNode)));
    });
    if (detachedToolNodeIds.length > 0) {
      const pruned = pruneOrphanedWorkflowAttachments({
        nodes: nextNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
        connections: nextEdges.map((edge) => edge.data!.connection),
        candidateNodeIds: detachedToolNodeIds,
      });
      const reconciled = reconcileCanvasGraph(nextNodes, nextEdges, pruned);
      nextNodes = reconciled.nodes;
      nextEdges = reconciled.edges;
    }

    [...desiredTools.values()].forEach((tool, index) => {
      const expectedType = tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal';
      const attachedToolNodeIds = new Set(nextEdges
        .filter((edge) => edge.target === selectedWorkflowNode.id && edge.data?.connection.connectionType === 'tool')
        .map((edge) => edge.source));
      const existingIndex = nextNodes.findIndex((candidate) => (
        attachedToolNodeIds.has(candidate.id)
        &&
        candidate.data.workflowNode.type === expectedType
        && getWorkflowToolName(candidate.data.workflowNode) === tool.name
      ));
      let workflowNode: WorkflowNode;
      if (existingIndex >= 0) {
        const current = nextNodes[existingIndex].data.workflowNode;
        workflowNode = {
          ...current,
          name: getNativeAgentToolLabel(tool),
          config: { ...current.config, ...buildNativeAgentToolConfig(tool) },
        };
        nextNodes[existingIndex] = {
          ...nextNodes[existingIndex],
          data: { ...nextNodes[existingIndex].data, workflowNode },
        };
      } else {
        workflowNode = createWorkflowNode(expectedType, {
          id: `${expectedType.replace('.', '_')}_${crypto.randomUUID()}`,
          name: getNativeAgentToolLabel(tool),
          position: {
            x: selectedNode.position.x - 320,
            y: selectedNode.position.y + 120 + index * 90,
          },
          config: buildNativeAgentToolConfig(tool),
        });
        nextNodes.push({
          id: workflowNode.id,
          type: 'workflow',
          position: workflowNode.position,
          data: { workflowNode, errorCount: 0 },
        });
      }

      const alreadyAttached = nextEdges.some((edge) => (
        edge.source === workflowNode.id
        && edge.target === selectedWorkflowNode.id
        && edge.data?.connection.connectionType === 'tool'
      ));
      if (alreadyAttached) return;
      const sourcePort = workflowNode.outputPorts.find((port) => port.connectionType === 'tool');
      const targetPort = selectedWorkflowNode.inputPorts.find((port) => port.connectionType === 'tool');
      if (!sourcePort || !targetPort) return;
      nextEdges.push(canvasEdge({
        id: `conn_${crypto.randomUUID()}`,
        sourceNodeId: workflowNode.id,
        sourcePortId: sourcePort.id,
        targetNodeId: selectedWorkflowNode.id,
        targetPortId: targetPort.id,
        connectionType: 'tool',
      }));
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    commit(nextNodes, nextEdges);
  };

  const addToolFromLibrary = (tool: CatalogTool) => {
    if (selectedWorkflowNode?.type === 'ai.agent') {
      if (!connectedToolNames.has(tool.name)) handleToggleAgentTool(tool);
      openInspectorPanel();
      return;
    }
    addCatalogItem({ tool, position: centerCanvasPosition() });
  };
  const selectedTestDependencyIds = selectedWorkflowNode
    ? definition.connections
      .filter((connection) => (
        connection.targetNodeId === selectedWorkflowNode.id
        && ['main', 'error', 'event'].includes(connection.connectionType)
      ))
      .map((connection) => connection.sourceNodeId)
      .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
    : [];
  const selectedTestBlockedReason = selectedWorkflowNode
    ? getWorkflowNodeManifest(selectedWorkflowNode.type)?.attachment
      ? 'Capacidades anexadas não iniciam uma execução.'
      : !selectedWorkflowNode.type.startsWith('trigger.') && !selectedWorkflowNode.inputPorts.some((port) => port.connectionType === 'main')
        ? 'Este bloco não possui entrada principal simulável.'
        : null
    : null;
  const openSelectedNodeTest = () => {
    if (!selectedWorkflowNode || !onTestNode || selectedTestBlockedReason || testRunning) return;
    setTestTarget({ kind: 'node', nodeId: selectedWorkflowNode.id });
  };
  const updateSelectedNode = (workflowNode: WorkflowNode) => {
    const nextNodes = nodes.map((node) => node.id === workflowNode.id ? { ...node, data: { ...node.data, workflowNode } } : node);
    setNodes(nextNodes);
    commit(nextNodes, edges);
  };
  const setSelectedNodeCustomErrorRoute = (enabled: boolean) => {
    if (!selectedWorkflowNode) return;
    const workflowNode = {
      ...selectedWorkflowNode,
      config: { ...selectedWorkflowNode.config, customErrorRoute: enabled },
    };
    const nextNodes = nodes.map((node) => node.id === workflowNode.id
      ? { ...node, data: { ...node.data, workflowNode } }
      : node);
    const nextEdges = enabled
      ? edges
      : edges.filter((edge) => !(
          edge.source === workflowNode.id
          && edge.data?.connection.connectionType === 'error'
        ));
    setNodes(nextNodes);
    setEdges(nextEdges);
    if (!enabled && pendingConnection?.nodeId === workflowNode.id) setPendingConnection(null);
    if (!enabled && focusedRoute?.sourceNodeId === workflowNode.id) setFocusedRoute(null);
    commit(nextNodes, nextEdges);
  };
  const requestDeleteSelectedNode = () => {
    if (selectedNode) setDeleteCandidateId(selectedNode.id);
  };
  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const original = selectedNode.data.workflowNode;
    const duplicatedId = `${original.type.replace('.', '_')}_${crypto.randomUUID()}`;
    const position = { x: selectedNode.position.x + 48, y: selectedNode.position.y + 48 };
    const duplicatedWorkflowNode: WorkflowNode = {
      ...structuredClone(original),
      id: duplicatedId,
      name: `${original.name} · cópia`,
      position,
    };
    const duplicatedCanvasNode: CanvasNode = {
      ...selectedNode,
      id: duplicatedId,
      position,
      selected: true,
      data: { ...selectedNode.data, workflowNode: duplicatedWorkflowNode, errorCount: 0 },
    };

    const attachmentConnections = edges
      .map((edge) => edge.data!.connection)
      .filter((connection) => (
        connection.targetNodeId === original.id
        && !['main', 'event', 'error'].includes(connection.connectionType)
      ));
    const attachmentIds = new Map<string, string>();
    const duplicatedAttachments: CanvasNode[] = [];
    for (const connection of attachmentConnections) {
      if (attachmentIds.has(connection.sourceNodeId)) continue;
      const source = nodes.find((node) => node.id === connection.sourceNodeId);
      if (!source) continue;
      const id = `${source.data.workflowNode.type.replace('.', '_')}_${crypto.randomUUID()}`;
      attachmentIds.set(source.id, id);
      const attachmentPosition = { x: source.position.x + 48, y: source.position.y + 48 };
      duplicatedAttachments.push({
        ...source,
        id,
        position: attachmentPosition,
        selected: false,
        data: {
          ...source.data,
          errorCount: 0,
          workflowNode: {
            ...structuredClone(source.data.workflowNode),
            id,
            name: `${source.data.workflowNode.name} · cópia`,
            position: attachmentPosition,
          },
        },
      });
    }
    const duplicatedAttachmentEdges = attachmentConnections.flatMap((connection) => {
      const sourceNodeId = attachmentIds.get(connection.sourceNodeId);
      if (!sourceNodeId) return [];
      return [canvasEdge({
        ...structuredClone(connection),
        id: `conn_${crypto.randomUUID()}`,
        sourceNodeId,
        targetNodeId: duplicatedId,
      })];
    });
    const nextNodes = [
      ...nodes.map((node) => node.selected ? { ...node, selected: false } : node),
      duplicatedCanvasNode,
      ...duplicatedAttachments,
    ];
    const nextEdges = [...edges, ...duplicatedAttachmentEdges];
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(duplicatedId);
    commit(nextNodes, nextEdges);
    toast({ title: `${original.name} duplicado`, description: 'O novo bloco foi deslocado para facilitar a conexão.' });
  }, [commit, edges, nodes, selectedNode, setEdges, setNodes]);
  const confirmDeleteCandidate = () => {
    if (!deleteCandidateId) return;
    const deletedName = nodes.find((node) => node.id === deleteCandidateId)?.data.workflowNode.name || 'Bloco';
    const previousNodes = nodes;
    const previousEdges = edges;
    const previousSelectedNodeId = selectedNodeId;
    const lifecycle = deleteWorkflowNodesAndPrivateAttachments({
      nodes: nodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      connections: edges.map((edge) => edge.data!.connection),
      nodeIds: [deleteCandidateId],
    });
    const next = reconcileCanvasGraph(nodes, edges, lifecycle);
    setNodes(next.nodes);
    setEdges(next.edges);
    if (selectedNodeId === deleteCandidateId) setSelectedNodeId(null);
    setDeleteCandidateId(null);
    commit(next.nodes, next.edges);
    toast({
      title: `${deletedName} excluído`,
      description: 'O bloco e seus recursos privados foram removidos do rascunho.',
      action: (
        <ToastAction
          altText={`Desfazer exclusão de ${deletedName}`}
          onClick={() => {
            setNodes(previousNodes);
            setEdges(previousEdges);
            setSelectedNodeId(previousSelectedNodeId);
            commit(previousNodes, previousEdges);
          }}
        >
          Desfazer
        </ToastAction>
      ),
    });
  };

  useEffect(() => {
    if (!selectedNodeId) return;
    const requestDeleteFromKeyboard = (event: KeyboardEvent) => {
      if (!['Backspace', 'Delete'].includes(event.key) || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setDeleteCandidateId(selectedNodeId);
    };
    window.addEventListener('keydown', requestDeleteFromKeyboard, true);
    return () => window.removeEventListener('keydown', requestDeleteFromKeyboard, true);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const duplicateFromKeyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !(event.ctrlKey || event.metaKey) || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      duplicateSelectedNode();
    };
    window.addEventListener('keydown', duplicateFromKeyboard, true);
    return () => window.removeEventListener('keydown', duplicateFromKeyboard, true);
  }, [duplicateSelectedNode, selectedNodeId]);

  const manifests = useMemo(() => listStableWorkflowNodeManifests().filter((manifest) => (
    manifestMatches(manifest, query)
    && (editorMode === 'advanced' || ESSENTIAL_WORKFLOW_NODE_TYPES.has(manifest.type))
    && (!(pendingConnection || selectedWorkflowNode) || manifest.category !== 'triggers')
    && (!catalogSourcePort || manifest.inputPorts.some((port) => port.connectionType === catalogSourcePort.connectionType))
  )), [catalogSourcePort, editorMode, pendingConnection, query, selectedWorkflowNode]);
  const recommendedManifests = useMemo(() => {
    const byType = new Map(manifests.map((manifest) => [manifest.type, manifest]));
    return recommendedNodeTypes(selectedWorkflowNode, catalogSourcePort?.connectionType, surface)
      .map((type) => byType.get(type))
      .filter((manifest): manifest is WorkflowNodeManifest => Boolean(manifest && !manifest.attachment));
  }, [catalogSourcePort?.connectionType, manifests, selectedWorkflowNode, surface]);
  const recommendedManifestTypes = useMemo(() => new Set(recommendedManifests.map((manifest) => manifest.type)), [recommendedManifests]);
  const grouped = useMemo(() => Object.entries(CATEGORY_META).map(([category, meta]) => ({
    category: category as WorkflowNodeCategory,
    meta,
    manifests: manifests.filter((manifest) => (
      manifest.category === category
      && !manifest.attachment
      && !['tool.internal', 'tool.mcp'].includes(manifest.type)
      && !recommendedManifestTypes.has(manifest.type)
    )),
  })).filter((group) => group.manifests.length > 0), [manifests, recommendedManifestTypes]);
  const attachmentManifests = useMemo(() => manifests.filter((manifest) => (
    // Recursos avançados
    manifest.attachment && !['tool.internal', 'tool.mcp'].includes(manifest.type)
  )), [manifests]);
  const libraryToolGroups = useMemo(() => editorMode === 'advanced' ? groupNativeAgentTools(tools.filter((tool) => (
    isNativeAgentToolAttachable(tool)
    && (!query || `${getNativeAgentToolLabel(tool)} ${tool.name} ${tool.description} ${tool.serverName || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
  ))) : [], [editorMode, query, tools]);
  const hiddenResourceNodeIds = useMemo(() => new Set(showAdvancedResources ? [] : nodes
    .filter((node) => getWorkflowNodeManifest(node.data.workflowNode.type)?.attachment)
    .map((node) => node.id)), [nodes, showAdvancedResources]);
  const flowNodes = useMemo(() => nodes.map((node) => {
    const hidden = hiddenResourceNodeIds.has(node.id);
    return node.hidden === hidden ? node : { ...node, hidden };
  }), [hiddenResourceNodeIds, nodes]);
  const workflowNodeById = useMemo(() => new Map(
    definition.nodes.map((node) => [node.id, node]),
  ), [definition.nodes]);
  const focusedRouteEdgeIds = useMemo(() => focusedRoute
    ? traceWorkflowRouteEdgeIds(definition, focusedRoute.sourceNodeId, focusedRoute.sourcePortId)
    : new Set<string>(), [definition, focusedRoute]);
  const flowEdges = useMemo(() => edges.map((edge) => {
    const adjacentToDraggedNode = Boolean(draggedNodeId && (edge.source === draggedNodeId || edge.target === draggedNodeId));
    const tracedRoute = Boolean(focusedRoute && focusedRouteEdgeIds.has(edge.id));
    const sourceNode = workflowNodeById.get(edge.source);
    const hiddenSimpleFallback = editorMode === 'essential'
      && sourceNode?.type === 'interaction.options'
      && ['default', 'expired'].includes(edge.data?.connection.sourcePortId || '');
    const baseStyle = edge.style || {};
    return {
      ...edge,
      animated: Boolean(edge.animated
        && (!draggedNodeId || adjacentToDraggedNode)
        && (!focusedRoute || tracedRoute)),
      hidden: hiddenResourceNodeIds.has(edge.source)
        || hiddenResourceNodeIds.has(edge.target)
        || hiddenSimpleFallback
        || Boolean(draggedNodeId && !adjacentToDraggedNode),
      style: {
        ...baseStyle,
        opacity: draggedNodeId
          ? (adjacentToDraggedNode ? 0.96 : 0)
          : focusedRoute
            ? (tracedRoute ? 0.98 : 0.07)
            : 0.46,
        strokeWidth: adjacentToDraggedNode || tracedRoute ? 2.15 : 1.35,
      },
      zIndex: adjacentToDraggedNode || tracedRoute ? 5 : 0,
    };
  }), [draggedNodeId, edges, editorMode, focusedRoute, focusedRouteEdgeIds, hiddenResourceNodeIds, workflowNodeById]);
  const deleteCandidate = deleteCandidateId ? nodes.find((node) => node.id === deleteCandidateId) || null : null;
  const statusLabel = isSaving
    ? 'Salvando…'
    : isPublishing
      ? 'Publicando…'
      : !validation.valid
        ? validation.errors.length === 1 ? '1 pendência' : `${validation.errors.length} pendências`
        : isDirty
          ? 'Alterações não salvas'
          : hasDraft
            ? 'Rascunho salvo'
            : 'Publicado';

  return (
    <div className={NATIVE_WORKFLOW_SHELL_CLASS}>
      {isNarrowViewport && (catalogOpen || inspectorOpen) ? <button type="button" aria-label="Fechar painel aberto" onClick={() => { setCatalogOpen(false); setInspectorOpen(false); setPendingConnection(null); }} className="absolute inset-0 z-40 bg-[#02060b]/75 backdrop-blur-[2px]" /> : null}
      <NativeWorkflowCatalog
        open={catalogOpen}
        onClose={() => {
          setCatalogOpen(false);
          setPendingConnection(null);
        }}
        query={query}
        onQueryChange={setQuery}
        selectedWorkflowNode={selectedWorkflowNode}
        pendingConnection={pendingConnection}
        recommendedManifests={recommendedManifests}
        groupedManifests={grouped}
        attachmentManifests={attachmentManifests}
        libraryToolGroups={libraryToolGroups}
        toolsLoading={toolsLoading}
        editorMode={editorMode}
        onAddCatalogItem={(manifest) => {
          addCatalogItem({
            type: manifest.type,
            position: centerCanvasPosition(),
            smartPosition: true,
          });
        }}
        onAddToolFromLibrary={addToolFromLibrary}
        isNativeAgentToolAttachable={isNativeAgentToolAttachable}
        getNativeAgentToolLabel={getNativeAgentToolLabel}
        getNativeAgentToolUnavailableReason={getNativeAgentToolUnavailableReason}
        getNodeCopy={friendlyNodeCopy}
        getNodeIcon={workflowNodeIcon}
        getNodeAccent={(category) => NATIVE_WORKFLOW_CATEGORY_COLOR[category]}
        isNarrowViewport={isNarrowViewport}
        panelRef={catalogPanelRef}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-[#070b10]">
        <header className="relative z-20 flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-[#0c141d]/95 px-3 py-2.5 shadow-[0_12px_34px_rgba(0,0,0,.18)] backdrop-blur-xl 2xl:flex-nowrap 2xl:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {!catalogOpen && <Button variant="ghost" size="icon" onClick={() => { setPendingConnection(null); setQuery(''); openCatalogPanel(); }} className="h-9 w-9 shrink-0 rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-300 hover:bg-white/[0.07]" title="Adicionar bloco"><PanelLeftOpen className="h-4 w-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={handleBack} className="h-9 w-9 shrink-0 rounded-xl text-slate-400 hover:bg-white/[0.05] hover:text-white" aria-label="Voltar para automações"><ArrowLeft className="h-4 w-4" /></Button>
            <div className="min-w-0 border-l border-white/[0.08] pl-3"><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">{surface === 'standalone' ? 'Fluxo Nexus' : 'Automação visual'}</p><WorkflowNameInput value={definition.name} onCommit={(name) => onChange({ ...definition, name, updatedAt: new Date().toISOString() })} /></div>
            <button type="button" data-testid="workflow-validation-status" onClick={() => { setSelectedNodeId(null); openInspectorPanel(); }} title="Abrir validação da automação" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"><Badge aria-live="polite" className={cn('h-6 rounded-full px-2.5 text-[10px] font-medium', validation.valid && !isDirty ? 'border-emerald-400/25 bg-emerald-400/[0.09] text-emerald-200' : 'border-amber-400/25 bg-amber-400/[0.09] text-amber-100')}><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-80" /><span className="hidden sm:inline">{statusLabel}</span><span className="sm:hidden">{!validation.valid ? validation.errors.length : isDirty ? '•' : '✓'}</span></Badge></button>
          </div>
          <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {onOpenPanel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-2 rounded-xl border border-transparent text-slate-300 hover:border-white/[0.06] hover:bg-white/[0.06] hover:text-white">
                    <Settings2 className="h-4 w-4" />
                    {surface === 'standalone' ? 'Gerenciar fluxo' : 'Gerenciar agente'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 border-white/10 bg-[#111316] text-slate-200 shadow-2xl">
                  {surface === 'standalone' ? <>
                    <DropdownMenuItem onClick={() => onOpenPanel('executions')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                      <Activity className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium">Execuções</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenPanel('versions')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                      <History className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium">Histórico de versões</span>
                    </DropdownMenuItem>
                    {onExport ? <DropdownMenuItem onClick={onExport} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                      <Download className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium">Exportar JSON</span>
                    </DropdownMenuItem> : null}
                    {onImport ? <DropdownMenuItem onClick={onImport} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                      <Upload className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium">Importar JSON</span>
                    </DropdownMenuItem> : null}
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onClick={() => onOpenPanel('capabilities')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                      <Wrench className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium">Ferramentas e MCP</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenPanel('settings')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                      <Settings2 className="h-4 w-4 text-slate-300" />
                      <span className="text-sm font-medium">Implantação e gatilhos</span>
                    </DropdownMenuItem>
                  </> : <>
                  <DropdownMenuItem onClick={() => onOpenPanel('procedures')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <ListChecks className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Procedimentos</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('knowledge')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <Database className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Conhecimento</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('capabilities')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <Zap className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Habilidades</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('analytics')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <LineChart className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Analytics</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('decision')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <BrainCircuit className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Motor de decisão</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={() => onOpenPanel('playground')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <TestTube2 className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Playground</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('versions')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <History className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">Histórico</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={() => onOpenPanel('settings')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <Settings2 className="h-4 w-4 text-slate-300" />
                    <span className="text-sm font-medium">Ajustes gerais</span>
                  </DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : onOpenSettings ? (
              <Button variant="ghost" size="sm" onClick={onOpenSettings} className="shrink-0 text-slate-300">
                <Settings2 className="mr-2 h-4 w-4" /> Ajustes
              </Button>
            ) : null}
            {onManageCredentials ? (
              <Button variant="ghost" size="sm" onClick={onManageCredentials} className="shrink-0 text-slate-300">
                <KeyRound className="mr-2 h-4 w-4" /> Credenciais
              </Button>
            ) : null}
            <div className="flex h-9 shrink-0 items-center rounded-xl border border-white/[0.07] bg-white/[0.025] p-0.5" aria-label="Nível de edição">
              <button type="button" aria-pressed={editorMode === 'essential'} onClick={() => setEditorMode('essential')} className={cn('h-7 rounded-lg px-2.5 text-[10px] font-semibold transition', editorMode === 'essential' ? 'bg-slate-200 text-slate-950' : 'text-slate-400 hover:text-slate-200')}>Simples</button>
              <button type="button" aria-pressed={editorMode === 'advanced'} onClick={() => setEditorMode('advanced')} className={cn('h-7 rounded-lg px-2.5 text-[10px] font-semibold transition', editorMode === 'advanced' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200')}>Avançado</button>
            </div>
            {onTest && <Button variant="ghost" size="sm" onClick={() => setTestTarget({ kind: 'workflow' })} disabled={!validation.valid || testRunning || isSaving || isPublishing} className="h-9 shrink-0 rounded-xl text-slate-200 hover:bg-white/[0.06]"><Play className="mr-2 h-4 w-4 text-slate-400" />{testRunning ? 'Iniciando…' : 'Testar'}</Button>}
            <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving || isPublishing || !isDirty} aria-busy={isSaving} className="h-9 shrink-0 rounded-xl border-slate-700/70 bg-[#111d28] text-slate-200 hover:bg-[#172633]"><Save className="mr-2 h-4 w-4" />{isSaving ? 'Salvando…' : 'Salvar'}</Button>
            <Button size="sm" onClick={onPublish} disabled={isSaving || isPublishing || !validation.valid || !hasDraft} aria-busy={isPublishing} title={!validation.valid ? 'Resolva as pendências antes de publicar.' : !hasDraft ? (isDirty ? 'Apenas o layout visual foi alterado. Use "Salvar" para guardar as posições.' : 'Nenhuma alteração nova para publicar.') : 'Publicar rascunho'} className="h-9 shrink-0 rounded-xl bg-slate-100 px-4 font-semibold text-slate-950 shadow-sm hover:bg-white"><Sparkles className="mr-2 h-4 w-4" />{isPublishing ? 'Publicando…' : 'Publicar'}</Button>
            {!inspectorOpen && <Button variant="ghost" size="icon" onClick={openInspectorPanel} className="h-9 w-9 shrink-0 rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-300 hover:bg-white/[0.07]" title="Abrir inspetor"><PanelRightOpen className="h-4 w-4" /></Button>}
          </div>
        </header>
        <div className={cn('relative min-h-0 flex-1 flex flex-col bg-[#f8fafc]', debugExecutionId && !activePanelContent ? 'basis-[56%]' : 'flex-1')} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
          {activePanelContent ? (
            <div className="h-full w-full overflow-y-auto bg-[#070b10] px-4 py-5 text-slate-100 sm:px-6">
              {activePanelContent}
            </div>
          ) : (
            <ReactFlow<CanvasNode, CanvasEdge>
              className="bg-[#f8fafc] [&_.react-flow__node.dragging]:will-change-transform"
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onInit={setFlowInstance}
              onNodesChange={handleNodesChange}
              onNodeDragStart={(_, node) => setDraggedNodeId(node.id)}
              onNodeDragStop={(_, node) => persistNodePosition(node)}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onEdgeClick={(event, edge) => {
                event.stopPropagation();
                const connection = edge.data?.connection;
                if (connection) focusWorkflowRoute(connection.sourceNodeId, connection.sourcePortId);
              }}
              onNodeClick={(_, node) => { setPendingConnection(null); setFocusedRoute(null); setSelectedNodeId(node.id); openInspectorPanel(); }}
              onPaneClick={() => { setPendingConnection(null); setFocusedRoute(null); setSelectedNodeId(null); }}
              minZoom={isNarrowViewport ? 0.2 : 0.42}
              maxZoom={1.6}
              onlyRenderVisibleElements={isLargeWorkflow}
              connectionRadius={28}
              connectOnClick
              snapToGrid
              snapGrid={[16, 16]}
              deleteKeyCode={['Backspace', 'Delete']}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#cbd5e1" />
              {flowNodes.every((node) => node.hidden) ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="max-w-sm rounded-[20px] border border-slate-200 bg-white p-6 text-center shadow-[0_16px_38px_rgba(0,0,0,0.08)]">
                    <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700"><Play className="h-5 w-5" /></span>
                    <h2 className="mt-4 text-base font-semibold text-slate-900">Como este fluxo começa?</h2>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">Escolha um acontecimento inicial. Depois, basta usar “Próximo passo” para montar o restante.</p>
                    <Button type="button" onClick={() => { setPendingConnection(null); setSelectedNodeId(null); setQuery(''); openCatalogPanel(); }} className="nodrag nopan mt-4 rounded-xl bg-slate-900 text-white hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" />Adicionar primeira etapa</Button>
                  </div>
                </div>
              ) : null}
              <div className="pointer-events-none absolute left-5 top-5 z-10 hidden rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2 text-[10px] text-slate-600 shadow-sm sm:block"><span className="font-semibold text-slate-800">Monte em sequência:</span> use “+ Próximo passo” · arraste somente para organizar</div>
              <Controls className="!m-4 !overflow-hidden !rounded-[14px] !border-slate-200/90 !bg-white/95 !text-slate-700 !shadow-[0_4px_20px_rgba(0,0,0,0.08)] [&>button]:!h-9 [&>button]:!w-9 [&>button]:!border-slate-100 [&>button]:!bg-transparent [&>button:hover]:!bg-slate-100 [&>button]:!text-slate-700">
                <ControlButton
                  onClick={organizeWorkflow}
                  disabled={nodes.length < 2}
                  title="Organizar fluxo automaticamente"
                  aria-label="Organizar fluxo automaticamente"
                >
                  <LayoutGrid className="h-4 w-4" />
                </ControlButton>
                {canUndoAutoLayout ? (
                  <ControlButton
                    onClick={undoWorkflowOrganization}
                    title="Desfazer organização automática"
                    aria-label="Desfazer organização automática"
                  >
                    <Undo2 className="h-4 w-4" />
                  </ControlButton>
                ) : null}
              </Controls>
              {!isLargeWorkflow ? <MiniMap pannable zoomable className="!m-4 !h-24 !w-36 !rounded-[16px] !border !border-slate-200/90 !bg-white/95 !shadow-[0_4px_20px_rgba(0,0,0,0.08)]" nodeColor="#94a3b8" maskColor="rgba(241,245,249,0.75)" /> : null}
            </ReactFlow>
          )}
        </div>
        {debugExecutionId && !activePanelContent && (
          <section className="relative min-h-[280px] flex-1 border-t border-slate-700/60 bg-[#101214] shadow-[0_-10px_28px_rgba(0,0,0,.3)]">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setDebugExecutionId(null); setDebugSnapshot(null); }}
              className="absolute right-14 top-2 z-40 h-8 w-8 text-slate-400 hover:text-white"
              title="Fechar depurador"
            >
              <X className="h-4 w-4" />
            </Button>
            <WorkflowExecutionDebugger
              executionId={debugExecutionId}
              embedded
              onSnapshot={setDebugSnapshot}
              onEventSelect={(event) => {
                if (!event.nodeId) return;
                setSelectedNodeId(event.nodeId);
                flowInstance?.fitView({ nodes: [{ id: event.nodeId }], duration: 350, padding: 0.8 });
              }}
            />
          </section>
        )}
      </main>

      {inspectorOpen && <aside ref={inspectorPanelRef} aria-label="Inspetor da automação" aria-modal={isNarrowViewport || undefined} role={isNarrowViewport ? 'dialog' : undefined} className="absolute bottom-3 right-3 top-3 z-50 w-[min(400px,calc(100vw-1.5rem))] shrink-0 overflow-y-auto rounded-[22px] border border-slate-700/60 bg-[#0e1720]/95 shadow-[0_18px_48px_rgba(0,0,0,.42)] backdrop-blur-xl">
        {selectedNode ? (
          <div className="p-4">
            <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-white/[0.065] bg-[#0e1720]/95 px-4 pb-4 pt-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-300">{selectedNode.data.workflowNode.type === 'ai.agent' ? 'Configurar agente' : 'Configurar bloco'}</p><p className="mt-1 text-xs text-slate-500">As alterações ficam no rascunho</p></div><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 shrink-0 rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white"><PanelRightClose className="h-4 w-4" /><span className="sr-only">Fechar inspetor</span></Button></div>
              <Label htmlFor={`workflow-node-name-${selectedNode.id}`} className="mt-3 block text-[11px] text-slate-400">{selectedNode.data.workflowNode.type === 'ai.agent' ? 'Nome do agente' : 'Nome do bloco'}</Label>
              <Input id={`workflow-node-name-${selectedNode.id}`} value={selectedNode.data.workflowNode.name} onChange={(event) => updateSelectedNode({
                ...selectedNode.data.workflowNode,
                name: event.target.value,
                config: selectedNode.data.workflowNode.type === 'ai.agent'
                  ? { ...selectedNode.data.workflowNode.config, name: event.target.value }
                  : selectedNode.data.workflowNode.config,
              })} className="mt-1.5 h-10 rounded-xl border-slate-700/70 bg-[#09121a] font-semibold text-slate-100 shadow-inner placeholder:text-slate-500" />
              {onTestNode && <Button variant="outline" size="sm" onClick={openSelectedNodeTest} disabled={Boolean(selectedTestBlockedReason) || testRunning} title={selectedTestBlockedReason || 'Executar este bloco com as dependências anteriores simuladas'} className="mt-3 w-full rounded-xl border-slate-600/70 bg-slate-300/[0.045] text-slate-100 hover:bg-slate-300/[0.08]"><Play className="mr-2 h-4 w-4 text-slate-400" />{testRunning ? 'Iniciando…' : 'Testar deste bloco'}</Button>}
              <div className={`mt-3 grid gap-2 ${selectedNode.data.workflowNode.type !== 'ai.agent' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <Button variant="outline" size="sm" onClick={duplicateSelectedNode} title="Duplicar bloco (Ctrl+D)" className="border-slate-600/70 bg-slate-300/[0.045] text-slate-100 hover:bg-slate-300/[0.08]"><Copy className="mr-2 h-4 w-4" />Duplicar</Button>
                {selectedNode.data.workflowNode.type !== 'ai.agent' ? <Button variant="destructive" size="sm" onClick={requestDeleteSelectedNode} title="Excluir bloco (Delete)"><Trash2 className="mr-2 h-4 w-4" />Excluir</Button> : null}
              </div>
            </div>
            {selectedNode.data.workflowNode.outputPorts.some((port) => port.connectionType === 'error') ? (
              <section className="mb-4 rounded-[16px] border border-slate-700/55 bg-[#111c27] p-4">
                <label htmlFor={`workflow-custom-error-${selectedNode.id}`} className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    id={`workflow-custom-error-${selectedNode.id}`}
                    checked={selectedNode.data.workflowNode.config.customErrorRoute === true}
                    onCheckedChange={(checked) => setSelectedNodeCustomErrorRoute(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-200">Usar caminho de erro personalizado</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                      {selectedNode.data.workflowNode.type.startsWith('interaction.')
                        ? 'Quando desligado, respostas inválidas repetem a pergunta automaticamente e a saída “Erro” permanece oculta.'
                        : 'Quando desligado, a falha é registrada e encerrada automaticamente, sem mostrar uma saída “Erro” no fluxo.'}
                    </span>
                  </span>
                </label>
              </section>
            ) : null}
            {selectedNode.data.workflowNode.type === 'ai.agent'
              ? <AgentInspector
                  node={selectedNode.data.workflowNode}
                  onUpdate={updateSelectedNode}
                  modelOptions={modelOptions}
                  connectedModel={connectedModel}
                  connectedKnowledge={connectedKnowledge}
                  connectedMemory={connectedMemory}
                  connectedGuardrail={connectedGuardrail}
                   connectedToolNames={connectedToolNames}
                   tools={tools}
                   toolsLoading={toolsLoading}
                  onModelChange={handleAgentModelChange}
                  onConfigureKnowledge={handleConfigureAgentKnowledge}
                  onToggleMemory={() => connectedMemory
                    ? detachResourceFromSelectedAgent('memory')
                    : void attachResourceToSelectedAgent('memory.session', 'memory')}
                  onToggleGuardrail={() => connectedGuardrail
                    ? detachResourceFromSelectedAgent('guardrail')
                    : void attachResourceToSelectedAgent('guardrail.policy', 'guardrail', { name: 'Políticas da automação', checks: [], onViolation: 'route_to_error' })}
                  onToggleTool={handleToggleAgentTool}
                   onSetTools={handleSetAgentTools}
                   onOpenTools={() => onOpenPanel?.('capabilities')}
                   onOpenModels={() => onOpenModelSettings ? onOpenModelSettings() : onOpenPanel?.('settings')}
                   knowledgeDocumentCount={knowledgeDocuments.length}
                  onDelete={requestDeleteSelectedNode}
                />
              : hasSpecializedWorkflowInspector(selectedNode.data.workflowNode.type)
                ? <NativeSpecializedNodeInspector
                    node={selectedNode.data.workflowNode}
                    onUpdate={updateSelectedNode}
                    editorMode={editorMode}
                    modelOptions={modelOptions}
                     knowledgeDocuments={knowledgeDocuments}
                     knowledgeCollections={knowledgeCollections}
                     onManageKnowledge={() => onOpenPanel?.('knowledge')}
                     onManageModels={() => onOpenModelSettings ? onOpenModelSettings() : onOpenPanel?.('settings')}
                     credentialOptions={credentialOptions}
                     teamOptions={dialogyResources.teams}
                     tagOptions={dialogyResources.tags}
                     memberOptions={dialogyResources.members}
                     intelligentAgentOptions={dialogyResources.intelligentAgents}
                     instanceOptions={dialogyResources.instances}
                     onManageCredentials={onManageCredentials}
                     workflowNodeOptions={definition.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type }))}
                     workflowOptions={dialogyResources.workflows.filter((workflow) => workflow.id !== definition.id.replace(/^nexus:/, ''))}
                     toolOptions={tools}
                   />
                : <GenericInspector node={selectedNode.data.workflowNode} manifest={getWorkflowNodeManifest(selectedNode.data.workflowNode.type)!} onUpdate={updateSelectedNode} />}
          </div>
        ) : (
          <div className="p-4"><div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center justify-between gap-3 border-b border-white/[0.065] bg-[#0e1720]/95 px-4 py-4 backdrop-blur-xl"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-300">Saúde da automação</p><p className="mt-1 text-xs text-slate-500">Validação e tipos de conexão</p></div><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white"><PanelRightClose className="h-4 w-4" /></Button></div><div className="mt-4 space-y-2">{validation.errors.length === 0 ? <div className="rounded-[16px] border border-emerald-400/20 bg-emerald-400/[0.075] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><CheckCircle2 className="h-4 w-4" />Tudo pronto para publicar</div><p className="mt-2 text-[11px] leading-relaxed text-emerald-100/65">A estrutura e as conexões obrigatórias estão válidas.</p></div> : validation.errors.map((issue, index) => <button key={`${issue.code}-${index}`} type="button" onClick={() => { if (issue.nodeId) setSelectedNodeId(issue.nodeId); }} className="w-full rounded-[16px] border border-amber-400/25 bg-amber-400/[0.07] p-3 text-left transition hover:bg-amber-400/[0.12]"><span className="flex items-start gap-2 text-xs font-medium leading-relaxed text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</span><span className="ml-5 mt-1 block font-mono text-[9px] text-amber-300/55">{issue.code}</span></button>)}</div><div className="mt-5 rounded-[16px] border border-slate-700/55 bg-[#0a121a]/70 p-4"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Tipos de conexão</p><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">{Object.entries(CONNECTION_META).filter(([type]) => type !== 'agent_tool').map(([type, meta]) => <div key={type} className="flex items-center gap-2 text-[10px] text-slate-300"><span className="w-7 border-t-2" style={{ borderColor: meta.color, borderStyle: meta.dashed ? 'dashed' : 'solid' }} />{meta.label}</div>)}</div></div></div>
        )}
      </aside>}
      <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={(open) => { if (!open) setDeleteCandidateId(null); }}>
        <AlertDialogContent className="dark border-white/10 bg-[#111820] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{deleteCandidate?.data.workflowNode.name || 'bloco'}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              As conexões e os recursos privados usados somente por este bloco também serão removidos. Esta alteração só chega ao atendimento depois de salvar e publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-slate-200 hover:bg-white/5">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCandidate} className="bg-red-600 text-white hover:bg-red-500">Excluir bloco</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NativeWorkflowTestChat
        open={Boolean(testTarget)}
        onClose={() => setTestTarget(null)}
        workflowName={definition.name}
        workflowDefinition={definition}
        startNodeId={testTarget?.kind === 'node' ? testTarget.nodeId : undefined}
        startNodeName={testTarget?.kind === 'node' ? selectedWorkflowNode?.name : undefined}
        onRunTest={async (payload) => {
          if (testTarget?.kind === 'node') {
            return onTestNode?.(testTarget.nodeId, { message: payload.message });
          }
          return onTest?.({ message: payload.message });
        }}
        onResumeTest={onResumeTest ? async (payload) => onResumeTest(payload) : undefined}
        onOpenExecutionDebugger={(executionId) => {
          setDebugExecutionId(executionId);
        }}
      />
    </div>
  );
}
