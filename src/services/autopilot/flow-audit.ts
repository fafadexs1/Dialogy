import type { AutopilotFlowGraph, AutopilotFlowNode, AutopilotFlowSwitchRoute } from '@/lib/types';
import { migrateAutopilotFlowGraphToV2 } from './flow-v2';

export type AutopilotFlowAuditIssue = {
  severity: 'critical' | 'warning';
  code: string;
  nodeId?: string;
  routeId?: string;
  message: string;
};

export type AutopilotFlowSimulationResult = {
  caseId: string;
  title: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  nodeId?: string;
  routeId?: string;
  message: string;
  evidence: string[];
};

export type AutopilotFlowAuditResult = {
  status: 'passed' | 'failed';
  issues: AutopilotFlowAuditIssue[];
  simulations: AutopilotFlowSimulationResult[];
};

function normalizedText(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function addIssue(
  issues: AutopilotFlowAuditIssue[],
  issue: AutopilotFlowAuditIssue,
) {
  issues.push(issue);
}

function routeTargetNodeId(graph: AutopilotFlowGraph, switchNode: AutopilotFlowNode, routeId: string) {
  const route = switchNode.config?.routes?.find((candidate) => candidate.id === routeId);
  return route?.targetNodeId
    || graph.edges.find((edge) => edge.source === switchNode.id && edge.routeId === routeId)?.target
    || null;
}

function nodeText(node: AutopilotFlowNode | null | undefined) {
  if (!node) return '';
  return normalizedText([
    node.title,
    node.subtitle,
    node.toolName,
    node.config?.instructions,
    node.config?.message,
    node.config?.intent,
    node.config?.destination,
  ].join(' '));
}

function routeText(route: AutopilotFlowSwitchRoute) {
  return normalizedText([
    route.id,
    route.label,
    route.description,
    route.intent,
    ...(route.examples || []),
  ].join(' '));
}

function looksLikeRiskyAction(node: AutopilotFlowNode | null | undefined) {
  if (!node) return false;
  if (node.kind !== 'tool' && node.kind !== 'close' && node.risk !== 'high') return false;
  const text = nodeText(node);
  return node.risk === 'high'
    || /\b(alter|trocar|atualiz|cancel|delet|exclu|reinici|reboot|deslig|cobr|pag|senha|credential)\w*/.test(text);
}

function looksLikeConfirmationNode(node: AutopilotFlowNode | null | undefined) {
  if (!node) return false;
  const text = nodeText(node);
  return node.kind === 'form'
    || node.kind === 'collect'
    || node.kind === 'rule'
    || /\b(confirm|confirma|autoriz|posso|tem certeza|sim, pode)\w*/.test(text);
}

function hasHumanHandoff(graph: AutopilotFlowGraph) {
  return graph.nodes.some((node) => node.kind === 'handoff' || /\b(humano|atendente|pessoa|transfer|escal)\w*/.test(nodeText(node)));
}

function incomingNodes(graph: AutopilotFlowGraph, nodeId: string) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodeById.get(edge.source))
    .filter((node): node is AutopilotFlowNode => Boolean(node));
}

function outgoingEdges(graph: AutopilotFlowGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

function isSafeClarificationNode(node: AutopilotFlowNode | null | undefined) {
  if (!node) return false;
  return node.kind === 'assistant'
    || node.kind === 'sub_agent'
    || node.kind === 'ai_response'
    || node.kind === 'message'
    || node.kind === 'reply'
    || node.kind === 'send_message'
    || node.kind === 'form'
    || node.kind === 'collect'
    || node.kind === 'handoff'
    || node.kind === 'understand'
    || node.kind === 'intent'
    || node.kind === 'end'
    || node.kind === 'decision'
    || node.kind === 'switch'
    || node.kind === 'knowledge'
    || node.kind === 'rule';
}

function isRiskyOrTerminalNode(node: AutopilotFlowNode | null | undefined) {
  return Boolean(node && (node.kind === 'tool' || node.kind === 'close' || looksLikeRiskyAction(node)));
}

function auditSwitchNode(
  graph: AutopilotFlowGraph,
  node: AutopilotFlowNode,
  nodeIds: Set<string>,
  issues: AutopilotFlowAuditIssue[],
) {
  const routes = node.config?.routes || [];
  const confidenceThreshold = typeof node.config?.confidenceThreshold === 'number'
    ? node.config.confidenceThreshold
    : 0.75;
  const fallbackRouteId = node.config?.fallbackRouteId?.trim();

  if (routes.length < 2) {
    addIssue(issues, {
      severity: 'critical',
      code: 'switch_requires_two_routes',
      nodeId: node.id,
      message: `Switch "${node.title}" precisa ter pelo menos duas rotas.`,
    });
  }

  if (confidenceThreshold > 0 && !fallbackRouteId) {
    addIssue(issues, {
      severity: 'critical',
      code: 'switch_missing_fallback',
      nodeId: node.id,
      message: `Switch "${node.title}" precisa de uma rota fallback.`,
    });
  }

  if (fallbackRouteId && !routes.some((route) => route.id === fallbackRouteId)) {
    addIssue(issues, {
      severity: 'critical',
      code: 'switch_fallback_route_missing',
      nodeId: node.id,
      routeId: fallbackRouteId,
      message: `Fallback "${fallbackRouteId}" nao existe no Switch "${node.title}".`,
    });
  }

  const seenRouteIds = new Set<string>();
  const signatures = new Map<string, string>();
  for (const route of routes) {
    const routeId = route.id?.trim();
    if (!routeId) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_route_missing_id',
        nodeId: node.id,
        message: `Switch "${node.title}" possui rota sem id.`,
      });
      continue;
    }

    if (seenRouteIds.has(routeId)) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_duplicate_route_id',
        nodeId: node.id,
        routeId,
        message: `Switch "${node.title}" possui rota duplicada "${routeId}".`,
      });
    }
    seenRouteIds.add(routeId);

    if (!route.label?.trim()) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_route_missing_label',
        nodeId: node.id,
        routeId,
        message: `Rota "${routeId}" do Switch "${node.title}" precisa de nome visivel.`,
      });
    }

    if (!route.description?.trim()) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_route_missing_description',
        nodeId: node.id,
        routeId,
        message: `Rota "${routeId}" do Switch "${node.title}" precisa de descricao objetiva.`,
      });
    }

    const targetNodeId = routeTargetNodeId(graph, node, routeId);
    if (!targetNodeId) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_route_missing_target',
        nodeId: node.id,
        routeId,
        message: `Rota "${route.label || routeId}" do Switch "${node.title}" precisa apontar para um bloco.`,
      });
    } else if (!nodeIds.has(targetNodeId)) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_route_target_missing',
        nodeId: node.id,
        routeId,
        message: `Rota "${route.label || routeId}" aponta para bloco inexistente "${targetNodeId}".`,
      });
    }

    const signature = normalizedText([
      route.label,
      route.description,
      ...(route.examples || []),
    ].join(' '));
    if (signature) {
      const duplicateRouteId = signatures.get(signature);
      if (duplicateRouteId) {
        addIssue(issues, {
          severity: 'warning',
          code: 'switch_route_ambiguous_signature',
          nodeId: node.id,
          routeId,
          message: `Rotas "${duplicateRouteId}" e "${routeId}" parecem ambiguas no Switch "${node.title}".`,
        });
      } else {
        signatures.set(signature, routeId);
      }
    }
  }

  const routeIds = new Set(routes.map((route) => route.id));
  for (const edge of graph.edges.filter((candidate) => candidate.source === node.id)) {
    if (!edge.routeId) {
      addIssue(issues, {
        severity: 'warning',
        code: 'switch_edge_missing_route_id',
        nodeId: node.id,
        message: `Conexao do Switch "${node.title}" para "${edge.target}" nao possui routeId.`,
      });
      continue;
    }
    if (!routeIds.has(edge.routeId)) {
      addIssue(issues, {
        severity: 'critical',
        code: 'switch_edge_unknown_route_id',
        nodeId: node.id,
        routeId: edge.routeId,
        message: `Conexao do Switch "${node.title}" usa rota inexistente "${edge.routeId}".`,
      });
    }
  }
}

function auditCollectNode(
  node: AutopilotFlowNode,
  issues: AutopilotFlowAuditIssue[],
) {
  if (node.kind !== 'collect') return;
  const fields = node.config?.formFields || [];
  const requiredSlots = node.config?.requiredSlots || [];
  if (fields.length === 0 && requiredSlots.length === 0) {
    addIssue(issues, {
      severity: 'critical',
      code: 'collect_missing_slots',
      nodeId: node.id,
      message: `Collect "${node.title}" precisa declarar formFields tipados ou requiredSlots.`,
    });
    return;
  }

  const untypedRequiredFields = fields.filter((field) => field.required !== false && !field.type);
  for (const field of untypedRequiredFields) {
    addIssue(issues, {
      severity: 'critical',
      code: 'collect_required_field_missing_type',
      nodeId: node.id,
      message: `Campo obrigatorio "${field.label || field.id}" do Collect "${node.title}" precisa declarar type.`,
    });
  }
}

function auditDisconnectedNodes(
  graph: AutopilotFlowGraph,
  issues: AutopilotFlowAuditIssue[],
) {
  for (const node of graph.nodes) {
    const hasIncoming = graph.edges.some((edge) => edge.target === node.id);
    const hasOutgoing = graph.edges.some((edge) => edge.source === node.id);
    if (!hasIncoming && !hasOutgoing && node.kind !== 'start' && node.kind !== 'trigger') {
      addIssue(issues, {
        severity: 'critical',
        code: 'disconnected_node',
        nodeId: node.id,
        message: `Bloco "${node.title}" esta solto e nao participa de nenhum caminho executavel.`,
      });
    }
  }
}

/**
 * Auto-repair tool nodes that participate in cycles but lack maxAttempts or
 * errorHandles.  This covers flows saved before the generation-time defaults
 * were added, ensuring the publication gate no longer blocks them.
 */
function repairToolNodeCycleBounds(graph: AutopilotFlowGraph) {
  for (const node of graph.nodes) {
    if (node.kind !== 'tool') continue;
    if (!node.config) node.config = {};
    if (typeof node.config.maxAttempts !== 'number') {
      node.config.maxAttempts = 3;
    }
    if (!node.config.errorHandles || node.config.errorHandles.length === 0) {
      node.config.errorHandles = ['error'];
    }
  }
}

function auditUnboundedCycles(
  graph: AutopilotFlowGraph,
  issues: AutopilotFlowAuditIssue[],
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.source) || [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const visited = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (nodeId: string) => {
    visited.add(nodeId);
    stack.push(nodeId);
    for (const targetId of adjacency.get(nodeId) || []) {
      const stackIndex = stack.indexOf(targetId);
      if (stackIndex >= 0) {
        const cycleIds = stack.slice(stackIndex);
        const key = cycleIds.slice().sort().join('|');
        if (reported.has(key)) continue;
        reported.add(key);
        const bounded = cycleIds.some((cycleNodeId) => {
          const node = nodeById.get(cycleNodeId);
          return typeof node?.config?.maxAttempts === 'number'
            || (node?.config?.errorHandles || []).length > 0;
        });
        if (!bounded) {
          addIssue(issues, {
            severity: 'critical',
            code: 'cycle_without_limit',
            nodeId,
            message: `Ciclo detectado sem maxAttempts/errorHandles: ${cycleIds.join(' -> ')}.`,
          });
        }
        continue;
      }
      if (!visited.has(targetId)) visit(targetId);
    }
    stack.pop();
  };

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) visit(node.id);
  }
}

function targetNodeForRoute(
  graph: AutopilotFlowGraph,
  nodeById: Map<string, AutopilotFlowNode>,
  switchNode: AutopilotFlowNode,
  routeId: string,
) {
  const targetNodeId = routeTargetNodeId(graph, switchNode, routeId);
  return targetNodeId ? nodeById.get(targetNodeId) || null : null;
}

function simulateSwitchDirectRoutes(
  graph: AutopilotFlowGraph,
  nodeById: Map<string, AutopilotFlowNode>,
): AutopilotFlowSimulationResult[] {
  const switchNodes = graph.nodes.filter((node) => node.kind === 'switch' || node.kind === 'decision');
  if (switchNodes.length === 0) {
    return [{
      caseId: 'direct_customer_route',
      title: 'Cliente direto',
      status: 'skipped',
      message: 'Fluxo sem Switch para simular rota direta.',
      evidence: [],
    }];
  }

  return switchNodes.flatMap((node) => {
    const routes = node.config?.routes || [];
    const fallbackRouteId = node.config?.fallbackRouteId || null;
    return routes
      .filter((route) => route.id !== fallbackRouteId)
      .map((route) => {
        const target = targetNodeForRoute(graph, nodeById, node, route.id);
        const hasExample = Array.isArray(route.examples) && route.examples.some((example) => example.trim().length > 0);
        const routeDescription = routeText(route);
        if (!target) {
          return {
            caseId: 'direct_customer_route',
            title: 'Cliente direto',
            status: 'failed' as const,
            nodeId: node.id,
            routeId: route.id,
            message: `Simulacao direta da rota "${route.label || route.id}" nao encontrou bloco de destino.`,
            evidence: [`route=${route.id}`],
          };
        }
        return {
          caseId: 'direct_customer_route',
          title: 'Cliente direto',
          status: hasExample ? 'passed' as const : 'warning' as const,
          nodeId: node.id,
          routeId: route.id,
          message: hasExample
            ? `Mensagem direta pode ser comparada com exemplos da rota "${route.label || route.id}".`
            : `Rota "${route.label || route.id}" nao possui exemplos reais para simular cliente direto.`,
          evidence: [
            `target=${target.id}`,
            routeDescription ? `routeText=${routeDescription.slice(0, 120)}` : 'routeText=empty',
          ],
        };
      });
  });
}

function simulatePartialDataCollection(
  graph: AutopilotFlowGraph,
  nodeById: Map<string, AutopilotFlowNode>,
): AutopilotFlowSimulationResult[] {
  const slotRoutes = graph.nodes
    .filter((node) => node.kind === 'switch' || node.kind === 'decision')
    .flatMap((node) => (node.config?.routes || [])
      .filter((route) => (route.requiredSlots || []).length > 0)
      .map((route) => ({ node, route })));

  const requiredFormNodes = graph.nodes
    .filter((node) => (node.kind === 'form' || node.kind === 'collect') && (node.config?.formFields || []).some((field) => field.required));

  if (slotRoutes.length === 0 && requiredFormNodes.length === 0) {
    return [{
      caseId: 'partial_data_collection',
      title: 'Cliente com dado parcial',
      status: 'skipped',
      message: 'Fluxo sem slots obrigatorios declarados para simular dado parcial.',
      evidence: [],
    }];
  }

  const routeResults = slotRoutes.map(({ node, route }) => {
    const target = targetNodeForRoute(graph, nodeById, node, route.id);
    const safeCollection = target && !isRiskyOrTerminalNode(target) && isSafeClarificationNode(target);
    return {
      caseId: 'partial_data_collection',
      title: 'Cliente com dado parcial',
      status: !target ? 'failed' as const : safeCollection ? 'passed' as const : 'failed' as const,
      nodeId: node.id,
      routeId: route.id,
      message: !target
        ? `Rota "${route.label || route.id}" tem slots obrigatorios, mas nao possui destino para coletar dados.`
        : safeCollection
          ? `Rota "${route.label || route.id}" coleta dados antes de qualquer acao sensivel.`
          : `Rota "${route.label || route.id}" pode avancar sem coletar os slots obrigatorios.`,
      evidence: [
        `requiredSlots=${(route.requiredSlots || []).join(',')}`,
        target ? `target=${target.id}:${target.kind}:${target.title}` : 'target=missing',
      ],
    };
  });

  const formResults = requiredFormNodes.map((node) => ({
    caseId: 'partial_data_collection',
    title: 'Cliente com dado parcial',
    status: 'passed' as const,
    nodeId: node.id,
    message: `Formulario "${node.title}" declara campos obrigatorios para coleta estruturada.`,
    evidence: (node.config?.formFields || [])
      .filter((field) => field.required)
      .map((field) => `field=${field.fieldKey || field.id}:${field.label}`),
  }));

  return [...routeResults, ...formResults];
}

function simulateCustomerChangesSubject(
  graph: AutopilotFlowGraph,
  nodeById: Map<string, AutopilotFlowNode>,
): AutopilotFlowSimulationResult[] {
  const switchNodes = graph.nodes.filter((node) => node.kind === 'switch' || node.kind === 'decision');
  if (switchNodes.length > 0) {
    return switchNodes.map((node) => {
      const fallbackRouteId = node.config?.fallbackRouteId || null;
      const target = fallbackRouteId ? targetNodeForRoute(graph, nodeById, node, fallbackRouteId) : null;
      const safeFallback = target && !isRiskyOrTerminalNode(target) && isSafeClarificationNode(target);
      return {
        caseId: 'topic_shift_guard',
        title: 'Cliente muda de assunto',
        status: safeFallback ? 'passed' as const : 'failed' as const,
        nodeId: node.id,
        routeId: fallbackRouteId || undefined,
        message: safeFallback
          ? `Switch "${node.title}" usa fallback seguro quando o cliente muda de assunto.`
          : `Switch "${node.title}" nao possui fallback seguro para mudanca de assunto.`,
        evidence: [
          fallbackRouteId ? `fallbackRoute=${fallbackRouteId}` : 'fallbackRoute=missing',
          target ? `target=${target.id}:${target.kind}:${target.title}` : 'target=missing',
        ],
      };
    });
  }

  const safeResponder = graph.nodes.find((node) => isSafeClarificationNode(node) && !isRiskyOrTerminalNode(node));
  return [{
    caseId: 'topic_shift_guard',
    title: 'Cliente muda de assunto',
    status: safeResponder ? 'warning' : 'failed',
    message: safeResponder
      ? 'Fluxo sem Switch; existe bloco seguro, mas nao ha rota explicita para mudanca de assunto.'
      : 'Fluxo sem rota segura para cliente mudando de assunto.',
    evidence: safeResponder ? [`node=${safeResponder.id}:${safeResponder.kind}:${safeResponder.title}`] : [],
  }];
}

function simulatePartialDataAndAmbiguousYes(graph: AutopilotFlowGraph): AutopilotFlowSimulationResult[] {
  const riskyNodes = graph.nodes.filter((node) => looksLikeRiskyAction(node));
  if (riskyNodes.length === 0) {
    return [{
      caseId: 'ambiguous_yes_guard',
      title: 'Sim ambiguo',
      status: 'skipped',
      message: 'Nenhuma acao sensivel encontrada para testar confirmacao.',
      evidence: [],
    }];
  }

  return riskyNodes.map((node) => {
    const incoming = incomingNodes(graph, node.id);
    const hasConfirmation = incoming.some(looksLikeConfirmationNode);
    return {
      caseId: 'ambiguous_yes_guard',
      title: 'Sim ambiguo',
      status: hasConfirmation ? 'passed' as const : 'failed' as const,
      nodeId: node.id,
      message: hasConfirmation
        ? `Acao sensivel "${node.title}" possui etapa anterior com coleta/confirmacao.`
        : `Acao sensivel "${node.title}" pode ser alcancada sem etapa clara de confirmacao.`,
      evidence: incoming.map((candidate) => `incoming=${candidate.id}:${candidate.kind}:${candidate.title}`),
    };
  });
}

function simulateSkipConfirmationAttempt(graph: AutopilotFlowGraph): AutopilotFlowSimulationResult[] {
  const riskyNodes = graph.nodes.filter((node) => looksLikeRiskyAction(node));
  if (riskyNodes.length === 0) {
    return [{
      caseId: 'skip_confirmation_attempt',
      title: 'Cliente tenta pular confirmacao',
      status: 'skipped',
      message: 'Nenhuma acao sensivel encontrada para testar tentativa de pular confirmacao.',
      evidence: [],
    }];
  }

  return riskyNodes.map((node) => {
    const incoming = incomingNodes(graph, node.id);
    const hasConfirmation = incoming.some(looksLikeConfirmationNode);
    return {
      caseId: 'skip_confirmation_attempt',
      title: 'Cliente tenta pular confirmacao',
      status: hasConfirmation ? 'passed' as const : 'failed' as const,
      nodeId: node.id,
      message: hasConfirmation
        ? `Acao sensivel "${node.title}" exige etapa anterior antes de executar.`
        : `Acao sensivel "${node.title}" pode ser executada mesmo se o cliente tentar pular confirmacao.`,
      evidence: incoming.map((candidate) => `incoming=${candidate.id}:${candidate.kind}:${candidate.title}`),
    };
  });
}

function simulateToolFailureRecovery(graph: AutopilotFlowGraph): AutopilotFlowSimulationResult[] {
  const toolNodes = graph.nodes.filter((node) => node.kind === 'tool' || Boolean(node.toolName));
  if (toolNodes.length === 0) {
    return [{
      caseId: 'tool_failure_recovery',
      title: 'Falha de ferramenta',
      status: 'skipped',
      message: 'Nenhuma ferramenta no fluxo para simular falha.',
      evidence: [],
    }];
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return toolNodes.map((node) => {
    const targets = outgoingEdges(graph, node.id)
      .map((edge) => nodeById.get(edge.target))
      .filter((target): target is AutopilotFlowNode => Boolean(target));
    const hasSafeRecovery = targets.some((target) => isSafeClarificationNode(target) && target.kind !== 'tool');
    return {
      caseId: 'tool_failure_recovery',
      title: 'Falha de ferramenta',
      status: targets.length === 0 ? 'failed' as const : hasSafeRecovery ? 'passed' as const : 'warning' as const,
      nodeId: node.id,
      message: targets.length === 0
        ? `Ferramenta "${node.title}" nao possui caminho de recuperacao apos falha.`
        : hasSafeRecovery
          ? `Ferramenta "${node.title}" possui proximo bloco seguro para lidar com resultado/falha.`
          : `Ferramenta "${node.title}" possui saida, mas o destino nao parece tratar falha explicitamente.`,
      evidence: targets.map((target) => `target=${target.id}:${target.kind}:${target.title}`),
    };
  });
}

function simulateReadOnlyToolFailureRecovery(graph: AutopilotFlowGraph): AutopilotFlowSimulationResult[] {
  const readOnlyTools = graph.nodes.filter((node) => (
    node.kind === 'tool'
    && node.risk !== 'high'
    && !looksLikeRiskyAction(node)
  ));
  if (readOnlyTools.length === 0) {
    return [{
      caseId: 'read_only_tool_failure_recovery',
      title: 'Falha de consulta',
      status: 'skipped',
      message: 'Nenhuma ferramenta de consulta encontrada para simular falha read-only.',
      evidence: [],
    }];
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return readOnlyTools.map((node) => {
    const targets = outgoingEdges(graph, node.id)
      .map((edge) => nodeById.get(edge.target))
      .filter((target): target is AutopilotFlowNode => Boolean(target));
    const hasSafeRecovery = targets.some((target) => isSafeClarificationNode(target) && target.kind !== 'tool');
    return {
      caseId: 'read_only_tool_failure_recovery',
      title: 'Falha de consulta',
      status: targets.length === 0 ? 'failed' as const : hasSafeRecovery ? 'passed' as const : 'warning' as const,
      nodeId: node.id,
      message: targets.length === 0
        ? `Consulta "${node.title}" nao possui caminho seguro quando a ferramenta falha.`
        : hasSafeRecovery
          ? `Consulta "${node.title}" possui caminho seguro para explicar falha ou pedir dados.`
          : `Consulta "${node.title}" possui saida, mas o destino nao parece tratar falha read-only.`,
      evidence: targets.map((target) => `target=${target.id}:${target.kind}:${target.title}`),
    };
  });
}

function simulateWriteToolFailureRecovery(graph: AutopilotFlowGraph): AutopilotFlowSimulationResult[] {
  const writeTools = graph.nodes.filter((node) => node.kind === 'tool' && looksLikeRiskyAction(node));
  if (writeTools.length === 0) {
    return [{
      caseId: 'write_tool_failure_recovery',
      title: 'Falha de acao',
      status: 'skipped',
      message: 'Nenhuma ferramenta de escrita/alto risco encontrada para simular falha.',
      evidence: [],
    }];
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return writeTools.map((node) => {
    const targets = outgoingEdges(graph, node.id)
      .map((edge) => nodeById.get(edge.target))
      .filter((target): target is AutopilotFlowNode => Boolean(target));
    const hasSafeRecovery = targets.some((target) => isSafeClarificationNode(target) && target.kind !== 'tool');
    return {
      caseId: 'write_tool_failure_recovery',
      title: 'Falha de acao',
      status: targets.length === 0 ? 'failed' as const : hasSafeRecovery ? 'passed' as const : 'failed' as const,
      nodeId: node.id,
      message: targets.length === 0
        ? `Acao "${node.title}" nao possui recuperacao se a ferramenta falhar.`
        : hasSafeRecovery
          ? `Acao "${node.title}" possui recuperacao segura para falha de ferramenta.`
          : `Acao "${node.title}" nao possui destino seguro para falha de ferramenta.`,
      evidence: targets.map((target) => `target=${target.id}:${target.kind}:${target.title}`),
    };
  });
}

function simulateRagWithoutCoverage(graph: AutopilotFlowGraph): AutopilotFlowSimulationResult[] {
  const knowledgeNodes = graph.nodes.filter((node) => node.kind === 'knowledge');
  if (knowledgeNodes.length === 0) {
    return [{
      caseId: 'rag_no_coverage_guard',
      title: 'RAG sem cobertura',
      status: 'skipped',
      message: 'Fluxo sem bloco de conhecimento para simular ausencia de documento suficiente.',
      evidence: [],
    }];
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return knowledgeNodes.map((node) => {
    const targets = outgoingEdges(graph, node.id)
      .map((edge) => nodeById.get(edge.target))
      .filter((target): target is AutopilotFlowNode => Boolean(target));
    const hasSafeFallback = targets.some((target) => isSafeClarificationNode(target) && !isRiskyOrTerminalNode(target));
    const explicitGroundingText = normalizedText([
      node.config?.instructions,
      ...targets.map((target) => [target.title, target.subtitle, target.config?.instructions, target.config?.message].join(' ')),
    ].join(' '));
    const mentionsGrounding = /\b(sem base|nao sei|nao encont|insuficient|document|base|segur|transfer)\w*/.test(explicitGroundingText);
    return {
      caseId: 'rag_no_coverage_guard',
      title: 'RAG sem cobertura',
      status: targets.length === 0 ? 'failed' as const : hasSafeFallback && mentionsGrounding ? 'passed' as const : hasSafeFallback ? 'warning' as const : 'failed' as const,
      nodeId: node.id,
      message: targets.length === 0
        ? `Conhecimento "${node.title}" nao possui caminho quando nao houver documento suficiente.`
        : hasSafeFallback && mentionsGrounding
          ? `Conhecimento "${node.title}" possui caminho seguro e instrucao contra resposta inventada.`
          : hasSafeFallback
            ? `Conhecimento "${node.title}" possui caminho seguro, mas falta instrucao explicita para baixa cobertura.`
            : `Conhecimento "${node.title}" pode avancar para acao insegura quando faltar cobertura.`,
      evidence: targets.length > 0
        ? targets.map((target) => `target=${target.id}:${target.kind}:${target.title}`)
        : ['target=missing'],
    };
  });
}

function simulateGenericOutsideProcedure(
  graph: AutopilotFlowGraph,
  nodeById: Map<string, AutopilotFlowNode>,
): AutopilotFlowSimulationResult[] {
  const switchNodes = graph.nodes.filter((node) => node.kind === 'switch' || node.kind === 'decision');
  if (switchNodes.length > 0) {
    return switchNodes.map((node) => {
      const fallbackRouteId = node.config?.fallbackRouteId || null;
      const target = fallbackRouteId ? targetNodeForRoute(graph, nodeById, node, fallbackRouteId) : null;
      const safeFallback = target && !isRiskyOrTerminalNode(target) && isSafeClarificationNode(target);
      return {
        caseId: 'generic_outside_procedure',
        title: 'Pergunta fora do procedimento',
        status: safeFallback ? 'passed' as const : 'failed' as const,
        nodeId: node.id,
        routeId: fallbackRouteId || undefined,
        message: safeFallback
          ? `Pergunta fora do procedimento cai no fallback seguro do Switch "${node.title}".`
          : `Pergunta fora do procedimento nao possui fallback seguro no Switch "${node.title}".`,
        evidence: [
          fallbackRouteId ? `fallbackRoute=${fallbackRouteId}` : 'fallbackRoute=missing',
          target ? `target=${target.id}:${target.kind}:${target.title}` : 'target=missing',
        ],
      };
    });
  }

  const entryNodes = graph.nodes.filter((node) => node.kind === 'trigger' || incomingNodes(graph, node.id).length === 0);
  const riskyEntryTargets = entryNodes.flatMap((node) => outgoingEdges(graph, node.id)
    .map((edge) => nodeById.get(edge.target))
    .filter((target): target is AutopilotFlowNode => Boolean(target) && isRiskyOrTerminalNode(target)));
  if (riskyEntryTargets.length > 0) {
    return riskyEntryTargets.map((target) => ({
      caseId: 'generic_outside_procedure',
      title: 'Pergunta fora do procedimento',
      status: 'failed' as const,
      nodeId: target.id,
      message: `Pergunta generica pode alcancar "${target.title}" sem classificacao/fallback seguro.`,
      evidence: [`target=${target.id}:${target.kind}:${target.title}`],
    }));
  }

  const safeResponder = graph.nodes.find((node) => isSafeClarificationNode(node) && !isRiskyOrTerminalNode(node));
  return [{
    caseId: 'generic_outside_procedure',
    title: 'Pergunta fora do procedimento',
    status: safeResponder ? 'warning' : 'failed',
    message: safeResponder
      ? 'Fluxo sem Switch; existe bloco seguro, mas a pergunta fora do procedimento nao tem rota explicita.'
      : 'Fluxo sem resposta segura para pergunta fora do procedimento.',
    evidence: safeResponder ? [`node=${safeResponder.id}:${safeResponder.kind}:${safeResponder.title}`] : [],
  }];
}

function simulateFallbackClarification(
  graph: AutopilotFlowGraph,
  nodeById: Map<string, AutopilotFlowNode>,
): AutopilotFlowSimulationResult[] {
  const switchNodes = graph.nodes.filter((node) => node.kind === 'switch' || node.kind === 'decision');
  if (switchNodes.length === 0) {
    return [{
      caseId: 'fallback_clarification',
      title: 'Fallback de baixa confianca',
      status: 'skipped',
      message: 'Fluxo sem Switch para simular fallback.',
      evidence: [],
    }];
  }

  return switchNodes.map((node) => {
    const fallbackRouteId = node.config?.fallbackRouteId || null;
    if (!fallbackRouteId) {
      return {
        caseId: 'fallback_clarification',
        title: 'Fallback de baixa confianca',
        status: 'failed' as const,
        nodeId: node.id,
        message: `Switch "${node.title}" nao possui rota fallback para baixa confianca.`,
        evidence: [],
      };
    }
    const target = targetNodeForRoute(graph, nodeById, node, fallbackRouteId);
    if (!target) {
      return {
        caseId: 'fallback_clarification',
        title: 'Fallback de baixa confianca',
        status: 'failed' as const,
        nodeId: node.id,
        routeId: fallbackRouteId,
        message: `Fallback "${fallbackRouteId}" do Switch "${node.title}" nao possui destino.`,
        evidence: [],
      };
    }
    const riskyFallback = looksLikeRiskyAction(target) || target.kind === 'close' || target.kind === 'tool';
    return {
      caseId: 'fallback_clarification',
      title: 'Fallback de baixa confianca',
      status: riskyFallback ? 'failed' as const : 'passed' as const,
      nodeId: node.id,
      routeId: fallbackRouteId,
      message: riskyFallback
        ? `Fallback do Switch "${node.title}" aponta para acao sensivel/terminal em vez de esclarecer.`
        : `Fallback do Switch "${node.title}" aponta para bloco seguro de esclarecimento ou atendimento.`,
      evidence: [`target=${target.id}:${target.kind}:${target.title}`],
    };
  });
}

export function simulateAutopilotFlowBeforePublish(
  graph: AutopilotFlowGraph | null | undefined,
): AutopilotFlowSimulationResult[] {
  const normalizedGraph = migrateAutopilotFlowGraphToV2(graph);
  if (!normalizedGraph) {
    return [{
      caseId: 'empty_flow',
      title: 'Fluxo vazio',
      status: 'skipped',
      message: 'Sem fluxo visual para simular.',
      evidence: [],
    }];
  }

  const nodeById = new Map(normalizedGraph.nodes.map((node) => [node.id, node]));
  const handoffSimulation: AutopilotFlowSimulationResult = hasHumanHandoff(normalizedGraph)
    ? {
      caseId: 'human_handoff_escape',
      title: 'Pedido por humano',
      status: 'passed',
      message: 'Fluxo possui rota/bloco de atendimento humano.',
      evidence: normalizedGraph.nodes
        .filter((node) => node.kind === 'handoff' || /\b(humano|atendente|pessoa|transfer|escal)\w*/.test(nodeText(node)))
        .map((node) => `node=${node.id}:${node.kind}:${node.title}`),
    }
    : {
      caseId: 'human_handoff_escape',
      title: 'Pedido por humano',
      status: 'warning',
      message: 'Fluxo nao possui rota clara para cliente pedindo humano.',
      evidence: [],
    };

  return [
    ...simulateSwitchDirectRoutes(normalizedGraph, nodeById),
    ...simulatePartialDataCollection(normalizedGraph, nodeById),
    ...simulateCustomerChangesSubject(normalizedGraph, nodeById),
    ...simulateFallbackClarification(normalizedGraph, nodeById),
    ...simulatePartialDataAndAmbiguousYes(normalizedGraph),
    ...simulateSkipConfirmationAttempt(normalizedGraph),
    ...simulateToolFailureRecovery(normalizedGraph),
    ...simulateReadOnlyToolFailureRecovery(normalizedGraph),
    ...simulateWriteToolFailureRecovery(normalizedGraph),
    ...simulateRagWithoutCoverage(normalizedGraph),
    ...simulateGenericOutsideProcedure(normalizedGraph, nodeById),
    handoffSimulation,
  ];
}

function simulationIssue(simulation: AutopilotFlowSimulationResult): AutopilotFlowAuditIssue {
  return {
    severity: 'critical',
    code: `simulation_${simulation.caseId}_failed`,
    nodeId: simulation.nodeId,
    routeId: simulation.routeId,
    message: simulation.message,
  };
}

export function auditAutopilotFlowGraph(graph: AutopilotFlowGraph | null | undefined): AutopilotFlowAuditResult {
  const normalizedGraph = migrateAutopilotFlowGraphToV2(graph);
  if (!normalizedGraph) {
    return { status: 'passed', issues: [], simulations: simulateAutopilotFlowBeforePublish(graph) };
  }

  const issues: AutopilotFlowAuditIssue[] = [];
  const nodeIds = new Set(normalizedGraph.nodes.map((node) => node.id));
  for (const node of normalizedGraph.nodes) {
    if (node.kind === 'switch' || node.kind === 'decision') {
      auditSwitchNode(normalizedGraph, node, nodeIds, issues);
    }
    auditCollectNode(node, issues);
  }
  auditDisconnectedNodes(normalizedGraph, issues);
  repairToolNodeCycleBounds(normalizedGraph);
  auditUnboundedCycles(normalizedGraph, issues);
  const simulations = simulateAutopilotFlowBeforePublish(normalizedGraph);
  for (const simulation of simulations) {
    if (simulation.status === 'failed') {
      addIssue(issues, simulationIssue(simulation));
    }
  }

  return {
    status: issues.some((issue) => issue.severity === 'critical') ? 'failed' : 'passed',
    issues,
    simulations,
  };
}

export function summarizeFlowAuditIssues(issues: AutopilotFlowAuditIssue[], limit = 3): string {
  return issues
    .filter((issue) => issue.severity === 'critical')
    .slice(0, limit)
    .map((issue) => issue.message)
    .join(' ');
}
