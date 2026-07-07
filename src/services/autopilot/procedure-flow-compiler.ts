import type {
  AutopilotFlowFormField,
  AutopilotFlowGraph,
  AutopilotFlowNode,
  AutopilotFlowSwitchRoute,
} from '@/lib/types';
import type {
  ProcedureCompilationResult,
  ProcedureGraph,
  ProcedureSlotDefinition,
  ProcedureStep,
} from './procedure-types';
import { migrateAutopilotFlowGraphToV2 } from './flow-v2';

function normalizeId(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function stepIdForNode(node: AutopilotFlowNode, index: number) {
  return `flow_${normalizeId(node.id || node.title) || `node_${index + 1}`}`;
}

function slotKeyForField(field: AutopilotFlowFormField) {
  return normalizeId(field.fieldKey || field.id || field.label);
}

function slotDefinitionForField(field: AutopilotFlowFormField): ProcedureSlotDefinition | null {
  const key = slotKeyForField(field);
  if (!key) return null;
  return {
    key,
    label: field.label,
    type: field.type,
    required: field.required !== false,
    aliases: field.aliases || [],
    placeholder: field.placeholder,
  };
}

function executableNodeKind(node: AutopilotFlowNode) {
  return (
    node.kind === 'message' ||
    node.kind === 'decision' ||
    node.kind === 'knowledge' ||
    node.kind === 'collect' ||
    node.kind === 'tool' ||
    node.kind === 'sub_agent' ||
    node.kind === 'handoff' ||
    (node.kind === 'end' && Boolean(node.config?.message?.trim()))
  );
}

function renderFormPrompt(node: AutopilotFlowNode) {
  const intro = node.config?.message?.trim() || 'Para continuar, me envie os dados abaixo:';
  const fields = node.config?.formFields || [];
  const lines = fields
    .filter((field) => field.label?.trim())
    .map((field) => {
      const required = field.required === false ? 'opcional' : 'obrigatorio';
      const placeholder = field.placeholder?.trim() ? ` Ex.: ${field.placeholder.trim()}` : '';
      return `- ${field.label.trim()} (${required}).${placeholder}`;
    });

  return [
    intro,
    lines.length > 0 ? lines.join('\n') : '',
    lines.length > 0 ? 'Pode responder tudo em uma unica mensagem.' : '',
  ].filter(Boolean).join('\n\n').trim();
}

function collectTriggerIntents(graph: AutopilotFlowGraph) {
  const intents = graph.nodes.flatMap((node) => {
    if (node.kind === 'decision') {
      return (node.config?.routes || [])
        .map((route) => route.intent)
        .filter((intent): intent is string => Boolean(intent?.trim()));
    }
    return [];
  });
  return Array.from(new Set(intents)).slice(0, 8);
}

function collectTriggerKeywords(graph: AutopilotFlowGraph) {
  const values = graph.nodes.flatMap((node) => {
    const routeValues = node.kind === 'switch' || node.kind === 'decision'
      ? (node.config?.routes || []).flatMap((route) => [
        route.label,
        route.description,
        ...(route.examples || []),
      ])
      : [];

    return [
      node.title,
      node.subtitle,
      node.config?.instructions,
      node.config?.message,
      node.config?.customIntentLabel,
      ...routeValues,
    ];
  });

  return Array.from(new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value && value.length >= 3))
      .slice(0, 24),
  ));
}

function routeTargetFromEdge(
  graph: AutopilotFlowGraph,
  switchNodeId: string,
  routeId: string,
) {
  return graph.edges.find((edge) => (
    edge.source === switchNodeId && edge.routeId === routeId && Boolean(edge.target)
  ))?.target;
}

function isMainSequenceEdge(
  edge: NonNullable<AutopilotFlowGraph['edges']>[number],
  sourceNode: AutopilotFlowNode | undefined,
  routeId?: string | null,
) {
  if (routeId) return edge.routeId === routeId;
  if (edge.routeId) return false;
  if (edge.sourceHandle === 'source-right-skill') return false;
  if (edge.sourceHandle === 'source-right-knowledge') {
    return sourceNode?.kind === 'knowledge';
  }
  return true;
}

export function compileProcedureFromFlowGraph(input: {
  flowGraph: AutopilotFlowGraph | null | undefined;
  configId?: string | null;
  name?: string | null;
}): ProcedureCompilationResult {
  const graph = migrateAutopilotFlowGraphToV2(input.flowGraph);
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return {
      success: false,
      graph: null,
      warnings: [],
      error: 'Fluxo visual vazio.',
    };
  }

  const executableNodes = graph.nodes.filter(executableNodeKind);
  if (executableNodes.length === 0) {
    return {
      success: false,
      graph: null,
      warnings: [],
      error: 'Fluxo visual sem nodes executaveis.',
    };
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const executableIds = new Set(executableNodes.map((node) => node.id));
  const stepIdByNodeId = new Map(
    executableNodes.map((node, index) => [node.id, stepIdForNode(node, index)]),
  );

  const knowledgeDependencyForTarget = (targetNodeId: string): string | null => {
    const targetNode = nodeById.get(targetNodeId);
    if (!targetNode || targetNode.kind === 'knowledge') return null;

    const incomingKnowledgeEdge = graph.edges.find((edge) => {
      if (edge.target !== targetNodeId || edge.routeId) return false;
      const sourceNode = nodeById.get(edge.source);
      if (sourceNode?.kind !== 'knowledge' || !executableIds.has(edge.source)) return false;
      return edge.sourceHandle === 'source-right-knowledge'
        || edge.targetHandle === 'target-left-knowledge'
        || targetNode.kind === 'sub_agent';
    });

    return incomingKnowledgeEdge?.source || null;
  };

  const nextExecutableFrom = (sourceNodeId: string, routeId?: string | null): string | null => {
    const visited = new Set<string>([sourceNodeId]);
    const sourceNode = nodeById.get(sourceNodeId);
    const initialEdges = graph.edges.filter((edge) => (
      edge.source === sourceNodeId &&
      isMainSequenceEdge(edge, sourceNode, routeId)
    ));
    const queue = initialEdges.map((edge) => edge.target).filter(Boolean);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      if (executableIds.has(nodeId)) {
        const knowledgeDependency = sourceNode?.kind === 'knowledge'
          ? null
          : knowledgeDependencyForTarget(nodeId);
        return knowledgeDependency || nodeId;
      }

      const candidateSourceNode = nodeById.get(nodeId);
      for (const edge of graph.edges.filter((candidate) => (
        candidate.source === nodeId &&
        isMainSequenceEdge(candidate, candidateSourceNode)
      ))) {
        if (edge.target && !visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }

    return null;
  };

  const stepForNode = (node: AutopilotFlowNode, index: number): ProcedureStep | null => {
    const id = stepIdByNodeId.get(node.id) || stepIdForNode(node, index);
    const nextNodeId = node.kind === 'decision' ? null : nextExecutableFrom(node.id);
    const nextStepId = nextNodeId ? stepIdByNodeId.get(nextNodeId) || null : null;
    const base = {
      id,
      order: index + 1,
      label: node.title || node.id,
      visualNodeId: node.id,
      visualNodeKind: node.kind,
      nextStepId,
    };

    if (node.kind === 'decision') {
      const routes = node.config?.routes || [];
      const branches = routes.flatMap((route: AutopilotFlowSwitchRoute) => {
        const routeTarget = route.targetNodeId || routeTargetFromEdge(graph, node.id, route.id);
        const directTargetNodeId = routeTarget && nodeById.has(routeTarget)
          ? routeTarget
          : nextExecutableFrom(node.id, route.id);
        const targetNodeId = directTargetNodeId
          ? knowledgeDependencyForTarget(directTargetNodeId) || directTargetNodeId
          : null;
        const targetStepId = targetNodeId ? stepIdByNodeId.get(targetNodeId) : null;
        if (!targetStepId) return [];

        return [{
          condition: [
            route.label,
            route.description,
            ...(route.examples || []),
          ].filter(Boolean).join(' | '),
          nextStepId: targetStepId,
        }];
      });

      return {
        ...base,
        type: 'decide',
        decisionPrompt: node.config?.instructions || `Escolha uma rota para ${node.title}.`,
        branches,
        nextStepId: null,
      };
    }

    if (node.kind === 'collect') {
      const fields = node.config?.formFields || [];
      const slotDefinitions = fields
        .map(slotDefinitionForField)
        .filter((slot): slot is ProcedureSlotDefinition => Boolean(slot));
      return {
        ...base,
        type: 'gather_data',
        requiredSlots: slotDefinitions
          .filter((field) => field.required !== false)
          .map((field) => field.key)
          .filter(Boolean),
        slotDefinitions,
        promptTemplate: renderFormPrompt(node),
        maxRetries: node.config?.maxAttempts,
      };
    }

    if (node.kind === 'knowledge') {
      return {
        ...base,
        type: 'retrieve_knowledge',
        knowledgeQueryTemplate: node.config?.message || node.config?.instructions || '{{customerMessage}}',
        knowledgeCollectionIds: node.config?.knowledgeCollectionIds?.filter(Boolean),
        requiredKnowledgeCoverage: node.config?.requiredKnowledgeCoverage || 'medium',
        onLowKnowledge: /\b(transfer|humano|atendente|equipe)\w*/i.test(node.config?.instructions || '')
          ? 'handoff'
          : 'pause',
      };
    }

    if (node.kind === 'tool') {
      return {
        ...base,
        type: 'tool_call',
        toolName: node.toolName || node.config?.referenceId,
        toolPayloadTemplate: {},
      };
    }

    if (node.kind === 'handoff') {
      return {
        ...base,
        type: 'handoff',
        handoffReason: node.config?.message || node.config?.destination || node.title,
        nextStepId: null,
      };
    }

    const responseTemplate = node.kind === 'sub_agent'
      ? [
        node.config?.message,
        node.config?.instructions,
      ].filter((value) => value?.trim()).join('\n\n') || node.title
      : node.config?.message || node.config?.instructions || node.title;

    return {
      ...base,
      type: 'respond',
      responseTemplate,
      useLlm: Boolean(node.config?.useAi || node.kind === 'sub_agent'),
      requireGrounding: node.kind === 'sub_agent' || Boolean(node.config?.requiredKnowledgeCoverage),
      requiredKnowledgeCoverage: node.config?.requiredKnowledgeCoverage,
      returnToMainPrompt: node.kind === 'sub_agent' ? node.config?.returnToMainPrompt === true : undefined,
    };
  };

  const steps = executableNodes
    .map(stepForNode)
    .filter((step): step is ProcedureStep => Boolean(step));

  const compiled: ProcedureGraph = {
    id: `flow_${normalizeId(input.configId || input.name || 'visual_procedure') || 'visual_procedure'}`,
    documentId: `flow:${input.configId || 'visual'}`,
    documentName: input.name || 'Procedimento visual',
    version: 1,
    compiledAt: new Date().toISOString(),
    triggerIntents: collectTriggerIntents(graph),
    triggerKeywords: collectTriggerKeywords(graph),
    steps,
    metadata: {
      source: 'visual_flow',
      flowVersion: graph.version,
      visualNodeMappings: steps.map((step) => ({
        visualNodeId: step.visualNodeId,
        visualNodeKind: step.visualNodeKind,
        stepId: step.id,
        stepType: step.type,
      })),
    },
  };

  if (compiled.triggerIntents.length === 0) {
    compiled.triggerIntents = ['unknown'];
  }

  return {
    success: true,
    graph: compiled,
    warnings: [],
  };
}
