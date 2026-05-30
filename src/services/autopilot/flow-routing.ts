import type { AutopilotConfig, AutopilotFlowNode, KnowledgeBaseDocument, NexusFlowInstance } from '@/lib/types';
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
    (
      (node.kind === 'send_message' && Boolean(node.config?.message?.trim())) ||
      (
        node.kind === 'form' &&
        node.config?.formMode !== 'ai' &&
        (Boolean(node.config?.message?.trim()) || Boolean(node.config?.formFields?.length))
      )
    )
  ));

  if (!messageNode) return null;
  const message = messageNode.kind === 'form'
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
  if (node.kind === 'send_message') {
    return node.config?.message?.trim() || null;
  }

  if (
    node.kind === 'form' &&
    node.config?.formMode !== 'ai' &&
    (Boolean(node.config?.message?.trim()) || Boolean(node.config?.formFields?.length))
  ) {
    return renderFormMessage(node);
  }

  return null;
}

export function resolveEntryDeterministicFlowMessage(config: AutopilotConfig): DeterministicFlowMessage | null {
  const graph = config.flow_graph;
  if (!graph) return null;

  const triggerNodeIds = new Set(
    graph.nodes
      .filter((node) => node.kind === 'trigger')
      .map((node) => node.id),
  );
  if (triggerNodeIds.size === 0) return null;

  const entryTargets = new Set(
    graph.edges
      .filter((edge) => triggerNodeIds.has(edge.source))
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
  if (!scope || !config.flow_graph) return null;

  const directTargets = new Set(
    config.flow_graph.edges
      .filter((edge) => edge.source === scope.nodeId)
      .map((edge) => edge.target),
  );
  const formNode = config.flow_graph.nodes.find((node) => (
    directTargets.has(node.id) &&
    node.kind === 'form' &&
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
