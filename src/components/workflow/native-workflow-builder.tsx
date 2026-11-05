'use client';

import { getAutomationToolboxStatus } from '@/modules/nexus/actions/automation-toolbox';
import { WorkflowRecovery } from './workflow-recovery';
import { WorkflowWebhookSettings } from './workflow-webhook-settings';
import { WorkflowAutomationMonitor } from './workflow-automation-monitor';
import { WorkflowApprovals } from './workflow-approvals';
import { WorkflowWebhookTester } from './workflow-webhook-tester';
import { WorkflowDataExplorer } from './workflow-data-explorer';
import { WorkflowToolboxInspector } from './workflow-toolbox-inspector';
import { toolboxManifests } from '@/services/workflow-runtime/toolbox-catalog';
import { StudioCompositionInspector, studioFlowSelectionConfig, type StudioFlowSelection } from './studio-composition-inspector';
import { useStudioFlowLibrary } from './use-studio-flow-library';
import { isStudioFlowNode, type StudioFlowReleaseSummary } from '@/services/agent-studio/flow-contract';
import { PublishedAgentInspector } from './published-agent-inspector';
import { WorkflowNodeCard, type CanvasNode } from './workflow-node-card';
import { workflowNodeIcon } from './workflow-node-icons';
export { workflowNodeIcon } from './workflow-node-icons';
import { workflowEdgeTypes, type WorkflowCanvasEdge } from './workflow-canvas-edge';
import { useWorkflowHistory, useWorkflowPreferences } from './use-workflow-editor';
import { alignWorkflowNodes, availableWorkflowPosition, connectionProblem, insertionPortPairs, insertWorkflowOperation, readWorkflowEditorUi, separateWorkflowSections, withWorkflowSections } from './workflow-editor-core';
import { workflowNodeGeometry } from './workflow-node-geometry';
import { useTheme } from '@/providers/theme-provider';
import { useAuth } from '@/providers/auth-provider';
import './workflow-editor.css';
import { WorkflowZoomLevel } from './workflow-zoom-level';
import { WorkflowSections } from './workflow-sections';
import { WorkflowFormValidation, WorkflowJsonField } from './workflow-form-validation';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Background, BackgroundVariant, ControlButton, Controls, MarkerType, MiniMap, ReactFlow, SelectionMode, ConnectionLineType, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type ReactFlowInstance, useEdgesState, useNodesState } from '@xyflow/react';
import { Activity, AlertTriangle, ArrowLeft, Bot, Braces, BrainCircuit, CheckCircle2, Copy, Database, Download, GitBranch, History, KeyRound, LayoutGrid, LineChart, ListChecks, Loader2, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Plus, Save, Search, Send, Settings2, Sparkles, TestTube2, Trash2, Upload, Undo2, Redo2, Hand, MousePointer2, Magnet, Map as MapIcon, Focus, AlignLeft, AlignStartVertical, Columns3, Rows3, Layers, Wrench, X, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getAiModelRuntimeProvider, type AiModelCatalogEntry } from '@/lib/ai-models';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import type { NexusDialogyResources } from '@/modules/nexus/services/dialogy-resources';
import { NATIVE_WORKFLOW_CATEGORY_COLOR, NATIVE_WORKFLOW_CONNECTION_META, NATIVE_WORKFLOW_SHELL_CLASS } from '@/components/workflow/native-workflow-visuals';
import { createWorkflowNode, getWorkflowNodeManifest, listStableWorkflowNodeManifests, type WorkflowNodeCategory, type WorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import { type ConnectionType, type ModelConfiguration, type WorkflowConnection, type WorkflowDefinition, type WorkflowNode } from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { WorkflowExecutionDebugger, type DebugPayload } from '@/components/workflow/workflow-execution-debugger';
import { deriveWorkflowDebugNodeStates, confirmedWorkflowExecutionEdges, type WorkflowDebugNodeState } from '@/components/workflow/workflow-debug-state';
import { hasSpecializedWorkflowInspector, NativeSpecializedNodeInspector } from '@/components/workflow/native-specialized-inspectors';
import { applyWorkflowModelSelection } from '@/components/workflow/native-model-selection';
import { createNativeWorkflowLayout } from '@/components/workflow/native-workflow-layout';
import { getPrimaryWorkflowAgentId } from '@/services/workflow-runtime/model-selection';
import { buildNativeAgentToolConfig, getNativeAgentToolLabel, getNativeAgentToolUnavailableReason, getWorkflowToolName, groupNativeAgentTools, isNativeAgentToolAttachable, isNativeAgentToolRecommended, nativeAgentToolTestId, type NativeAgentToolCatalogItem } from '@/services/workflow-runtime/native-agent-tools';
import { createPrivateAgentResourceBundle, deleteWorkflowNodesAndPrivateAttachments, detachWorkflowConnectionsAndPrune, pruneOrphanedWorkflowAttachments } from '@/services/workflow-runtime/native-agent-attachments';
import { NativeWorkflowTestChat } from '@/components/workflow/native-workflow-test-chat';
import { NativeWorkflowCatalog } from '@/components/workflow/native-workflow-catalog';
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

type CanvasEdge = WorkflowCanvasEdge;

const CONNECTION_META = NATIVE_WORKFLOW_CONNECTION_META;

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

export function visibleWorkflowOutputPorts(node: WorkflowNode) {
  return node.outputPorts.filter((port) => (
    port.connectionType !== 'error' || node.config.customErrorRoute === true
  ));
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
  const connectedInputPortIds = new Map<string, Set<string>>();
  for (const issue of issues) {
    if (issue.nodeId) issueCount.set(issue.nodeId, (issueCount.get(issue.nodeId) || 0) + 1);
  }
  for (const connection of definition.connections) {
    const connected = connectedOutputPortIds.get(connection.sourceNodeId) || new Set<string>();
    connected.add(connection.sourcePortId);
    connectedOutputPortIds.set(connection.sourceNodeId, connected);
    const inputs = connectedInputPortIds.get(connection.targetNodeId) || new Set<string>(); inputs.add(connection.targetPortId); connectedInputPortIds.set(connection.targetNodeId, inputs);
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
      connectedInputPortIds: [...(connectedInputPortIds.get(workflowNode.id) || [])],
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
    type: 'workflow',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 14, height: 14 },
    style: {
      stroke: meta.color,
      strokeWidth: isMain ? 2.25 : 1.75,
      strokeDasharray: meta.dashed ? '6 5' : undefined,
      opacity: 0.95,
    },
    interactionWidth: 28,
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
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const copy = friendlyNodeCopy(manifest);
  return normalize(`${manifest.label} ${manifest.description} ${manifest.type} ${copy.label} ${copy.description}`).includes(normalize(query.trim()));
}

const ESSENTIAL_WORKFLOW_NODE_TYPES = new Set([
  ...toolboxManifests().map(manifest => manifest.type),
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
  'integration.google_ads_lead',
  'integration.database',
  'dialogy.crm_update',
  'dialogy.sgp_identify_customer',
  'dialogy.sgp_contract_status',
  'dialogy.sgp_second_copy',
  'dialogy.sgp_payment_promise',
  'dialogy.team_availability',
  'dialogy.chat_tag',
  'whatsapp.group_create',
  'whatsapp.send_catalog',
  'tool.http',
  'tool.database',
  'ai.agent',
  'ai.published_agent',
  'ai.studio_agent',
  'integration.studio_procedure',
  'tool.studio_agent',
  'tool.studio_procedure',
  'ai.model',
  'ai.prompt',
  'knowledge.rag_retriever',
  'memory.session',
  'tool.mcp',
  'tool.subflow',
  'output.respond',
  'output.media',
  'output.redirect',
  'output.handoff',
  'output.close_conversation',
  'output.end',
  'error.handler',
]);

const AUTOMATION_TOOLBOX_ENTRY_TYPES = [...toolboxManifests().map(manifest => manifest.type), 'integration.http_request', 'tool.http', 'logic.wait'];

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
  'dialogy.sgp_identify_customer': { label: 'Identificar cliente no SGP', description: 'Confirma o contrato usando o CPF salvo ou outro CPF informado.' },
  'dialogy.sgp_contract_status': { label: 'Consultar status no SGP', description: 'Seleciona o contrato e separa ativos de suspensos.' },
  'dialogy.sgp_second_copy': { label: 'Entregar segunda via SGP', description: 'Conduz a escolha da fatura e entrega PIX, boleto ou link.' },
  'dialogy.sgp_payment_promise': { label: 'Registrar promessa no SGP', description: 'Seleciona o contrato e tenta a liberação provisória.' },
  'dialogy.team_availability': { label: 'Consultar expediente', description: 'Segue por aberto ou fechado usando o horário da equipe no Dialogy.' },
  'dialogy.chat_tag': { label: 'Aplicar etiqueta', description: 'Atualiza a etiqueta do atendimento atual no próprio Dialogy.' },
  'whatsapp.group_create': { label: 'Criar grupo no WhatsApp', description: 'Cria um grupo na instância autorizada e adiciona participantes.' },
  'ai.agent': { label: 'Atender com IA', description: 'Entende o pedido, conversa e usa as habilidades permitidas.' },
  'ai.published_agent': { label: 'Agente do Studio', description: 'Transfere o atendimento para a IA publicada e encerra esta execução do Nexus.' },
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
      className="mt-0.5 block h-6 max-w-[260px] truncate rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold text-[var(--wf-text)] outline-none transition hover:border-[var(--wf-border)] hover:bg-white/[0.03] focus:border-[var(--wf-border)] focus:bg-[var(--wf-panel)]"
    />
  );
}

function InspectorSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--wf-border)] bg-[var(--wf-panel)] shadow-[0_8px_20px_rgba(0,0,0,.12)]">
      <div className="border-b border-[var(--wf-border)] px-4 py-3.5"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--wf-text)]">{title}</h3><p className="mt-1.5 text-xs leading-relaxed text-[var(--wf-muted)]">{description}</p></div>
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
        <div className="space-y-2"><Label htmlFor={fieldId('role')} className="text-xs text-[var(--wf-text)]">Papel do agente</Label><Input id={fieldId('role')} value={String(config.role || '')} onChange={(event) => set('role', event.target.value)} className="rounded-xl border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)] shadow-inner placeholder:text-[var(--wf-muted)]" placeholder="Ex.: especialista de suporte e retenção" /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('language')} className="text-xs text-[var(--wf-text)]">Idioma</Label><select id={fieldId('language')} value={String(config.language || 'pt-BR')} onChange={(event) => set('language', event.target.value)} className="h-10 w-full rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] px-3 text-sm text-[var(--wf-text)] shadow-inner"><option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option></select></div>
        <div className="space-y-2"><Label htmlFor={fieldId('persona')} className="text-xs text-[var(--wf-text)]">Tom e personalidade</Label><Textarea id={fieldId('persona')} value={String(config.persona || '')} onChange={(event) => set('persona', event.target.value)} className="min-h-28 rounded-xl border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)] shadow-inner placeholder:text-[var(--wf-muted)]" placeholder="Ex.: cordial, objetivo e didático. Não use jargões técnicos." /></div>
      </InspectorSection>

      <InspectorSection title="Recursos da IA" description="Configure aqui o que este agente pode usar. As conexões técnicas são gerenciadas automaticamente.">
        <div className="space-y-2"><Label htmlFor={fieldId('model')}>Modelo de linguagem</Label><select id={fieldId('model')} data-testid="agent-model-select" value={selectedModel} onChange={(event) => onModelChange(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] px-3 text-sm"><option value="" disabled>Selecione um modelo</option>{selectedModel && !modelOptions.some((model) => model.id === selectedModel) && <option value={selectedModel}>{selectedModel} (atual)</option>}{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}</select><Button type="button" variant="ghost" size="sm" onClick={onOpenModels}>Gerenciar modelos</Button></div>

        <div className="rounded-xl border border-orange-300/15 bg-orange-300/[0.045] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--wf-text)]">Base de conhecimento</p><p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">{connectedKnowledge ? (selectedDocumentCount || selectedCollectionCount ? `${selectedDocumentCount} documento(s) · ${selectedCollectionCount} coleção(ões)` : knowledgeDocumentCount > 0 ? `Todos os ${knowledgeDocumentCount} documento(s)` : 'Nenhum documento cadastrado') : 'Não conectada'}</p></div><Button type="button" size="sm" variant="outline" data-testid="agent-knowledge-configure" onClick={onConfigureKnowledge} className="h-8 border-orange-300/20 bg-orange-300/[0.04] text-xs text-orange-100 hover:bg-orange-300/10">{connectedKnowledge ? 'Configurar' : 'Adicionar'}</Button></div></div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-testid="agent-memory-toggle" aria-pressed={Boolean(connectedMemory)} onClick={onToggleMemory} className={cn('rounded-xl border p-3 text-left transition', connectedMemory ? 'border-[var(--wf-border)] bg-slate-300/[0.055]' : 'border-[var(--wf-border)] bg-white/[0.02]')}><p className="text-xs font-medium text-[var(--wf-text)]">Memória</p><p className="mt-1 text-xs text-[var(--wf-muted)]">{connectedMemory ? 'Ativa' : 'Desativada'}</p></button>
          <button type="button" data-testid="agent-guardrail-toggle" aria-pressed={Boolean(connectedGuardrail)} onClick={onToggleGuardrail} className={cn('rounded-xl border p-3 text-left transition', connectedGuardrail ? 'border-[var(--wf-border)] bg-slate-300/[0.055]' : 'border-[var(--wf-border)] bg-white/[0.02]')}><p className="text-xs font-medium text-[var(--wf-text)]">Proteções</p><p className="mt-1 text-xs text-[var(--wf-muted)]">{connectedGuardrail ? 'Ativas' : 'Desativadas'}</p></button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={fieldId('tool-search')}>Ferramentas permitidas</Label>
            <span data-testid="agent-tool-selection-count" aria-live="polite" className="text-xs text-[var(--wf-muted)]">{toolsLoading ? 'Carregando catálogo…' : `${selectedToolCount} de ${selectableOrRetainedToolCount} ativas`}</span>
          </div>
          <Input id={fieldId('tool-search')} value={toolQuery} onChange={(event) => setToolQuery(event.target.value)} className="rounded-xl border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)] shadow-inner placeholder:text-[var(--wf-muted)]" placeholder="Buscar por nome, função ou integração" />
          <div className="flex flex-wrap gap-1.5">
            {recommendedTools.length > 0 ? <Button type="button" size="sm" variant="outline" data-testid="agent-tools-select-recommended" onClick={() => onSetTools([...recommendedTools, ...connectedRetainedTools])} disabled={toolsLoading} className="h-7 border-[var(--wf-border)] px-2 text-xs">Selecionar recomendadas</Button> : null}
            <Button type="button" size="sm" variant="outline" data-testid="agent-tools-select-all-eligible" onClick={() => onSetTools([...tools.filter(isNativeAgentToolAttachable), ...connectedRetainedTools])} disabled={toolsLoading || eligibleToolCount === 0} className="h-7 border-[var(--wf-border)] px-2 text-xs">Todas elegíveis</Button>
            <Button type="button" size="sm" variant="ghost" data-testid="agent-tools-clear" onClick={() => onSetTools([])} disabled={toolsLoading || selectedToolCount === 0} className="h-7 px-2 text-xs text-[var(--wf-muted)]">Limpar</Button>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] p-2">
            {toolsLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-[var(--wf-text)]"><Loader2 className="h-4 w-4 animate-spin text-[var(--wf-muted)]" />Carregando todas as ferramentas do workspace…</div>
            ) : toolGroups.map((group) => (
              <section key={group.id} className="space-y-1">
                <div className="px-2 pb-1 pt-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--wf-text)]">{group.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--wf-muted)]">{group.description}</p>
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
                          <span className="text-xs font-medium text-[var(--wf-text)]">{getNativeAgentToolLabel(tool)}</span>
                          <Badge variant="outline" className={cn(
                            'h-4 rounded-full px-1.5 text-xs font-medium',
                            tool.riskLevel === 'high' ? 'border-red-400/25 text-red-300' : tool.riskLevel === 'medium' ? 'border-amber-400/25 text-amber-300' : 'border-emerald-400/20 text-emerald-300',
                          )}>{tool.riskLevel === 'high' ? 'alto risco' : tool.riskLevel === 'medium' ? 'atenção' : 'baixo risco'}</Badge>
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-[var(--wf-muted)]">{unavailableReason || tool.description}</span>
                        <span className="mt-1 block truncate font-mono text-xs text-[var(--wf-muted)]">{tool.name}</span>
                      </span>
                    </label>
                  );
                })}
              </section>
            ))}
            {!toolsLoading && visibleTools.length === 0 ? (
              <div className="space-y-2 p-3 text-center"><p className="text-xs text-[var(--wf-text)]">{tools.length === 0 ? 'Nenhuma ferramenta configurada neste workspace.' : 'Nenhuma ferramenta corresponde à busca.'}</p>{tools.length === 0 ? <Button type="button" size="sm" variant="outline" onClick={onOpenTools} className="border-[var(--wf-border)]">Configurar ferramentas</Button> : null}</div>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-[var(--wf-muted)]">Ao ativar, nome, schemas, risco, timeout e permissão são preenchidos automaticamente.</p>
        </div>
      </InspectorSection>

      <InspectorSection title="Comportamento" description="Explique o resultado esperado; cada instrução ou critério deve ocupar uma linha.">
        <div className="space-y-2"><Label htmlFor={fieldId('objective')}>Objetivo principal</Label><Textarea id={fieldId('objective')} value={String(config.objective || '')} onChange={(event) => set('objective', event.target.value)} className="min-h-24" placeholder="Ex.: resolver dúvidas de cobrança e encaminhar exceções ao financeiro." /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('instructions')}>Instruções</Label><EditableStringList id={fieldId('instructions')} value={config.instructions} onChange={(value) => set('instructions', value)} className="min-h-32" placeholder={'Consulte a base antes de responder\nConfirme dados antes de executar ferramentas'} /></div>
        <div className="space-y-2"><Label htmlFor={fieldId('completion')}>Quando considerar concluído</Label><EditableStringList id={fieldId('completion')} value={config.completionCriteria} onChange={(value) => set('completionCriteria', value)} className="min-h-24" placeholder={'Dúvida respondida com fonte válida\nPróximo passo confirmado com o cliente'} /></div>
      </InspectorSection>

      <details className="rounded-[18px] border border-[var(--wf-border)] bg-[var(--wf-panel)] p-4"><summary className="cursor-pointer text-sm font-medium text-[var(--wf-text)]">Limites avançados</summary><div className="mt-4 grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor={fieldId('max-turns')}>Máx. turnos</Label><Input id={fieldId('max-turns')} type="number" min={1} max={100} value={Number(config.maxTurns || 8)} onChange={(event) => set('maxTurns', Number(event.target.value))} /></div><div className="space-y-2"><Label htmlFor={fieldId('max-tools')}>Máx. ferramentas</Label><Input id={fieldId('max-tools')} type="number" min={0} max={100} value={Number(config.maxToolCalls || 20)} onChange={(event) => set('maxToolCalls', Number(event.target.value))} /></div></div></details>
      <Button type="button" variant="ghost" onClick={onDelete} className="w-full text-red-300 hover:bg-red-500/10 hover:text-red-200"><Trash2 className="mr-2 h-4 w-4" />Excluir este agente</Button>
    </div>
  );
}

function GenericInspector({ node, manifest, onUpdate }: { node: WorkflowNode; manifest?: WorkflowNodeManifest; onUpdate: (node: WorkflowNode) => void }) {
  if (!manifest) return <div className="rounded-xl border border-[var(--wf-border)] p-4 text-sm"><p>Esta operação não está disponível no catálogo atual. Seus dados e conexões foram preservados.</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(node.config, null, 2)}</pre></div>;
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
          return <label key={field.path} className="flex items-center justify-between gap-3 text-sm text-[var(--wf-text)]"><span>{field.label}</span><input type="checkbox" checked={value === true} onChange={(event) => updateConfig(field.path, event.target.checked)} /></label>;
        }
        if (field.control === 'json') return <div key={`${node.id}:${field.path}`} className="space-y-2"><Label>{field.label}</Label><WorkflowJsonField aria-label={field.label} fieldKey={`${node.id}:${field.path}`} value={value} onValueChange={(next) => updateConfig(field.path, next)} className="min-h-28 font-mono text-xs" /></div>;
        if (field.control === 'string_list') return <div key={`${node.id}:${field.path}`} className="space-y-2"><Label>{field.label}</Label><EditableStringList value={value} onChange={(next) => updateConfig(field.path, next)} className="min-h-28" /></div>;
        return (
          <div key={field.path} className="space-y-2">
            <Label htmlFor={`generic-${node.id}-${field.path}`}>{field.label}</Label>
            <Input
              id={`generic-${node.id}-${field.path}`}
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
  onDiscard,
  onSave,
  onPublish,
  assistantComposer,
  studioReleases,
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
  onDiscard?: () => void;
  onSave: () => void;
  onPublish: () => void;
  assistantComposer?: React.ReactNode;
  studioReleases?: StudioFlowReleaseSummary[];
}) {
  const { resolvedTheme } = useTheme();
  const { user: editorUser } = useAuth();
  const { apply: applyHistory, undo: undoHistory, redo: redoHistory, canUndo, canRedo, boundary: historyBoundary, externalRevision } = useWorkflowHistory(definition, onChange);
  const { preferences, update: updatePreferences } = useWorkflowPreferences(`dialogy:flowbuilder:${editorUser?.id || 'anonymous'}:${definition.workspaceId || 'local'}`);
  const [canvasTool, setCanvasTool] = useState<'select' | 'pan'>('select');
  const [zoom, setZoom] = useState(1);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [insertionEdgeId, setInsertionEdgeId] = useState<string | null>(null);
  const [insertionChoice, setInsertionChoice] = useState<{ node: WorkflowNode; pairs: ReturnType<typeof insertionPortPairs> } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'config' | 'advanced' | 'results'>('config');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formRevision, setFormRevision] = useState(0);
  const hasFormErrors = Object.keys(formErrors).length > 0;
  const formDrafts = useRef(new Map<string, string>());
  const reportFormError = useCallback((key: string, message: string | null) => setFormErrors((previous) => {
    if (previous[key] === message || (!message && !(key in previous))) return previous;
    const next = { ...previous }; if (message) next[key] = message; else delete next[key]; return next;
  }), []);
  const resetFormDrafts = useCallback(() => { formDrafts.current.clear(); setFormErrors({}); setFormRevision((value) => value + 1); }, []);
  useEffect(() => { resetFormDrafts(); }, [externalRevision, resetFormDrafts]);
  const formValidation = useMemo(() => ({ report: reportFormError, drafts: formDrafts.current, revision: formRevision }), [reportFormError, formRevision]);
  const sections = useMemo(() => readWorkflowEditorUi(definition).groups, [definition]);
  const validation = useMemo(() => validateWorkflowDefinition(definition, {
    availableModelIds: modelOptions.map((model) => model.id),
  }), [definition, modelOptions]);
  const [nodes, setNodes] = useNodesState<CanvasNode>(canvasNodes(definition, validation.errors));
  const [edges, setEdges] = useEdgesState<CanvasEdge>(canvasEdges(definition));
  const selectedIds = useMemo(() => new Set(nodes.filter((node) => node.selected && !getWorkflowNodeManifest(node.data.workflowNode.type)?.attachment).map((node) => node.id)), [nodes]);
  const nodesRef = useRef(nodes);
  const selectionAtPointerDown = useRef(new Set<string>());
  const edgesRef = useRef(edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [editorMode, setEditorMode] = useState<'essential' | 'advanced'>('essential');
  const fetchedStudioLibrary = useStudioFlowLibrary(studioReleases ? undefined : definition.workspaceId);
  const studioLibrary = studioReleases ? { releases: studioReleases, loading: false, error: '' } : fetchedStudioLibrary;
  const studioSimulationOperations = useMemo(() => {
    if (!definition.nodes.some((node) => isStudioFlowNode(node.type))) return [];
    const operations = definition.nodes.flatMap((node) => isStudioFlowNode(node.type)
      ? (studioLibrary.releases.find((release) => release.releaseId === node.config.releaseId)?.testOperations || []).map((operation) => ({ ...operation, label: `${node.name} · ${operation.label}` }))
      : ['tool.http', 'tool.mcp', 'tool.database', 'tool.subflow'].includes(node.type) ? [{ id: node.type === 'tool.subflow' ? node.id : String(node.config.name || node.id), label: node.name }] : []);
    return [...new Map(operations.map((operation) => [operation.id, operation])).values()];
  }, [definition.nodes, studioLibrary.releases]);
  const showAdvancedResources = editorMode === 'advanced' || definition.nodes.some((node) => node.type === 'ai.studio_agent');
  const visibleWorkflowNodeCount = useMemo(() => definition.nodes.filter((node) => (
    showAdvancedResources || !getWorkflowNodeManifest(node.type)?.attachment
  )).length, [definition.nodes, showAdvancedResources]);
  const isLargeWorkflow = visibleWorkflowNodeCount > LARGE_WORKFLOW_NODE_THRESHOLD;
  const initialViewportNodeIds = useMemo(() => initialWorkflowViewportNodeIds(definition, 4), [definition]);
  const initialViewportNodeIdKey = initialViewportNodeIds.join('|');
  const [pendingConnection, setPendingConnection] = useState<{ nodeId: string; sourcePortId: string } | null>(null);
  const draggingGesture = useRef(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [focusedRoute, setFocusedRoute] = useState<FocusedWorkflowRoute | null>(null);
  const deleteIdsRef = useRef<string[]>([]);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const catalogPanelRef = useRef<HTMLElement | null>(null);
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const panelReturnFocusRef = useRef<HTMLElement | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const initialViewportSignatureRef = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [toolboxUnavailable, setToolboxUnavailable] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!definition.workspaceId || !/^[a-f0-9-]{36}$/i.test(definition.workspaceId)) { setToolboxUnavailable({}); return; }
    let current = true;
    void getAutomationToolboxStatus(definition.workspaceId).then(status => { if (current) setToolboxUnavailable(status.enabled ? status.supportedMediaTypes.length ? {} : { 'media.analyze': 'Habilite os formatos compatíveis do modelo principal na IA Global.' } : Object.fromEntries(AUTOMATION_TOOLBOX_ENTRY_TYPES.map(type => [type, status.reason]))); }).catch(() => { if (current) setToolboxUnavailable(Object.fromEntries(AUTOMATION_TOOLBOX_ENTRY_TYPES.map(type => [type, 'Não foi possível confirmar a disponibilidade destas ferramentas. Reabra o fluxo para tentar novamente.']))); });
    return () => { current = false; };
  }, [definition.workspaceId]);
  const [debugReloadKey, setDebugReloadKey] = useState(0);
  const [debugExecutionId, setDebugExecutionId] = useState<string | null>(null);
  const [pinnedFixtures, setPinnedFixtures] = useState<WorkflowBlockTestFixtures>({});
  useEffect(() => setPinnedFixtures({}), [definition.id]);
  const [testDataSnapshot, setTestDataSnapshot] = useState<{ input?: Record<string, unknown>; variables?: Record<string, unknown>; nodeResults?: Record<string, Record<string, unknown>> } | null>(null);
  useEffect(() => setTestDataSnapshot(null), [definition.id]);
  const rememberTestResult = (result: WorkflowTestExecutionResult | string | null | undefined) => { if (result && typeof result === 'object') setTestDataSnapshot({ input: result.input, variables: result.variables, nodeResults: Object.fromEntries(Object.entries(result.nodeResults || {}).filter(([, item]) => item !== null && typeof item === 'object')) as Record<string, Record<string, unknown>> }); return result; };
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
    setSelectedNodeId(null); formDrafts.current.clear(); setFormErrors({}); setInsertionEdgeId(null); setInsertionChoice(null);
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
      if (visibleWorkflowNodeCount > 6 && initialViewportNodeIds.length > 0) {
        void flowInstance.fitView({
          nodes: initialViewportNodeIds.map((id) => ({ id })),
          padding: isNarrowViewport ? 0.2 : 0.5,
          minZoom: isNarrowViewport ? 0.42 : 0.8,
          maxZoom: isNarrowViewport ? 0.72 : 1,
          duration: 0,
        });
        return;
      }
      void flowInstance.fitView({
        padding: isNarrowViewport ? 0.12 : 0.24,
        minZoom: isNarrowViewport ? 0.28 : 0.8,
        maxZoom: isNarrowViewport ? 0.68 : 0.94,
        duration: 0,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [definition.id, flowInstance, initialViewportNodeIdKey, initialViewportNodeIds, isLargeWorkflow, isNarrowViewport, visibleWorkflowNodeCount]);

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
    setInsertionEdgeId(null);
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
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return canvasNodes(
      definition,
      validation.errors,
      selectedNodeId,
      debugNodeStates,
      requestNextStep,
      focusWorkflowRoute,
      focusedRoute,
      editorMode === 'advanced',
    ).map((node) => {
      const fieldErrorCount = Object.keys(formErrors).filter((key) => key.startsWith(`${node.id}:`)).length;
      if (fieldErrorCount) node = { ...node, data: { ...node.data, errorCount: node.data.errorCount + fieldErrorCount } };
      const previous = byId.get(node.id);
      if (!previous) return node;
      const sameData = previous.data.workflowNode === node.data.workflowNode && previous.data.errorCount === node.data.errorCount && previous.data.operationalState === node.data.operationalState && previous.data.focusedOutputPortId === node.data.focusedOutputPortId && previous.data.showAdvancedRoutes === node.data.showAdvancedRoutes && previous.data.connectedOutputPortIds?.join('|') === node.data.connectedOutputPortIds?.join('|') && previous.data.connectedInputPortIds?.join('|') === node.data.connectedInputPortIds?.join('|') && previous.data.onAddNext === node.data.onAddNext && previous.data.onFocusRoute === node.data.onFocusRoute;
      if (sameData && previous.position.x === node.position.x && previous.position.y === node.position.y) return previous;
      return { ...previous, position: node.position, data: sameData ? previous.data : node.data };
    });
    });
  }, [debugNodeStates, definition, editorMode, focusWorkflowRoute, focusedRoute, requestNextStep, selectedNodeId, setNodes, validation.errors, formErrors]);
  useEffect(() => { setEdges(canvasEdges(definition)); }, [definition, setEdges]);

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

  const commit = useCallback((nextNodes: CanvasNode[], nextEdges: CanvasEdge[], editKey = '') => {
    let nextDefinition: WorkflowDefinition = {
      ...definition,
      nodes: nextNodes.map((node) => node.data.workflowNode.position.x === node.position.x && node.data.workflowNode.position.y === node.position.y ? node.data.workflowNode : { ...node.data.workflowNode, position: node.position }),
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
    if ((nextDefinition.metadata?.flowBuilderUi as { version?: unknown } | undefined)?.version === 1) nextDefinition = withWorkflowSections(nextDefinition, readWorkflowEditorUi(nextDefinition).groups);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    applyHistory(nextDefinition, editKey);
  }, [definition, applyHistory]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const removedNodeIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    if (removedNodeIds.size === 0) {
      const nextNodes = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      if (!draggingGesture.current && changes.some((change) => change.type === 'position' && change.position && change.dragging !== true)) commit(nextNodes, edgesRef.current, `position:${changes.filter((change) => change.type === 'position').map((change) => change.id).join(',')}`);
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
    commit(nextNodes, edgesRef.current);
    setDraggedNodeId(null); draggingGesture.current = false;
  }, [commit]);

  const organizeWorkflow = useCallback(() => {
    if (nodes.length < 2) return;
    const positions = separateWorkflowSections(nodes.map((node) => node.data.workflowNode), sections, createNativeWorkflowLayout(
      nodes.map((node) => ({ ...node.data.workflowNode, position: node.position })),
      edges.map((edge) => edge.data!.connection),
    ));
    const nextNodes = nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) || node.position,
    }));
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    commit(nextNodes, edges);
    window.requestAnimationFrame(() => {
      void flowInstance?.fitView({ padding: 0.2, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, maxZoom: 0.94 });
    });
    toast({ title: 'Fluxo organizado', description: 'Rotas, ramificações e recursos foram distribuídos automaticamente.' });
  }, [commit, edges, flowInstance, nodes, setNodes, sections]);

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

  const validateCanvasConnection = useCallback((candidate: Connection | CanvasEdge) => !connectionProblem(
    { nodes: nodesRef.current.map((node) => node.data.workflowNode), connections: edgesRef.current.map((edge) => edge.data!.connection) },
    candidate.source, candidate.sourceHandle?.replace(/^out:/, '') || '', candidate.target, candidate.targetHandle?.replace(/^in:/, '') || '',
  ), []);
  const onConnect = useCallback((candidate: Connection) => {
    const source = nodes.find((node) => node.id === candidate.source)?.data.workflowNode;
    const target = nodes.find((node) => node.id === candidate.target)?.data.workflowNode;
    const sourcePortId = candidate.sourceHandle?.replace(/^out:/, '') || '';
    const targetPortId = candidate.targetHandle?.replace(/^in:/, '') || '';
    const sourcePort = source?.outputPorts.find((port) => port.id === sourcePortId);
    const targetPort = target?.inputPorts.find((port) => port.id === targetPortId);
    if (!source || !target || !sourcePort || !targetPort || !validateCanvasConnection(candidate)) {
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
  }, [commit, edges, nodes, setEdges, validateCanvasConnection]);

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
    studio?: StudioFlowSelection;
  }) => {
    const { type, tool, position, studio, smartPosition = false } = input;
    if (insertionEdgeId && type) {
      const original = definition.connections.find((connection) => connection.id === insertionEdgeId);
      if (!original) return;
      const node = createWorkflowNode(type, { id: `${type.replace('.', '_')}_${crypto.randomUUID()}`, position, ...(studio ? { name: studio.procedureId ? studio.release.procedures.find((entry) => entry.id === studio.procedureId)?.name : studio.release.agentName, config: studioFlowSelectionConfig(studio) } : {}) });
      node.position = availableWorkflowPosition(node, nodesRef.current.map((value) => ({ ...value.data.workflowNode, position: value.position })));
      const pairs = insertionPortPairs(node, original);
      if (!pairs.length) return;
      if (pairs.length > 1) { setInsertionChoice({ node, pairs }); return; }
      try {
        applyHistory(insertWorkflowOperation(definition, insertionEdgeId, node, pairs[0].input.id, pairs[0].output.id, `conn_${crypto.randomUUID()}`));
        setInsertionEdgeId(null); setCatalogOpen(false); setSelectedNodeId(node.id); openInspectorPanel();
        updatePreferences({ recent: [type, ...preferences.recent.filter((value) => value !== type)].slice(0, 10) });
      } catch (error) { toast({ title: 'Inserção indisponível', description: String(error), variant: 'destructive' }); }
      return;
    }
    if (type) updatePreferences({ recent: [type, ...preferences.recent.filter((value) => value !== type)].slice(0, 10) });
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
          x: originCanvasNode.position.x + workflowNodeGeometry(originCanvasNode.data.workflowNode).width + 96,
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
    if (studio) workflowNode = { ...workflowNode, name: studio.procedureId ? studio.release.procedures.find((entry) => entry.id === studio.procedureId)?.name || workflowNode.name : studio.release.agentName, config: { ...workflowNode.config, ...studioFlowSelectionConfig(studio) } };
    workflowNode.position = availableWorkflowPosition(workflowNode, nodesRef.current.map((value) => ({ ...value.data.workflowNode, position: value.position })));
    const freePosition = workflowNode.position;
    let nextNodes: CanvasNode[] = [...nodes, { id: workflowNode.id, type: 'workflow', position: freePosition, data: { workflowNode, errorCount: 0 } }];
    let nextEdges = edges;
    if (workflowNode.type === 'ai.agent') {
      const withDefaults = createAgentDefaults(workflowNode, freePosition, nextNodes, nextEdges);
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
    if (originWorkflowNode && ['ai.studio_agent', 'tool.studio_agent'].includes(originWorkflowNode.type) && !isExecutableNode) {
      const resourceOutput = workflowNode.outputPorts[0];
      const agentInput = originWorkflowNode.inputPorts.find((port) => port.connectionType === resourceOutput?.connectionType);
      if (resourceOutput && agentInput && !connectionProblem({ nodes: nextNodes.map((entry) => entry.data.workflowNode), connections: nextEdges.map((entry) => entry.data!.connection) }, workflowNode.id, resourceOutput.id, originWorkflowNode.id, agentInput.id)) {
        nextEdges = [...nextEdges, canvasEdge({ id: `conn_${crypto.randomUUID()}`, sourceNodeId: workflowNode.id, sourcePortId: resourceOutput.id, targetNodeId: originWorkflowNode.id, targetPortId: agentInput.id, connectionType: resourceOutput.connectionType })];
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
  }, [commit, createAgentDefaults, edges, nodes, openInspectorPanel, pendingConnection, selectedNodeId, setEdges, setNodes, definition, insertionEdgeId, applyHistory, updatePreferences, preferences.recent]);

  const centerCanvasPosition = useCallback(() => {
    const rect = canvasPanelRef.current?.getBoundingClientRect();
    return flowInstance && rect ? flowInstance.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 420, y: 260 };
  }, [flowInstance]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/dialogy-workflow-node');
    const toolRaw = event.dataTransfer.getData('application/dialogy-workflow-tool');
    const studioRaw = event.dataTransfer.getData('application/dialogy-studio-flow');
    const position = flowInstance
      ? flowInstance.screenToFlowPosition({ x: event.clientX - 110, y: event.clientY - 50 })
      : { x: event.clientX - (event.currentTarget as Element).getBoundingClientRect().left - 105, y: event.clientY - (event.currentTarget as Element).getBoundingClientRect().top - 50 };
    let tool: CatalogTool | undefined;
    if (toolRaw) {
      try { tool = JSON.parse(toolRaw) as CatalogTool; } catch { return; }
    }
    if (studioRaw) {
      try { const selection = JSON.parse(studioRaw); const release = studioLibrary.releases.find((entry) => entry.releaseId === selection.releaseId); if (release && isStudioFlowNode(selection.type)) addCatalogItem({ type: selection.type, position, studio: { type: selection.type, release, procedureId: selection.procedureId } }); } catch { /* Ignore malformed drag data. */ }
      return;
    }
    addCatalogItem({ type: type || undefined, tool, position });
  }, [addCatalogItem, flowInstance, studioLibrary.releases]);

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
        nodes: nextNodes.map((node) => node.data.workflowNode.position.x === node.position.x && node.data.workflowNode.position.y === node.position.y ? node.data.workflowNode : { ...node.data.workflowNode, position: node.position }),
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
    commit(nextNodes, edges, `node:${workflowNode.id}`);
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
    if (selectedNode) { deleteIdsRef.current = [selectedNode.id]; setDeleteCandidateId(selectedNode.id); }
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
      nodeIds: deleteIdsRef.current.length ? deleteIdsRef.current : [deleteCandidateId],
    });
    const next = reconcileCanvasGraph(nodes, edges, lifecycle);
    setNodes(next.nodes);
    setEdges(next.edges);
    if (selectedNodeId && (selectedNodeId === deleteCandidateId || deleteIdsRef.current.includes(selectedNodeId))) setSelectedNodeId(null);
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
    if (!selectedNodeId && !selectedIds.size && !selectedEdgeId) return;
    const requestDeleteFromKeyboard = (event: KeyboardEvent) => {
      if (!['Backspace', 'Delete'].includes(event.key) || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedEdgeId) { handleEdgesChange([{ type: 'remove', id: selectedEdgeId }]); setSelectedEdgeId(null); return; }
      deleteIdsRef.current = selectedIds.size ? [...selectedIds] : selectedNodeId ? [selectedNodeId] : [];
      setDeleteCandidateId(deleteIdsRef.current[0] || null);
    };
    window.addEventListener('keydown', requestDeleteFromKeyboard, true);
    return () => window.removeEventListener('keydown', requestDeleteFromKeyboard, true);
  }, [selectedNodeId, selectedIds, selectedEdgeId, handleEdgesChange]);

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

  const compatibleManifests = useMemo(() => listStableWorkflowNodeManifests().filter((manifest) => (
    !(surface === 'standalone' && manifest.type === 'ai.agent')
    && (editorMode === 'advanced' || ESSENTIAL_WORKFLOW_NODE_TYPES.has(manifest.type))
    && (!(pendingConnection || selectedWorkflowNode) || manifest.category !== 'triggers')
    && (!insertionEdgeId ? (!catalogSourcePort || (manifest.inputPorts.some((port) => port.connectionType === catalogSourcePort.connectionType) || (selectedWorkflowNode && ['ai.studio_agent', 'tool.studio_agent'].includes(selectedWorkflowNode.type) && manifest.attachment))) : !manifest.attachment && !manifest.terminal && (() => {
      const edge = definition.connections.find((connection) => connection.id === insertionEdgeId);
      return edge && insertionPortPairs(createWorkflowNode(manifest.type, { id: 'preview', position: { x: 0, y: 0 } }), edge).length > 0;
    })())
  )), [catalogSourcePort, editorMode, pendingConnection, selectedWorkflowNode, surface, insertionEdgeId, definition.connections]);
  const manifests = useMemo(() => compatibleManifests.filter((manifest) => manifestMatches(manifest, query)), [compatibleManifests, query]);
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
  const disconnectEdge = useCallback((id: string) => { handleEdgesChange([{ type: 'remove', id }]); setSelectedEdgeId(null); setFocusedRoute(null); toast({ title: 'Conexão removida', description: 'O caminho foi desconectado no rascunho. Use Ctrl+Z para desfazer.' }); }, [handleEdgesChange]);
  const confirmedEdges = useMemo(() => debugSnapshot ? confirmedWorkflowExecutionEdges(debugSnapshot.execution, definition.connections) : new Set<string>(), [debugSnapshot, definition.connections]);
  const requestInsertEdge = useCallback((id: string) => { setInsertionEdgeId(id); setPendingConnection(null); setSelectedNodeId(null); setQuery(''); openCatalogPanel(); }, [openCatalogPanel]);
  const flowEdges = useMemo(() => edges.map((edge) => {
    const adjacentToDraggedNode = Boolean(draggedNodeId && (edge.source === draggedNodeId || edge.target === draggedNodeId));
    const tracedRoute = Boolean(focusedRoute && focusedRouteEdgeIds.has(edge.id));
    const sourceNode = workflowNodeById.get(edge.source);
    const baseStyle = edge.style || {};
    return {
      ...edge,
      animated: false,
      data: { ...edge.data!, label: sourceNode?.outputPorts.find((port) => port.id === edge.data?.connection.sourcePortId)?.label, showLabel: Boolean(sourceNode && sourceNode.outputPorts.filter((port) => port.connectionType === 'main').length > 1 && edge.data?.connection.connectionType === 'main'), onInsert: requestInsertEdge, onDisconnect: disconnectEdge, active: confirmedEdges.has(edge.id) && debugSnapshot?.execution.status === 'running' },
      hidden: hiddenResourceNodeIds.has(edge.source)
        || hiddenResourceNodeIds.has(edge.target)
,
      style: {
        ...baseStyle,
        opacity: draggedNodeId
          ? (adjacentToDraggedNode ? 1 : 0.3)
          : focusedRoute
            ? (tracedRoute ? 1 : 0.2)
            : 0.8,
        strokeWidth: adjacentToDraggedNode || tracedRoute ? 2.15 : 1.35,
      },
      zIndex: adjacentToDraggedNode || tracedRoute ? 5 : 0,
    };
  }), [draggedNodeId, edges, focusedRoute, focusedRouteEdgeIds, hiddenResourceNodeIds, workflowNodeById, requestInsertEdge, disconnectEdge, confirmedEdges, debugSnapshot?.execution.status]);
  const selectMembers = useCallback((ids: string[]) => {
    const selected = new Set(ids);
    setNodes((current) => { const next = current.map((node) => ({ ...node, selected: selected.has(node.id) })); nodesRef.current = next; return next; });
  }, [setNodes]);
  const moveSection = useCallback((ids: string[], delta: { x: number; y: number }, done: boolean) => {
    if (done) { commit(nodesRef.current, edgesRef.current); return; }
    const members = new Set(ids);
    const next = nodesRef.current.map((node) => members.has(node.id) ? { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } } : node);
    nodesRef.current = next; setNodes(next);
  }, [commit, setNodes]);
  const createSection = () => {
    if (selectedIds.size < 2) return;
    const groups = sections.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !selectedIds.has(id)) })).filter((group) => group.nodeIds.length);
    applyHistory(withWorkflowSections(definition, [...groups, { id: `section_${crypto.randomUUID()}`, title: `Seção ${sections.length + 1}`, nodeIds: [...selectedIds] }]));
  };
  const alignSelection = (operation: 'left' | 'top' | 'horizontal' | 'vertical') => {
    const aligned = new Map(alignWorkflowNodes(nodesRef.current.map((node) => ({ ...node.data.workflowNode, position: node.position })), selectedIds, operation).map((node) => [node.id, node.position]));
    const next = nodesRef.current.map((node) => ({ ...node, position: aligned.get(node.id) || node.position }));
    setNodes(next); commit(next, edgesRef.current);
  };
  const centerSelected = () => { if (selectedNodeId) void flowInstance?.fitView({ nodes: [{ id: selectedNodeId }], padding: 0.7, maxZoom: 1, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }); };
  const findNode = (id: string) => { selectMembers([id]); setSelectedNodeId(id); setNodeSearchOpen(false); void flowInstance?.fitView({ nodes: [{ id }], padding: 0.7, maxZoom: 1, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }); };
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'a') { event.preventDefault(); selectMembers(nodesRef.current.filter((node) => !node.hidden).map((node) => node.id)); }
      else if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redoHistory(); else undoHistory(); }
      else if (mod && key === 'y') { event.preventDefault(); redoHistory(); }
      else if (mod && key === 's') { event.preventDefault(); if (!hasFormErrors && !isSaving && !isPublishing) onSave(); }
      else if (mod && key === 'f') { event.preventDefault(); setNodeSearchOpen(true); }
      else if (!mod && key === 'a') { event.preventDefault(); setPendingConnection(null); setInsertionEdgeId(null); setSelectedNodeId(null); setQuery(''); openCatalogPanel(); }
      else if (!mod && key === 'v') setCanvasTool('select');
      else if (!mod && key === 'h') setCanvasTool('pan');
      else if (key === 'escape') { setSelectedEdgeId(null); setCatalogOpen(false); setInspectorOpen(false); setNodeSearchOpen(false); setContextMenu(null); setInsertionEdgeId(null); setInsertionChoice(null); setPendingConnection(null); }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [undoHistory, redoHistory, hasFormErrors, isSaving, isPublishing, onSave, openCatalogPanel, selectMembers]);
  useEffect(() => {
    const ids = new Set(definition.nodes.map((node) => node.id));
    setFormErrors((previous) => { const next = Object.fromEntries(Object.entries(previous).filter(([key]) => [...ids].some((id) => key.startsWith(`${id}:`)))); return Object.keys(next).length === Object.keys(previous).length ? previous : next; });
  }, [definition.nodes]);
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
    <TooltipProvider delayDuration={450}><WorkflowFormValidation.Provider value={formValidation}><div className={NATIVE_WORKFLOW_SHELL_CLASS} data-detail={zoom >= 0.8 ? 'full' : zoom >= 0.5 ? 'summary' : 'structure'} onBlurCapture={historyBoundary} onPointerDownCapture={(event) => {
      if (event.target instanceof Element && event.target.closest('.react-flow__node')) selectionAtPointerDown.current = new Set(nodesRef.current.filter((node) => node.selected).map((node) => node.id));
    }}>
      {isNarrowViewport && (catalogOpen || inspectorOpen) ? <button type="button" aria-label="Fechar painel aberto" onClick={() => { setCatalogOpen(false); setInspectorOpen(false); setPendingConnection(null); }} className="absolute inset-0 z-40 bg-[var(--wf-panel)] backdrop-blur-[2px]" /> : null}
      <NativeWorkflowCatalog
        unavailableReasons={toolboxUnavailable}
        open={catalogOpen}
        studioReleases={studioLibrary.releases}
        studioAllowedTypes={compatibleManifests.filter((manifest) => isStudioFlowNode(manifest.type)).map((manifest) => manifest.type)}
        studioLoading={studioLibrary.loading}
        studioError={studioLibrary.error}
        onAddStudio={(studio) => addCatalogItem({ type: studio.type, studio, position: centerCanvasPosition(), smartPosition: true })}
        favorites={preferences.favorites}
        recent={preferences.recent}
        onToggleFavorite={(type) => updatePreferences({ favorites: preferences.favorites.includes(type) ? preferences.favorites.filter((value) => value !== type) : [...preferences.favorites, type] })}
        onClose={() => {
          setCatalogOpen(false);
          setPendingConnection(null);
          setInsertionEdgeId(null);
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

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--wf-panel)]">
        <header className="relative z-20 flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--wf-border)] bg-[var(--wf-panel)] px-3 py-2.5 shadow-[0_12px_34px_rgba(0,0,0,.18)] backdrop-blur-xl 2xl:flex-nowrap 2xl:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {!catalogOpen && <Button variant="ghost" size="icon" onClick={() => { setPendingConnection(null); setQuery(''); openCatalogPanel(); }} className="h-9 w-9 shrink-0 rounded-xl border border-[var(--wf-border)] bg-white/[0.025] text-[var(--wf-text)] hover:bg-white/[0.07]" title="Adicionar bloco"><PanelLeftOpen className="h-4 w-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={handleBack} className="h-9 w-9 shrink-0 rounded-xl text-[var(--wf-muted)] hover:bg-white/[0.05] hover:text-[var(--wf-text)]" aria-label="Voltar para automações"><ArrowLeft className="h-4 w-4" /></Button>
            <div className="min-w-0 border-l border-[var(--wf-border)] pl-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--wf-muted)]">{surface === 'standalone' ? 'Fluxo Nexus' : 'Automação visual'}</p><WorkflowNameInput value={definition.name} onCommit={(name) => applyHistory({ ...definition, name, updatedAt: new Date().toISOString() })} /></div>
            <button type="button" data-testid="workflow-validation-status" onClick={() => { setSelectedNodeId(null); openInspectorPanel(); }} title="Abrir validação da automação" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"><Badge aria-live="polite" className={cn('h-6 rounded-full px-2.5 text-xs font-medium', validation.valid && !isDirty ? 'border-emerald-400/25 bg-emerald-400/[0.09] text-emerald-200' : 'border-amber-400/25 bg-amber-400/[0.09] text-amber-100')}><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-80" /><span className="hidden sm:inline">{statusLabel}</span><span className="sm:hidden">{!validation.valid ? validation.errors.length : isDirty ? '•' : '✓'}</span></Badge></button>
          </div>
          <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {onOpenPanel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-2 rounded-xl border border-transparent text-[var(--wf-text)] hover:border-[var(--wf-border)] hover:bg-white/[0.06] hover:text-[var(--wf-text)]">
                    <Settings2 className="h-4 w-4" />
                    {surface === 'standalone' ? 'Gerenciar fluxo' : 'Gerenciar agente'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="workflow-portal w-56 border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)] shadow-2xl">
                  {surface === 'standalone' ? <>
                    <DropdownMenuItem onClick={() => onOpenPanel('executions')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <Activity className="h-4 w-4 text-[var(--wf-muted)]" />
                      <span className="text-sm font-medium">Execuções</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenPanel('versions')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <History className="h-4 w-4 text-[var(--wf-muted)]" />
                      <span className="text-sm font-medium">Histórico de versões</span>
                    </DropdownMenuItem>
                    {onExport ? <DropdownMenuItem onClick={onExport} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <Download className="h-4 w-4 text-[var(--wf-muted)]" />
                      <span className="text-sm font-medium">Exportar JSON</span>
                    </DropdownMenuItem> : null}
                    {onImport ? <DropdownMenuItem onClick={onImport} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <Upload className="h-4 w-4 text-[var(--wf-muted)]" />
                      <span className="text-sm font-medium">Importar JSON</span>
                    </DropdownMenuItem> : null}
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onClick={() => onOpenPanel('capabilities')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <Wrench className="h-4 w-4 text-[var(--wf-muted)]" />
                      <span className="text-sm font-medium">Ferramentas e MCP</span>
                    </DropdownMenuItem>
                    {onManageCredentials ? <DropdownMenuItem onClick={onManageCredentials} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <KeyRound className="h-4 w-4 text-[var(--wf-muted)]" />
                      <span className="text-sm font-medium">Credenciais</span>
                    </DropdownMenuItem> : null}
                    <DropdownMenuItem onClick={() => onOpenPanel('settings')} className="flex cursor-pointer items-center gap-2.5 py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                      <Settings2 className="h-4 w-4 text-[var(--wf-text)]" />
                      <span className="text-sm font-medium">Implantação e gatilhos</span>
                    </DropdownMenuItem>
                  </> : <>
                  <DropdownMenuItem onClick={() => onOpenPanel('procedures')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <ListChecks className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Procedimentos</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('knowledge')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <Database className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Conhecimento</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('capabilities')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <Zap className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Habilidades</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('analytics')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <LineChart className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Analytics</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('decision')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <BrainCircuit className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Motor de decisão</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={() => onOpenPanel('playground')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <TestTube2 className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Playground</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPanel('versions')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <History className="h-4 w-4 text-[var(--wf-muted)]" />
                    <span className="text-sm font-medium">Histórico</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={() => onOpenPanel('settings')} className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-white/5 hover:text-[var(--wf-text)] focus:bg-white/5 focus:text-white">
                    <Settings2 className="h-4 w-4 text-[var(--wf-text)]" />
                    <span className="text-sm font-medium">Ajustes gerais</span>
                  </DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : onOpenSettings ? (
              <Button variant="ghost" size="sm" onClick={onOpenSettings} className="shrink-0 text-[var(--wf-text)]">
                <Settings2 className="mr-2 h-4 w-4" /> Ajustes
              </Button>
            ) : null}
            {onManageCredentials && surface !== 'standalone' ? (
              <Button variant="ghost" size="sm" onClick={onManageCredentials} className="shrink-0 text-[var(--wf-text)]">
                <KeyRound className="mr-2 h-4 w-4" /> Credenciais
              </Button>
            ) : null}
            <div className="flex h-9 shrink-0 items-center rounded-xl border border-[var(--wf-border)] bg-white/[0.025] p-0.5" aria-label="Nível de edição">
              <button type="button" aria-pressed={editorMode === 'essential'} onClick={() => setEditorMode('essential')} className={cn('h-7 rounded-lg px-2.5 text-xs font-semibold transition', editorMode === 'essential' ? 'bg-[var(--wf-hover)] text-[var(--wf-text)]' : 'text-[var(--wf-muted)] hover:text-[var(--wf-text)]')}>Simples</button>
              <button type="button" aria-pressed={editorMode === 'advanced'} onClick={() => setEditorMode('advanced')} className={cn('h-7 rounded-lg px-2.5 text-xs font-semibold transition', editorMode === 'advanced' ? 'bg-[var(--wf-hover)] text-[var(--wf-text)]' : 'text-[var(--wf-muted)] hover:text-[var(--wf-text)]')}>Avançado</button>
            </div>
            {onTest && <Button variant="ghost" size="sm" onClick={() => setTestTarget({ kind: 'workflow' })} disabled={!validation.valid || testRunning || isSaving || isPublishing} className="h-9 shrink-0 rounded-xl text-[var(--wf-text)] hover:bg-white/[0.06]"><Play className="mr-2 h-4 w-4 text-[var(--wf-muted)]" />{testRunning ? 'Iniciando…' : 'Testar'}</Button>}
            {onDiscard ? <button type="button" onClick={() => { resetFormDrafts(); onDiscard?.(); }} disabled={isSaving || isPublishing || (!isDirty && !hasFormErrors)} title="Descartar alterações" aria-label="Descartar alterações" className="group flex h-9 w-9 shrink-0 items-center justify-start overflow-hidden rounded-xl border border-[var(--wf-border)] bg-white/[0.025] px-2.5 text-[var(--wf-text)] transition-[width,background-color] duration-200 hover:w-[106px] hover:bg-white/[0.07] focus-visible:w-[106px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-40 disabled:hover:w-9"><Undo2 className="h-4 w-4 shrink-0" /><span className="ml-2 whitespace-nowrap text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Descartar</span></button> : null}
            <button type="button" onClick={() => { historyBoundary(); if (!hasFormErrors) onSave(); }} disabled={isSaving || isPublishing || !isDirty || hasFormErrors} aria-busy={isSaving} title="Salvar rascunho" aria-label={isSaving ? 'Salvando rascunho' : 'Salvar rascunho'} className="group flex h-9 w-9 shrink-0 items-center justify-start overflow-hidden rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] px-2.5 text-[var(--wf-text)] transition-[width,background-color] duration-200 hover:w-[92px] hover:bg-[var(--wf-panel)] focus-visible:w-[92px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-40 disabled:hover:w-9"><Save className={cn('h-4 w-4 shrink-0', isSaving && 'animate-pulse')} /><span className="ml-2 whitespace-nowrap text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{isSaving ? 'Salvando…' : 'Salvar'}</span></button>
            <Button size="sm" onClick={onPublish} disabled={isSaving || isPublishing || !validation.valid || !hasDraft || hasFormErrors} aria-busy={isPublishing} title={!validation.valid ? 'Resolva as pendências antes de publicar.' : !hasDraft ? (isDirty ? 'Apenas o layout visual foi alterado. Use "Salvar" para guardar as posições.' : 'Nenhuma alteração nova para publicar.') : 'Publicar rascunho'} className="h-9 shrink-0 rounded-xl bg-[var(--wf-accent)] px-4 font-semibold text-[var(--wf-accent-text)] shadow-sm hover:opacity-90"><Sparkles className="mr-2 h-4 w-4" />{isPublishing ? 'Publicando…' : 'Publicar'}</Button>
            {!inspectorOpen && <Button variant="ghost" size="icon" onClick={openInspectorPanel} className="h-9 w-9 shrink-0 rounded-xl border border-[var(--wf-border)] bg-white/[0.025] text-[var(--wf-text)] hover:bg-white/[0.07]" title="Abrir inspetor"><PanelRightOpen className="h-4 w-4" /></Button>}
          </div>
        </header>
        {hasFormErrors && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-[var(--wf-border)] bg-[var(--wf-panel)] px-4 py-2 text-xs text-[var(--wf-danger)]"><AlertTriangle size={14} />Corrija os campos inválidos antes de salvar.{[...new Set(Object.keys(formErrors).flatMap((key) => definition.nodes.filter((node) => key.startsWith(`${node.id}:`)).map((node) => node.id)))].map((id) => <button key={id} type="button" className="underline" onClick={() => { findNode(id); setInspectorTab('config'); openInspectorPanel(); }}>{definition.nodes.find((node) => node.id === id)?.name || id}</button>)}</div>}
        <div ref={canvasPanelRef} className={cn('relative min-h-0 flex-1 flex flex-col wf-canvas transition-[margin] duration-200', debugExecutionId && !activePanelContent ? 'basis-[56%]' : 'flex-1', inspectorOpen && !isNarrowViewport && 'mr-[400px]')} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
          {activePanelContent ? (
            <div className="h-full w-full overflow-y-auto bg-[var(--wf-panel)] px-4 py-5 text-[var(--wf-text)] sm:px-6">
              {activePanelContent}
            </div>
          ) : (
            <ReactFlow<CanvasNode, CanvasEdge>
              className="wf-canvas [&_.react-flow__node.dragging]:will-change-transform"
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={workflowEdgeTypes}
              colorMode={resolvedTheme === 'light' ? 'light' : 'dark'}
              connectionLineType={ConnectionLineType.Bezier}
              isValidConnection={validateCanvasConnection}
              onMove={(_, viewport) => { const detail = viewport.zoom >= 0.8 ? 1 : viewport.zoom >= 0.5 ? 0.65 : 0.35; setZoom((previous) => previous === detail ? previous : detail); }}
              selectionMode={SelectionMode.Partial}
              selectionOnDrag={canvasTool === 'select'}
              panOnDrag={canvasTool === 'pan' ? true : [1, 2]}
              panActivationKeyCode="Space"
              multiSelectionKeyCode="Shift"
              selectionKeyCode="Shift"
              onSelectionDragStart={() => { draggingGesture.current = true; }}
              onSelectionDragStop={() => { commit(nodesRef.current, edgesRef.current); draggingGesture.current = false; }}
              onPaneContextMenu={(event) => { event.preventDefault(); const rect = (event.currentTarget as Element).getBoundingClientRect(); setContextMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top }); }}
              onInit={(instance) => { initialViewportSignatureRef.current = null; setFlowInstance(instance); setZoom(instance.getZoom()); }}
              onNodesChange={handleNodesChange}
              onNodeDragStart={(_, node) => { draggingGesture.current = true; setDraggedNodeId(node.id); }}
              onNodeDragStop={(_, node) => persistNodePosition(node)}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onEdgeClick={(event, edge) => {
                event.stopPropagation();
                setSelectedEdgeId(edge.id); setSelectedNodeId(null); setInspectorOpen(false);
                setEdges((current) => current.map((candidate) => ({ ...candidate, selected: candidate.id === edge.id })));
                const connection = edge.data?.connection;
                if (connection) focusWorkflowRoute(connection.sourceNodeId, connection.sourcePortId);
              }}
              onNodeClick={(event, node) => {
                const selected = event.shiftKey ? new Set(selectionAtPointerDown.current) : new Set<string>();
                if (event.shiftKey && selected.has(node.id)) selected.delete(node.id); else selected.add(node.id);
                const next = nodesRef.current.map((candidate) => candidate.selected === selected.has(candidate.id) ? candidate : { ...candidate, selected: selected.has(candidate.id) });
                nodesRef.current = next; setNodes(next);
                setSelectedEdgeId(null); setInspectorTab('config'); setPendingConnection(null); setFocusedRoute(null); setSelectedNodeId(node.id); openInspectorPanel();
              }}
              onPaneClick={() => { setSelectedEdgeId(null); setPendingConnection(null); setFocusedRoute(null); setSelectedNodeId(null); setContextMenu(null); }}
              minZoom={0.15}
              maxZoom={1.6}
              onlyRenderVisibleElements={isLargeWorkflow}
              connectionRadius={28}
              connectOnClick
              snapToGrid={preferences.snap}
              snapGrid={[16, 16]}
              deleteKeyCode={null}
            >
              <WorkflowSections groups={sections} nodes={flowNodes} getZoom={flowInstance?.getZoom || (() => 1)} onSelect={selectMembers} onMove={moveSection}
                onRename={(id, title) => applyHistory(withWorkflowSections(definition, sections.map((group) => group.id === id ? { ...group, title } : group)))}
                onRemove={(id) => applyHistory(withWorkflowSections(definition, sections.filter((group) => group.id !== id)))} />
              <div className="nodrag nopan wf-toolbar" role="toolbar" aria-label="Ferramentas do canvas">
                <button type="button" aria-label="Selecionar (V)" title="Selecionar (V) · Shift para seleção múltipla" aria-pressed={canvasTool === 'select'} onClick={() => setCanvasTool('select')}><MousePointer2 size={16} /></button>
                <button type="button" aria-label="Navegar (H)" title="Navegar (H) · Espaço temporário" aria-pressed={canvasTool === 'pan'} onClick={() => setCanvasTool('pan')}><Hand size={16} /></button>
                <span className="wf-toolbar-divider" />
                <button type="button" aria-label="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={undoHistory}><Undo2 size={16} /></button>
                <button type="button" aria-label="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redoHistory}><Redo2 size={16} /></button>
                <span className="wf-toolbar-divider" />
                <button type="button" aria-label="Localizar operação (Ctrl+F)" onClick={() => setNodeSearchOpen((value) => !value)}><Search size={16} /></button>
                <button type="button" aria-label="Centralizar selecionado" disabled={!selectedNodeId} onClick={centerSelected}><Focus size={16} /></button>
                <button type="button" aria-label="Ajustar à grade" aria-pressed={preferences.snap} onClick={() => updatePreferences({ snap: !preferences.snap })}><Magnet size={16} /></button>
                <button type="button" aria-label="Mostrar minimapa" aria-pressed={preferences.minimap} onClick={() => updatePreferences({ minimap: !preferences.minimap })}><MapIcon size={16} /></button>
                {selectedEdgeId && <button type="button" aria-label="Apagar conexão selecionada" onClick={() => disconnectEdge(selectedEdgeId)}><Trash2 size={16} />Desconectar</button>}
                <WorkflowZoomLevel />
                {selectedIds.size > 1 && <><span className="wf-toolbar-divider" /><button type="button" aria-label="Alinhar à esquerda" onClick={() => alignSelection('left')}><AlignLeft size={16} /></button><button type="button" aria-label="Alinhar pelo topo" onClick={() => alignSelection('top')}><AlignStartVertical size={16} /></button><button type="button" aria-label="Distribuir horizontalmente" onClick={() => alignSelection('horizontal')}><Columns3 size={16} /></button><button type="button" aria-label="Distribuir verticalmente" onClick={() => alignSelection('vertical')}><Rows3 size={16} /></button><button type="button" onClick={createSection}><Layers size={16} />Criar seção</button></>}
              </div>
              {nodeSearchOpen && <div className="nodrag nopan wf-search"><Input autoFocus aria-label="Localizar operação no fluxo" placeholder="Nome ou tipo da operação…" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNodeSearchOpen(false); }} /><div className="wf-search-results">{definition.nodes.filter((node) => `${node.name} ${node.type}`.toLocaleLowerCase('pt-BR').includes(nodeSearch.toLocaleLowerCase('pt-BR'))).map((node) => <button key={node.id} type="button" onClick={() => findNode(node.id)}>{node.name}<span className="block text-[var(--wf-muted)]">{node.type}</span></button>)}</div></div>}
              {contextMenu && <div className="nodrag nopan wf-search" role="menu" aria-label="Ações do canvas" style={{ left: contextMenu.x, top: contextMenu.y, width: 240 }}><div className="wf-search-results"><button type="button" role="menuitem" onClick={() => { setContextMenu(null); setPendingConnection(null); setSelectedNodeId(null); openCatalogPanel(); }}>Adicionar operação</button><button type="button" role="menuitem" onClick={() => { organizeWorkflow(); setContextMenu(null); }}>Organizar fluxo</button><button type="button" role="menuitem" disabled={!canUndo} onClick={() => { undoHistory(); setContextMenu(null); }}>Desfazer</button></div></div>}
              <Background variant={BackgroundVariant.Dots} gap={zoom < 0.5 ? 48 : 24} size={1} color="var(--wf-grid)" />
              {flowNodes.every((node) => node.hidden) ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="max-w-sm rounded-[20px] border border-[var(--wf-border)] bg-[var(--wf-hover)] p-6 text-center shadow-[0_16px_38px_rgba(0,0,0,0.08)]">
                    <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--wf-border)] bg-slate-100 text-[var(--wf-text)]"><Play className="h-5 w-5" /></span>
                    <h2 className="mt-4 text-base font-semibold text-[var(--wf-text)]">Como este fluxo começa?</h2>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--wf-muted)]">Escolha um acontecimento inicial. Depois, basta usar “Próximo passo” para montar o restante.</p>
                    <Button type="button" onClick={() => { setPendingConnection(null); setSelectedNodeId(null); setQuery(''); openCatalogPanel(); }} className="nodrag nopan mt-4 rounded-xl bg-slate-900 text-white hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" />Adicionar primeira etapa</Button>
                  </div>
                </div>
              ) : null}

              <Controls className="!m-4 !overflow-hidden !rounded-[14px] !border-[var(--wf-border)] !bg-white/95 !text-[var(--wf-text)] !shadow-[0_4px_20px_rgba(0,0,0,0.08)] [&>button]:!h-9 [&>button]:!w-9 [&>button]:!border-[var(--wf-border)] [&>button]:!bg-transparent [&>button:hover]:!bg-slate-100 [&>button]:!text-[var(--wf-text)]">
                <ControlButton
                  onClick={organizeWorkflow}
                  disabled={nodes.length < 2}
                  title="Organizar fluxo automaticamente"
                  aria-label="Organizar fluxo automaticamente"
                >
                  <LayoutGrid className="h-4 w-4" />
                </ControlButton>

              </Controls>
              {preferences.minimap ? <MiniMap pannable zoomable className="!m-4 !h-24 !w-36 !rounded-[16px] !border !border-[var(--wf-border)] !bg-white/95 !shadow-[0_4px_20px_rgba(0,0,0,0.08)]" nodeColor="var(--wf-muted)" maskColor="color-mix(in srgb, var(--wf-canvas) 75%, transparent)" /> : null}
            </ReactFlow>
          )}
          {assistantComposer && !activePanelContent ? assistantComposer : null}
        </div>
        {debugExecutionId && !activePanelContent && (
          <section className="relative min-h-[280px] flex-1 border-t border-[var(--wf-border)] bg-[var(--wf-panel)] shadow-[0_-10px_28px_rgba(0,0,0,.3)]">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setDebugExecutionId(null); setDebugSnapshot(null); }}
              className="absolute right-14 top-2 z-40 h-8 w-8 text-[var(--wf-muted)] hover:text-[var(--wf-text)]"
              title="Fechar depurador"
            >
              <X className="h-4 w-4" />
            </Button>
            <WorkflowExecutionDebugger
              key={debugReloadKey}
              executionId={debugExecutionId}
              embedded
              onSnapshot={setDebugSnapshot}
              onEventSelect={(event) => {
                if (!event.nodeId) return;
                setSelectedNodeId(event.nodeId);
                flowInstance?.fitView({ nodes: [{ id: event.nodeId }], duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, padding: 0.8 });
              }}
            />
          </section>
        )}
      </main>

      {inspectorOpen && <aside ref={inspectorPanelRef} aria-label="Inspetor da automação" aria-modal={isNarrowViewport || undefined} role={isNarrowViewport ? 'dialog' : undefined} className={cn('absolute bottom-0 right-0 w-[min(400px,calc(100vw-1.5rem))] shrink-0 overflow-y-auto border border-[var(--wf-border)] bg-[var(--wf-panel)] shadow-[-12px_12px_40px_rgba(0,0,0,.28)] backdrop-blur-xl', isNarrowViewport ? 'top-3 z-50 rounded-l-[22px]' : 'top-[68px] z-30 rounded-none border-b-0 border-r-0')}>
        {selectedNode ? (
          <div className="p-4">
            <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-[var(--wf-border)] bg-[var(--wf-panel)] px-4 pb-4 pt-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--wf-text)]">{selectedNode.data.workflowNode.type === 'ai.agent' ? 'Configurar agente' : 'Configurar bloco'}</p><p className="mt-1 text-xs text-[var(--wf-muted)]">As alterações ficam no rascunho</p></div><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 shrink-0 rounded-xl text-[var(--wf-muted)] hover:bg-white/[0.06] hover:text-[var(--wf-text)]"><PanelRightClose className="h-4 w-4" /><span className="sr-only">Fechar inspetor</span></Button></div>
              <Label htmlFor={`workflow-node-name-${selectedNode.id}`} className="mt-3 block text-xs text-[var(--wf-muted)]">{selectedNode.data.workflowNode.type === 'ai.agent' ? 'Nome do agente' : 'Nome do bloco'}</Label>
              <Input id={`workflow-node-name-${selectedNode.id}`} value={formDrafts.current.get(`${selectedNode.id}:name`) ?? selectedNode.data.workflowNode.name} onChange={(event) => { if (!event.target.value.trim()) { formDrafts.current.set(`${selectedNode.id}:name`, event.target.value); reportFormError(`${selectedNode.id}:name`, 'Nome obrigatório'); return; } formDrafts.current.delete(`${selectedNode.id}:name`); reportFormError(`${selectedNode.id}:name`, null); updateSelectedNode({
                ...selectedNode.data.workflowNode,
                name: event.target.value,
                config: selectedNode.data.workflowNode.type === 'ai.agent'
                  ? { ...selectedNode.data.workflowNode.config, name: event.target.value }
                  : selectedNode.data.workflowNode.config,
              }); }} className="mt-1.5 h-10 rounded-xl border-[var(--wf-border)] bg-[var(--wf-panel)] font-semibold text-[var(--wf-text)] shadow-inner placeholder:text-[var(--wf-muted)]" />
              {onTestNode && <Button variant="outline" size="sm" onClick={openSelectedNodeTest} disabled={Boolean(selectedTestBlockedReason) || testRunning} title={selectedTestBlockedReason || 'Executar este bloco com as dependências anteriores simuladas'} className="mt-3 w-full rounded-xl border-[var(--wf-border)] bg-slate-300/[0.045] text-[var(--wf-text)] hover:bg-slate-300/[0.08]"><Play className="mr-2 h-4 w-4 text-[var(--wf-muted)]" />{testRunning ? 'Iniciando…' : 'Testar deste bloco'}</Button>}
              <div className={`mt-3 grid gap-2 ${selectedNode.data.workflowNode.type !== 'ai.agent' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <Button variant="outline" size="sm" onClick={duplicateSelectedNode} title="Duplicar bloco (Ctrl+D)" className="border-[var(--wf-border)] bg-slate-300/[0.045] text-[var(--wf-text)] hover:bg-slate-300/[0.08]"><Copy className="mr-2 h-4 w-4" />Duplicar</Button>
                {selectedNode.data.workflowNode.type !== 'ai.agent' ? <Button variant="destructive" size="sm" onClick={requestDeleteSelectedNode} title="Excluir bloco (Delete)"><Trash2 className="mr-2 h-4 w-4" />Excluir</Button> : null}
              </div>
            </div>
            <div className="mb-4 flex gap-1 rounded-xl bg-[var(--wf-canvas)] p-1" role="tablist" aria-label="Detalhes da operação">
              {(['config', 'advanced', 'results'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={inspectorTab === tab} onClick={() => setInspectorTab(tab)} className={cn('flex-1 rounded-lg px-2 py-2 text-xs', inspectorTab === tab ? 'bg-[var(--wf-panel)] font-semibold text-[var(--wf-text)] shadow-sm' : 'text-[var(--wf-muted)]')}>{tab === 'config' ? 'Configuração' : tab === 'advanced' ? 'Avançado' : 'Resultados'}</button>)}
            </div>
            {formErrors[`${selectedNode.id}:name`] && <p role="alert" className="mb-3 text-xs text-[var(--wf-danger)]">Informe um nome para esta operação.</p>}
            {inspectorTab === 'results' ? <section className="rounded-xl border border-[var(--wf-border)] p-4"><h3 className="text-sm font-semibold">Resultado recebido do motor</h3><p className="mt-2 text-xs text-[var(--wf-muted)]">{debugSnapshot ? 'Dados da execução selecionada.' : 'Selecione uma execução no debugger para inspecionar dados reais.'}</p>{debugSnapshot?.execution.nodeResults?.[selectedNode.id] && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(debugSnapshot.execution.nodeResults[selectedNode.id], null, 2)}</pre>}</section> : <>
            {definition.workspaceId && debugSnapshot?.execution.status === 'failed' && <WorkflowRecovery workspaceId={definition.workspaceId} executionId={debugSnapshot.execution.id} onRecovered={() => setDebugReloadKey(value => value + 1)} />}
            {selectedNode.data.workflowNode.type === 'trigger.webhook' && <WorkflowWebhookSettings node={selectedNode.data.workflowNode} onUpdate={updateSelectedNode} credentials={credentialOptions} />}
            {definition.workspaceId && ['logic.map_subflow', 'logic.fork_subflows', 'logic.async_subflow', 'trigger.webhook'].includes(selectedNode.data.workflowNode.type) && <WorkflowAutomationMonitor workspaceId={definition.workspaceId} executionId={debugSnapshot?.execution.id} onInspect={setDebugExecutionId} />}
            {definition.workspaceId && selectedNode.data.workflowNode.type === 'trigger.webhook' && <WorkflowWebhookTester workspaceId={definition.workspaceId} onSample={sample => setPinnedFixtures(previous => ({ ...previous, [selectedNode.id]: { output: sample } }))} />}
            {definition.workspaceId && (selectedNode.data.workflowNode.type === 'logic.approval' || selectedNode.data.workflowNode.type === 'integration.connector' || debugSnapshot?.execution.waitingReason === 'approval') && <WorkflowApprovals workspaceId={definition.workspaceId} />}
            <WorkflowDataExplorer key={selectedNode.id} node={selectedNode.data.workflowNode} execution={debugSnapshot?.execution || testDataSnapshot || undefined} pinned={new Set(Object.keys(pinnedFixtures))} onPin={(id, output, statePatch) => setPinnedFixtures(previous => { const next = { ...previous }; if (output) next[id] = { output, ...(statePatch ? { statePatch } : {}) }; else delete next[id]; return next; })} onMap={(field, expression) => updateSelectedNode({ ...selectedNode.data.workflowNode, config: { ...selectedNode.data.workflowNode.config, [field]: expression } })} />
            {inspectorTab === 'advanced' && selectedNode.data.workflowNode.outputPorts.some((port) => port.connectionType === 'error') ? (
              <section className="mb-4 rounded-[16px] border border-[var(--wf-border)] bg-[var(--wf-panel)] p-4">
                <label htmlFor={`workflow-custom-error-${selectedNode.id}`} className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    id={`workflow-custom-error-${selectedNode.id}`}
                    checked={selectedNode.data.workflowNode.config.customErrorRoute === true}
                    onCheckedChange={(checked) => setSelectedNodeCustomErrorRoute(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-[var(--wf-text)]">Usar caminho de erro personalizado</span>
                    <span className="mt-1 block text-xs leading-relaxed text-[var(--wf-muted)]">
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
              : isStudioFlowNode(selectedNode.data.workflowNode.type)
                ? <StudioCompositionInspector node={selectedNode.data.workflowNode} definition={definition} releases={studioLibrary.releases} loading={studioLibrary.loading} error={studioLibrary.error} onUpdate={(patch) => updateSelectedNode({ ...selectedNode.data.workflowNode, ...patch })} onAddResource={(type) => addCatalogItem({ type, position: centerCanvasPosition(), smartPosition: true })} />
              : selectedNode.data.workflowNode.type === 'ai.published_agent'
                ? <PublishedAgentInspector workspaceId={definition.workspaceId} node={selectedNode.data.workflowNode} onUpdate={(patch) => updateSelectedNode({ ...selectedNode.data.workflowNode, ...patch })} />
              : toolboxManifests().some(manifest => manifest.type === selectedNode.data.workflowNode.type)
                ? <WorkflowToolboxInspector workspaceId={definition.workspaceId} node={selectedNode.data.workflowNode} onUpdate={updateSelectedNode} credentials={credentialOptions} workflows={dialogyResources.workflows.filter(workflow => workflow.id !== definition.id.replace(/^nexus:/, ''))} />
              : hasSpecializedWorkflowInspector(selectedNode.data.workflowNode.type)
                ? <NativeSpecializedNodeInspector
                    node={selectedNode.data.workflowNode}
                    onUpdate={updateSelectedNode}
                    editorMode={inspectorTab === 'advanced' ? 'advanced' : 'essential'}
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
                : <GenericInspector node={selectedNode.data.workflowNode} manifest={getWorkflowNodeManifest(selectedNode.data.workflowNode.type)} onUpdate={updateSelectedNode} />}
            </>}
          </div>
        ) : (
          <div className="p-4"><div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center justify-between gap-3 border-b border-[var(--wf-border)] bg-[var(--wf-panel)] px-4 py-4 backdrop-blur-xl"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--wf-text)]">Saúde da automação</p><p className="mt-1 text-xs text-[var(--wf-muted)]">Validação e tipos de conexão</p></div><Button variant="ghost" size="icon" onClick={() => setInspectorOpen(false)} title="Fechar inspetor" className="h-8 w-8 rounded-xl text-[var(--wf-muted)] hover:bg-white/[0.06] hover:text-[var(--wf-text)]"><PanelRightClose className="h-4 w-4" /></Button></div><div className="mt-4 space-y-2">{validation.errors.length === 0 ? <div className="rounded-[16px] border border-emerald-400/20 bg-emerald-400/[0.075] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><CheckCircle2 className="h-4 w-4" />Tudo pronto para publicar</div><p className="mt-2 text-xs leading-relaxed text-emerald-100/65">A estrutura e as conexões obrigatórias estão válidas.</p></div> : validation.errors.map((issue, index) => <button key={`${issue.code}-${index}`} type="button" onClick={() => { if (issue.nodeId) setSelectedNodeId(issue.nodeId); }} className="w-full rounded-[16px] border border-amber-400/25 bg-amber-400/[0.07] p-3 text-left transition hover:bg-amber-400/[0.12]"><span className="flex items-start gap-2 text-xs font-medium leading-relaxed text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</span><span className="ml-5 mt-1 block font-mono text-xs text-amber-300/55">{issue.code}</span></button>)}</div><div className="mt-5 rounded-[16px] border border-[var(--wf-border)] bg-[var(--wf-panel)] p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--wf-muted)]">Tipos de conexão</p><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">{Object.entries(CONNECTION_META).filter(([type]) => type !== 'agent_tool').map(([type, meta]) => <div key={type} className="flex items-center gap-2 text-xs text-[var(--wf-text)]"><span className="w-7 border-t-2" style={{ borderColor: meta.color, borderStyle: meta.dashed ? 'dashed' : 'solid' }} />{meta.label}</div>)}</div></div></div>
        )}
      </aside>}
      <AlertDialog open={Boolean(insertionChoice)} onOpenChange={(open) => { if (!open) setInsertionChoice(null); }}>
        <AlertDialogContent className="workflow-portal border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)]"><AlertDialogHeader><AlertDialogTitle>Escolha a continuação</AlertDialogTitle><AlertDialogDescription>Selecione as portas da operação que manterão o caminho existente.</AlertDialogDescription></AlertDialogHeader><div className="grid gap-2">{insertionChoice?.pairs.map((pair) => <Button key={`${pair.input.id}:${pair.output.id}`} variant="outline" onClick={() => {
          if (!insertionEdgeId || !insertionChoice) return;
          try { applyHistory(insertWorkflowOperation(definition, insertionEdgeId, insertionChoice.node, pair.input.id, pair.output.id, `conn_${crypto.randomUUID()}`)); setSelectedNodeId(insertionChoice.node.id); setInsertionChoice(null); setInsertionEdgeId(null); setCatalogOpen(false); openInspectorPanel(); }
          catch (error) { toast({ title: 'Inserção indisponível', description: String(error), variant: 'destructive' }); }
        }}>{pair.input.label} → {pair.output.label}</Button>)}</div><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={(open) => { if (!open) setDeleteCandidateId(null); }}>
        <AlertDialogContent className="workflow-portal border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteIdsRef.current.length > 1 ? `Excluir ${deleteIdsRef.current.length} operações?` : `Excluir “${deleteCandidate?.data.workflowNode.name || 'bloco'}”?`}</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--wf-muted)]">
              As conexões e os recursos privados usados somente por este bloco também serão removidos. Esta alteração só chega ao atendimento depois de salvar e publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--wf-border)] bg-transparent text-[var(--wf-text)] hover:bg-white/5">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCandidate} className="bg-red-600 text-white hover:bg-red-500">Excluir bloco</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NativeWorkflowTestChat
        open={Boolean(testTarget)}
        onClose={() => setTestTarget(null)}
        workflowName={definition.name}
        workflowDefinition={definition}
        simulationOperations={studioSimulationOperations}
        startNodeId={testTarget?.kind === 'node' ? testTarget.nodeId : undefined}
        startNodeName={testTarget?.kind === 'node' ? selectedWorkflowNode?.name : undefined}
        onRunTest={async (payload) => {
          setTestRunning(true);
          try {
            if (testTarget?.kind === 'node') return rememberTestResult(await onTestNode?.(testTarget.nodeId, { message: payload.message, fixtures: { ...pinnedFixtures, ...payload.fixtures } }));
            return rememberTestResult(await onTest?.({ message: payload.message, fixtures: { ...pinnedFixtures, ...payload.fixtures } }));
          } finally { setTestRunning(false); }
        }}
        onResumeTest={onResumeTest ? async (payload) => { setTestRunning(true); try { return rememberTestResult(await onResumeTest(payload)); } finally { setTestRunning(false); } } : undefined}
        onOpenExecutionDebugger={(executionId) => {
          setDebugExecutionId(executionId);
        }}
      />
    </div></WorkflowFormValidation.Provider></TooltipProvider>
  );
}
