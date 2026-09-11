import 'server-only';

import { db } from '@/lib/db';
import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime';

type Queryable = Pick<typeof db, 'query'>;

export type NexusDialogyResourceOption = {
  id: string;
  label: string;
  description?: string;
  type?: string;
  hasLinkedAi?: boolean;
  linkedAiActive?: boolean;
};

export type NexusDialogyTagOption = NexusDialogyResourceOption & {
  isCloseReason: boolean;
};

export type NexusDialogyResources = {
  teams: NexusDialogyResourceOption[];
  tags: NexusDialogyTagOption[];
  members: NexusDialogyResourceOption[];
  systemAgents: NexusDialogyResourceOption[];
  intelligentAgents: NexusDialogyResourceOption[];
  instances: NexusDialogyResourceOption[];
  workflows: NexusDialogyResourceOption[];
};

export type NexusDialogyBindingIssue = {
  nodeId: string;
  nodeName: string;
  field: string;
  value: string;
  resource: 'team' | 'tag' | 'close_reason' | 'member' | 'system_agent' | 'intelligent_agent' | 'instance' | 'workflow';
  message: string;
};

const MESSAGE_DELIVERY_NODE_TYPES = new Set([
  'interaction.options',
  'interaction.form',
  'output.respond',
  'output.media',
  'dialogy.sgp_identify_customer',
  'dialogy.sgp_contract_status',
  'dialogy.sgp_second_copy',
  'dialogy.sgp_payment_promise',
]);

export function nexusWorkflowRequiresSenderSystemAgent(definition: WorkflowDefinition) {
  return definition.nodes.some((node) => (
    node.type === 'trigger.received_message'
    || node.type === 'ai.published_agent'
    || MESSAGE_DELIVERY_NODE_TYPES.has(node.type)
    || (node.type === 'ai.agent' && node.config.autoSendResponse === true)
  ));
}

function configuredValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function isDynamicBinding(value: string) {
  return value.includes('{{') || value.includes('}}');
}

function collectBindingIssue(input: {
  issues: NexusDialogyBindingIssue[];
  node: WorkflowNode;
  field: string;
  value: unknown;
  known: Set<string>;
  resource: NexusDialogyBindingIssue['resource'];
  label: string;
}) {
  for (const value of configuredValues(input.value)) {
    if (isDynamicBinding(value) || input.known.has(value)) continue;
    input.issues.push({
      nodeId: input.node.id,
      nodeName: input.node.name,
      field: input.field,
      value,
      resource: input.resource,
      message: `O bloco "${input.node.name}" referencia ${input.label} "${value}", que não pertence a este workspace ou não está mais disponível.`,
    });
  }
}

export function validateNexusWorkflowDialogyBindingsAgainstResources(
  definition: WorkflowDefinition,
  resources: NexusDialogyResources,
): { valid: boolean; issues: NexusDialogyBindingIssue[] } {
  const issues: NexusDialogyBindingIssue[] = [];
  const teams = new Set(resources.teams.map((resource) => resource.id));
  const tags = new Set(resources.tags.map((resource) => resource.id));
  const closeReasons = new Set(resources.tags.filter((resource) => resource.isCloseReason).map((resource) => resource.id));
  const members = new Set(resources.members.map((resource) => resource.id));
  const systemAgents = new Set(resources.systemAgents.map((resource) => resource.id));
  const intelligentAgents = new Set(resources.intelligentAgents.map((resource) => resource.id));
  const instances = new Set(resources.instances.map((resource) => resource.id));
  const currentWorkflowId = definition.id.replace(/^nexus:/, '');
  const workflows = new Set(resources.workflows
    .map((resource) => resource.id)
    .filter((id) => id !== currentWorkflowId));
  const senderSystemAgentId = String(definition.metadata?.senderSystemAgentId || '').trim();
  const senderSystemAgent = resources.systemAgents.find((resource) => resource.id === senderSystemAgentId);

  if (nexusWorkflowRequiresSenderSystemAgent(definition) && !senderSystemAgentId) {
    issues.push({
      nodeId: '__workflow__',
      nodeName: definition.name,
      field: 'metadata.senderSystemAgentId',
      value: '',
      resource: 'system_agent',
      message: `Selecione o agente do sistema que enviará as mensagens do fluxo "${definition.name}".`,
    });
  } else if (senderSystemAgentId && !systemAgents.has(senderSystemAgentId)) {
    issues.push({
      nodeId: '__workflow__',
      nodeName: definition.name,
      field: 'metadata.senderSystemAgentId',
      value: senderSystemAgentId,
      resource: 'system_agent',
      message: `O agente remetente do fluxo "${definition.name}" não pertence a este workspace ou não está mais ativo.`,
    });
  } else if (
    senderSystemAgent?.type === 'intelligent_attendant'
    && definition.nodes.some((node) => node.type === 'ai.agent' && node.config.useSelectedSystemAgent !== false)
    && senderSystemAgent.linkedAiActive !== true
  ) {
    issues.push({
      nodeId: '__workflow__',
      nodeName: definition.name,
      field: 'metadata.senderSystemAgentId',
      value: senderSystemAgentId,
      resource: 'intelligent_agent',
      message: `Ative a IA vinculada ao agente "${senderSystemAgent.label}" antes de publicar este fluxo.`,
    });
  }

  for (const node of definition.nodes) {
    const check = (
      field: string,
      value: unknown,
      known: Set<string>,
      resource: NexusDialogyBindingIssue['resource'],
      label: string,
    ) => collectBindingIssue({ issues, node, field, value, known, resource, label });

    if (node.type === 'trigger.received_message') {
      check('instanceNames', node.config.instanceNames, instances, 'instance', 'a instância');
    }
    if (node.type === 'dialogy.team_availability') {
      check('teamId', node.config.teamId, teams, 'team', 'a equipe');
    }
    if (node.type === 'dialogy.chat_tag') {
      check('tagId', node.config.tagId, tags, 'tag', 'a etiqueta');
    }
    if (node.type === 'output.handoff') {
      if (String(node.config.destinationType || 'human') === 'intelligent_agent') {
        check('systemAgentId', node.config.systemAgentId, intelligentAgents, 'intelligent_agent', 'o Atendente Inteligente');
      } else {
        check('teamId', node.config.teamId, teams, 'team', 'a equipe');
        if (!configuredValues(node.config.teamId).length) {
          check('agentId', node.config.agentId, members, 'member', 'o atendente');
        }
      }
    }
    if (node.type === 'output.close_conversation') {
      check('reasonTagId', node.config.reasonTagId, closeReasons, 'close_reason', 'o motivo de encerramento');
    }
    if (['whatsapp.send_text', 'whatsapp.send_media', 'whatsapp.group_create'].includes(node.type)) {
      check('instanceName', node.config.instanceName, instances, 'instance', 'a instância');
    }
    if (node.type === 'dialogy.sgp_second_copy' && node.config.deliveryMode === 'cloud-template') {
      check('pixTemplateInstance', node.config.pixTemplateInstance, instances, 'instance', 'a instância PIX');
      check('boletoTemplateInstance', node.config.boletoTemplateInstance, instances, 'instance', 'a instância de boleto');
    }
    if (node.type === 'logic.subflow' || node.type === 'tool.subflow') {
      check('workflowId', node.config.workflowId, workflows, 'workflow', 'o fluxo publicado');
    }
  }

  return { valid: issues.length === 0, issues };
}

export async function validateNexusWorkflowDialogyBindings(input: {
  workspaceId: string;
  definition: WorkflowDefinition;
  database?: Queryable;
}) {
  const resources = await loadNexusDialogyResources(input.workspaceId, input.database || db);
  return validateNexusWorkflowDialogyBindingsAgainstResources(input.definition, resources);
}

export async function loadNexusDialogyResources(
  workspaceId: string,
  database: Queryable = db,
): Promise<NexusDialogyResources> {
  // Keep these queries sequential: callers may pass a transaction-bound
  // PoolClient, which cannot safely execute concurrent queries.
  const teams = await database.query(
      `SELECT id::text AS id, name
       FROM public.teams
       WHERE workspace_id = $1
       ORDER BY name`,
      [workspaceId],
    );
  const tags = await database.query(
      `SELECT id::text AS id, label, COALESCE(is_close_reason, false) AS is_close_reason
       FROM public.tags
       WHERE workspace_id = $1
       ORDER BY is_close_reason DESC, label`,
      [workspaceId],
    );
  const members = await database.query(
      `SELECT DISTINCT u.id::text AS id, u.full_name, u.email
       FROM public.users u
       INNER JOIN public.user_workspace_roles uwr
         ON uwr.user_id = u.id AND uwr.workspace_id = $1
       ORDER BY u.full_name, u.email`,
      [workspaceId],
    );
  const systemAgents = await database.query(
      `SELECT agent.id::text AS id,
              agent.name,
              agent.type,
              agent.autopilot_config_id::text AS autopilot_config_id,
              autopilot.is_active AS autopilot_is_active
       FROM public.system_agents agent
       LEFT JOIN public.autopilot_configs autopilot
         ON autopilot.id = agent.autopilot_config_id
        AND autopilot.workspace_id = agent.workspace_id
       WHERE agent.workspace_id = $1
         AND agent.is_active IS NOT FALSE
       ORDER BY agent.name`,
      [workspaceId],
    );
  const instances = await database.query(
      `SELECT instance_name, type
       FROM public.evolution_api_instances
       WHERE workspace_id = $1
       ORDER BY instance_name`,
      [workspaceId],
    );
  const workflows = await database.query(
    `SELECT nw.id::text AS id, nw.name, nw.published_revision
     FROM public.nexus_workflows nw
     INNER JOIN public.workflow_definitions wd
       ON wd.workflow_id = nw.published_workflow_id
      AND wd.workflow_version = nw.published_workflow_version
     WHERE nw.workspace_id = $1
       AND nw.status = 'published'
       AND wd.definition @> '{"nodes":[{"type":"trigger.manual"}]}'::jsonb
     ORDER BY nw.name`,
    [workspaceId],
  );

  const systemAgentOptions = systemAgents.rows.map((row: Record<string, unknown>) => {
    const type = String(row.type || 'default');
    const hasLinkedAi = Boolean(row.autopilot_config_id);
    const linkedAiActive = row.autopilot_is_active === true;
    const description = type === 'intelligent_attendant'
      ? `Atendente Inteligente · ${linkedAiActive ? 'IA ativa' : hasLinkedAi ? 'IA pausada' : 'sem IA vinculada'}`
      : type === 'marketing' ? 'Marketing' : 'Padrão';
    return {
      id: String(row.id),
      label: String(row.name),
      description,
      type,
      hasLinkedAi,
      linkedAiActive,
    };
  });

  return {
    teams: teams.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      label: String(row.name),
    })),
    tags: tags.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      label: String(row.label),
      isCloseReason: row.is_close_reason === true,
    })),
    members: members.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      label: String(row.full_name || row.email || row.id),
      description: row.email ? String(row.email) : undefined,
    })),
    systemAgents: systemAgentOptions,
    intelligentAgents: systemAgentOptions.filter((agent) => (
      agent.type === 'intelligent_attendant' && agent.linkedAiActive === true
    )),
    instances: instances.rows.map((row: Record<string, unknown>) => ({
      id: String(row.instance_name),
      label: String(row.instance_name),
      description: row.type ? String(row.type) : undefined,
    })),
    workflows: workflows.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      label: String(row.name),
      description: `Publicado · v${Number(row.published_revision || 0)}`,
    })),
  };
}
