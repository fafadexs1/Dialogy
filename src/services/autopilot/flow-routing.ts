import type { AutopilotConfig, AutopilotFlowNode } from '@/lib/types';
import type { UniversalAutopilotIntent } from './intent-types';

export type ActiveFlowIntentScope = {
  nodeId: string;
  title: string;
  intent: UniversalAutopilotIntent;
  customIntentLabel?: string;
  systemPrompt: string;
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
  };
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
