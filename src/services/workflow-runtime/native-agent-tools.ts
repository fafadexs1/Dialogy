import type { WorkflowDefinition, WorkflowNode } from './types';

export type NativeAgentToolCatalogItem = {
  name: string;
  displayName?: string;
  category?: 'attendance' | 'crm' | 'sgp' | 'mcp' | 'other';
  description: string;
  source: 'dialogy' | 'mcp';
  serverId?: string;
  serverName?: string;
  version?: string;
  class?: string;
  riskLevel: 'low' | 'medium' | 'high';
  sideEffect?: 'none' | 'low' | 'medium' | 'high';
  idempotent?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  requiresHumanApproval?: boolean;
  customerVisible?: boolean;
  enabledByDefault?: boolean;
  allowedIntents?: string[];
  requiredSlots?: string[];
  fallbackAction?: string;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
};

export type NativeAgentToolGroup = {
  id: string;
  label: string;
  description: string;
  tools: NativeAgentToolCatalogItem[];
};

const INTERNAL_GROUPS: Record<string, Pick<NativeAgentToolGroup, 'label' | 'description'>> = {
  attendance: {
    label: 'Atendimento',
    description: 'Transferência, encerramento e notas internas.',
  },
  crm: {
    label: 'CRM',
    description: 'Leitura e atualização dos dados do contato.',
  },
  sgp: {
    label: 'SGP',
    description: 'Contratos, faturas e operações do provedor.',
  },
  other: {
    label: 'Outras ferramentas',
    description: 'Recursos adicionais disponíveis no workspace.',
  },
};

function humanizeIdentifier(value: string) {
  const words = value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
  return words ? words.charAt(0).toLocaleUpperCase('pt-BR') + words.slice(1) : 'Ferramenta';
}

export function parseQualifiedMcpToolName(name: string): { serverId: string; toolName: string } | null {
  const [prefix, serverId, ...toolNameParts] = name.split(':');
  const toolName = toolNameParts.join(':').trim();
  if (prefix !== 'mcp' || !serverId?.trim() || !toolName) return null;
  return { serverId: serverId.trim(), toolName };
}

export function getNativeAgentToolLabel(tool: NativeAgentToolCatalogItem) {
  const configured = tool.displayName?.trim();
  if (configured) return configured;
  const parsed = parseQualifiedMcpToolName(tool.name);
  return humanizeIdentifier(parsed?.toolName || tool.name);
}

export function isNativeAgentToolEligible(tool: NativeAgentToolCatalogItem) {
  if (tool.source === 'mcp') return true;
  return !Array.isArray(tool.allowedIntents) || tool.allowedIntents.length > 0;
}

export function isNativeAgentToolRecommended(tool: NativeAgentToolCatalogItem) {
  if (!isNativeAgentToolEligible(tool) || tool.requiresHumanApproval === true) return false;
  if (tool.enabledByDefault === true) return true;
  return tool.source === 'dialogy' && ['transfer_chat', 'add_internal_note'].includes(tool.name);
}

export function nativeAgentToolTestId(toolName: string) {
  return `agent-tool-${toolName.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

export function getNativeAgentToolUnavailableReason(tool: NativeAgentToolCatalogItem) {
  if (isNativeAgentToolEligible(tool)) return null;
  return 'Esta operação permanece bloqueada para execução autônoma pela IA.';
}

function groupIdentity(tool: NativeAgentToolCatalogItem) {
  if (tool.source === 'mcp') {
    const serverId = tool.serverId || parseQualifiedMcpToolName(tool.name)?.serverId || 'unknown';
    return {
      id: `mcp:${serverId}`,
      label: tool.serverName?.trim() || 'Servidor MCP',
      description: 'Ferramentas sincronizadas desta integração MCP.',
    };
  }
  const category = tool.category && INTERNAL_GROUPS[tool.category] ? tool.category : 'other';
  return { id: `dialogy:${category}`, ...INTERNAL_GROUPS[category] };
}

export function groupNativeAgentTools(tools: NativeAgentToolCatalogItem[]): NativeAgentToolGroup[] {
  const groups = new Map<string, NativeAgentToolGroup>();
  for (const tool of tools) {
    const identity = groupIdentity(tool);
    const group = groups.get(identity.id) || { ...identity, tools: [] };
    group.tools.push(tool);
    groups.set(identity.id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    tools: [...group.tools].sort((left, right) => (
      getNativeAgentToolLabel(left).localeCompare(getNativeAgentToolLabel(right), 'pt-BR')
    )),
  }));
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildNativeAgentToolConfig(tool: NativeAgentToolCatalogItem): Record<string, unknown> {
  const parsedMcpName = parseQualifiedMcpToolName(tool.name);
  const requiresConfirmation = tool.requiresHumanApproval === true || tool.riskLevel === 'high';
  const config: Record<string, unknown> = {
    name: tool.name,
    displayName: getNativeAgentToolLabel(tool),
    description: tool.description,
    source: tool.source,
    version: tool.version || (tool.source === 'mcp' ? 'mcp' : '1'),
    class: tool.class || (tool.riskLevel === 'low' ? 'read_only' : 'write_non_idempotent'),
    riskLevel: tool.riskLevel,
    sideEffect: tool.sideEffect || (tool.riskLevel === 'low' ? 'none' : tool.riskLevel),
    idempotent: tool.idempotent ?? tool.riskLevel !== 'high',
    timeoutMs: positiveInteger(tool.timeoutMs, tool.source === 'mcp' ? 30_000 : 20_000),
    maxAttempts: positiveInteger(tool.maxAttempts, 1),
    requiresConfirmation,
    requiresHumanApproval: requiresConfirmation,
    customerVisible: tool.customerVisible !== false,
    allowedIntents: tool.allowedIntents || [],
    requiredSlots: tool.requiredSlots || [],
    fallbackAction: tool.fallbackAction || 'configured_fallback',
    inputSchema: tool.inputSchema || {},
    outputSchema: tool.outputSchema || {},
  };
  if (requiresConfirmation) config.permissionScope = 'automations:execute_sensitive_tool';
  if (tool.source === 'mcp') {
    config.serverId = tool.serverId || parsedMcpName?.serverId || '';
    config.serverName = tool.serverName || '';
    config.allowedTools = parsedMcpName?.toolName ? [parsedMcpName.toolName] : [];
    config.audit = true;
  } else {
    config.action = tool.name;
  }
  return config;
}

export function getWorkflowToolName(node: WorkflowNode) {
  if (!node.type.startsWith('tool.')) return '';
  return String(node.config.name || node.config.action || '').trim();
}

export function listAttachedWorkflowToolNames(definition: WorkflowDefinition) {
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  const names = definition.connections
    .filter((connection) => connection.connectionType === 'tool')
    .map((connection) => nodeById.get(connection.sourceNodeId))
    .map((node) => node ? getWorkflowToolName(node) : '')
    .filter(Boolean);
  return [...new Set(names)];
}

export function synchronizeNativeWorkflowToolState<
  T extends {
    workflow_builder_mode?: string | null;
    workflow_definition?: WorkflowDefinition | null;
    enabled_tool_names?: string[] | null;
  },
>(snapshot: T): T {
  if (snapshot.workflow_builder_mode !== 'native_v2' || !snapshot.workflow_definition) return snapshot;
  return {
    ...snapshot,
    enabled_tool_names: listAttachedWorkflowToolNames(snapshot.workflow_definition),
  };
}

export type NativeWorkflowToolReconciliation = {
  workflow: WorkflowDefinition;
  errors: string[];
};

/**
 * Reconciles every tool attached to an agent with the current workspace
 * catalog. Catalog metadata is authoritative so stale schemas, permissions or
 * confirmation flags cannot be published from an old/manually edited draft.
 */
export function reconcileNativeWorkflowTools(
  definition: WorkflowDefinition,
  catalog: NativeAgentToolCatalogItem[],
): NativeWorkflowToolReconciliation {
  const catalogByName = new Map(catalog.map((tool) => [tool.name, tool]));
  const attachedToolNodeIds = new Set(definition.connections
    .filter((connection) => connection.connectionType === 'tool')
    .map((connection) => connection.sourceNodeId));
  const errors: string[] = [];
  let changed = false;

  const nodes = definition.nodes.map((node) => {
    if (!attachedToolNodeIds.has(node.id)) return node;
    const name = getWorkflowToolName(node);
    const tool = catalogByName.get(name);
    if (!tool) {
      errors.push(`A ferramenta "${node.name}" não existe mais no catálogo deste workspace.`);
      return node;
    }
    if (!isNativeAgentToolEligible(tool)) {
      errors.push(`A ferramenta "${getNativeAgentToolLabel(tool)}" não está liberada para execução autônoma.`);
      return node;
    }
    const expectedType = tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal';
    if (node.type !== expectedType) {
      errors.push(`A origem da ferramenta "${getNativeAgentToolLabel(tool)}" mudou; remova e adicione novamente.`);
      return node;
    }
    const canonicalConfig = { ...node.config, ...buildNativeAgentToolConfig(tool) };
    if (JSON.stringify(canonicalConfig) === JSON.stringify(node.config)
      && node.name === getNativeAgentToolLabel(tool)) return node;
    changed = true;
    return {
      ...node,
      name: getNativeAgentToolLabel(tool),
      config: canonicalConfig,
    };
  });

  return {
    workflow: changed ? { ...definition, nodes, updatedAt: new Date().toISOString() } : definition,
    errors: [...new Set(errors)],
  };
}
