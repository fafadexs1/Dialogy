import type { AutopilotConfig, AutopilotFlowNode, AutopilotFlowSwitchRoute, KnowledgeBaseDocument, NexusFlowInstance } from '@/lib/types';
import type { AgentToolAction } from '@/services/agent-tools/types';
import type { UniversalAutopilotIntent } from './intent-types';
import { migrateAutopilotFlowGraphToV2 } from './flow-v2';

export type ActiveFlowIntentScope = {
  nodeId: string;
  title: string;
  intent: UniversalAutopilotIntent;
  customIntentLabel?: string;
  systemPrompt: string;
  knowledgeCollectionIds?: string[];
};

export type DeterministicFlowMessage = {
  nodeId: string;
  title: string;
  message: string;
};

export type FlowFormGuidance = {
  nodeId: string;
  title: string;
  intro: string;
  fields: Array<{
    label: string;
    fieldKey?: string;
    required: boolean;
    placeholder?: string;
  }>;
};

export type FlowCompletionPlan = {
  actions: AgentToolAction[];
  reason: string;
  terminalNodeId?: string;
};

export type FlowSwitchGuidance = {
  nodeId: string;
  title: string;
  instructions: string;
  mode: 'ai' | 'rules';
  confidenceThreshold: number;
  fallbackRouteId?: string;
  routes: AutopilotFlowSwitchRoute[];
};

export type FlowSwitchResolution = {
  switchNodeId: string;
  switchTitle: string;
  routeId: string;
  routeLabel: string;
  targetNodeId?: string;
  confidence: number;
  evidence: string[];
  fallbackUsed: boolean;
  candidateRoutes: FlowSwitchRouteCandidate[];
  rejectedRoutes: FlowSwitchRouteCandidate[];
};

export type FlowSwitchRouteCandidate = {
  routeId: string;
  routeLabel: string;
  targetNodeId?: string;
  confidence: number;
  selected: boolean;
  fallback: boolean;
  evidence: string[];
  rejectedReason?: string;
};

function configWithV2FlowGraph(config: AutopilotConfig): AutopilotConfig {
  return {
    ...config,
    flow_graph: migrateAutopilotFlowGraphToV2(config.flow_graph),
  };
}

function switchRouteTargetFromEdges(
  config: AutopilotConfig,
  switchNodeId: string,
  routeId: string | null | undefined,
): string | undefined {
  if (!routeId) return undefined;
  const edge = config.flow_graph?.edges.find((candidate) => (
    candidate.source === switchNodeId && candidate.routeId === routeId && Boolean(candidate.target)
  ));
  return edge?.target;
}

function hydrateSwitchRoutesFromEdges(
  config: AutopilotConfig,
  node: AutopilotFlowNode,
): AutopilotFlowSwitchRoute[] {
  return (node.config?.routes || []).map((route) => ({
    ...route,
    targetNodeId: route.targetNodeId || switchRouteTargetFromEdges(config, node.id, route.id),
  }));
}

function normalizeReferenceId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '');
}

function nodeReferenceId(node: AutopilotFlowNode): string {
  return normalizeReferenceId(node.config?.referenceId || node.config?.variableName || node.title || node.id);
}

function ruleReferenceId(rule: NexusFlowInstance): string {
  return `habilidade_${normalizeReferenceId(rule.name || rule.id) || rule.id}`;
}

function uniqueReferenceAliases(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeReferenceId(value || '')).filter(Boolean)));
}

function renderFormMessage(node: AutopilotFlowNode): string {
  const intro = node.config?.message?.trim() || 'Para continuar, me envie os dados abaixo:';
  const fields = node.config?.formFields || [];
  const fieldLines = fields
    .filter((field) => field.label?.trim())
    .map((field) => {
      const required = field.required === false ? 'opcional' : 'obrigatorio';
      const example = field.placeholder?.trim() ? ` Ex.: ${field.placeholder.trim()}` : '';
      return `- ${field.label.trim()} (${required}).${example}`;
    });

  return [
    intro,
    fieldLines.length > 0 ? fieldLines.join('\n') : '',
    fieldLines.length > 0 ? 'Pode responder tudo em uma unica mensagem.' : '',
  ].filter(Boolean).join('\n\n').trim();
}

export function resolveActiveFlowIntentScope(
  config: AutopilotConfig,
  intent: UniversalAutopilotIntent,
): ActiveFlowIntentScope | null {
  config = configWithV2FlowGraph(config);
  const nodes = config.flow_graph?.nodes || [];
  const edges = config.flow_graph?.edges || [];
  const decisionRoute = nodes
    .filter((node) => node.kind === 'decision')
    .flatMap((node) => (node.config?.routes || []).map((route) => ({
      route,
      targetNodeId: route.targetNodeId || switchRouteTargetFromEdges(config, node.id, route.id),
    })))
    .find((item) => item.route.intent === intent && item.targetNodeId);
  const matchedNode = nodes.find((node): node is AutopilotFlowNode => (
    node.kind === 'sub_agent' &&
    Boolean(node.config?.instructions?.trim()) &&
    (
      node.id === decisionRoute?.targetNodeId ||
      (!decisionRoute && edges.some((edge) => edge.target === node.id))
    )
  )) || nodes.find((node): node is AutopilotFlowNode => (
    node.kind === 'decision' &&
    Boolean(node.config?.instructions?.trim()) &&
    (node.config?.routes || []).some((route) => route.intent === intent)
  ));

  if (!matchedNode) return null;

  return {
    nodeId: matchedNode.id,
    title: matchedNode.title,
    intent,
    customIntentLabel: matchedNode.config?.customIntentLabel?.trim() || undefined,
    systemPrompt: matchedNode.config?.instructions?.trim() || '',
    knowledgeCollectionIds: matchedNode.config?.knowledgeCollectionIds?.filter(Boolean),
  };
}

export function resolveActiveFlowIntentScopeByNodeId(
  config: AutopilotConfig,
  nodeId: string | null | undefined,
): ActiveFlowIntentScope | null {
  config = configWithV2FlowGraph(config);
  const node = config.flow_graph?.nodes.find((candidate) => candidate.id === nodeId);
  if (
    !node ||
    !['sub_agent', 'decision'].includes(node.kind) ||
    !node.config?.instructions?.trim()
  ) {
    return null;
  }
  const routeIntent = node.kind === 'decision'
    ? node.config.routes?.find((route) => route.intent)?.intent as UniversalAutopilotIntent | undefined
    : undefined;

  return {
    nodeId: node.id,
    title: node.title,
    intent: (node.config.intent as UniversalAutopilotIntent | undefined) || routeIntent || 'unknown',
    customIntentLabel: node.config?.customIntentLabel?.trim() || undefined,
    systemPrompt: node.config.instructions.trim(),
    knowledgeCollectionIds: node.config?.knowledgeCollectionIds?.filter(Boolean),
  };
}

export function filterKnowledgeDocumentsForScope(
  config: AutopilotConfig,
  documents: KnowledgeBaseDocument[] | null | undefined,
  scope: ActiveFlowIntentScope | null,
): KnowledgeBaseDocument[] {
  config = configWithV2FlowGraph(config);
  const list = documents || [];
  if (!config.flow_graph) return list;

  const principalNodeId = config.flow_graph.nodes.find((node) => node.kind === 'sub_agent')?.id;
  const targetNodeIds = new Set([principalNodeId, scope?.nodeId].filter((nodeId): nodeId is string => Boolean(nodeId)));
  if (targetNodeIds.size === 0) return [];

  const attachedKnowledgeNodeIds = new Set(
    config.flow_graph.nodes
      .filter((node) => node.kind === 'knowledge')
      .map((node) => node.id),
  );
  const hasAttachedKnowledge = config.flow_graph.edges.some((edge) => (
    targetNodeIds.has(edge.target) && attachedKnowledgeNodeIds.has(edge.source)
  ));
  if (!hasAttachedKnowledge) return [];

  const allowedIds = scope?.knowledgeCollectionIds;
  if (!allowedIds || allowedIds.length === 0) return list;

  const allowed = new Set(allowedIds);
  return list.filter((document) => {
    const collectionIds = document.collectionIds?.length ? document.collectionIds : ['general'];
    return collectionIds.some((collectionId) => allowed.has(collectionId));
  });
}

export function buildIntentScopedKnowledgeBase(
  basePrompt: string,
  scope: ActiveFlowIntentScope | null,
): string {
  if (!scope) return basePrompt;

  return [
    basePrompt,
    '',
    'SUB-AGENTE ESPECIALIZADO ATIVO',
    `Intencao de ativacao: ${scope.intent}`,
    scope.customIntentLabel ? `Intencao personalizada descrita pelo usuario: ${scope.customIntentLabel}` : '',
    `Sub-agente do fluxo: ${scope.title}`,
    scope.systemPrompt,
    '',
    'Use este sub-agente somente para a intencao atual. Quando a intencao da mensagem mudar, o agente principal volta a valer.',
  ].filter(Boolean).join('\n');
}

export function resolveDeterministicFlowMessage(
  config: AutopilotConfig,
  scope: ActiveFlowIntentScope | null,
): DeterministicFlowMessage | null {
  config = configWithV2FlowGraph(config);
  if (!scope || !config.flow_graph) return null;

  const directTargets = new Set(
    config.flow_graph.edges
      .filter((edge) => edge.source === scope.nodeId)
      .map((edge) => edge.target),
  );
  const messageNode = config.flow_graph.nodes.find((node) => (
    directTargets.has(node.id) &&
    (
      (node.kind === 'message' && Boolean(node.config?.message?.trim())) ||
      (
        node.kind === 'collect' &&
        node.config?.formMode !== 'ai' &&
        (Boolean(node.config?.message?.trim()) || Boolean(node.config?.formFields?.length))
      )
    )
  ));

  if (!messageNode) return null;
  const message = messageNode.kind === 'collect'
    ? renderFormMessage(messageNode)
    : messageNode.config?.message?.trim();
  if (!message) return null;

  return {
    nodeId: messageNode.id,
    title: messageNode.title,
    message,
  };
}

function deterministicMessageFromNode(node: AutopilotFlowNode): string | null {
  if (node.kind === 'message') {
    return node.config?.message?.trim() || null;
  }

  if (
    node.kind === 'collect' &&
    node.config?.formMode !== 'ai' &&
    (Boolean(node.config?.message?.trim()) || Boolean(node.config?.formFields?.length))
  ) {
    return renderFormMessage(node);
  }

  return null;
}

function normalizeInstructionText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenizeSwitchText(value: string): string[] {
  return normalizeInstructionText(value)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreSwitchRoute(message: string, route: AutopilotFlowSwitchRoute): { score: number; evidence: string[] } {
  const normalizedMessage = normalizeInstructionText(message);
  const routeText = normalizeInstructionText([
    route.id,
    route.label,
    route.description,
    ...(route.examples || []),
  ].join(' '));
  const evidence: string[] = [];
  let score = 0;

  const mentionsWifi = /\b(wi[\s-]?fi|ssid|rede|roteador|router|modem)\b/.test(normalizedMessage);
  const mentionsCredentials = /\b(usuario|login|senha|password|ssid|credencia|nome da rede)\b/.test(normalizedMessage);
  const requestsChange = /\b(trocar|mudar|alterar|atualizar|nova|novo|change|update)\b/.test(normalizedMessage);
  const requestsLookup = /\b(esqueci|consultar|verificar|qual|quais|mostrar|informe|informar|passa|recuperar)\b/.test(normalizedMessage);
  const requestsDiagnostics = /\b(lento|lentidao|oscila|queda|interferencia|canal|canais|redes ao redor|sinal fraco|diagnost)\w*/.test(normalizedMessage);
  const requestsReboot = /\b(reiniciar|reinicie|reboot|restart|resetar|desligar e ligar)\w*/.test(normalizedMessage);
  const requestsHuman = /\b(humano|atendente|pessoa|especialista|transferir|equipe)\w*/.test(normalizedMessage);
  const routeIsLookup = /\b(consultar|consulta|credenciais atuais|wifi atual|senha atual)\b/.test(routeText);
  const routeIsChange = /\b(trocar|troca|alterar|mudanca|change|update)\b/.test(routeText);
  const routeIsDiagnostics = /\b(diagnost|lentidao|canal|interferencia|redes ao redor)\w*/.test(routeText);
  const routeIsReboot = /\b(reiniciar|reboot|restart|resetar)\w*/.test(routeText);
  const routeIsHuman = /\b(humano|atendente|transfer|equipe)\w*/.test(routeText);
  if (mentionsWifi && mentionsCredentials && requestsLookup && !requestsChange && routeIsLookup && !routeIsChange) {
    score = 0.99;
    evidence.push('Pedido explicito de consulta das credenciais atuais do Wi-Fi.');
  } else if (mentionsWifi && requestsChange && routeIsChange) {
    score = 0.99;
    evidence.push('Pedido explicito de alteracao de Wi-Fi.');
  } else if (mentionsWifi && requestsDiagnostics && routeIsDiagnostics) {
    score = 0.99;
    evidence.push('Pedido explicito de diagnostico de Wi-Fi.');
  } else if (requestsReboot && routeIsReboot) {
    score = 0.99;
    evidence.push('Pedido explicito de reboot do roteador.');
  } else if (requestsHuman && routeIsHuman) {
    score = 0.99;
    evidence.push('Pedido explicito de atendimento humano.');
  }

  for (const example of route.examples || []) {
    const normalizedExample = normalizeInstructionText(example);
    if (normalizedExample && normalizedMessage.includes(normalizedExample)) {
      evidence.push(`Mensagem contem exemplo da rota: "${example}"`);
      score = Math.max(score, 0.95);
    }
  }

  const routeTokens = new Set(tokenizeSwitchText([
    route.label,
    route.description,
    ...(route.examples || []),
  ].join(' ')));
  const messageTokens = tokenizeSwitchText(message);
  const matched = messageTokens.filter((token) => routeTokens.has(token));
  if (matched.length > 0) {
    const overlapScore = Math.min(0.9, 0.35 + matched.length / Math.max(4, Math.min(messageTokens.length, routeTokens.size)));
    score = Math.max(score, overlapScore);
    evidence.push(`Termos relacionados: ${Array.from(new Set(matched)).slice(0, 6).join(', ')}`);
  }

  return { score: Number(score.toFixed(2)), evidence };
}

export function listFlowSwitchGuidance(config: AutopilotConfig): FlowSwitchGuidance[] {
  config = configWithV2FlowGraph(config);
  const graph = config.flow_graph;
  if (!graph) return [];

  return graph.nodes
    .filter((node) => node.kind === 'decision' && Array.isArray(node.config?.routes) && node.config.routes.length > 0)
    .map((node) => ({
      nodeId: node.id,
      title: node.title,
      instructions: node.config?.instructions?.trim() || `Escolha uma rota para ${node.title}.`,
      mode: node.config?.switchMode || 'ai',
      confidenceThreshold: typeof node.config?.confidenceThreshold === 'number'
        ? Math.max(0, Math.min(1, node.config.confidenceThreshold))
        : 0.75,
      fallbackRouteId: node.config?.fallbackRouteId,
      routes: hydrateSwitchRoutesFromEdges(config, node),
    }));
}

export function resolveFlowSwitchRoute(input: {
  config: AutopilotConfig;
  switchNodeId: string;
  customerMessage: string;
}): FlowSwitchResolution | null {
  const config = configWithV2FlowGraph(input.config);
  const guidance = listFlowSwitchGuidance(config).find((item) => item.nodeId === input.switchNodeId);
  if (!guidance) return null;

  const scoredRoutes = guidance.routes
    .map((route) => ({ route, ...scoreSwitchRoute(input.customerMessage, route) }))
    .sort((left, right) => right.score - left.score);
  const best = scoredRoutes[0] || null;
  const fallbackRoute = guidance.routes.find((route) => route.id === guidance.fallbackRouteId) || guidance.routes.at(-1) || null;
  if (!best && !fallbackRoute) return null;

  const accepted = best && best.score >= guidance.confidenceThreshold ? best : null;
  const selected = accepted || (fallbackRoute ? { route: fallbackRoute, score: best?.score || 0, evidence: best?.evidence || [] } : best);
  if (!selected) return null;
  const selectedRouteId = selected.route.id;
  const candidateRoutes = scoredRoutes.map((candidate): FlowSwitchRouteCandidate => {
    const selectedCandidate = candidate.route.id === selectedRouteId;
    const fallback = candidate.route.id === fallbackRoute?.id;
    let rejectedReason: string | undefined;
    if (!selectedCandidate) {
      rejectedReason = candidate.score < guidance.confidenceThreshold
        ? `Confianca ${candidate.score.toFixed(2)} abaixo do minimo ${guidance.confidenceThreshold.toFixed(2)}.`
        : `Rota menos aderente que ${selected.route.id}.`;
    } else if (!accepted && fallback) {
      rejectedReason = undefined;
    }

    return {
      routeId: candidate.route.id,
      routeLabel: candidate.route.label,
      targetNodeId: candidate.route.targetNodeId,
      confidence: candidate.score,
      selected: selectedCandidate,
      fallback,
      evidence: candidate.evidence.slice(0, 4),
      rejectedReason,
    };
  });

  if (!candidateRoutes.some((candidate) => candidate.routeId === selectedRouteId)) {
    candidateRoutes.unshift({
      routeId: selected.route.id,
      routeLabel: selected.route.label,
      targetNodeId: selected.route.targetNodeId,
      confidence: selected.score,
      selected: true,
      fallback: selected.route.id === fallbackRoute?.id,
      evidence: selected.evidence.slice(0, 4),
    });
  }

  return {
    switchNodeId: guidance.nodeId,
    switchTitle: guidance.title,
    routeId: selected.route.id,
    routeLabel: selected.route.label,
    targetNodeId: selected.route.targetNodeId,
    confidence: accepted ? selected.score : Number((best?.score || 0).toFixed(2)),
    evidence: accepted
      ? selected.evidence
      : [
          ...(selected.evidence || []),
          `Confianca abaixo de ${guidance.confidenceThreshold.toFixed(2)}; usando fallback.`,
        ],
    fallbackUsed: !accepted,
    candidateRoutes,
    rejectedRoutes: candidateRoutes.filter((candidate) => !candidate.selected),
  };
}

export function resolveFirstFlowSwitchRoute(input: {
  config: AutopilotConfig;
  customerMessage: string;
}): FlowSwitchResolution | null {
  const config = configWithV2FlowGraph(input.config);
  const firstSwitch = listFlowSwitchGuidance(config)[0];
  if (!firstSwitch) return null;
  return resolveFlowSwitchRoute({
    config,
    switchNodeId: firstSwitch.nodeId,
    customerMessage: input.customerMessage,
  });
}

function entryFlowNodeId(config: AutopilotConfig): string | null {
  config = configWithV2FlowGraph(config);
  const graph = config.flow_graph;
  if (!graph) return null;
  return graph.nodes.find((node) => node.kind === 'start')?.id
    || graph.nodes.find((node) => node.kind === 'sub_agent')?.id
    || graph.nodes[0]?.id
    || null;
}

function findNearestReachableSwitchNodeId(
  config: AutopilotConfig,
  activeNodeId: string | null | undefined,
): string | null {
  config = configWithV2FlowGraph(config);
  const graph = config.flow_graph;
  if (!graph) return null;

  const startNodeId = activeNodeId && graph.nodes.some((node) => node.id === activeNodeId)
    ? activeNodeId
    : entryFlowNodeId(config);
  if (!startNodeId) return listFlowSwitchGuidance(config)[0]?.nodeId || null;

  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const node = graph.nodes.find((candidate) => candidate.id === current);
    if (node?.kind === 'decision' && node.config?.routes?.length) {
      const isLegacyIntentWrapper = node.config.legacyNodeKind === 'intent';
      const hasDownstreamDecision = graph.edges.some((edge) => (
        edge.source === node.id &&
        graph.nodes.some((candidate) => candidate.id === edge.target && candidate.kind === 'decision')
      ));
      if (!isLegacyIntentWrapper || !hasDownstreamDecision) return node.id;
    }

    for (const edge of graph.edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return null;
}

export function resolveFlowSwitchRouteForActivePath(input: {
  config: AutopilotConfig;
  customerMessage: string;
  activeNodeId?: string | null;
}): FlowSwitchResolution | null {
  const config = configWithV2FlowGraph(input.config);
  const switchNodeId = findNearestReachableSwitchNodeId(config, input.activeNodeId);
  if (switchNodeId) {
    return resolveFlowSwitchRoute({
      config,
      switchNodeId,
      customerMessage: input.customerMessage,
    });
  }
  const firstSwitch = listFlowSwitchGuidance(config)[0];
  if (!firstSwitch) return null;
  const reentry = resolveFlowSwitchRoute({
    config,
    switchNodeId: firstSwitch.nodeId,
    customerMessage: input.customerMessage,
  });
  return reentry && !reentry.fallbackUsed ? reentry : null;
}

export function formatFlowSwitchGuidanceForPrompt(config: AutopilotConfig): string {
  config = configWithV2FlowGraph(config);
  const switches = listFlowSwitchGuidance(config);
  if (switches.length === 0) return '';

  return [
    'SWITCHES DO FLUXO',
    'Quando houver um Switch conectado ao caminho atual, escolha uma unica rota configurada e respeite fallback quando nao houver evidencia suficiente.',
    ...switches.map((flowSwitch) => [
      `Switch: ${flowSwitch.title} (@${flowSwitch.nodeId})`,
      `Objetivo: ${flowSwitch.instructions}`,
      `Modo: ${flowSwitch.mode}; confianca minima: ${flowSwitch.confidenceThreshold.toFixed(2)}; fallback: ${flowSwitch.fallbackRouteId || 'ultima rota'}`,
      'Rotas:',
      ...flowSwitch.routes.map((route) => [
        `- ${route.id}: ${route.label}`,
        `  Quando usar: ${route.description}`,
        route.examples?.length ? `  Exemplos: ${route.examples.join(' | ')}` : '',
        route.requiredSlots?.length ? `  Dados obrigatorios: ${route.requiredSlots.join(', ')}` : '',
        route.targetNodeId ? `  Destino: @${route.targetNodeId}` : '',
      ].filter(Boolean).join('\n')),
    ].join('\n')),
  ].join('\n');
}

function directedReachableNodeIds(config: AutopilotConfig, startNodeId: string | null | undefined): Set<string> {
  config = configWithV2FlowGraph(config);
  const graph = config.flow_graph;
  const reachable = new Set<string>();
  if (!graph || !startNodeId) return reachable;

  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of graph.edges) {
      if (edge.source === current && !reachable.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return reachable;
}

function nodeRequestsClose(node: AutopilotFlowNode): boolean {
  const text = normalizeInstructionText([
    node.kind,
    node.title,
    node.subtitle || '',
    node.config?.referenceId || '',
    node.config?.instructions || '',
    node.config?.message || '',
  ].join('\n'));

  return (
    node.kind === 'end' ||
    /\b@?close_chat\b/.test(text) ||
    (
      /\b(fim|final|encerr|close|termin)\w*/.test(text) &&
      /\b(atendimento|chat|conversa|fluxo)\b/.test(text)
    )
  );
}

export function resolveFlowCompletionPlan(
  config: AutopilotConfig,
  activeNodeId: string | null | undefined,
): FlowCompletionPlan | null {
  config = configWithV2FlowGraph(config);
  const graph = config.flow_graph;
  if (!graph || !activeNodeId) return null;
  if (!Array.isArray(config.enabled_tool_names) || !config.enabled_tool_names.includes('close_chat')) return null;

  const reachable = directedReachableNodeIds(config, activeNodeId);
  const terminalNode = graph.nodes.find((node) => reachable.has(node.id) && nodeRequestsClose(node));
  if (!terminalNode) return null;

  return {
    actions: [{
      type: 'close_chat',
      reason: `Fluxo concluiu no bloco "${terminalNode.title}" e solicitou encerramento.`,
      payload: {
        notes: `Encerramento automatico por conclusao do fluxo: ${terminalNode.title}`,
        sendCloseMessage: false,
      },
    }],
    reason: 'flow_completion_requests_close_chat',
    terminalNodeId: terminalNode.id,
  };
}

export function resolveEntryDeterministicFlowMessage(config: AutopilotConfig): DeterministicFlowMessage | null {
  config = configWithV2FlowGraph(config);
  const graph = config.flow_graph;
  if (!graph) return null;

  const startNodeIds = new Set(
    graph.nodes
      .filter((node) => node.kind === 'start')
      .map((node) => node.id),
  );
  if (startNodeIds.size === 0) return null;

  const entryTargets = new Set(
    graph.edges
      .filter((edge) => startNodeIds.has(edge.source))
      .map((edge) => edge.target),
  );

  const messageNode = graph.nodes.find((node) => entryTargets.has(node.id) && deterministicMessageFromNode(node));
  if (!messageNode) return null;

  const message = deterministicMessageFromNode(messageNode);
  if (!message) return null;

  return {
    nodeId: messageNode.id,
    title: messageNode.title,
    message,
  };
}

export function resolveFlowFormGuidance(
  config: AutopilotConfig,
  scope: ActiveFlowIntentScope | null,
): FlowFormGuidance | null {
  config = configWithV2FlowGraph(config);
  if (!scope || !config.flow_graph) return null;

  const directTargets = new Set(
    config.flow_graph.edges
      .filter((edge) => edge.source === scope.nodeId)
      .map((edge) => edge.target),
  );
  const formNode = config.flow_graph.nodes.find((node) => (
    directTargets.has(node.id) &&
    node.kind === 'collect' &&
    node.config?.formMode === 'ai' &&
    (Boolean(node.config?.message?.trim()) || Boolean(node.config?.formFields?.length))
  ));

  if (!formNode) return null;

  return {
    nodeId: formNode.id,
    title: formNode.title,
    intro: formNode.config?.message?.trim() || 'Para continuar, colete os dados necessarios do cliente.',
    fields: (formNode.config?.formFields || [])
      .filter((field) => field.label?.trim())
      .map((field) => ({
        label: field.label.trim(),
        fieldKey: field.fieldKey?.trim() || undefined,
        required: field.required !== false,
        placeholder: field.placeholder?.trim() || undefined,
      })),
  };
}

export function formatFlowFormGuidanceForPrompt(form: FlowFormGuidance | null): string {
  if (!form) return '';

  const fields = form.fields.map((field, index) => {
    const required = field.required ? 'obrigatorio' : 'opcional';
    const key = field.fieldKey ? `; chave=${field.fieldKey}` : '';
    const example = field.placeholder ? `; exemplo=${field.placeholder}` : '';
    return `${index + 1}. ${field.label} (${required}${key}${example})`;
  }).join('\n');

  return [
    'FORMULARIO GUIADO POR IA ATIVO',
    `Bloco: ${form.title}`,
    `Objetivo: ${form.intro}`,
    'Campos a coletar:',
    fields || '(Nenhum campo configurado.)',
    '',
    'Regras de conducao:',
    '- Nao envie todos os campos como uma lista seca, a menos que o cliente peça.',
    '- Pergunte no maximo 1 ou 2 campos por mensagem, em linguagem natural.',
    '- Se o cliente tirar uma duvida no meio, responda a duvida e depois retome o proximo campo pendente.',
    '- Use o historico para nao pedir novamente dados que o cliente ja informou.',
    '- Quando todos os campos obrigatorios estiverem claros, confirme um resumo curto e indique o proximo passo do atendimento.',
    '- Nao acione ferramentas apenas para coletar estes campos.',
  ].join('\n');
}

export function formatFlowReferencesForPrompt(
  config: AutopilotConfig,
  rules: NexusFlowInstance[] | null | undefined,
): string {
  config = configWithV2FlowGraph(config);
  const nodeReferences = (config.flow_graph?.nodes || [])
    .map((node) => {
      const aliases = uniqueReferenceAliases([
        nodeReferenceId(node),
        node.id,
        node.title,
        node.config?.referenceId,
        node.config?.variableName,
      ]);
      if (aliases.length === 0) return null;
      return `- ${aliases.map((alias) => `@${alias}`).join(', ')}: bloco "${node.title}" (${node.kind})${node.subtitle ? ` - ${node.subtitle}` : ''}`;
    })
    .filter((line): line is string => Boolean(line));

  const ruleReferences = (rules || [])
    .filter((rule) => rule.enabled)
    .map((rule) => `- @${ruleReferenceId(rule)}: habilidade "${rule.name}" - gatilho: ${rule.trigger}`);

  if (nodeReferences.length === 0 && ruleReferences.length === 0) return '';

  return [
    'REFERENCIAS DO FLUXO (@ID)',
    'Quando instrucoes, documentos ou mensagens mencionarem @ID, interprete como referencia ao bloco ou habilidade abaixo.',
    ...nodeReferences,
    ...ruleReferences,
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderDeterministicFlowMessage(
  config: AutopilotConfig,
  template: string,
  values: {
    customerMessage: string;
    contactName?: string | null;
  },
): string {
  let message = template
    .replace(/\{\{\s*system\.customer_message\s*\}\}/g, values.customerMessage)
    .replace(/\{\{\s*system\.contact\.name\s*\}\}/g, values.contactName?.trim() || '');

  for (const variable of config.flow_graph?.variables || []) {
    const token = new RegExp(`\\{\\{\\s*system\\.${escapeRegExp(variable.name)}\\s*\\}\\}`, 'g');
    message = message.replace(token, variable.defaultValue || '');
  }

  return message.trim();
}
