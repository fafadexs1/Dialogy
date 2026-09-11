import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import type {
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowNode,
} from '@/services/workflow-runtime/types';

export type NexusWorkflowTemplate = 'blank' | 'message' | 'webhook' | 'schedule' | 'crm_option';

export type NexusWorkflowSummary = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  nodeCount: number;
  triggerTypes: string[];
  category?: 'workflow' | 'crm_trigger';
  publishedRevision: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NexusWorkflowRecord = NexusWorkflowSummary & {
  createdBy: string;
  draftDefinition: WorkflowDefinition;
  publishedWorkflowId: string | null;
  publishedWorkflowVersion: string | null;
  hasUnpublishedChanges: boolean;
};

export type NexusWorkflowVersionSource = 'create' | 'save' | 'publish' | 'restore' | 'duplicate' | 'import';

export type NexusWorkflowVersionSummary = {
  id: string;
  revision: number;
  publishedRevision: number | null;
  description: string;
  source: NexusWorkflowVersionSource;
  nodeCount: number;
  connectionCount: number;
  createdAt: string;
};

export type NexusWorkflowExecutionSummary = {
  id: string;
  workflowVersion: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  sessionId: string | null;
  conversationId: string | null;
  currentNodeId: string | null;
  totalSteps: number;
  totalModelCalls: number;
  totalToolCalls: number;
  totalTokens: number | null;
  failureMessage: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

/** Studio agents own the rest of the conversation, so they can never expose a downstream route in Nexus. */
export function normalizeStandaloneStudioAgents(definition: WorkflowDefinition): WorkflowDefinition {
  const terminalAgentIds = new Set(
    definition.nodes.filter((node) => node.type === 'ai.published_agent').map((node) => node.id),
  );
  if (terminalAgentIds.size === 0) return definition;
  return {
    ...definition,
    nodes: definition.nodes.map((node) => terminalAgentIds.has(node.id)
      ? { ...node, outputPorts: [], config: { ...node.config, outputKeys: [] } }
      : node),
    connections: definition.connections.filter((connection) => !terminalAgentIds.has(connection.sourceNodeId)),
  };
}

const DEFAULT_SETTINGS: WorkflowDefinition['settings'] = {
  executionTimeoutMs: 120_000,
  maxSteps: 100,
  maxModelCalls: 15,
  maxToolCalls: 20,
  maxAgentTurnsPerNode: 8,
  maxRepeatedDecisionSignatures: 2,
  maxTotalInputTokens: 100_000,
  maxTotalOutputTokens: 20_000,
  concurrencyLimit: 1,
};

function connection(
  id: string,
  source: WorkflowNode,
  sourcePortId: string,
  target: WorkflowNode,
  targetPortId = 'main',
  connectionType: WorkflowConnection['connectionType'] = 'main',
): WorkflowConnection {
  return {
    id,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    connectionType,
  };
}

function addNode(
  definition: WorkflowDefinition,
  type: string,
  id: string,
  name: string,
  position: WorkflowNode['position'],
  config: Record<string, unknown> = {},
) {
  const node = createWorkflowNode(type, { id, name, position, config });
  definition.nodes.push(node);
  return node;
}

function addErrorTermination(definition: WorkflowDefinition) {
  const error = addNode(definition, 'error.handler', 'workflow_error', 'Se algo der errado', { x: 760, y: 320 }, {
    mode: 'fail',
    publicMessage: 'A execução foi interrompida com segurança.',
  });
  const end = addNode(definition, 'output.end', 'workflow_error_end', 'Finalizar com erro', { x: 1060, y: 320 }, {
    output: { success: false },
  });
  definition.connections.push(connection('error_to_end', error, 'failed', end));
  return error;
}

export function createStandaloneNexusWorkflow(input: {
  id: string;
  workspaceId: string;
  name: string;
  template: NexusWorkflowTemplate;
  crmOption?: { fieldId: string; value: string };
  now?: string;
}): WorkflowDefinition {
  const timestamp = input.now || new Date().toISOString();
  const definition: WorkflowDefinition = {
    id: `nexus:${input.id}`,
    workspaceId: input.workspaceId,
    name: input.name,
    version: 'draft',
    status: 'draft',
    nodes: [],
    connections: [],
    settings: { ...DEFAULT_SETTINGS },
    metadata: {
      editor: 'nexus',
      kind: 'standalone',
      nexusWorkflowId: input.id,
      template: input.template,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (input.template === 'crm_option') {
    const trigger = addNode(definition, 'trigger.internal_event', 'crm_option', 'Opção do CRM', { x: 100, y: 100 }, {
      eventName: 'contact.updated', defaultOutput: 'event', crmOption: input.crmOption || { fieldId: '', value: '' },
    });
    const end = addNode(definition, 'output.end', 'crm_end', 'Finalizar fluxo', { x: 430, y: 100 });
    definition.connections.push(connection('crm_to_end', trigger, 'event', end));
  } else if (input.template === 'message') {
    const error = addErrorTermination(definition);
    const trigger = addNode(definition, 'trigger.received_message', 'message_received', 'Mensagem recebida', { x: 80, y: 80 });
    const response = addNode(definition, 'output.respond', 'send_message', 'Enviar mensagem', { x: 390, y: 80 }, {
      channel: 'source',
      message: 'Recebi sua mensagem: {{input.text}}',
      idempotent: true,
    });
    const end = addNode(definition, 'output.end', 'message_end', 'Finalizar fluxo', { x: 720, y: 80 });
    definition.connections.push(
      connection('message_to_response', trigger, 'message', response),
      connection('response_to_end', response, 'success', end),
      connection('response_to_error', response, 'error', error, 'error', 'error'),
    );
  } else if (input.template === 'webhook') {
    const error = addErrorTermination(definition);
    const trigger = addNode(definition, 'trigger.webhook', 'webhook_received', 'Webhook recebido', { x: 80, y: 80 }, {
      method: 'POST',
      authentication: 'signature',
    });
    const variables = addNode(definition, 'data.set', 'prepare_payload', 'Preparar dados', { x: 390, y: 80 }, {
      assignments: { receivedAt: '{{context.startedAt}}' },
    });
    const end = addNode(definition, 'output.end', 'webhook_end', 'Finalizar fluxo', { x: 720, y: 80 }, {
      output: { accepted: true },
    });
    definition.connections.push(
      connection('webhook_to_variables', trigger, 'request', variables),
      connection('webhook_to_error', trigger, 'error', error, 'error', 'error'),
      connection('variables_to_end', variables, 'success', end),
      connection('variables_to_error', variables, 'error', error, 'error', 'error'),
    );
  } else if (input.template === 'schedule') {
    const error = addErrorTermination(definition);
    const trigger = addNode(definition, 'trigger.schedule', 'scheduled_tick', 'Horário agendado', { x: 80, y: 80 }, {
      timezone: 'America/Sao_Paulo',
      cron: '0 9 * * 1-5',
    });
    const variables = addNode(definition, 'data.set', 'scheduled_context', 'Definir contexto', { x: 390, y: 80 }, {
      assignments: { source: 'schedule' },
    });
    const end = addNode(definition, 'output.end', 'schedule_end', 'Finalizar fluxo', { x: 720, y: 80 });
    definition.connections.push(
      connection('schedule_to_variables', trigger, 'tick', variables),
      connection('variables_to_end', variables, 'success', end),
      connection('variables_to_error', variables, 'error', error, 'error', 'error'),
    );
  } else {
    const trigger = addNode(definition, 'trigger.manual', 'manual_trigger', 'Execução manual', { x: 100, y: 100 });
    const end = addNode(definition, 'output.end', 'manual_end', 'Finalizar fluxo', { x: 430, y: 100 });
    definition.connections.push(connection('manual_to_end', trigger, 'started', end));
  }

  return WorkflowDefinitionSchema.parse(definition);
}

export function bindStandaloneNexusWorkflow(input: {
  definition: WorkflowDefinition;
  id: string;
  workspaceId: string;
  name?: string;
  now?: string;
}): WorkflowDefinition {
  const parsed = normalizeStandaloneStudioAgents(WorkflowDefinitionSchema.parse(input.definition));
  return WorkflowDefinitionSchema.parse({
    ...parsed,
    id: `nexus:${input.id}`,
    workspaceId: input.workspaceId,
    name: input.name?.trim() || parsed.name,
    version: 'draft',
    status: 'draft',
    metadata: {
      ...(parsed.metadata || {}),
      editor: 'nexus',
      kind: 'standalone',
      nexusWorkflowId: input.id,
    },
    updatedAt: input.now || new Date().toISOString(),
  });
}

export function duplicateStandaloneNexusWorkflow(input: {
  definition: WorkflowDefinition;
  id: string;
  workspaceId: string;
  name: string;
  now?: string;
}): WorkflowDefinition {
  const timestamp = input.now || new Date().toISOString();
  const rebound = bindStandaloneNexusWorkflow({
    definition: input.definition,
    id: input.id,
    workspaceId: input.workspaceId,
    name: input.name,
    now: timestamp,
  });
  return WorkflowDefinitionSchema.parse({
    ...rebound,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      ...(rebound.metadata || {}),
      duplicatedFromWorkflowId: input.definition.metadata?.nexusWorkflowId || null,
    },
  });
}
