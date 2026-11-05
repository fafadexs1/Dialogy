import { db } from '@/lib/db';
import { WorkflowDefinitionSchema, hashValue, type WorkflowDefinition } from '@/services/workflow-runtime';

import {
  cancelPublishedNexusWorkflowExecution,
  loadPublishedNexusWorkflow,
  resolveNexusInteractionOption,
  resumePublishedNexusWorkflow,
  startPublishedNexusWorkflow,
  type NexusRuntimeAdapters,
} from './runtime';
import {
  findBestNexusKeywordMatch,
  normalizeNexusKeywordText,
  parseNexusTriggerKeywords,
} from './trigger-matching';

function parseJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

const normalizedText = (value: string) => normalizeNexusKeywordText(value);

function configuredList(value: unknown) {
  return (Array.isArray(value) ? value : String(value || '').split(/[\n,]/))
    .map(String)
    .map(normalizedText)
    .filter(Boolean);
}

export type NexusMessageTriggerContext = {
  platform?: string;
  instanceName?: string;
  // Loaded from this workspace's instance registry, never from message metadata.
  instancePlatforms?: Record<string, string>;
  messageType?: string;
  chatStatus?: string;
  agentId?: string | null;
  assignedSystemAgentId?: string | null;
};

export type NexusMessageTriggerMatch = {
  catchAll: boolean;
  score: number;
  matchedWeight: number;
  keyword?: string;
  threshold?: number;
  outputPortId: string;
};

export function nexusChatCanReceiveAutomation(status: unknown) {
  return normalizedText(String(status || '')) === 'gerais';
}

function configuredRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function keywordOutput(config: Record<string, unknown>, keyword: string) {
  const outputs = configuredRecord(config.keywordOutputPorts);
  if (typeof outputs[keyword] === 'string' && String(outputs[keyword]).trim()) return String(outputs[keyword]);
  const normalizedKeyword = normalizeNexusKeywordText(keyword);
  const equivalent = Object.entries(outputs).find(([configured]) => (
    normalizeNexusKeywordText(configured) === normalizedKeyword
  ));
  return equivalent ? String(equivalent[1]) : String(config.defaultOutput || 'message');
}

export function nexusMessageTriggerMatch(
  config: Record<string, unknown>,
  message: string,
  context: NexusMessageTriggerContext = {},
): NexusMessageTriggerMatch | null {
  const platforms = configuredList(config.platforms);
  const instances = configuredList(config.instanceNames);
  const messageTypes = configuredList(config.messageTypes);
  const platform = normalizedText(context.platform || '');
  if (platforms.length > 0 && !platforms.includes(platform)) return null;
  // Meta and webchat do not use the instance selector. WhatsApp and Telegram
  // restrictions apply independently; an unknown/deleted instance stays restrictive.
  const instancePlatforms = Object.fromEntries(Object.entries(context.instancePlatforms || {})
    .map(([name, channel]) => [normalizedText(name), normalizedText(channel)]));
  const channelInstances = ['instagram', 'messenger', 'webchat'].includes(platform)
    ? []
    : ['whatsapp', 'telegram'].includes(platform)
      ? instances.filter(name => !instancePlatforms[name] || instancePlatforms[name] === platform)
      : instances;
  if (channelInstances.length > 0 && !channelInstances.includes(normalizedText(context.instanceName || ''))) return null;
  if (messageTypes.length > 0 && !messageTypes.includes(normalizedText(context.messageType || 'text'))) return null;
  if (
    String(config.startPolicy || 'all') === 'unassigned_only'
    && (
      context.agentId
      || context.assignedSystemAgentId
      || (Boolean(context.chatStatus) && !nexusChatCanReceiveAutomation(context.chatStatus))
    )
  ) return null;

  const mode = String(config.matchMode || 'all');
  const defaultOutput = String(config.defaultOutput || 'message');
  if (mode === 'all') return { catchAll: true, score: 0, matchedWeight: 0, outputPortId: defaultOutput };
  const keywords = parseNexusTriggerKeywords(config.keywords);
  const thresholds = configuredRecord(config.keywordThresholds);
  if (mode === 'any_keyword') {
    const match = findBestNexusKeywordMatch(keywords, thresholds, message);
    if (match) return {
      catchAll: false,
      score: match.score,
      matchedWeight: match.matchedWeight,
      keyword: match.keyword,
      threshold: match.threshold,
      outputPortId: keywordOutput(config, match.keyword),
    };
    return config.fallbackToAnyMessage === true
      ? { catchAll: true, score: 0, matchedWeight: 0, outputPortId: defaultOutput }
      : null;
  }
  if (mode === 'all_keywords') {
    const matches = keywords.map((keyword) => findBestNexusKeywordMatch([keyword], thresholds, message));
    if (matches.length === 0 || matches.some((match) => !match)) return null;
    return {
      catchAll: false,
      score: Math.min(...matches.map((match) => match!.score)),
      matchedWeight: matches.reduce((sum, match) => sum + match!.matchedWeight, 0),
      outputPortId: defaultOutput,
    };
  }
  if (mode === 'regex') {
    try {
      const matched = new RegExp(String(config.pattern || ''), config.caseSensitive === true ? '' : 'i').test(message);
      return matched ? { catchAll: false, score: 100, matchedWeight: 1, outputPortId: defaultOutput } : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function nexusMessageTriggerMatches(
  config: Record<string, unknown>,
  message: string,
  context: NexusMessageTriggerContext = {},
) {
  return nexusMessageTriggerMatch(config, message, context) !== null;
}

export function nexusMessageTriggerIsCatchAll(config: Record<string, unknown>) {
  return String(config.matchMode || 'all') === 'all' || config.fallbackToAnyMessage === true;
}

export function nexusWaitingExecutionIsSuperseded(input: {
  workflowVersion: unknown;
  publishedWorkflowVersion: unknown;
  automationManaged?: boolean;
}) {
  if (input.automationManaged) return false;
  const workflowVersion = String(input.workflowVersion || '').trim();
  const publishedWorkflowVersion = String(input.publishedWorkflowVersion || '').trim();
  return Boolean(workflowVersion && publishedWorkflowVersion && workflowVersion !== publishedWorkflowVersion);
}

export function rankNexusMessageTriggerCandidates<T extends {
  match: NexusMessageTriggerMatch | null;
  priority: number;
}>(candidates: T[]) {
  const matched = candidates.filter((candidate): candidate is T & { match: NexusMessageTriggerMatch } => Boolean(candidate.match));
  const hasSpecificMatch = matched.some((candidate) => candidate.match.catchAll === false);
  return matched
    .filter((candidate) => !hasSpecificMatch || candidate.match.catchAll === false)
    .sort((left, right) => (
      right.match.score - left.match.score
      || right.match.matchedWeight - left.match.matchedWeight
      || right.priority - left.priority
    ));
}

function messageTrigger(definition: WorkflowDefinition) {
  return definition.nodes.find((node) => node.type === 'trigger.received_message');
}

export async function dispatchPublishedNexusMessage(input: {
  workspaceId: string;
  chatId: string;
  message: string;
  sourceMessageId: string;
  instanceName?: string;
  metadata?: Record<string, unknown>;
  adapters: NexusRuntimeAdapters | (() => Promise<NexusRuntimeAdapters>);
}) {
  let resolvedAdapters: NexusRuntimeAdapters | null = typeof input.adapters === 'function' ? null : input.adapters;
  const adapters = async () => {
    resolvedAdapters ||= await (input.adapters as () => Promise<NexusRuntimeAdapters>)();
    return resolvedAdapters;
  };
  const chatResult = await db.query(
    `SELECT chat.status,
            chat.agent_id,
            chat.assigned_system_agent_id,
            chat.contact_id,
            chat.source,
            chat.instance_type,
            contact.name AS contact_name,
            contact.phone,
            contact.phone_number_jid
     FROM chats AS chat
     JOIN contacts AS contact ON contact.id = chat.contact_id
     WHERE chat.id = $1
       AND chat.workspace_id = $2
     LIMIT 1`,
    [input.chatId, input.workspaceId],
  );
  const chat = chatResult.rows[0] as Record<string, unknown> | undefined;
  if (!chat) return { handled: false, resumed: false, executions: [] };

  // Conversas na fila geral podem ser automatizadas. Assim que um humano ou
  // agente assume o atendimento, nenhuma execucao Nexus antiga pode acordar
  // com a proxima mensagem do cliente.
  if (!nexusChatCanReceiveAutomation(chat.status)) {
    const staleExecutions = await db.query(
      `SELECT id
       FROM public.workflow_executions
       WHERE workspace_id = $1
         AND conversation_id = $2
         AND status = 'waiting'
         AND workflow_id LIKE 'nexus:%'`,
      [input.workspaceId, input.chatId],
    );
    await Promise.allSettled((staleExecutions.rows as Array<{ id: string }>).map((row) => (
      cancelPublishedNexusWorkflowExecution({
        workspaceId: input.workspaceId,
        executionId: String(row.id),
        reason: 'Conversa assumida por atendimento; automacao Nexus interrompida.',
      })
    )));
    return { handled: false, resumed: false, executions: [], suppressed: 'chat_in_service' };
  }
  const waitingResult = await db.query(
    `SELECT execution.id AS execution_id,
            execution.current_node_id,
            execution.resume_token,
            execution.context,
            execution.waiting_reason,
            execution.workflow_version,
            nexus.published_workflow_version,
            definition.definition
     FROM public.workflow_executions AS execution
     JOIN public.workflow_definitions AS definition
       ON definition.workflow_id = execution.workflow_id
      AND definition.workflow_version = execution.workflow_version
     LEFT JOIN public.nexus_workflows AS nexus
       ON nexus.workspace_id = execution.workspace_id
      AND nexus.published_workflow_id = execution.workflow_id
     WHERE execution.workspace_id = $1
       AND execution.conversation_id = $2
       AND execution.status = 'waiting'
       AND execution.workflow_id LIKE 'nexus:%'
       AND execution.resume_token IS NOT NULL
     ORDER BY execution.updated_at DESC
     LIMIT 1`,
    [input.workspaceId, input.chatId],
  );
  let waitingRow = waitingResult.rows[0] as Record<string, unknown> | undefined;
  const waitingContext = parseJson(waitingRow?.context);
  const automationManaged = Boolean(waitingContext && typeof waitingContext === 'object' && 'automationManaged' in waitingContext && waitingContext.automationManaged === true);
  if (waitingRow && nexusWaitingExecutionIsSuperseded({
    workflowVersion: waitingRow.workflow_version,
    publishedWorkflowVersion: waitingRow.published_workflow_version,
    automationManaged,
  })) {
    await cancelPublishedNexusWorkflowExecution({
      workspaceId: input.workspaceId,
      executionId: String(waitingRow.execution_id),
      reason: `Execução da versão ${String(waitingRow.workflow_version)} substituída pela versão publicada ${String(waitingRow.published_workflow_version)}.`,
    });
    waitingRow = undefined;
  }
  const resumeToken = waitingRow?.resume_token ? String(waitingRow.resume_token) : '';
  const waitingDefinition = waitingRow?.definition
    ? WorkflowDefinitionSchema.safeParse(parseJson(waitingRow.definition)).data
    : undefined;
  const waitingNode = waitingDefinition?.nodes.find((node) => node.id === String(waitingRow?.current_node_id || ''));
  if (resumeToken && automationManaged && (
    ['approval', 'subflows', 'event'].includes(String(waitingRow?.waiting_reason))
    || (waitingNode?.type === 'logic.wait' && waitingNode.config.mode !== 'message')
  )) {
    return { handled: true, resumed: false, executions: [] };
  }
  const providerSelectedOptionId = String(input.metadata?.selectedOptionId || '').trim();
  const resumeWaiting = async (selectedOptionId?: string, optionResolutionAttempted = false) => {
    const resumed = await resumePublishedNexusWorkflow({
      workspaceId: input.workspaceId,
      adapters: await adapters(),
      resume: {
        resumeToken,
        input: {
          value: input.message,
          text: input.message,
          message: input.message,
          sourceMessageId: input.sourceMessageId,
          ...(selectedOptionId ? { selectedOptionId } : {}),
          ...(optionResolutionAttempted ? { optionResolutionAttempted: true } : {}),
        },
        contextPatch: { resumedAt: new Date().toISOString(), sourceMessageId: input.sourceMessageId },
        workerId: `nexus_message_resume_${input.chatId}`,
      },
    });
    return { handled: true, resumed: true, executions: [resumed.execution] };
  };
  if (resumeToken && waitingNode?.config.legacyApiResponseAsInput === true) {
    return { handled: true, resumed: false, executions: [] };
  }
  if (resumeToken && waitingNode?.type !== 'interaction.options') {
    return resumeWaiting(providerSelectedOptionId || undefined);
  }

  const candidates = await db.query(
    `SELECT nw.id, nw.workspace_id, wd.definition,
            (SELECT COALESCE(jsonb_object_agg(instance_name,
               CASE WHEN lower(type) = 'telegram' THEN 'telegram' ELSE 'whatsapp' END), '{}'::jsonb)
             FROM public.evolution_api_instances WHERE workspace_id = $1) AS instance_platforms
     FROM public.nexus_workflows nw
     JOIN public.workflow_definitions wd
       ON wd.workflow_id = nw.published_workflow_id
      AND wd.workflow_version = nw.published_workflow_version
     WHERE nw.workspace_id = $1
       AND nw.status = 'published'
       AND wd.definition @> '{"nodes":[{"type":"trigger.received_message"}]}'::jsonb
     ORDER BY COALESCE((wd.definition #>> '{metadata,priority}')::integer, 0) DESC, nw.updated_at DESC
     LIMIT 50`,
    [input.workspaceId],
  );
  const triggerContext: NexusMessageTriggerContext = {
    platform: String(input.metadata?.platform || chat.source || ''),
    instanceName: input.instanceName || '',
    messageType: String(input.metadata?.messageType || 'text'),
    chatStatus: String(chat.status || ''),
    agentId: chat.agent_id ? String(chat.agent_id) : null,
    assignedSystemAgentId: chat.assigned_system_agent_id ? String(chat.assigned_system_agent_id) : null,
  };
  const stablePhone = String(chat.phone || chat.phone_number_jid || '').replace(/@.+$/, '');
  const executions = [];
  const matchedCandidates = (candidates.rows as Array<Record<string, unknown>>)
    .map((row) => {
      const definition = WorkflowDefinitionSchema.parse(parseJson(row.definition));
      const trigger = messageTrigger(definition);
      const match = trigger ? nexusMessageTriggerMatch(trigger.config, input.message, {
        ...triggerContext,
        instancePlatforms: configuredRecord(row.instance_platforms) as Record<string, string>,
      }) : null;
      return { row, definition, trigger, match, priority: Number(definition.metadata?.priority || 0) };
    })
    .filter((candidate) => candidate.trigger && candidate.match);
  const orderedCandidates = rankNexusMessageTriggerCandidates(matchedCandidates);
  const hasSpecificMatch = orderedCandidates.some((candidate) => candidate.match.catchAll === false);
  if (resumeToken && waitingNode?.type === 'interaction.options') {
    const selectedOptionId = providerSelectedOptionId;
    const configuredOptions = Array.isArray(waitingNode.config.options)
      ? waitingNode.config.options.filter((option): option is Record<string, unknown> => (
        Boolean(option) && typeof option === 'object' && !Array.isArray(option)
      ))
      : [];
    const exactProviderSelection = selectedOptionId
      ? configuredOptions.find((option, index) => (
        String(option.id || option.value || `option_${index + 1}`) === selectedOptionId
      ))
      : undefined;
    let optionMatch = exactProviderSelection ? { id: selectedOptionId } : null;
    try {
      optionMatch ||= await resolveNexusInteractionOption({
          workspaceId: input.workspaceId,
          node: waitingNode,
          message: input.message,
        });
    } catch (error) {
      console.warn('[NEXUS_MESSAGE_DISPATCH] Intelligent option resolution failed before trigger arbitration.', error);
    }
    if (optionMatch || !hasSpecificMatch) {
      return resumeWaiting(optionMatch?.id, true);
    }
    await cancelPublishedNexusWorkflowExecution({
      workspaceId: input.workspaceId,
      executionId: String(waitingRow?.execution_id || ''),
      reason: 'Substituída por uma frase de gatilho específica recebida durante um menu.',
    });
  }
  for (const { row, definition, trigger, match } of orderedCandidates) {
    if (!trigger || !match) continue;
    const requestedOutput = match.outputPortId;
    const defaultOutput = String(trigger.config.defaultOutput || trigger.outputPorts.find((port) => port.connectionType === 'main')?.id || 'message');
    const triggerOutput = definition.connections.some((connection) => (
      connection.sourceNodeId === trigger.id && connection.sourcePortId === requestedOutput
    )) ? requestedOutput : defaultOutput;
    const published = await loadPublishedNexusWorkflow({ nexusWorkflowId: String(row.id), workspaceId: input.workspaceId });
    if (!published) continue;
    const executionId = `nexus_message_${hashValue({ workflowId: row.id, sourceMessageId: input.sourceMessageId })}`;
    const result = await startPublishedNexusWorkflow({
      published,
      triggerType: 'trigger.received_message',
      triggerOutput,
      payload: {
        text: input.message,
        message: input.message,
        customerMessage: input.message,
        sourceMessageId: input.sourceMessageId,
        metadata: input.metadata || {},
      },
      context: {
        source: 'received_message',
        platform: triggerContext.platform || null,
        instanceName: input.instanceName || null,
        messageType: triggerContext.messageType || null,
        sourceMessageId: input.sourceMessageId,
        contactId: String(chat.contact_id),
        contactName: String(chat.contact_name || 'Cliente'),
        contactPhone: stablePhone,
      },
      variables: {
        id_conversa: input.chatId,
        id_chat: input.chatId,
        mensagem_usuario: input.message,
        id_estavel: stablePhone,
        nome_usuario: String(chat.contact_name || 'Cliente'),
      },
      sessionId: input.chatId,
      conversationId: input.chatId,
      executionId,
      workerId: `nexus_message_${input.chatId}`,
      adapters: await adapters(),
    });
    executions.push(result.execution);
    if (trigger.config.continueMatching !== true) break;
  }
  return { handled: executions.length > 0, resumed: false, executions };
}
