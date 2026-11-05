import 'server-only';

import { randomUUID } from 'node:crypto';
import type { NodeExecutionResult, NodeRuntimeInput, NodeHandler } from '@/services/workflow-runtime/types';
import type { AgentToolAction } from '@/services/agent-tools/types';
import { getAutopilotConfigService } from '@/services/autopilot/runtime/config-service';
import { assertAutopilotSourceMessageCurrent } from '@/services/autopilot/runtime/stale-source-guard';
import { db } from '@/lib/db';
import { isRecord } from '@/services/workflow-runtime/utils';
import { loadStudioRelease } from './repository';
import { studioSessionStore, stopStudioSession } from './session-store';
import { runStudioConversation } from './runtime';
import { mapStudioFlowInputs, validateStudioFlowBindings } from './flow-inputs';
import { loadStudioConversationHistory } from './history';
import { loadStudioContactCrm } from './contact-crm';

export async function executePublishedStudioNode(input: NodeRuntimeInput, effects: {
  send: (response: string) => Promise<{ success?: boolean; error?: unknown }>;
  native: (action: AgentToolAction, confirmed: boolean) => Promise<void>;
}): Promise<NodeExecutionResult> {
  try {
    const workspaceId = input.workflow.workspaceId;
    const chatId = input.execution.conversationId;
    if (!workspaceId || !chatId || input.workflow.status !== 'published') throw new Error('Use este agente em um fluxo publicado com atendimento ativo.');
    const agentId = String(input.node.config.agentId || '');
    const releaseId = String(input.node.config.releaseId || '');
    if (!agentId || !releaseId) throw new Error('Selecione um agente e uma versão publicada.');
    const release = await loadStudioRelease(workspaceId, agentId, releaseId);
    if (!release) throw new Error('Versão indisponível.');
    const bindings = validateStudioFlowBindings(release.agentSnapshot, input.node.config.inputMappings, input.node.config.outputKeys);
    const { config } = await getAutopilotConfigService(workspaceId, agentId);
    if (!config || config.id !== agentId || !config.is_active) throw new Error('O agente está pausado ou indisponível.');
    const contactResult = await db.query(`SELECT ct.* FROM contacts ct JOIN chats c ON c.contact_id = ct.id AND c.workspace_id = ct.workspace_id WHERE c.workspace_id = $1 AND c.id = $2`, [workspaceId, chatId]);
    if (!contactResult.rows[0]) throw new Error('Contato da conversa indisponível.');
    const resumed = isRecord(input.execution.context.__resumeInput) ? input.execution.context.__resumeInput : {};
    const messageId = String(resumed.sourceMessageId || input.execution.context.sourceMessageId || input.input.sourceMessageId || '');
    const message = String(resumed.message || resumed.text || resumed.value || input.input.message || input.input.text || input.execution.input.message || '');
    if (!messageId || !message) throw new Error('O bloco precisa de uma mensagem do cliente identificada.');
    const store = await studioSessionStore({ workspaceId, chatId, agentId, contextId: `${input.execution.executionId}:${input.node.id}` });
    if (store.state && store.state.releaseId !== releaseId) throw new Error('O atendimento começou com outra versão. Reinicie-o de forma controlada.');
    if (store.state?.status === 'cancelled') throw new Error('Esta invocação do agente foi cancelada.');
    const result = await runStudioConversation({ release, config, chatId, messageId, message,
      chatHistory: await loadStudioConversationHistory(workspaceId, chatId, messageId),
      signal: input.signal,
      state: store.state, contact: { ...contactResult.rows[0], custom_fields: await loadStudioContactCrm(workspaceId, chatId) }, flowInput: mapStudioFlowInputs(release.agentSnapshot, input.node.config.inputMappings,
        { variables: input.execution.variables, current: input.input, input: input.execution.input }),
      checkpoint: store.checkpoint, assertCurrent: () => assertAutopilotSourceMessageCurrent({ chatId, sourceMessageId: messageId }),
      runNative: (action, operation) => effects.native(action, operation.confirmed),
    });
    if (result.response) { input.signal?.throwIfAborted(); await assertAutopilotSourceMessageCurrent({ chatId, sourceMessageId: messageId }); const delivered = await effects.send(result.response); if (delivered.success === false) throw new Error('Não foi possível entregar a resposta do agente.'); }
    const requestedKeys = bindings.outputKeys;
    const output = { response: result.response, agentId, releaseId, version: release.version, status: result.state.status,
      data: Object.fromEntries(requestedKeys.filter((key) => Object.hasOwn(result.state.values, key)).map((key) => [key, result.state.values[key]])) };
    if (result.state.status === 'waiting_input' || result.state.status === 'running') {
      const now = Date.now();
      return { status: 'waiting', waitingReason: 'time', resumeToken: randomUUID(), output: { ...output,
        resumeMode: 'reexecute', expirationOutput: 'error', waitingSince: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString() } };
    }
    if (result.state.status === 'failed' || result.state.status === 'cancelled') return { status: 'error', selectedOutput: 'error', output, error: { code: 'STUDIO_PROCEDURE_FAILED', message: 'O agente não conseguiu concluir o procedimento.', retryable: false } };
    return { status: 'completed', selectedOutput: result.state.status === 'transferred' ? 'handoff' : 'completed', output };
  } catch (error) { return { status: 'error', selectedOutput: 'error', error: { code: 'STUDIO_EXECUTION_FAILED', message: error instanceof Error ? error.message : 'Falha no agente publicado.', retryable: false } }; }
}

export const stopPublishedStudioNode: NonNullable<NodeHandler['stop']> = async ({ workflow, execution, node, reason }) => {
  if (!workflow.workspaceId || !execution.conversationId || node.type !== 'ai.published_agent') return;
  await stopStudioSession({ workspaceId: workflow.workspaceId, chatId: execution.conversationId, agentId: String(node.config.agentId), contextId: `${execution.executionId}:${node.id}` }, reason);
};
