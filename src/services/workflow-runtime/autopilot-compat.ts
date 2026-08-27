import type {
  AutopilotFlowEdge,
  AutopilotFlowGraph,
  AutopilotFlowNode,
} from '@/lib/types';
import { createWorkflowNode } from './catalog';
import type {
  ModelConfiguration,
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowNode,
} from './types';
import { createId } from './utils';

export type CompileAutopilotWorkflowInput = {
  configId: string;
  workspaceId: string;
  name: string;
  graph: AutopilotFlowGraph;
  version: string;
  model: ModelConfiguration;
  createdAt?: string;
  updatedAt?: string;
};

function normalizeId(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function targetType(node: AutopilotFlowNode): string {
  switch (node.kind) {
    case 'start':
    case 'trigger':
      return 'trigger.received_message';
    case 'message':
    case 'reply':
    case 'send_message':
      return 'output.respond';
    case 'collect':
    case 'form':
      return 'logic.wait';
    case 'decision':
    case 'switch':
    case 'intent':
    case 'rule':
      return node.config?.switchMode === 'rules' ? 'logic.switch' : 'logic.ai_router';
    case 'assistant':
    case 'sub_agent':
    case 'ai_response':
    case 'understand':
      return 'ai.agent';
    case 'knowledge':
      return 'knowledge.rag_retriever';
    case 'tool':
      return node.toolName?.startsWith('mcp:') ? 'tool.mcp' : 'tool.internal';
    case 'handoff':
      return node.config?.destination ? 'output.handoff' : 'output.respond';
    case 'close':
    case 'end':
      return 'output.end';
    default:
      return 'data.transform';
  }
}

function mappedConfig(node: AutopilotFlowNode): Record<string, unknown> {
  const config = node.config || {};
  const type = targetType(node);
  switch (type) {
    case 'trigger.received_message':
      return {};
    case 'output.respond':
      return {
        message: config.message || node.subtitle || node.title,
        channel: 'source',
        idempotent: true,
      };
    case 'logic.wait':
      return {
        mode: 'event',
        resumeEvent: 'conversation.message.received',
        timeoutMs: 86_400_000,
        requestedFields: config.formFields || config.requiredSlots || [],
      };
    case 'logic.ai_router': {
      const routes = config.routes || [];
      const fallback = config.fallbackRouteId || routes.at(-1)?.id || 'fallback';
      return {
        routes: routes.map((route) => ({
          id: route.id,
          label: route.label,
          description: route.description,
          examples: route.examples || [],
        })),
        minimumConfidence: config.confidenceThreshold ?? 0.75,
        lowConfidenceOutput: fallback,
        defaultOutput: fallback,
        instructions: config.instructions || '',
      };
    }
    case 'logic.switch':
      return {
        value: `{{variables.${config.variableName || 'route'}}}`,
        cases: (config.routes || []).map((route) => ({
          output: route.id,
          operator: 'equals',
          value: route.id,
        })),
        defaultOutput: config.fallbackRouteId || config.routes?.at(-1)?.id || 'default',
      };
    case 'ai.agent':
      return {
        name: node.title || 'Agente',
        role: config.customIntentLabel || node.subtitle || 'atendimento',
        objective: config.instructions || config.message || node.subtitle || node.title,
        instructions: [
          config.instructions || '',
          config.message ? `Resposta esperada: ${config.message}` : '',
        ].filter(Boolean),
        completionCriteria: [
          'Responder ou encaminhar a solicitação sem inventar resultados.',
          'Usar somente ferramentas e conhecimento conectados.',
        ],
        availableContext: ['input', 'context', 'variables'],
        maxTurns: 8,
        maxToolCalls: 20,
        maxRepeatedToolCalls: 2,
        timeoutMs: 120_000,
        modelTimeoutMs: 60_000,
        toolTimeoutMs: 30_000,
        allowParallelToolCalls: false,
        requireStructuredFinalOutput: false,
        fallbackOnToolError: 'route_to_error',
        onLimitReached: 'handoff',
      };
    case 'knowledge.rag_retriever':
      return {
        maxDocuments: 6,
        minimumScore: 0.55,
        filters: {
          collectionIds: config.knowledgeCollectionIds || [],
        },
        strategy: 'hybrid',
        rerank: true,
        tokenLimit: 6_000,
      };
    case 'tool.mcp': {
      const [, serverId = '', toolName = ''] = String(node.toolName || '').split(':');
      return {
        name: node.toolName || normalizeId(node.title),
        description: node.subtitle || config.instructions || node.title,
        serverId,
        allowedTools: toolName ? [toolName] : [],
        inputSchema: config.inputSchema || {},
        outputSchema: config.outputSchema || {},
        timeoutMs: 20_000,
        requiresConfirmation: node.risk === 'high',
        audit: true,
      };
    }
    case 'tool.internal':
      return {
        name: node.toolName || normalizeId(node.title),
        description: node.subtitle || config.instructions || node.title,
        action: node.toolName || normalizeId(node.title),
        inputSchema: config.inputSchema || {},
        outputSchema: config.outputSchema || {},
        idempotent: node.risk !== 'high',
        requiresConfirmation: node.risk === 'high',
      };
    case 'output.handoff':
      return {
        teamId: config.destination || '',
        reason: config.message || node.subtitle || 'Transferência solicitada pelo fluxo.',
        requireConfirmation: false,
        permissionScope: 'conversation:handoff',
      };
    case 'output.end':
      return {
        output: {
          message: config.message || node.subtitle || '',
        },
      };
    default:
      return {
        mappings: {
          value: config.variableName
            ? `{{variables.${config.variableName}}}`
            : '{{current}}',
        },
      };
  }
}

function dynamicRoutePorts(node: AutopilotFlowNode, workflowNode: WorkflowNode): WorkflowNode {
  if (workflowNode.type !== 'logic.ai_router' && workflowNode.type !== 'logic.switch') return workflowNode;
  const routePorts = (node.config?.routes || []).map((route) => ({
    id: route.id,
    label: route.label || route.id,
    direction: 'output' as const,
    connectionType: 'main' as const,
    required: true,
    multiple: false,
  }));
  const fallback = node.config?.fallbackRouteId || routePorts.at(-1)?.id || 'default';
  if (!routePorts.some((port) => port.id === fallback)) {
    routePorts.push({
      id: fallback,
      label: 'Fallback',
      direction: 'output',
      connectionType: 'main',
      required: true,
      multiple: false,
    });
  }
  return {
    ...workflowNode,
    outputPorts: [
      ...routePorts,
      {
        id: 'error',
        label: 'Erro',
        direction: 'output',
        connectionType: 'error',
        required: false,
        multiple: false,
      },
    ],
  };
}

function mainSourcePort(node: WorkflowNode, edge?: AutopilotFlowEdge): string {
  if ((node.type === 'logic.ai_router' || node.type === 'logic.switch') && edge?.routeId) {
    return edge.routeId;
  }
  return node.outputPorts.find((port) => port.connectionType === 'main')?.id || 'success';
}

function mainTargetPort(node: WorkflowNode): string {
  return node.inputPorts.find((port) => port.connectionType === 'main')?.id || 'main';
}

function connection(
  source: WorkflowNode,
  target: WorkflowNode,
  type: WorkflowConnection['connectionType'],
  sourcePortId: string,
  targetPortId: string,
  id = createId('conn'),
): WorkflowConnection {
  return {
    id,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    connectionType: type,
  };
}

export function compileAutopilotFlowToWorkflow(
  input: CompileAutopilotWorkflowInput,
): WorkflowDefinition {
  const timestamp = new Date().toISOString();
  const nodes = input.graph.nodes.map((legacyNode) => {
    const node = createWorkflowNode(targetType(legacyNode), {
      id: legacyNode.id,
      name: legacyNode.title,
      position: legacyNode.position,
      config: mappedConfig(legacyNode),
    });
    return dynamicRoutePorts(legacyNode, node);
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const legacyNodeMap = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const modelNode = createWorkflowNode('ai.model', {
    id: `model_${normalizeId(input.configId)}`,
    name: `Modelo de ${input.name}`,
    position: {
      x: Math.min(...nodes.map((node) => node.position.x), 0) - 260,
      y: Math.min(...nodes.map((node) => node.position.y), 0),
    },
    config: input.model,
  });
  nodes.push(modelNode);
  nodeMap.set(modelNode.id, modelNode);

  const connections: WorkflowConnection[] = [];
  const bypassTargets = new Map<string, string[]>();
  for (const edge of input.graph.edges) {
    const legacySource = legacyNodeMap.get(edge.source);
    const legacyTarget = legacyNodeMap.get(edge.target);
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!legacySource || !legacyTarget || !source || !target) continue;

    if (target.type.startsWith('tool.') && source.type === 'ai.agent') {
      connections.push(connection(
        target,
        source,
        'tool',
        target.outputPorts.find((port) => port.connectionType === 'tool')?.id || 'tool',
        source.inputPorts.find((port) => port.connectionType === 'tool')?.id || 'tools',
        `compat_tool_${edge.id}`,
      ));
      const outgoingTargets = input.graph.edges
        .filter((candidate) => candidate.source === target.id)
        .map((candidate) => candidate.target);
      bypassTargets.set(source.id, [...(bypassTargets.get(source.id) || []), ...outgoingTargets]);
      continue;
    }
    if (source.type.startsWith('tool.')) continue;

    if (source.type === 'knowledge.rag_retriever' && target.type === 'ai.agent') {
      connections.push(connection(
        source,
        target,
        'knowledge',
        'knowledge',
        'knowledge',
        `compat_knowledge_${edge.id}`,
      ));
      const incomingSources = input.graph.edges
        .filter((candidate) => candidate.target === source.id)
        .map((candidate) => candidate.source);
      for (const incomingSource of incomingSources) {
        bypassTargets.set(incomingSource, [...(bypassTargets.get(incomingSource) || []), target.id]);
      }
      continue;
    }
    if (target.type === 'knowledge.rag_retriever') continue;

    connections.push(connection(
      source,
      target,
      'main',
      mainSourcePort(source, edge),
      mainTargetPort(target),
      `compat_main_${edge.id}`,
    ));
  }

  for (const [sourceId, targetIds] of bypassTargets) {
    const source = nodeMap.get(sourceId);
    if (!source) continue;
    for (const targetId of new Set(targetIds)) {
      const target = nodeMap.get(targetId);
      if (!target || target.type.startsWith('tool.') || target.type === 'knowledge.rag_retriever') continue;
      if (connections.some((candidate) => (
        candidate.sourceNodeId === source.id
        && candidate.targetNodeId === target.id
        && candidate.connectionType === 'main'
      ))) continue;
      connections.push(connection(
        source,
        target,
        'main',
        mainSourcePort(source),
        mainTargetPort(target),
      ));
    }
  }

  for (const agent of nodes.filter((node) => node.type === 'ai.agent' || node.type === 'ai.prompt')) {
    connections.push(connection(modelNode, agent, 'model', 'model', 'model'));
  }

  return {
    id: `autopilot:${input.configId}`,
    workspaceId: input.workspaceId,
    name: input.name,
    version: input.version,
    status: 'draft',
    nodes,
    connections,
    settings: {
      executionTimeoutMs: 120_000,
      maxSteps: 100,
      maxModelCalls: 15,
      maxToolCalls: 20,
      maxAgentTurnsPerNode: 8,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 100_000,
      maxTotalOutputTokens: 20_000,
      concurrencyLimit: 1,
    },
    metadata: {
      source: 'autopilot_flow_v2',
      configId: input.configId,
      visualGraphVersion: input.graph.version,
    },
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}
