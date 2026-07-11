'use client';

import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
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
import { Button } from '@/components/ui/button';
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
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { AiModelCatalogEntry } from '@/lib/ai-models';
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

type CatalogTool = {
  name: string;
  description: string;
  source: 'dialogy' | 'mcp';
  serverId?: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresHumanApproval?: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
};

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
  if (type === 'logic.ai_router' || type === 'logic.switch' || type === 'logic.if') return GitBranch;
  if (type.startsWith('knowledge.') || type.startsWith('memory.')) return Database;
  if (type.startsWith('tool.')) return Wrench;
  if (type === 'guardrail.policy') return ShieldCheck;
  if (type === 'output.respond') return Send;
  if (type === 'output.handoff') return UserRound;
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

function canvasEdges(definition: WorkflowDefinition): CanvasEdge[] {
  return definition.connections.map((connection) => {
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
  });
}

function manifestMatches(manifest: WorkflowNodeManifest, query: string) {
  if (!query) return true;
  const haystack = `${manifest.label} ${manifest.description} ${manifest.type}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function CatalogButton({ manifest }: { manifest: WorkflowNodeManifest }) {
  const Icon = nodeIcon(manifest.type);
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/dialogy-workflow-node', manifest.type);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05]"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-sky-300"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-200">{manifest.label}</span><span className="block truncate text-[10px] text-slate-500">{manifest.description}</span></span>
    </button>
  );
}

function AgentInspector({ node, onUpdate }: { node: WorkflowNode; onUpdate: (node: WorkflowNode) => void }) {
  const config = node.config;
  const set = (key: string, value: unknown) => onUpdate({ ...node, config: { ...config, [key]: value } });
  const arrayValue = (key: string) => Array.isArray(config[key]) ? (config[key] as unknown[]).map(String).join('\n') : '';
  return (
    <div className="space-y-5">
      <div className="space-y-2"><Label>Nome do agente</Label><Input value={String(config.name || '')} onChange={(event) => set('name', event.target.value)} /></div>
      <div className="space-y-2"><Label>Papel</Label><Input value={String(config.role || '')} onChange={(event) => set('role', event.target.value)} placeholder="Ex.: especialista de suporte" /></div>
      <div className="space-y-2"><Label>Persona</Label><Textarea value={String(config.persona || '')} onChange={(event) => set('persona', event.target.value)} className="min-h-32" placeholder="Identidade, tom, estilo e limites de comunicação." /></div>
      <div className="space-y-2"><Label>Idioma</Label><Input value={String(config.language || 'pt-BR')} onChange={(event) => set('language', event.target.value)} /></div>
      <div className="space-y-2"><Label>Objetivo</Label><Textarea value={String(config.objective || '')} onChange={(event) => set('objective', event.target.value)} className="min-h-24" /></div>
      <div className="space-y-2"><Label>Instruções, uma por linha</Label><Textarea value={arrayValue('instructions')} onChange={(event) => set('instructions', event.target.value.split('\n').map((value) => value.trim()).filter(Boolean))} className="min-h-28" /></div>
      <div className="space-y-2"><Label>Critérios de conclusão</Label><Textarea value={arrayValue('completionCriteria')} onChange={(event) => set('completionCriteria', event.target.value.split('\n').map((value) => value.trim()).filter(Boolean))} className="min-h-24" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Máx. turnos</Label><Input type="number" value={Number(config.maxTurns || 8)} onChange={(event) => set('maxTurns', Number(event.target.value))} /></div>
        <div className="space-y-2"><Label>Máx. tools</Label><Input type="number" value={Number(config.maxToolCalls || 20)} onChange={(event) => set('maxToolCalls', Number(event.target.value))} /></div>
      </div>
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
  isSaving,
  isPublishing,
  onChange,
  onBack,
  onOpenSettings,
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
  isSaving: boolean;
  isPublishing: boolean;
  onChange: (definition: WorkflowDefinition) => void;
  onBack: () => void;
  onOpenSettings?: () => void;
  onOpenPanel?: (panel: 'knowledge' | 'capabilities' | 'analytics' | 'decision' | 'settings' | 'playground' | 'versions') => void;
  activePanelContent?: React.ReactNode;
  onTest?: () => Promise<string | null | undefined> | string | null | undefined;
  onTestNode?: (
    nodeId: string,
    fixtures: Record<string, { output: Record<string, unknown>; statePatch?: Record<string, unknown> }>,
  ) => Promise<string | null | undefined> | string | null | undefined;
  onSave: () => void;
  onPublish: () => void;
}) {
  const validation = useMemo(() => validateWorkflowDefinition(definition), [definition]);
  const [nodes, setNodes] = useNodesState<CanvasNode>(canvasNodes(definition, validation.errors));
  const [edges, setEdges] = useEdgesState<CanvasEdge>(canvasEdges(definition));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const [query, setQuery] = useState('');
  const [debugExecutionId, setDebugExecutionId] = useState<string | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugPayload | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const debugNodeStates = useMemo(() => debugSnapshot
    ? deriveWorkflowDebugNodeStates(debugSnapshot.execution, debugSnapshot.events)
    : {}, [debugSnapshot]);
  useEffect(() => {
    if (!window.matchMedia('(min-width: 1280px)').matches) {
      setCatalogOpen(false);
      setInspectorOpen(false);
    }
  }, []);
  useEffect(() => {
    setNodes(canvasNodes(definition, validation.errors, selectedNodeId, debugNodeStates));
    setEdges(canvasEdges(definition));
  }, [debugNodeStates, definition, selectedNodeId, setEdges, setNodes, validation.errors]);

  const runTest = useCallback(async () => {
    if (!onTest || testRunning) return;
    setTestRunning(true);
    setDebugSnapshot(null);
    try {
      const executionId = await onTest();
      if (executionId) setDebugExecutionId(executionId);
    } catch (error) {
      toast({
        title: 'Falha ao iniciar o teste',
        description: error instanceof Error ? error.message : 'Não foi possível iniciar a execução.',
        variant: 'destructive',
      });
    } finally {
      setTestRunning(false);
    }
  }, [onTest, testRunning]);

  const commit = useCallback((nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => {
    const nextDefinition: WorkflowDefinition = {
      ...definition,
      nodes: nextNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      connections: nextEdges.map((edge) => edge.data!.connection),
      updatedAt: new Date().toISOString(),
    };
    onChange(nextDefinition);
  }, [definition, onChange]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const nextNodes = applyNodeChanges(changes, nodes);
    setNodes(nextNodes);

    const removedNodeIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    const nextEdges = removedNodeIds.size > 0
      ? edges.filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target))
      : edges;
    if (nextEdges !== edges) setEdges(nextEdges);
    if (selectedNodeId && removedNodeIds.has(selectedNodeId)) setSelectedNodeId(null);

    const shouldPersist = changes.some((change) =>
      change.type === 'remove'
      || (change.type === 'position' && change.dragging === false),
    );
    if (shouldPersist) commit(nextNodes, nextEdges);
  }, [commit, edges, nodes, selectedNodeId, setEdges, setNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange<CanvasEdge>[]) => {
    const nextEdges = applyEdgeChanges(changes, edges);
    setEdges(nextEdges);
    if (changes.some((change) => change.type === 'remove')) commit(nodes, nextEdges);
  }, [commit, edges, nodes, setEdges]);

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
    const additions: WorkflowNode[] = [];
    const connections: WorkflowConnection[] = [];
    const ensureAttachment = (type: 'ai.model' | 'memory.session' | 'guardrail.policy', connectionType: 'model' | 'memory' | 'guardrail', y: number) => {
      const existing = currentNodes.find((node) => node.data.workflowNode.type === type)?.data.workflowNode;
      const attachment = existing || createWorkflowNode(type, {
        id: `${type.replace('.', '_')}_${crypto.randomUUID()}`,
        position: { x: position.x - 290, y },
        config: type === 'ai.model' ? defaultModel : type === 'guardrail.policy'
          ? { name: 'Políticas da automação', checks: [], onViolation: 'route_to_error' }
          : {},
      });
      if (!existing) additions.push(attachment);
      const sourcePort = attachment.outputPorts.find((port) => port.connectionType === connectionType)!;
      const targetPort = agent.inputPorts.find((port) => port.connectionType === connectionType)!;
      connections.push({
        id: `conn_${crypto.randomUUID()}`,
        sourceNodeId: attachment.id,
        sourcePortId: sourcePort.id,
        targetNodeId: agent.id,
        targetPortId: targetPort.id,
        connectionType,
      });
    };
    ensureAttachment('ai.model', 'model', position.y - 110);
    ensureAttachment('memory.session', 'memory', position.y + 40);
    ensureAttachment('guardrail.policy', 'guardrail', position.y + 190);
    const additionNodes = additions.map((workflowNode) => ({ id: workflowNode.id, type: 'workflow' as const, position: workflowNode.position, data: { workflowNode, errorCount: 0 } }));
    const additionEdges = connections.map((item): CanvasEdge => {
      const meta = CONNECTION_META[item.connectionType];
      return {
        id: item.id, source: item.sourceNodeId, target: item.targetNodeId,
        sourceHandle: `out:${item.sourcePortId}`, targetHandle: `in:${item.targetPortId}`, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: meta.color },
        style: { stroke: meta.color, strokeWidth: 1.8, strokeDasharray: '6 5' }, data: { connection: item },
      };
    });
    return { nodes: [...currentNodes, ...additionNodes], edges: [...currentEdges, ...additionEdges] };
  }, [defaultModel]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/dialogy-workflow-node');
    const toolRaw = event.dataTransfer.getData('application/dialogy-workflow-tool');
    const position = flowInstance
      ? flowInstance.screenToFlowPosition({ x: event.clientX - 110, y: event.clientY - 50 })
      : { x: event.clientX - event.currentTarget.getBoundingClientRect().left - 105, y: event.clientY - event.currentTarget.getBoundingClientRect().top - 50 };
    let workflowNode: WorkflowNode | null = null;
    if (toolRaw) {
      const tool = JSON.parse(toolRaw) as CatalogTool;
      workflowNode = createWorkflowNode(tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal', {
        id: `tool_${crypto.randomUUID()}`,
        name: tool.name,
        position,
        config: {
          name: tool.name,
          description: tool.description,
          action: tool.name,
          serverId: tool.serverId || '',
          allowedTools: tool.source === 'mcp' ? [tool.name] : [],
          inputSchema: tool.inputSchema || {},
          outputSchema: tool.outputSchema || {},
          requiresConfirmation: tool.requiresHumanApproval === true,
          permissionScope: tool.requiresHumanApproval ? 'automations:execute_sensitive_tool' : undefined,
          idempotent: tool.riskLevel !== 'high',
        },
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
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(workflowNode.id);
    setInspectorOpen(true);
    commit(nextNodes, nextEdges);
  }, [commit, createAgentDefaults, edges, flowInstance, nodes, setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedWorkflowNode = selectedNode?.data.workflowNode || null;
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
  const runSelectedNodeTest = async () => {
    if (!selectedWorkflowNode || !onTestNode || selectedTestBlockedReason || testRunning) return;
    const fixtures: Record<string, { output: Record<string, unknown>; statePatch?: Record<string, unknown> }> = {};
    for (const dependencyId of selectedTestDependencyIds) {
      const dependency = definition.nodes.find((node) => node.id === dependencyId);
      const raw = window.prompt(
        `Fixture JSON da saída de "${dependency?.name || dependencyId}"`,
        JSON.stringify({ output: {}, statePatch: {} }, null, 2),
      );
      if (raw === null) return;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('fixture_object_required');
        const fixture = parsed as Record<string, unknown>;
        if (!fixture.output || typeof fixture.output !== 'object' || Array.isArray(fixture.output)) throw new Error('fixture_output_required');
        if (fixture.statePatch !== undefined && (!fixture.statePatch || typeof fixture.statePatch !== 'object' || Array.isArray(fixture.statePatch))) throw new Error('fixture_state_patch_invalid');
        fixtures[dependencyId] = {
          output: fixture.output as Record<string, unknown>,
          statePatch: fixture.statePatch as Record<string, unknown> | undefined,
        };
      } catch {
        toast({
          title: 'Fixture inválida',
          description: 'Use { "output": { ... }, "statePatch": { ... } }.',
          variant: 'destructive',
        });
        return;
      }
    }
    setTestRunning(true);
    setDebugSnapshot(null);
    try {
      const executionId = await onTestNode(selectedWorkflowNode.id, fixtures);
      if (executionId) setDebugExecutionId(executionId);
    } catch (error) {
      toast({
        title: 'Falha ao testar este bloco',
        description: error instanceof Error ? error.message : 'Não foi possível iniciar o teste isolado.',
        variant: 'destructive',
      });
    } finally {
      setTestRunning(false);
    }
  };
  const updateSelectedNode = (workflowNode: WorkflowNode) => {
    const nextNodes = nodes.map((node) => node.id === workflowNode.id ? { ...node, data: { ...node.data, workflowNode } } : node);
    setNodes(nextNodes);
    commit(nextNodes, edges);
  };
  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    const nextNodes = nodes.filter((node) => node.id !== selectedNode.id);
    const nextEdges = edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(null);
    commit(nextNodes, nextEdges);
  };

  const manifests = useMemo(() => listStableWorkflowNodeManifests().filter((manifest) => manifestMatches(manifest, query)), [query]);
  const grouped = useMemo(() => Object.entries(CATEGORY_META).map(([category, meta]) => ({
    category: category as WorkflowNodeCategory,
    meta,
    manifests: manifests.filter((manifest) => manifest.category === category && !['tool.internal', 'tool.mcp'].includes(manifest.type)),
  })).filter((group) => group.manifests.length > 0), [manifests]);

  return (
    <div className={NATIVE_WORKFLOW_SHELL_CLASS}>
      {catalogOpen && <aside className="absolute inset-y-0 left-0 z-30 flex w-[min(290px,88vw)] shrink-0 flex-col border-r border-slate-700/70 bg-[#101821] shadow-2xl xl:relative xl:z-auto xl:w-[clamp(230px,20vw,290px)] xl:shadow-none">
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
            return <section key={group.category}><h3 className="mb-2 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"><Icon className="h-3.5 w-3.5" />{group.meta.label}</h3>{group.manifests.map((manifest) => <CatalogButton key={manifest.type} manifest={manifest} />)}</section>;
          })}
          {tools.length > 0 && <section><h3 className="mb-2 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"><Wrench className="h-3.5 w-3.5" />Ferramentas disponíveis</h3>{tools.filter((tool) => !query || `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase())).map((tool) => <button key={tool.name} type="button" draggable onDragStart={(event) => event.dataTransfer.setData('application/dialogy-workflow-tool', JSON.stringify(tool))} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05]"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-300"><Wrench className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-xs font-medium">{tool.name}</span><span className="block truncate text-[10px] text-slate-500">{tool.description}</span></span></button>)}</section>}
        </div>
      </aside>}

      <main className="flex min-w-0 flex-1 flex-col bg-[#080d14]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700/70 bg-[#101821] px-3 py-2.5 2xl:flex-nowrap 2xl:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {!catalogOpen && <Button variant="ghost" size="icon" onClick={() => setCatalogOpen(true)} className="shrink-0 rounded-xl text-slate-300" title="Abrir biblioteca"><PanelLeftOpen className="h-4 w-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 rounded-xl"><ArrowLeft className="h-4 w-4" /></Button>
            <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-400">Flowbuilder agent-first</p><h1 className="max-w-[240px] truncate text-sm font-semibold">{definition.name}</h1></div>
            <Badge className={cn('hidden shrink-0 sm:inline-flex', validation.valid ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200')}>{validation.valid ? 'Pronto para publicar' : `${validation.errors.length} pendência(s)`}</Badge>
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
            {onTest && <Button variant="ghost" size="sm" onClick={() => void runTest()} disabled={!validation.valid || testRunning} className="shrink-0"><Play className="mr-2 h-4 w-4" />{testRunning ? 'Iniciando…' : 'Testar'}</Button>}
            <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving} className="shrink-0 border-white/10 bg-[#192430]"><Save className="mr-2 h-4 w-4" />Salvar</Button>
            <Button size="sm" onClick={onPublish} disabled={isPublishing || !validation.valid} className="shrink-0"><Sparkles className="mr-2 h-4 w-4" />Publicar</Button>
            {!inspectorOpen && <Button variant="ghost" size="icon" onClick={() => setInspectorOpen(true)} className="h-8 w-8 shrink-0 text-slate-300" title="Abrir inspetor"><PanelRightOpen className="h-4 w-4" /></Button>}
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
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onInit={setFlowInstance}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => { setSelectedNodeId(node.id); setInspectorOpen(true); }}
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

      {inspectorOpen && <aside className="absolute inset-y-0 right-0 z-30 w-[min(360px,92vw)] shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[#101821] shadow-2xl xl:relative xl:z-auto xl:w-[clamp(310px,26vw,360px)] xl:shadow-none">
        {selectedNode ? (
          <div className="p-5">
            <div className="mb-5">
              <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">Configurar bloco</p><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 shrink-0 text-slate-400"><PanelRightClose className="h-4 w-4" /><span className="sr-only">Fechar inspetor</span></Button></div>
              <Input value={selectedNode.data.workflowNode.name} onChange={(event) => updateSelectedNode({ ...selectedNode.data.workflowNode, name: event.target.value })} className="mt-2 border-slate-600/70 bg-[#192430] font-semibold" />
              {onTestNode && <Button variant="outline" size="sm" onClick={() => void runSelectedNodeTest()} disabled={Boolean(selectedTestBlockedReason) || testRunning} title={selectedTestBlockedReason || 'Executar este bloco com as dependências anteriores simuladas'} className="mt-3 w-full border-sky-500/30 bg-sky-500/[0.08] text-sky-100 hover:bg-sky-500/[0.15]"><Play className="mr-2 h-4 w-4" />{testRunning ? 'Iniciando…' : 'Testar deste bloco'}</Button>}
              <Button variant="destructive" size="sm" onClick={deleteSelectedNode} title="Excluir bloco (Delete)" className="mt-3 w-full"><Trash2 className="mr-2 h-4 w-4" />Excluir bloco</Button>
            </div>
            {selectedNode.data.workflowNode.type === 'ai.agent'
              ? <AgentInspector node={selectedNode.data.workflowNode} onUpdate={updateSelectedNode} />
              : hasSpecializedWorkflowInspector(selectedNode.data.workflowNode.type)
                ? <NativeSpecializedNodeInspector
                    node={selectedNode.data.workflowNode}
                    onUpdate={updateSelectedNode}
                    modelOptions={modelOptions}
                    knowledgeDocuments={knowledgeDocuments}
                    knowledgeCollections={knowledgeCollections}
                  />
                : <GenericInspector node={selectedNode.data.workflowNode} manifest={getWorkflowNodeManifest(selectedNode.data.workflowNode.type)!} onUpdate={updateSelectedNode} />}
          </div>
        ) : (
          <div className="p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Validação</p><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 text-slate-400"><PanelRightClose className="h-4 w-4" /></Button></div><div className="mt-4 space-y-2">{validation.errors.length === 0 ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4 text-sm text-emerald-200">A automação está estruturalmente válida.</div> : validation.errors.map((issue, index) => <button key={`${issue.code}-${index}`} type="button" onClick={() => { if (issue.nodeId) setSelectedNodeId(issue.nodeId); }} className="w-full rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-left transition hover:bg-amber-500/[0.14]"><span className="block text-xs font-medium text-amber-200">{issue.message}</span><span className="mt-1 block font-mono text-[9px] text-amber-400/70">{issue.code}</span></button>)}</div><div className="mt-6 border-t border-slate-700/70 pt-5"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Legenda</p><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(CONNECTION_META).filter(([type]) => type !== 'agent_tool').map(([type, meta]) => <div key={type} className="flex items-center gap-2 text-[10px] text-slate-300"><span className="w-7 border-t-2" style={{ borderColor: meta.color, borderStyle: meta.dashed ? 'dashed' : 'solid' }} />{meta.label}</div>)}</div></div></div>
        )}
      </aside>}
    </div>
  );
}
