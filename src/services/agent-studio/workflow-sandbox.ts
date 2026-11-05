import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAutopilotConfigService } from '@/services/autopilot/runtime/config-service';
import type { Contact } from '@/lib/types';
import type { WorkflowHandlerDependencies } from '@/services/workflow-runtime/node-handlers';
import { isRecord } from '@/services/workflow-runtime/utils';
import { markWorkflowSensitivePaths } from '@/services/workflow-runtime/sensitive-data';
import { loadStudioRelease } from './repository';
import { runStudioConversation } from './runtime';
import { openStudioSession, sealStudioSession } from './session-store';
import { mapStudioFlowInputs, validateStudioFlowBindings } from './flow-inputs';

/** Real Studio conversation, pinned release, isolated session and simulated effects.
 * The caller must authenticate a workspace manager before constructing this adapter.
 */
export function createPublishedStudioSandboxExecutor(options: {
  workspaceId: string;
  actorUserId: string;
  sendResponse: NonNullable<WorkflowHandlerDependencies['sendResponse']>;
}): NonNullable<WorkflowHandlerDependencies['executePublishedAgent']> {
  return async input => {
    if (input.execution.context.sandbox !== true || input.workflow.workspaceId !== options.workspaceId) throw new Error('Este adaptador só pode executar no sandbox do workspace autorizado.');
    const agentId = String(input.node.config.agentId || ''), releaseId = String(input.node.config.releaseId || '');
    const release = await loadStudioRelease(options.workspaceId, agentId, releaseId);
    if (!release) throw new Error('A publicação do Studio não está disponível.');
    validateStudioFlowBindings(release.agentSnapshot, input.node.config.inputMappings, input.node.config.outputKeys);
    const { config } = await getAutopilotConfigService(options.workspaceId, agentId);
    if (!config || config.id !== agentId || !config.is_active) throw new Error('O agente do Studio está pausado ou indisponível.');
    if (config.is_private && config.user_id !== options.actorUserId) throw new Error('Agente não encontrado.');
    const scope = { workspaceId: options.workspaceId, agentId, chatId: `nexus-preview:${input.execution.executionId}`, contextId: input.node.id };
    const stored = isRecord(input.execution.variables.__studioSandboxSessions) ? input.execution.variables.__studioSandboxSessions : {};
    const previous = typeof stored[input.node.id] === 'string' ? openStudioSession(scope, stored[input.node.id] as string) : null;
    if (previous && previous.releaseId !== releaseId) throw new Error('O teste começou com outra versão. Reinicie a conversa.');
    const resumed = isRecord(input.execution.context.__resumeInput) ? input.execution.context.__resumeInput : {};
    const message = String(resumed.message || resumed.text || resumed.value || input.input.message || input.input.text || input.execution.input.message || '');
    const messageId = `nexus-preview:${input.execution.executionId}:${input.node.id}:${input.execution.executionPath.length}`;
    const previousToolCalls = previous?.toolCallCount || 0;
    const result = await runStudioConversation({ release, config, state: previous, message, messageId, chatId: scope.chatId,
      contact: { id: 'nexus-preview', workspace_id: options.workspaceId, name: 'Cliente fictício' } as Contact,
      flowInput: mapStudioFlowInputs(release.agentSnapshot, input.node.config.inputMappings, { variables: input.execution.variables, current: input.input, input: input.execution.input }),
      // Authoring preview never reads contact/history or performs business actions.
      preview: { samples: {} }, signal: input.signal, checkpoint: async () => {}, assertCurrent: async () => { input.signal.throwIfAborted(); }, runNative: async () => {},
    });
    input.signal.throwIfAborted();
    const patch = markWorkflowSensitivePaths({ __studioSandboxSessions: { ...stored, [input.node.id]: sealStudioSession(scope, result.state) } }, ['__studioSandboxSessions']);
    if (result.response) {
      const delivery = await options.sendResponse(result.response, input);
      if (delivery.success === false) throw new Error('Não foi possível mostrar a resposta no chat de teste.');
    }
    const output = { response: result.response, agentId, releaseId, sandbox: true, status: result.state.status };
    const turn = result.state.reasoning?.lastTurnMetrics;
    const usage = turn?.usage || [];
    const metrics = { durationMs: Number(turn?.durationMs || 0), modelCalls: Math.max(Number(turn?.modelDecisions || 0), usage.reduce((sum, entry) => sum + entry.calls, 0)), toolCalls: Math.max(0, (result.state.toolCallCount || 0) - previousToolCalls), inputTokens: usage.reduce((sum, entry) => sum + entry.inputTokens, 0), outputTokens: usage.reduce((sum, entry) => sum + entry.outputTokens, 0) };
    if (result.state.status === 'failed' || result.state.status === 'cancelled') return { status: 'error', selectedOutput: 'error', error: { code: 'STUDIO_PREVIEW_FAILED', message: 'O agente não conseguiu concluir o turno do teste.', retryable: false }, output, statePatch: patch, metrics };
    // A resolved Studio request does not end its ownership of the conversation.
    if (['waiting_input', 'running', 'resolved'].includes(result.state.status)) return { status: 'waiting', waitingReason: 'message', resumeToken: randomUUID(), statePatch: patch, output: { ...output, resumeMode: 'reexecute', expirationOutput: 'error', waitingSince: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }, metrics };
    return { status: 'completed', output, statePatch: patch, metrics };
  };
}
