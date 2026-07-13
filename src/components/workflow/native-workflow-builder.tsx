'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
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
  AlertTriangle,
  ArrowLeft,
  Bot,
  Braces,
  BrainCircuit,
  CheckCircle2,
  Database,
  GitBranch,
  History,
  LineChart,
  ListChecks,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
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
  Zap,
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
  NativeWorkflowTestDialog,
  type NativeWorkflowTestPayload,
} from '@/components/workflow/native-workflow-test-dialog';

type CatalogTool = NativeAgentToolCatalogItem;

type WorkflowNodeData = {
  workflowNode: WorkflowNode;
  errorCount: number;
  operationalState?: WorkflowDebugNodeState;
};

type CanvasNode = Node<WorkflowNodeData, 'workflow'>;
type CanvasEdge = Edge<{ connection: WorkflowConnection }>;

const CONNECTION_META = NATIVE_WORKFLOW_CONNECTION_META;

const DEBUG_STATE_META: Record<WorkflowDebugNodeState, { label: string; color: string; className: string }> = {
  queued: { label: 'Na fila', color: '#94a3b8', className: 'border-slate-400/40 bg-slate-400/15 text-slate-200' },
  thinking: { label: 'Pensando', color: '#a78bfa', className: 'border-violet-400/40 bg-violet-400/15 text-violet-100' },
  running_tool: { label: 'Executando tool', color: '#fb7185', className: 'border-rose-400/40 bg-rose-400/15 text-rose-100' },
  completed: { label: 'Concluído', color: '#34d399', className: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100' },
  waiting: { label: 'Aguardando', color: '#fbbf24', className: 'border-amber-400/40 bg-amber-400/15 text-amber-100' },
  failed: { label: 'Falhou', color: '#f87171', className: 'border-red-400/50 bg-red-400/15 text-red-100' },
};

const CATEGORY_META: Record<WorkflowNodeCategory, { label: string; icon: typeof Bot }> = {
  triggers: { label: 'Entradas', icon: Play },
  data: { label: 'Dados', icon: Braces },
  logic: { label: 'Lógica', icon: GitBranch },
  ai: { label: 'Inteligência', icon: Sparkles },
  knowledge_memory: { label: 'Conhecimento e memória', icon: Database },
  tools: { label: 'Ferramentas', icon: Wrench },
  output: { label: 'Saídas', icon: Send },
  error: { label: 'Erros', icon: AlertTriangle },
};

function nodeIcon(type: string) {
  if (type.startsWith('trigger.')) return Play;
  if (type === 'ai.agent') return Bot;
  if (type === 'logic.goal_completion') return ListChecks;
  if (type === 'logic.ai_router' || type === 'logic.switch' || type === 'logic.if') return GitBranch;
  if (type.startsWith('knowledge.') || type.startsWith('memory.')) return Database;
  if (type.startsWith('tool.')) return Wrench;
  if (type === 'guardrail.policy') return ShieldCheck;
  if (type === 'output.respond') return Send;
  if (type === 'output.handoff') return UserRound;
  if (type === 'output.close_conversation') return CheckCircle2;
  if (type === 'output.end') return CheckCircle2;
  return Braces;
}

function portPosition(connectionType: ConnectionType, direction: 'input' | 'output') {
  if (connectionType === 'main' || connectionType === 'event') {
    return direction === 'input' ? Position.Top : Position.Bottom;
  }
  if (connectionType === 'error') return Position.Right;
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
    borderColor: '#e2e8f0',
    boxShadow: `0 0 0 2px #111923, 0 0 12px ${meta.color}99`,
  };
}

function WorkflowNodeCard({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.workflowNode;
  const manifest = getWorkflowNodeManifest(node.type);
  const Icon = nodeIcon(node.type);
  const accent = NATIVE_WORKFLOW_CATEGORY_COLOR[manifest?.category || 'data'];
  const debugState = data.operationalState ? DEBUG_STATE_META[data.operationalState] : null;
  return (
    <div
      className={cn(
        'group relative min-w-[220px] overflow-visible rounded-2xl border-2 bg-[#1a2530] px-4 py-4 text-slate-100 shadow-[0_18px_45px_rgba(0,0,0,0.48)] transition-[border-color,box-shadow,transform] duration-150',
        selected && '-translate-y-0.5',
        data.errorCount > 0 && '!border-rose-400',
      )}
      style={{
        borderColor: debugState?.color || (selected ? accent : '#34485a'),
        boxShadow: debugState
          ? `0 0 0 3px ${debugState.color}35, 0 0 26px ${debugState.color}35, 0 20px 50px rgba(0,0,0,.55)`
          : selected
          ? `0 0 0 3px ${accent}35, 0 20px 50px rgba(0,0,0,.55)`
          : '0 18px 45px rgba(0,0,0,.48)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 top-0 h-[2px] rounded-full opacity-90"
        style={{ backgroundColor: accent, boxShadow: `0 0 12px ${accent}` }}
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
            className="!h-4 !w-4 !border-[2px] transition-transform hover:!scale-125 focus-visible:!scale-125"
          />
        );
      })}
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
          style={{ color: accent, backgroundColor: `${accent}18`, borderColor: `${accent}40` }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{node.name}</span>
          <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{manifest?.label || node.type}</span>
        </span>
        {data.errorCount > 0 && <Badge className="border-red-500/30 bg-red-500/10 text-red-200">{data.errorCount}</Badge>}
      </div>
      {debugState && (
        <Badge className={cn('mt-3 border text-[9px] uppercase tracking-wide', debugState.className)}>
          {data.operationalState === 'thinking' || data.operationalState === 'running_tool' ? (
            <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          ) : null}
          {debugState.label}
        </Badge>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {node.inputPorts.filter((port) => !['main', 'event'].includes(port.connectionType)).map((port) => (
          <span key={port.id} className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] text-slate-400">{port.label}</span>
        ))}
      </div>
      {node.outputPorts.map((port) => {
        const position = portPosition(port.connectionType, 'output');
        return (
          <Handle
            key={`output-${port.id}`}
            id={`out:${port.id}`}
            type="source"
            position={position}
            title={`${port.label} · ${CONNECTION_META[port.connectionType].label}`}
            aria-label={`Saída ${port.label}: ${CONNECTION_META[port.connectionType].label}`}
            style={handleStyle(node.outputPorts, port.id, position, port.connectionType)}
            className="!h-4 !w-4 !border-[2px] transition-transform hover:!scale-125 focus-visible:!scale-125"
          />
        );
      })}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNodeCard };

function canvasNodes(
  definition: WorkflowDefinition,
  issues: ReturnType<typeof validateWorkflowDefinition>['errors'],
  selectedNodeId?: string | null,
  operationalStates: Record<string, WorkflowDebugNodeState> = {},
): CanvasNode[] {
  const issueCount = new Map<string, number>();
  for (const issue of issues) {
    if (issue.nodeId) issueCount.set(issue.nodeId, (issueCount.get(issue.nodeId) || 0) + 1);
  }
  return definition.nodes.map((workflowNode) => ({
    id: workflowNode.id,
    type: 'workflow',
    position: workflowNode.position,
    selected: workflowNode.id === selectedNodeId,
    data: {
      workflowNode: structuredClone(workflowNode),
      errorCount: issueCount.get(workflowNode.id) || 0,
      operationalState: operationalStates[workflowNode.id],
    },
  }));
}

function canvasEdge(connection: WorkflowConnection): CanvasEdge {
  const meta = CONNECTION_META[connection.connectionType];
  return {
    id: connection.id,
    source: connection.sourceNodeId,
    target: connection.targetNodeId,
    sourceHandle: `out:${connection.sourcePortId}`,
    targetHandle: `in:${connection.targetPortId}`,
    type: 'smoothstep',
    animated: connection.connectionType === 'event',
    markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 16, height: 16 },
    style: { stroke: meta.color, strokeWidth: 1.8, strokeDasharray: meta.dashed ? '6 5' : undefined },
    data: { connection },
  };
}

function canvasEdges(definition: WorkflowDefinition): CanvasEdge[] {
  return definition.connections.map(canvasEdge);
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

function CatalogButton({ manifest, onAdd }: { manifest: WorkflowNodeManifest; onAdd: () => void }) {
  const Icon = nodeIcon(manifest.type);
  return (
    <button
      type="button"
      draggable
      onClick={onAdd}
      title={`Adicionar ${manifest.label}${manifest.attachment ? '' : ' e conectar ao bloco selecionado'}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/dialogy-workflow-node', manifest.type);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-sky-300"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-200">{manifest.label}</span><span className="block truncate text-[10px] text-slate-500">{manifest.description}</span></span>
    </button>
  );
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

function InspectorSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
      <div><h3 className="text-sm font-semibold text-slate-100">{title}</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{description}</p></div>
      {children}
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
        <div className="space-y-2"><Label htmlFor={fieldId('role')}>Papel do agente</Label><Input id={fieldId('role')} value={String(config.role || '')} onChange={(event) => set('role', event.target.value)} className="rounded-xl border-white/10 bg-slate-950 text-slate-100 placeholder:text-slate-600" placeholder="Ex.: especialista de suporte e retenção" /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('language')}>Idioma</Label><select id={fieldId('language')} value={String(config.language || 'pt-BR')} onChange={(event) => set('language', event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-slate-200"><option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option></select></div>
        <div className="space-y-2"><Label htmlFor={fieldId('persona')}>Tom e personalidade</Label><Textarea id={fieldId('persona')} value={String(config.persona || '')} onChange={(event) => set('persona', event.target.value)} className="min-h-28 rounded-xl border-white/10 bg-slate-950 text-slate-100 placeholder:text-slate-600" placeholder="Ex.: cordial, objetivo e didático. Não use jargões técnicos." /></div>
      </InspectorSection>

      <InspectorSection title="Recursos da IA" description="Configure aqui o que este agente pode usar. As conexões técnicas são gerenciadas automaticamente.">
        <div className="space-y-2">
          <Label htmlFor={fieldId('model')}>Modelo de IA</Label>
          <select id={fieldId('model')} data-testid="agent-model-select" value={selectedModel} onChange={(event) => onModelChange(event.target.value)} disabled={modelOptions.length === 0} aria-describedby={modelOptions.length === 0 ? fieldId('model-empty') : undefined} className="h-10 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-60">{!selectedModel ? <option value="">Selecione um modelo</option> : null}{selectedModel && !modelOptions.some((model) => model.id === selectedModel) ? <option value={selectedModel}>{selectedModel} (não configurado)</option> : null}{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
          {modelOptions.length === 0 ? <div id={fieldId('model-empty')} role="status" className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-3"><p className="text-xs leading-relaxed text-amber-100">Nenhum modelo com credencial está disponível neste workspace.</p><Button type="button" size="sm" variant="outline" onClick={onOpenModels} className="mt-2 border-amber-300/30 text-amber-100">Configurar modelos</Button></div> : null}
        </div>

        <div className="rounded-xl border border-orange-400/15 bg-orange-400/[0.04] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-200">Base de conhecimento</p><p className="mt-1 text-xs text-slate-400">{connectedKnowledge ? (selectedDocumentCount || selectedCollectionCount ? `${selectedDocumentCount} documento(s) · ${selectedCollectionCount} coleção(ões)` : knowledgeDocumentCount > 0 ? `Todos os ${knowledgeDocumentCount} documento(s)` : 'Nenhum documento cadastrado') : 'Não conectada'}</p></div><Button type="button" size="sm" variant="outline" data-testid="agent-knowledge-configure" onClick={onConfigureKnowledge} className="border-orange-400/20 text-orange-200">{connectedKnowledge ? 'Configurar' : 'Adicionar'}</Button></div></div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-testid="agent-memory-toggle" aria-pressed={Boolean(connectedMemory)} onClick={onToggleMemory} className={cn('rounded-xl border p-3 text-left transition', connectedMemory ? 'border-violet-400/30 bg-violet-400/10' : 'border-white/10 bg-white/[0.02]')}><p className="text-xs font-medium text-slate-200">Memória</p><p className="mt-1 text-[10px] text-slate-500">{connectedMemory ? 'Ativa' : 'Desativada'}</p></button>
          <button type="button" data-testid="agent-guardrail-toggle" aria-pressed={Boolean(connectedGuardrail)} onClick={onToggleGuardrail} className={cn('rounded-xl border p-3 text-left transition', connectedGuardrail ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-white/10 bg-white/[0.02]')}><p className="text-xs font-medium text-slate-200">Proteções</p><p className="mt-1 text-[10px] text-slate-500">{connectedGuardrail ? 'Ativas' : 'Desativadas'}</p></button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={fieldId('tool-search')}>Ferramentas permitidas</Label>
            <span data-testid="agent-tool-selection-count" aria-live="polite" className="text-xs text-slate-400">{toolsLoading ? 'Carregando catálogo…' : `${selectedToolCount} de ${selectableOrRetainedToolCount} ativas`}</span>
          </div>
          <Input id={fieldId('tool-search')} value={toolQuery} onChange={(event) => setToolQuery(event.target.value)} className="rounded-xl border-white/10 bg-slate-950 text-slate-100 placeholder:text-slate-600" placeholder="Buscar por nome, função ou integração" />
          <div className="flex flex-wrap gap-1.5">
            {recommendedTools.length > 0 ? <Button type="button" size="sm" variant="outline" data-testid="agent-tools-select-recommended" onClick={() => onSetTools([...recommendedTools, ...connectedRetainedTools])} disabled={toolsLoading} className="h-7 border-white/10 px-2 text-[10px]">Selecionar recomendadas</Button> : null}
            <Button type="button" size="sm" variant="outline" data-testid="agent-tools-select-all-eligible" onClick={() => onSetTools([...tools.filter(isNativeAgentToolAttachable), ...connectedRetainedTools])} disabled={toolsLoading || eligibleToolCount === 0} className="h-7 border-white/10 px-2 text-[10px]">Todas elegíveis</Button>
            <Button type="button" size="sm" variant="ghost" data-testid="agent-tools-clear" onClick={() => onSetTools([])} disabled={toolsLoading || selectedToolCount === 0} className="h-7 px-2 text-[10px] text-slate-400">Limpar</Button>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-white/[0.07] p-2">
            {toolsLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-300"><Loader2 className="h-4 w-4 animate-spin text-cyan-300" />Carregando todas as ferramentas do workspace…</div>
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
                        selected && 'bg-cyan-400/[0.05]',
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

      <details className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"><summary className="cursor-pointer text-sm font-medium text-slate-300">Limites avançados</summary><div className="mt-4 grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor={fieldId('max-turns')}>Máx. turnos</Label><Input id={fieldId('max-turns')} type="number" min={1} max={100} value={Number(config.maxTurns || 8)} onChange={(event) => set('maxTurns', Number(event.target.value))} /></div><div className="space-y-2"><Label htmlFor={fieldId('max-tools')}>Máx. ferramentas</Label><Input id={fieldId('max-tools')} type="number" min={0} max={100} value={Number(config.maxToolCalls || 20)} onChange={(event) => set('maxToolCalls', Number(event.target.value))} /></div></div></details>
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
  onTest,
  onTestNode,
  onSave,
  onPublish,
  activePanelContent,
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
  onOpenPanel?: (panel: 'knowledge' | 'capabilities' | 'analytics' | 'decision' | 'settings' | 'playground' | 'versions') => void;
  activePanelContent?: React.ReactNode;
  onTest?: (payload: NativeWorkflowTestPayload) => Promise<string | null | undefined> | string | null | undefined;
  onTestNode?: (
    nodeId: string,
    payload: NativeWorkflowTestPayload,
  ) => Promise<string | null | undefined> | string | null | undefined;
  onSave: () => void;
  onPublish: () => void;
}) {
  const validation = useMemo(() => validateWorkflowDefinition(definition, {
    availableModelIds: modelOptions.map((model) => model.id),
  }), [definition, modelOptions]);
  const [nodes, setNodes] = useNodesState<CanvasNode>(canvasNodes(definition, validation.errors));
  const [edges, setEdges] = useEdgesState<CanvasEdge>(canvasEdges(definition));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [showAdvancedResources, setShowAdvancedResources] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const catalogPanelRef = useRef<HTMLElement | null>(null);
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const panelReturnFocusRef = useRef<HTMLElement | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const [query, setQuery] = useState('');
  const [debugExecutionId, setDebugExecutionId] = useState<string | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugPayload | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testTarget, setTestTarget] = useState<{ kind: 'workflow' } | { kind: 'node'; nodeId: string } | null>(null);
  const debugNodeStates = useMemo(() => debugSnapshot
    ? deriveWorkflowDebugNodeStates(debugSnapshot.execution, debugSnapshot.events)
    : {}, [debugSnapshot]);
  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 1279px)');
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

  useEffect(() => {
    if (!isNarrowViewport || (!catalogOpen && !inspectorOpen)) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setCatalogOpen(false);
      setInspectorOpen(false);
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
    setNodes(canvasNodes(definition, validation.errors, selectedNodeId, debugNodeStates));
    setEdges(canvasEdges(definition));
  }, [debugNodeStates, definition, selectedNodeId, setEdges, setNodes, validation.errors]);

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

  useEffect(() => {
    if (!flowInstance) return;
    const frame = window.requestAnimationFrame(() => flowInstance.fitView({ duration: 250, padding: 0.28 }));
    return () => window.cancelAnimationFrame(frame);
  }, [flowInstance, showAdvancedResources]);

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
    let nextNodes = applyNodeChanges(changes, nodes);
    const removedNodeIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    let nextEdges = edges;
    if (removedNodeIds.size > 0) {
      const lifecycle = deleteWorkflowNodesAndPrivateAttachments({
        nodes: nextNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
        connections: edges.map((edge) => edge.data!.connection),
        nodeIds: removedNodeIds,
      });
      const reconciled = reconcileCanvasGraph(nextNodes, edges, lifecycle);
      nextNodes = reconciled.nodes;
      nextEdges = reconciled.edges;
    }
    setNodes(nextNodes);
    if (nextEdges !== edges) setEdges(nextEdges);
    if (selectedNodeId && removedNodeIds.has(selectedNodeId)) setSelectedNodeId(null);

    const shouldPersist = changes.some((change) =>
      change.type === 'remove'
      || (change.type === 'position' && change.dragging === false),
    );
    if (shouldPersist) commit(nextNodes, nextEdges);
  }, [commit, edges, nodes, selectedNodeId, setEdges, setNodes]);

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
    const meta = CONNECTION_META[connection.connectionType];
    const nextEdge: CanvasEdge = {
      id,
      source: source.id,
      target: target.id,
      sourceHandle: candidate.sourceHandle,
      targetHandle: candidate.targetHandle,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 16, height: 16 },
      style: { stroke: meta.color, strokeWidth: 1.8, strokeDasharray: meta.dashed ? '6 5' : undefined },
      data: { connection },
    };
    const nextEdges = [...edges, nextEdge];
    setEdges(nextEdges);
    commit(nodes, nextEdges);
  }, [commit, edges, nodes, setEdges]);

  const createAgentDefaults = useCallback((agent: WorkflowNode, position: { x: number; y: number }, currentNodes: CanvasNode[], currentEdges: CanvasEdge[]) => {
    const bundle = createPrivateAgentResourceBundle({ agent, position, model: defaultModel });
    const additionNodes = bundle.nodes.map((workflowNode) => ({ id: workflowNode.id, type: 'workflow' as const, position: workflowNode.position, data: { workflowNode, errorCount: 0 } }));
    const additionEdges = bundle.connections.map(canvasEdge);
    return { nodes: [...currentNodes, ...additionNodes], edges: [...currentEdges, ...additionEdges] };
  }, [defaultModel]);

  const addCatalogItem = useCallback((input: {
    type?: string;
    tool?: CatalogTool;
    position: { x: number; y: number };
  }) => {
    const { type, tool, position } = input;
    let workflowNode: WorkflowNode | null = null;
    if (tool) {
      if (!isNativeAgentToolAttachable(tool)) return;
      workflowNode = createWorkflowNode(tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal', {
        id: `tool_${crypto.randomUUID()}`,
        name: getNativeAgentToolLabel(tool),
        position,
        config: buildNativeAgentToolConfig(tool),
      });
    } else if (type) {
      const manifest = getWorkflowNodeManifest(type);
      if (!manifest || manifest.availability !== 'stable') return;
      workflowNode = createWorkflowNode(type, {
        id: `${type.replace('.', '_')}_${crypto.randomUUID()}`,
        position,
        config: type === 'ai.agent' ? {
          name: 'Novo agente', role: 'especialista', persona: '', language: 'pt-BR', objective: '',
          instructions: [], completionCriteria: ['Concluir a tarefa com segurança.'], availableContext: ['input', 'context', 'variables'],
        } : {},
      });
    }
    if (!workflowNode) return;
    let nextNodes: CanvasNode[] = [...nodes, { id: workflowNode.id, type: 'workflow', position, data: { workflowNode, errorCount: 0 } }];
    let nextEdges = edges;
    if (workflowNode.type === 'ai.agent') {
      const withDefaults = createAgentDefaults(workflowNode, position, nextNodes, nextEdges);
      nextNodes = withDefaults.nodes;
      nextEdges = withDefaults.edges;
    }
    const previousSelectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId)?.data.workflowNode : null;
    const isExecutableNode = !getWorkflowNodeManifest(workflowNode.type)?.attachment;
    if (previousSelectedNode && isExecutableNode) {
      const targetPort = workflowNode.inputPorts.find((port) => port.connectionType === 'main');
      const sourcePort = previousSelectedNode.outputPorts
        .filter((port) => port.connectionType === 'main')
        .find((port) => port.multiple || !nextEdges.some((edge) => edge.source === previousSelectedNode.id && edge.sourceHandle === `out:${port.id}`));
      if (sourcePort && targetPort) {
        nextEdges = [...nextEdges, canvasEdge({
          id: `conn_${crypto.randomUUID()}`,
          sourceNodeId: previousSelectedNode.id,
          sourcePortId: sourcePort.id,
          targetNodeId: workflowNode.id,
          targetPortId: targetPort.id,
          connectionType: 'main',
        })];
      }
    }
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(workflowNode.id);
    if (getWorkflowNodeManifest(workflowNode.type)?.attachment) setShowAdvancedResources(true);
    openInspectorPanel();
    commit(nextNodes, nextEdges);
  }, [commit, createAgentDefaults, edges, nodes, openInspectorPanel, selectedNodeId, setEdges, setNodes]);

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

  const submitTest = async (payload: NativeWorkflowTestPayload) => {
    if (!testTarget || testRunning) return { error: 'Já existe um teste em andamento.' };
    setTestRunning(true);
    setDebugSnapshot(null);
    try {
      const executionId = testTarget.kind === 'workflow'
        ? await onTest?.(payload)
        : await onTestNode?.(testTarget.nodeId, payload);
      if (!executionId) return { error: 'A execução não foi iniciada. Revise a configuração e tente novamente.' };
      setDebugExecutionId(executionId);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Não foi possível iniciar a execução.' };
    } finally {
      setTestRunning(false);
    }
  };
  const updateSelectedNode = (workflowNode: WorkflowNode) => {
    const nextNodes = nodes.map((node) => node.id === workflowNode.id ? { ...node, data: { ...node.data, workflowNode } } : node);
    setNodes(nextNodes);
    commit(nextNodes, edges);
  };
  const requestDeleteSelectedNode = () => {
    if (selectedNode) setDeleteCandidateId(selectedNode.id);
  };
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

  const manifests = useMemo(() => listStableWorkflowNodeManifests().filter((manifest) => manifestMatches(manifest, query)), [query]);
  const grouped = useMemo(() => Object.entries(CATEGORY_META).map(([category, meta]) => ({
    category: category as WorkflowNodeCategory,
    meta,
    manifests: manifests.filter((manifest) => manifest.category === category && !manifest.attachment && !['tool.internal', 'tool.mcp'].includes(manifest.type)),
  })).filter((group) => group.manifests.length > 0), [manifests]);
  const attachmentManifests = useMemo(() => manifests.filter((manifest) => (
    manifest.attachment && !['tool.internal', 'tool.mcp'].includes(manifest.type)
  )), [manifests]);
  const libraryToolGroups = useMemo(() => groupNativeAgentTools(tools.filter((tool) => (
    isNativeAgentToolAttachable(tool)
    && (!query || `${getNativeAgentToolLabel(tool)} ${tool.name} ${tool.description} ${tool.serverName || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
  ))), [query, tools]);
  const hiddenResourceNodeIds = useMemo(() => new Set(showAdvancedResources ? [] : nodes
    .filter((node) => getWorkflowNodeManifest(node.data.workflowNode.type)?.attachment)
    .map((node) => node.id)), [nodes, showAdvancedResources]);
  const flowNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    hidden: hiddenResourceNodeIds.has(node.id),
  })), [hiddenResourceNodeIds, nodes]);
  const flowEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    hidden: hiddenResourceNodeIds.has(edge.source) || hiddenResourceNodeIds.has(edge.target),
  })), [edges, hiddenResourceNodeIds]);
  const deleteCandidate = deleteCandidateId ? nodes.find((node) => node.id === deleteCandidateId) || null : null;
  const statusLabel = isSaving
    ? 'Salvando…'
    : isPublishing
      ? 'Publicando…'
      : !validation.valid
        ? `${validation.errors.length} pendência(s)`
        : isDirty
          ? 'Alterações não salvas'
          : hasDraft
            ? 'Rascunho salvo'
            : 'Publicado';

  return (
    <div className={NATIVE_WORKFLOW_SHELL_CLASS}>
      {isNarrowViewport && (catalogOpen || inspectorOpen) ? <button type="button" aria-label="Fechar painel aberto" onClick={() => { setCatalogOpen(false); setInspectorOpen(false); }} className="absolute inset-0 z-40 bg-slate-950/70 backdrop-blur-[1px]" /> : null}
      {catalogOpen && <aside ref={catalogPanelRef} aria-label="Biblioteca de blocos" aria-modal={isNarrowViewport || undefined} role={isNarrowViewport ? 'dialog' : undefined} className="absolute inset-y-0 left-0 z-50 flex w-[min(290px,88vw)] shrink-0 flex-col border-r border-slate-700/70 bg-[#101821] shadow-2xl xl:relative xl:z-auto xl:w-[clamp(230px,20vw,290px)] xl:shadow-none">
        <div className="border-b border-slate-700/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Biblioteca de blocos</span>
            <Button variant="ghost" size="icon" onClick={() => setCatalogOpen(false)} className="h-8 w-8 text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Fechar biblioteca">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar blocos" className="border-white/10 bg-[#191c20] pl-9" /></div>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {grouped.map((group) => {
            const Icon = group.meta.icon;
            return <section key={group.category}><h3 className="mb-2 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Icon className="h-3.5 w-3.5" />{group.meta.label}</h3>{group.manifests.map((manifest) => <CatalogButton key={manifest.type} manifest={manifest} onAdd={() => addCatalogItem({ type: manifest.type, position: centerCanvasPosition() })} />)}</section>;
          })}
          {attachmentManifests.length > 0 && <details className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2"><summary className="cursor-pointer px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Recursos avançados</summary><p className="px-2 pb-2 text-xs leading-relaxed text-slate-400">No uso comum, configure modelo, conhecimento, memória e proteções diretamente no bloco Agente de IA.</p>{attachmentManifests.map((manifest) => <CatalogButton key={manifest.type} manifest={manifest} onAdd={() => addCatalogItem({ type: manifest.type, position: centerCanvasPosition() })} />)}</details>}
          {toolsLoading ? <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs text-slate-300"><Loader2 className="h-4 w-4 animate-spin text-cyan-300" />Carregando ferramentas…</div> : null}
          {tools.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Wrench className="h-3.5 w-3.5" />Ferramentas disponíveis</h3>
              {libraryToolGroups.map((group) => (
                <div key={group.id} className="mb-3">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{group.label}</p>
                  {group.tools.map((tool) => {
                    const eligible = isNativeAgentToolAttachable(tool);
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        draggable={eligible}
                        disabled={!eligible}
                        title={getNativeAgentToolUnavailableReason(tool) || tool.description}
                        onClick={() => addToolFromLibrary(tool)}
                        onDragStart={(event) => event.dataTransfer.setData('application/dialogy-workflow-tool', JSON.stringify(tool))}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-300"><Wrench className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-xs font-medium">{getNativeAgentToolLabel(tool)}</span><span className="block truncate text-xs text-slate-400">{getNativeAgentToolUnavailableReason(tool) || tool.description}</span></span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </section>
          )}
          {!toolsLoading && grouped.length === 0 && attachmentManifests.length === 0 && libraryToolGroups.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 p-5 text-center"><p className="text-sm font-medium text-slate-200">Nenhum bloco encontrado</p><p className="mt-1 text-xs text-slate-400">Tente outro nome ou limpe a busca.</p>{query ? <Button type="button" size="sm" variant="ghost" onClick={() => setQuery('')} className="mt-2 text-cyan-200">Limpar busca</Button> : null}</div> : null}
        </div>
      </aside>}

      <main className="flex min-w-0 flex-1 flex-col bg-[#080d14]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700/70 bg-[#101821] px-3 py-2.5 2xl:flex-nowrap 2xl:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {!catalogOpen && <Button variant="ghost" size="icon" onClick={openCatalogPanel} className="shrink-0 rounded-xl text-slate-300" title="Abrir biblioteca"><PanelLeftOpen className="h-4 w-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={handleBack} className="shrink-0 rounded-xl" aria-label="Voltar para automações"><ArrowLeft className="h-4 w-4" /></Button>
            <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-400">Flowbuilder agent-first</p><h1 className="max-w-[240px] truncate text-sm font-semibold">{definition.name}</h1></div>
            <button type="button" data-testid="workflow-validation-status" onClick={() => { setSelectedNodeId(null); openInspectorPanel(); }} title="Abrir validação da automação" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"><Badge aria-live="polite" className={cn(validation.valid && !isDirty ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200')}><span className="hidden sm:inline">{statusLabel}</span><span className="sm:hidden">{!validation.valid ? validation.errors.length : isDirty ? '•' : '✓'}</span></Badge></button>
          </div>
          <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-0.5">
            {onOpenPanel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="shrink-0 text-slate-300 gap-2 hover:bg-white/[0.08] hover:text-white">
                    <Settings2 className="h-4 w-4" />
                    Gerenciar agente
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 border-white/10 bg-[#111316] text-slate-200 shadow-2xl">
                  <DropdownMenuItem onClick={() => onOpenPanel('knowledge')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <Database className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium">Conhecimento</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('capabilities')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium">Habilidades</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('analytics')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <LineChart className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-medium">Analytics</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('decision')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <BrainCircuit className="h-4 w-4 text-sky-400" />
                    <span className="text-sm font-medium">Motor de decisão</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={() => onOpenPanel('playground')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white">
                    <TestTube2 className="h-4 w-4 text-rose-400" />
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
                </DropdownMenuContent>
              </DropdownMenu>
            ) : onOpenSettings ? (
              <Button variant="ghost" size="sm" onClick={onOpenSettings} className="shrink-0 text-slate-300">
                <Settings2 className="mr-2 h-4 w-4" /> Ajustes
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setShowAdvancedResources((current) => !current)} aria-pressed={showAdvancedResources} title={showAdvancedResources ? 'Ocultar recursos técnicos do canvas' : 'Exibir recursos técnicos no canvas'} className="shrink-0 text-slate-300"><Braces className="h-4 w-4 2xl:mr-2" /><span className="hidden 2xl:inline">{showAdvancedResources ? 'Ocultar recursos' : 'Ver recursos'}</span></Button>
            {onTest && <Button variant="ghost" size="sm" onClick={() => setTestTarget({ kind: 'workflow' })} disabled={!validation.valid || testRunning || isSaving || isPublishing} className="shrink-0"><Play className="mr-2 h-4 w-4" />{testRunning ? 'Iniciando…' : 'Testar'}</Button>}
            <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving || isPublishing || !isDirty} aria-busy={isSaving} className="shrink-0 border-white/10 bg-[#192430]"><Save className="mr-2 h-4 w-4" />{isSaving ? 'Salvando…' : 'Salvar'}</Button>
            <Button size="sm" onClick={onPublish} disabled={isSaving || isPublishing || !validation.valid || (!hasDraft && !isDirty)} aria-busy={isPublishing} title={!validation.valid ? 'Resolva as pendências antes de publicar.' : (!hasDraft && !isDirty) ? 'Nenhuma alteração nova para publicar.' : 'Publicar rascunho'} className="shrink-0"><Sparkles className="mr-2 h-4 w-4" />{isPublishing ? 'Publicando…' : 'Publicar'}</Button>
            {!inspectorOpen && <Button variant="ghost" size="icon" onClick={openInspectorPanel} className="h-8 w-8 shrink-0 text-slate-300" title="Abrir inspetor"><PanelRightOpen className="h-4 w-4" /></Button>}
          </div>
        </header>
        <div className={cn('min-h-0 bg-[#080d14] flex-1 flex flex-col', debugExecutionId && !activePanelContent ? 'basis-[56%]' : 'flex-1')} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
          {activePanelContent ? (
            <div className="h-full w-full overflow-y-auto px-6 py-6 text-slate-100 bg-[#080d14]">
              {activePanelContent}
            </div>
          ) : (
            <ReactFlow<CanvasNode, CanvasEdge>
              className="bg-[radial-gradient(circle_at_50%_0%,rgba(30,64,90,0.22),transparent_55%)]"
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onInit={setFlowInstance}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => { setSelectedNodeId(node.id); openInspectorPanel(); }}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              minZoom={0.25}
              maxZoom={1.8}
              deleteKeyCode={['Backspace', 'Delete']}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgba(125,172,205,0.24)" />
              <Controls className="!overflow-hidden !rounded-xl !border-slate-600/70 !bg-[#172330] !text-slate-200 !shadow-xl [&>button]:!border-slate-600/60 [&>button]:!bg-[#172330] [&>button:hover]:!bg-[#25384a]" />
              <MiniMap pannable zoomable className="!rounded-xl !border !border-slate-600/70 !bg-[#101821] !shadow-xl" nodeColor="#49667d" maskColor="rgba(3,8,14,0.7)" />
            </ReactFlow>
          )}
        </div>
        {debugExecutionId && !activePanelContent && (
          <section className="relative min-h-[280px] flex-1 border-t border-sky-500/25 bg-[#101214] shadow-[0_-12px_35px_rgba(0,0,0,.35)]">
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

      {inspectorOpen && <aside ref={inspectorPanelRef} aria-label="Inspetor da automação" aria-modal={isNarrowViewport || undefined} role={isNarrowViewport ? 'dialog' : undefined} className="absolute inset-y-0 right-0 z-50 w-[min(420px,94vw)] shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[#101821] shadow-2xl xl:relative xl:z-auto xl:w-[clamp(350px,30vw,430px)] xl:shadow-none">
        {selectedNode ? (
          <div className="p-5">
            <div className="mb-5">
              <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">{selectedNode.data.workflowNode.type === 'ai.agent' ? 'Configurar agente' : 'Configurar bloco'}</p><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 shrink-0 text-slate-400"><PanelRightClose className="h-4 w-4" /><span className="sr-only">Fechar inspetor</span></Button></div>
              <Label htmlFor={`workflow-node-name-${selectedNode.id}`} className="mt-3 block text-xs text-slate-400">{selectedNode.data.workflowNode.type === 'ai.agent' ? 'Nome do agente' : 'Nome do bloco'}</Label>
              <Input id={`workflow-node-name-${selectedNode.id}`} value={selectedNode.data.workflowNode.name} onChange={(event) => updateSelectedNode({
                ...selectedNode.data.workflowNode,
                name: event.target.value,
                config: selectedNode.data.workflowNode.type === 'ai.agent'
                  ? { ...selectedNode.data.workflowNode.config, name: event.target.value }
                  : selectedNode.data.workflowNode.config,
              })} className="mt-1.5 rounded-xl border-slate-600/70 bg-[#192430] font-semibold text-slate-100 placeholder:text-slate-500" />
              {onTestNode && <Button variant="outline" size="sm" onClick={openSelectedNodeTest} disabled={Boolean(selectedTestBlockedReason) || testRunning} title={selectedTestBlockedReason || 'Executar este bloco com as dependências anteriores simuladas'} className="mt-3 w-full border-sky-500/30 bg-sky-500/[0.08] text-sky-100 hover:bg-sky-500/[0.15]"><Play className="mr-2 h-4 w-4" />{testRunning ? 'Iniciando…' : 'Testar deste bloco'}</Button>}
              {selectedNode.data.workflowNode.type !== 'ai.agent' ? <Button variant="destructive" size="sm" onClick={requestDeleteSelectedNode} title="Excluir bloco (Delete)" className="mt-3 w-full"><Trash2 className="mr-2 h-4 w-4" />Excluir bloco</Button> : null}
            </div>
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
                    modelOptions={modelOptions}
                     knowledgeDocuments={knowledgeDocuments}
                     knowledgeCollections={knowledgeCollections}
                     onManageKnowledge={() => onOpenPanel?.('knowledge')}
                     onManageModels={() => onOpenModelSettings ? onOpenModelSettings() : onOpenPanel?.('settings')}
                   />
                : <GenericInspector node={selectedNode.data.workflowNode} manifest={getWorkflowNodeManifest(selectedNode.data.workflowNode.type)!} onUpdate={updateSelectedNode} />}
          </div>
        ) : (
          <div className="p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Validação</p><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 text-slate-400"><PanelRightClose className="h-4 w-4" /></Button></div><div className="mt-4 space-y-2">{validation.errors.length === 0 ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4 text-sm text-emerald-200">A automação está estruturalmente válida.</div> : validation.errors.map((issue, index) => <button key={`${issue.code}-${index}`} type="button" onClick={() => { if (issue.nodeId) setSelectedNodeId(issue.nodeId); }} className="w-full rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-left transition hover:bg-amber-500/[0.14]"><span className="block text-xs font-medium text-amber-200">{issue.message}</span><span className="mt-1 block font-mono text-[9px] text-amber-400/70">{issue.code}</span></button>)}</div><div className="mt-6 border-t border-slate-700/70 pt-5"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Legenda</p><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(CONNECTION_META).filter(([type]) => type !== 'agent_tool').map(([type, meta]) => <div key={type} className="flex items-center gap-2 text-[10px] text-slate-300"><span className="w-7 border-t-2" style={{ borderColor: meta.color, borderStyle: meta.dashed ? 'dashed' : 'solid' }} />{meta.label}</div>)}</div></div></div>
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
      <NativeWorkflowTestDialog
        open={Boolean(testTarget)}
        onOpenChange={(open) => { if (!open) setTestTarget(null); }}
        onSubmit={submitTest}
        workflowName={definition.name}
        title={testTarget?.kind === 'node' ? `Testar ${selectedWorkflowNode?.name || 'bloco'}` : 'Testar automação'}
        description={testTarget?.kind === 'node' ? 'Simule a mensagem e as dependências anteriores sem publicar o rascunho.' : 'Converse com o agente usando exatamente o rascunho que está no canvas.'}
        initialMessage={testTarget?.kind === 'node' ? 'Teste isolado iniciado pelo editor.' : 'Olá, preciso de ajuda.'}
        presets={testTarget?.kind === 'workflow' ? [
          { id: 'duvida', label: 'Dúvida geral', description: 'Valida resposta e consulta à base.', message: 'Olá, preciso de ajuda com uma dúvida.' },
          { id: 'financeiro', label: 'Financeiro', description: 'Exercita ferramentas e confirmação.', message: 'Preciso consultar uma fatura e entender as formas de pagamento.' },
          { id: 'humano', label: 'Transferência', description: 'Confere a rota segura para uma pessoa.', message: 'Quero falar com um atendente humano.' },
        ] : []}
        dependencies={testTarget?.kind === 'node' ? selectedTestDependencyIds.map((dependencyId) => {
          const dependency = definition.nodes.find((node) => node.id === dependencyId);
          return {
            id: dependencyId,
            label: dependency?.name || dependencyId,
            description: dependency ? `Saída simulada de ${dependency.type}.` : undefined,
            required: true,
            defaultOutput: {},
          };
        }) : []}
        fixtureMode={testTarget?.kind === 'node' && selectedTestDependencyIds.length > 0 ? 'required' : 'hidden'}
        loading={testRunning}
        closeOnSuccess
        historyStorageKey={`dialogy-workflow-test:${definition.id}`}
      />
    </div>
  );
}
