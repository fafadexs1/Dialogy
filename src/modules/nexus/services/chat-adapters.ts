import {
  sendAgentButtonsAction,
  sendAgentListAction,
  sendAgentTemplateAction,
  sendAutomatedMediaAction,
  sendAutomatedMessageAction,
} from '@/actions/messages';
import { closeChatAction, transferChatAction, transferChatToIntelligentAgentAction } from '@/actions/chats';
import { db } from '@/lib/db';
import { createTrustedActorContext } from '@/lib/security/trusted-server-context';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { dispatchPublishedNexusMessage } from './message-dispatcher';
import type { NexusRuntimeAdapters } from './runtime';
import { isValidWorkflowGoalCompletionEvidence } from '@/services/workflow-runtime/goal-completion';
import type { NodeRuntimeInput, WorkflowDefinition } from '@/services/workflow-runtime';
import { isRecord } from '@/services/workflow-runtime/utils';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';

type NexusSenderSystemAgent = {
  id: string;
  name: string;
  type: string;
  autopilotConfigId: string | null;
  autopilotIsActive: boolean | null;
};

function configuredSenderSystemAgentId(workflow: WorkflowDefinition) {
  return String(workflow.metadata?.senderSystemAgentId || '').trim();
}

export async function resolveNexusSenderSystemAgent(input: {
  workspaceId: string;
  workflow: WorkflowDefinition;
  database?: Pick<typeof db, 'query'>;
}): Promise<NexusSenderSystemAgent> {
  const senderSystemAgentId = configuredSenderSystemAgentId(input.workflow);
  if (!senderSystemAgentId) {
    throw new Error(`O fluxo "${input.workflow.name}" não possui um agente remetente configurado.`);
  }
  const result = await (input.database || db).query(
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
       AND agent.id = $2
       AND agent.is_active IS NOT FALSE
     LIMIT 1`,
    [input.workspaceId, senderSystemAgentId],
  );
  if (!result.rows[0]) {
    throw new Error(`O agente remetente configurado no fluxo "${input.workflow.name}" não pertence a este workspace ou não está ativo.`);
  }
  return {
    id: String(result.rows[0].id),
    name: String(result.rows[0].name || 'Agente do sistema'),
    type: String(result.rows[0].type || 'default'),
    autopilotConfigId: result.rows[0].autopilot_config_id ? String(result.rows[0].autopilot_config_id) : null,
    autopilotIsActive: typeof result.rows[0].autopilot_is_active === 'boolean'
      ? result.rows[0].autopilot_is_active
      : null,
  };
}

function mimeType(type: string, url: string, configured?: string) {
  if (configured?.trim()) return configured.trim();
  const extension = (() => { try { return new URL(url).pathname.split('.').pop()?.toLowerCase(); } catch { return ''; } })();
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav', m4a: 'audio/mp4',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
  };
  if (extension && byExtension[extension]) return byExtension[extension];
  if (type === 'image') return 'image/jpeg';
  if (type === 'video') return 'video/mp4';
  if (type === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function nexusEventCausation(runtimeInput: NodeRuntimeInput) {
  const rawChain = runtimeInput.execution.context.nexusInternalEventChain;
  return {
    eventChain: Array.isArray(rawChain) ? rawChain.map(String) : undefined,
    causedByExecutionId: runtimeInput.execution.executionId,
    causedByNodeId: runtimeInput.node.id,
  };
}

function nexusDeliveryMetadata(runtimeInput: NodeRuntimeInput) {
  return {
    skipUserSignature: true,
    deliveryGuarantee: 'ordered' as const,
    nexusExecutionId: runtimeInput.execution.executionId,
    nexusNodeId: runtimeInput.node.id,
    nexusDeliveryId: [
      runtimeInput.execution.executionId,
      runtimeInput.node.id,
      runtimeInput.execution.totalSteps,
    ].join(':'),
  };
}

function interactionOptions(runtimeInput: NodeRuntimeInput) {
  const configured = Array.isArray(runtimeInput.node.config.options)
    ? runtimeInput.node.config.options.filter(isRecord)
    : [];
  return configured.map((option, index) => ({
    id: String(option.id || option.value || `option_${index + 1}`).trim().slice(0, 200),
    title: String(option.value || option.label || `Opcao ${index + 1}`).trim().slice(0, 24),
    description: String(option.label || '').trim().slice(0, 72),
  })).filter((option) => option.title);
}

function interactionDescription(runtimeInput: NodeRuntimeInput) {
  const retry = isRecord(runtimeInput.execution.context.__interactionRetry)
    && runtimeInput.execution.context.__interactionRetry.nodeId === runtimeInput.node.id;
  if (retry) {
    return String(
      runtimeInput.node.config.invalidOptionMessage
      || 'Opcao invalida. Escolha uma das opcoes abaixo.',
    ).trim();
  }
  return String(runtimeInput.node.config.description || 'Selecione uma opcao abaixo.').trim();
}

async function resolveWhatsappTarget(input: { workspaceId: string; chatId: string; instanceName?: string }) {
  const target = await db.query(
    `SELECT ct.phone_number_jid,
            COALESCE(
              $3::text,
              (SELECT m.instance_name FROM public.messages m
               WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL
               ORDER BY m.created_at DESC LIMIT 1)
            ) AS instance_name
     FROM public.chats c
     JOIN public.contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1 AND c.workspace_id = $2
     LIMIT 1`,
    [input.chatId, input.workspaceId, input.instanceName || null],
  );
  return {
    number: String(target.rows[0]?.phone_number_jid || '').trim(),
    instanceName: String(target.rows[0]?.instance_name || '').trim(),
  };
}

export async function createNexusChatAdapters(input: {
  workspaceId: string;
  chatId: string;
  instanceName?: string;
}): Promise<NexusRuntimeAdapters> {
  const senderCache = new Map<string, Promise<NexusSenderSystemAgent>>();
  const senderFor = (runtimeInput: NodeRuntimeInput) => {
    const senderSystemAgentId = configuredSenderSystemAgentId(runtimeInput.workflow);
    const cacheKey = senderSystemAgentId || `missing:${runtimeInput.workflow.id}@${runtimeInput.workflow.version}`;
    let sender = senderCache.get(cacheKey);
    if (!sender) {
      sender = resolveNexusSenderSystemAgent({ workspaceId: input.workspaceId, workflow: runtimeInput.workflow });
      senderCache.set(cacheKey, sender);
    }
    return sender;
  };
  const trustedActorFor = async (runtimeInput: NodeRuntimeInput) => {
    const sender = await senderFor(runtimeInput);
    return createTrustedActorContext({
      user: { id: sender.id, name: sender.name },
      isSystemAgent: true,
    });
  };
  const sendNativeList = async (
    runtimeInput: NodeRuntimeInput,
    list: {
      title: string;
      description: string;
      buttonText?: string;
      footerText?: string;
      sectionTitle?: string;
      options: Array<{ id: string; title: string; description?: string }>;
    },
  ) => {
    const sender = await senderFor(runtimeInput);
    return sendAgentListAction({
      agentId: sender.id,
      workspaceId: input.workspaceId,
      instanceName: input.instanceName || '',
      chatId: input.chatId,
      list: {
        title: list.title.trim().slice(0, 60),
        description: (list.description.trim() || 'Selecione uma opcao abaixo.').slice(0, 1_024),
        buttonText: String(list.buttonText || 'Ver opcoes').trim().slice(0, 20),
        // A Evolution exige o campo mesmo quando o rodape esta vazio.
        footerText: String(list.footerText || '').trim().slice(0, 60),
        sections: [{
          title: String(list.sectionTitle || 'Opcoes').trim().slice(0, 24) || '\u200B',
          rows: list.options.slice(0, 10).map((option) => ({
            title: option.title.trim().slice(0, 24),
            description: String(option.description || '').trim().slice(0, 72) || '\u200B',
            rowId: option.id.trim().slice(0, 200),
          })),
        }],
      },
      metadata: nexusDeliveryMetadata(runtimeInput),
    });
  };
  return {
    executeLinkedAgent: async (runtimeInput) => {
      const sender = await senderFor(runtimeInput);
      if (sender.type !== 'intelligent_attendant') {
        return { handled: false, reason: 'selected_system_agent_has_no_linked_ai' };
      }
      if (!sender.autopilotConfigId) {
        return {
          handled: true,
          success: false,
          error: `O Atendente Inteligente "${sender.name}" não possui uma IA vinculada.`,
        };
      }
      if (sender.autopilotIsActive !== true) {
        return {
          handled: true,
          success: false,
          error: `A IA vinculada ao agente "${sender.name}" está pausada ou indisponível.`,
        };
      }
      const startedAt = Date.now();
      const result = await transferChatToIntelligentAgentAction(
        {
          chatId: input.chatId,
          systemAgentId: sender.id,
          nexusEventContext: nexusEventCausation(runtimeInput),
        },
        await trustedActorFor(runtimeInput),
      );
      return {
        ...result,
        handled: true,
        delegated: result.success === true,
        systemAgentId: sender.id,
        systemAgentName: sender.name,
        autopilotConfigId: sender.autopilotConfigId,
        durationMs: Date.now() - startedAt,
      };
    },
    sendResponse: async (message, runtimeInput) => {
      const sender = await senderFor(runtimeInput);
      const metadata = nexusDeliveryMetadata(runtimeInput);
      if (runtimeInput.node.type === 'interaction.options') {
        const mode = String(runtimeInput.node.config.deliveryMode || 'text');
        const options = interactionOptions(runtimeInput);
        const title = String(runtimeInput.node.config.prompt || 'Escolha uma opcao:').trim();
        const description = interactionDescription(runtimeInput);
        const footer = String(runtimeInput.node.config.footer || '').trim();
        if (mode === 'list' && options.length > 0 && input.instanceName) {
          const delivered = await sendNativeList(runtimeInput, {
            title,
            description,
            buttonText: String(runtimeInput.node.config.buttonText || 'Ver opcoes'),
            footerText: footer,
            sectionTitle: String(runtimeInput.node.config.sectionTitle || 'Opcoes'),
            options: options.map((option) => ({
              id: option.id,
              title: option.title,
              description: option.description && option.description !== option.title
                ? option.description
                : undefined,
            })),
          });
          if (delivered.success || delivered.providerAccepted) return delivered;
          return sendAutomatedMessageAction(
            input.chatId,
            message,
            sender.id,
            true,
            input.instanceName,
            {
              ...metadata,
              nexusInteractiveFallback: true,
              nexusInteractiveError: delivered.error || 'Lista recusada pelo provedor.',
            },
          );
        }
        if (mode === 'buttons' && options.length > 0 && options.length <= 3 && input.instanceName) {
          const delivered = await sendAgentButtonsAction({
            agentId: sender.id,
            workspaceId: input.workspaceId,
            instanceName: input.instanceName,
            chatId: input.chatId,
            buttons: {
              title,
              description,
              footer: footer || undefined,
              buttons: options.map((option) => ({
                type: 'reply' as const,
                displayText: option.title,
                id: option.id,
              })),
            },
            metadata,
          });
          if (delivered.success || delivered.providerAccepted) return delivered;
        }
      }
      return sendAutomatedMessageAction(
        input.chatId,
        message,
        sender.id,
        true,
        input.instanceName,
        metadata,
      );
    },
    sendOptions: async ({ title, choices, invalid }, runtimeInput) => {
      const sender = await senderFor(runtimeInput);
      const fallback = [
        invalid ? 'Opcao invalida. Escolha uma das opcoes apresentadas.' : '',
        title,
        choices.map((choice, index) => (
          `${index + 1}. ${choice.label}${choice.description ? ` — ${choice.description}` : ''}`
        )).join('\n'),
      ].filter(Boolean).join('\n\n');
      if (input.instanceName && choices.length > 0) {
        const delivered = await sendNativeList(runtimeInput, {
          title,
          description: invalid
            ? 'Opcao invalida. Escolha uma das opcoes abaixo.'
            : 'Selecione uma opcao abaixo.',
          options: choices.map((choice) => ({
            id: choice.id,
            title: choice.label,
            description: choice.description || choice.label,
          })),
        });
        if (delivered.success || delivered.providerAccepted) return delivered;
        return sendAutomatedMessageAction(
          input.chatId,
          fallback,
          sender.id,
          true,
          input.instanceName,
          {
            ...nexusDeliveryMetadata(runtimeInput),
            nexusInteractiveFallback: true,
            nexusInteractiveError: delivered.error || 'Lista dinamica recusada pelo provedor.',
          },
        );
      }
      return sendAutomatedMessageAction(
        input.chatId,
        fallback,
        sender.id,
        true,
        input.instanceName,
        nexusDeliveryMetadata(runtimeInput),
      );
    },
    sendMedia: async (media, runtimeInput) => {
      const sender = await senderFor(runtimeInput);
      const type = ['image', 'video', 'audio', 'document'].includes(media.type) ? media.type : 'document';
      const target = await resolveSafeAutopilotWebhookTarget(media.url);
      return sendAutomatedMediaAction(
        input.chatId,
        media.caption || '',
        [{
          base64: target.url.toString(),
          mimetype: mimeType(type, target.url.toString(), media.mimeType),
          filename: media.fileName || `nexus-${runtimeInput.node.id}`,
          mediatype: type as 'image' | 'video' | 'audio' | 'document',
        }],
        sender.id,
        input.instanceName,
        {
          skipUserSignature: true,
          nexusExecutionId: runtimeInput.execution.executionId,
          nexusNodeId: runtimeInput.node.id,
        } as never,
      );
    },
    sendTyping: async (durationMs) => {
      const target = await resolveWhatsappTarget(input);
      if (!target.number || !target.instanceName) return { success: true, supported: false };
      const apiConfig = await getEvolutionApiConfig(target.instanceName, { workspaceId: input.workspaceId });
      if (!apiConfig) return { success: false, error: `A instância Evolution ${target.instanceName} não está configurada.` };
      const response = await fetchEvolutionAPI(
        `/chat/sendPresence/${encodeURIComponent(target.instanceName)}`,
        apiConfig,
        {
          method: 'POST',
          body: JSON.stringify({
            number: target.number.replace(/@.*$/, '').replace(/\D/g, ''),
            presence: 'composing',
            delay: Math.max(250, Math.min(60_000, Math.round(durationMs))),
          }),
        },
      );
      return { success: true, supported: true, response };
    },
    handoff: async (runtimeInput) => {
      const trustedActor = await trustedActorFor(runtimeInput);
      const destinationType = String(runtimeInput.node.config.destinationType || 'human');
      if (destinationType === 'intelligent_agent') {
        const systemAgentId = String(runtimeInput.node.config.systemAgentId || '').trim();
        if (!systemAgentId) return { success: false, error: 'Atendente Inteligente não configurado.' };
        const result = await transferChatToIntelligentAgentAction(
          { chatId: input.chatId, systemAgentId, nexusEventContext: nexusEventCausation(runtimeInput) },
          trustedActor,
        );
        return { ...result, destinationType, systemAgentId };
      }
      const teamId = String(runtimeInput.node.config.teamId || '').trim();
      const agentId = String(runtimeInput.node.config.agentId || '').trim();
      if (!teamId && !agentId) return { success: false, error: 'Equipe ou atendente humano não configurado.' };
      const result = await transferChatAction(
        {
          chatId: input.chatId,
          ...(teamId ? { teamId } : {}),
          ...(agentId ? { agentId } : {}),
          nexusEventContext: nexusEventCausation(runtimeInput),
        },
        trustedActor,
      );
      return { ...result, destinationType, teamId: teamId || null, agentId: agentId || null };
    },
    closeConversation: async (runtimeInput) => {
      const trustedActor = await trustedActorFor(runtimeInput);
      const authorizationMode = String(runtimeInput.node.config.closePolicy || 'goal_evidence');
      const goalEvidenceValid = isValidWorkflowGoalCompletionEvidence(runtimeInput.input.goalCompletion, runtimeInput);
      const deterministicRouteAuthorized = authorizationMode === 'deterministic_route'
        && runtimeInput.workflow.status === 'published';
      if (!goalEvidenceValid && !deterministicRouteAuthorized) {
        return { success: false, error: 'O encerramento exige prova de objetivo concluído ou uma rota determinística publicada.' };
      }
      const result = await closeChatAction(
        input.chatId,
        String(runtimeInput.node.config.reasonTagId || '').trim() || null,
        String(runtimeInput.node.config.notes || runtimeInput.node.config.reason || 'Encerramento pelo Nexus.').slice(0, 10_000),
        runtimeInput.node.config.sendCloseMessage === true,
        {
          event: 'nexus_close',
          nexusExecutionId: runtimeInput.execution.executionId,
          nexusNodeId: runtimeInput.node.id,
          nexusClosePolicy: authorizationMode,
          nexusEventChain: nexusEventCausation(runtimeInput).eventChain,
          nexusCausedByExecutionId: runtimeInput.execution.executionId,
          nexusCausedByNodeId: runtimeInput.node.id,
        },
        trustedActor,
      );
      return { ...result, closed: result.success === true, authorizationMode };
    },
    sendTemplate: async (template, runtimeInput) => {
      const sender = await senderFor(runtimeInput);
      const target = await resolveWhatsappTarget({ ...input, instanceName: template.instanceName || input.instanceName });
      const { number, instanceName } = target;
      if (!number || !instanceName) return { success: false, error: 'Telefone ou instância do atendimento não encontrado.' };
      return sendAgentTemplateAction({
        agentId: sender.id,
        workspaceId: input.workspaceId,
        numberid: number,
        instanceName,
        name: template.name,
        language: template.language,
        components: template.components,
        renderedContent: template.renderedContent,
        metadata: {
          skipUserSignature: true,
          nexusExecutionId: runtimeInput.execution.executionId,
          nexusNodeId: runtimeInput.node.id,
        } as never,
      });
    },
  };
}

export async function dispatchNexusChatMessage(input: {
  workspaceId: string;
  chatId: string;
  message: string;
  sourceMessageId: string;
  instanceName?: string;
  platform: string;
  messageType?: string;
}) {
  return dispatchPublishedNexusMessage({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    message: input.message,
    sourceMessageId: input.sourceMessageId,
    instanceName: input.instanceName,
    metadata: { platform: input.platform, messageType: input.messageType || 'text' },
    adapters: () => createNexusChatAdapters({
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      instanceName: input.instanceName,
    }),
  });
}
