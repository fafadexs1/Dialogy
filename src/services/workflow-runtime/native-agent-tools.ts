import { createWorkflowNode } from './catalog';
import { getPrimaryWorkflowAgentId } from './model-selection';
import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from './types';

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
    description: 'Notas internas auditadas; transferência e encerramento usam blocos nativos.',
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

const NATIVE_CONTROL_PLANE_TOOL_NAMES = new Set([
  'transfer_chat',
  'close_chat',
]);

export function isNativeAgentControlPlaneTool(tool: Pick<NativeAgentToolCatalogItem, 'name'> | string) {
  const name = typeof tool === 'string' ? tool : tool.name;
  return NATIVE_CONTROL_PLANE_TOOL_NAMES.has(name);
}

/**
 * Existing workflows may retain legacy internal tool attachments, but new
 * native workflows express conversation transfer/closure through explicit
 * system blocks rather than model-selectable tools. Notes and CRM field
 * updates remain audited tools because their dynamic content is chosen by the
 * agent and no equivalent first-class block exists yet.
 */
export function isNativeAgentToolAttachable(tool: NativeAgentToolCatalogItem) {
  return isNativeAgentToolEligible(tool) && !isNativeAgentControlPlaneTool(tool);
}

export function isNativeAgentToolRecommended(tool: NativeAgentToolCatalogItem) {
  if (!isNativeAgentToolAttachable(tool) || tool.requiresHumanApproval === true) return false;
  if (tool.enabledByDefault === true) return true;
  return false;
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

export type AttachNativeToolResult = {
  workflow: WorkflowDefinition;
  status: 'attached' | 'already_attached' | 'ineligible' | 'missing_agent' | 'missing_ports';
};

export type DetachNativeToolResult = {
  workflow: WorkflowDefinition;
  status: 'detached' | 'not_attached';
};

function nextWorkflowId(prefix: string, existingIds: Set<string>) {
  if (!existingIds.has(prefix)) return prefix;
  let suffix = 2;
  while (existingIds.has(`${prefix}_${suffix}`)) suffix += 1;
  return `${prefix}_${suffix}`;
}

function toolIdPrefix(toolName: string) {
  const normalized = toolName
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `tool_${normalized || 'capability'}`;
}

/**
 * Materializes a capability selected in the global tools panel into the
 * native workflow. The workflow remains authoritative: removing a capability
 * is intentionally done by disconnecting it in the flow builder.
 */
export function attachNativeToolToPrimaryAgent(
  definition: WorkflowDefinition,
  tool: NativeAgentToolCatalogItem,
): AttachNativeToolResult {
  if (!isNativeAgentToolAttachable(tool)) {
    return { workflow: definition, status: 'ineligible' };
  }

  const primaryAgentId = getPrimaryWorkflowAgentId(definition);
  const primaryAgent = definition.nodes.find((node) => node.id === primaryAgentId);
  if (!primaryAgent) return { workflow: definition, status: 'missing_agent' };

  const expectedType = tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal';
  const alreadyAttachedConnection = definition.connections.find((connection) => {
    if (connection.targetNodeId !== primaryAgent.id || connection.connectionType !== 'tool') return false;
    const source = definition.nodes.find((node) => node.id === connection.sourceNodeId);
    return Boolean(source && getWorkflowToolName(source) === tool.name);
  });
  if (alreadyAttachedConnection) {
    const canonicalNodes = definition.nodes.map((node) => (
      node.id === alreadyAttachedConnection.sourceNodeId
        ? {
          ...node,
          type: expectedType,
          name: getNativeAgentToolLabel(tool),
          config: { ...node.config, ...buildNativeAgentToolConfig(tool) },
        }
        : node
    ));
    return {
      workflow: { ...definition, nodes: canonicalNodes },
      status: 'already_attached',
    };
  }

  const reusableTool = definition.nodes.find((node) => (
    node.type === expectedType && getWorkflowToolName(node) === tool.name
  ));
  const attachedCount = definition.connections.filter((connection) => (
    connection.targetNodeId === primaryAgent.id && connection.connectionType === 'tool'
  )).length;
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const toolNode = reusableTool
    ? {
      ...reusableTool,
      name: getNativeAgentToolLabel(tool),
      config: { ...reusableTool.config, ...buildNativeAgentToolConfig(tool) },
    }
    : createWorkflowNode(expectedType, {
      id: nextWorkflowId(toolIdPrefix(tool.name), nodeIds),
      name: getNativeAgentToolLabel(tool),
      position: {
        x: primaryAgent.position.x - 320,
        y: primaryAgent.position.y + 120 + attachedCount * 90,
      },
      config: buildNativeAgentToolConfig(tool),
    });
  const sourcePort = toolNode.outputPorts.find((port) => port.connectionType === 'tool');
  const targetPort = primaryAgent.inputPorts.find((port) => port.connectionType === 'tool');
  if (!sourcePort || !targetPort) return { workflow: definition, status: 'missing_ports' };

  const connectionIds = new Set(definition.connections.map((connection) => connection.id));
  const connection: WorkflowConnection = {
    id: nextWorkflowId(`conn_${toolNode.id}_${primaryAgent.id}`, connectionIds),
    sourceNodeId: toolNode.id,
    sourcePortId: sourcePort.id,
    targetNodeId: primaryAgent.id,
    targetPortId: targetPort.id,
    connectionType: 'tool',
  };
  const nodes = reusableTool
    ? definition.nodes.map((node) => node.id === reusableTool.id ? toolNode : node)
    : [...definition.nodes, toolNode];

  return {
    workflow: { ...definition, nodes, connections: [...definition.connections, connection] },
    status: 'attached',
  };
}

/** Removes every node and connection for a globally disabled tool. */
export function detachNativeToolFromWorkflow(
  definition: WorkflowDefinition,
  toolName: string,
): DetachNativeToolResult {
  const toolNodeIds = new Set(definition.nodes
    .filter((node) => node.type.startsWith('tool.') && getWorkflowToolName(node) === toolName)
    .map((node) => node.id));
  if (toolNodeIds.size === 0) return { workflow: definition, status: 'not_attached' };

  return {
    workflow: {
      ...definition,
      nodes: definition.nodes.filter((node) => !toolNodeIds.has(node.id)),
      connections: definition.connections.filter((connection) => (
        !toolNodeIds.has(connection.sourceNodeId) && !toolNodeIds.has(connection.targetNodeId)
      )),
    },
    status: 'detached',
  };
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
