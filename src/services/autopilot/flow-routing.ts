import type { AutopilotConfig, AutopilotFlowNode, KnowledgeBaseDocument } from '@/lib/types';
import type { UniversalAutopilotIntent } from './intent-types';

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

export function resolveActiveFlowIntentScope(
  config: AutopilotConfig,
  intent: UniversalAutopilotIntent,
): ActiveFlowIntentScope | null {
  const nodes = config.flow_graph?.nodes || [];
  const edges = config.flow_graph?.edges || [];
  const matchedNode = nodes.find((node): node is AutopilotFlowNode => (
    node.kind === 'intent' &&
    node.config?.intent === intent &&
    Boolean(node.config.instructions?.trim()) &&
    edges.some((edge) => edge.target === node.id)
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

export function filterKnowledgeDocumentsForScope(
  config: AutopilotConfig,
  documents: KnowledgeBaseDocument[] | null | undefined,
  scope: ActiveFlowIntentScope | null,
): KnowledgeBaseDocument[] {
  const list = documents || [];
  if (!config.flow_graph) return list;

  const targetNodeId = scope?.nodeId || config.flow_graph.nodes.find((node) => node.kind === 'assistant')?.id;
  if (!targetNodeId) return [];

  const attachedKnowledgeNodeIds = new Set(
    config.flow_graph.nodes
      .filter((node) => node.kind === 'knowledge')
      .map((node) => node.id),
  );
  const hasAttachedKnowledge = config.flow_graph.edges.some((edge) => (
    edge.target === targetNodeId && attachedKnowledgeNodeIds.has(edge.source)
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
  if (!scope || !config.flow_graph) return null;

  const directTargets = new Set(
    config.flow_graph.edges
      .filter((edge) => edge.source === scope.nodeId)
      .map((edge) => edge.target),
  );
  const messageNode = config.flow_graph.nodes.find((node) => (
    directTargets.has(node.id) &&
    node.kind === 'send_message' &&
    Boolean(node.config?.message?.trim())
  ));

  if (!messageNode?.config?.message?.trim()) return null;

  return {
    nodeId: messageNode.id,
    title: messageNode.title,
    message: messageNode.config.message.trim(),
  };
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
