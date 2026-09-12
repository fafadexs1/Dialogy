import 'server-only';
import { requestPlatformJson } from '@/services/ai/platform-json';
import { platformModel, platformApiKey } from '@/services/ai/platform-config';

import { z } from 'zod';
import { isOpenAiCompatibleModel } from '@/services/ai/openai-compatible';
import { loadWorkspaceAiCredentialRecords } from '@/services/ai/workspace-ai-credentials';
import { logAutopilotUsage } from '@/actions/autopilot';
import { advanceStudioReasoningSession } from './reasoning-engine';
import { StudioReasoningDecisionSchema, studioReasoningDecisionJsonSchema } from './reasoning-contract';
import { studioReasoningSystemPrompt } from './reasoning-prompt';
import { readStudioDurableMemory } from './durable-memory-store';
import type { StudioMemoryPage } from './durable-memory';
import type { StudioRuntimeInput } from './runtime';
import type { StudioEngineDependencies, StudioSession } from './engine';
import { studioContactPhone } from './contact-phone';
import { createStructuredToolContinuation } from '@/services/ai/structured-tool-continuation';
import { loadStudioOlderConversationPage } from './history';
import { db } from '@/lib/db';
import { readArchivedStudioSession, readStudioRequestOperationHistory } from './session-store';

export async function runStudioReasoningRuntime(input: StudioRuntimeInput, state: StudioSession,
  dependencies: StudioEngineDependencies, history: Array<{ content: string; fromMe: boolean; messageId?: string }>) {
  const { release } = input;
  const document = release.agentSnapshot;
  const settings = document.resolveStage.reasoning;
  const model = (await platformModel()).id;
  if (!settings?.enabled || !model) throw new Error('Publique um modelo explícito para o atendimento com raciocínio.');
  if (!isOpenAiCompatibleModel(model) && !model.startsWith('googleai/') && !model.startsWith('lmstudio/')) throw new Error('Este provedor ainda não tem suporte ao novo núcleo de raciocínio.');
  const primaryKey = await platformApiKey(model);
  const continuation = model.startsWith('deepseek/') ? createStructuredToolContinuation() : undefined;
  const scope = { workspaceId: release.workspaceId, agentId: release.agentId, chatId: input.chatId };
  if (!input.preview && !input.suggestionOnly && state.reasoning) {
    // A single in-flight pointer does not represent every interrupted operation.
    // Reconcile each pending photo against its own persisted delivery evidence.
    for (const uncertain of state.reasoning.operations.filter((operation) => operation.status === 'unknown')) {
      const request = state.reasoning!.requests.find((entry) => entry.id === uncertain.requestId);
      const step = request && document.resolveStage.procedures.find((entry) => entry.id === request.procedureId)?.steps
        .find((entry) => `${request.procedureId}:${entry.id}` === uncertain.capabilityId);
      if (step?.nativeActionType === 'show_catalog_image') {
        await input.assertCurrent();
        const delivered = await db.query(`SELECT m.id, m.metadata FROM messages m JOIN chats c ON c.id=m.chat_id AND c.workspace_id=m.workspace_id
          WHERE c.id=$1 AND c.workspace_id=$2 AND m.from_me=TRUE AND m.type='image'
            AND m.metadata->>'studioOperationId'=$3 AND m.api_message_status IN ('SENT','DELIVERED','READ','PLAYED') LIMIT 1`,
        [input.chatId, release.workspaceId, uncertain.id]);
        if (delivered.rows.length) {
          await input.assertCurrent();
          state = structuredClone(state);
          const operation = state.reasoning!.operations.find((operation) => operation.id === uncertain.id)!;
          operation.status = 'succeeded';
          const metadata = delivered.rows[0].metadata;
          const product = metadata?.studioPresentedProduct;
          if (product && (typeof product.productId === 'string' || typeof product.productId === 'number')
            && typeof product.caption === 'string' && typeof metadata.mediaUrl === 'string' && metadata.mediaUrl.startsWith('https://')) {
            operation.presentedProduct = { productId: product.productId, caption: product.caption.slice(0, 500), url: metadata.mediaUrl };
          }
          state.events.push({ stepId: step.id, label: 'Envio da foto confirmado pelo registro da mensagem', kind: 'reasoning_delivery_reconciled', at: new Date().toISOString() });
          if (state.inFlight?.key === uncertain.id) state.inFlight = null;
          await input.checkpoint(state, []);
        }
      }
    }
  }
  // Authoring preview never reads a real customer's memory or performs business effects.
  const memory: StudioMemoryPage = input.preview ? { records: [], nextCursor: null } : await readStudioDurableMemory(scope);
  const sources = input.preview ? (state.conversationMemory || []).flatMap((turn) => [
    { messageId: turn.messageId, content: turn.customer, fromMe: false },
    { messageId: `${turn.messageId}:assistant`, content: turn.assistant, fromMe: true },
  ]) : history.flatMap((turn) => turn.messageId ? [{ ...turn, messageId: turn.messageId }] : []);
  const turnUsage = new Map<string, { model: string; stage: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number }>();
  const applyTurnUsage = (next: StudioSession) => {
    if (next.reasoning?.lastTurnMetrics?.messageId !== input.messageId) return;
    const entries = [...turnUsage.values()].map((entry) => ({ ...entry }));
    next.reasoning.lastTurnMetrics.usage = entries;
    // Base every checkpoint on the loaded state, not an earlier callback in this turn.
    // The CAS commits totals together with the final response and replay marker.
    const previous = state.reasoning?.usageTotals;
    if (previous?.lastMessageId === input.messageId) {
      next.reasoning.usageTotals = { ...previous };
      return;
    }
    next.reasoning.usageTotals = {
      lastMessageId: input.messageId, recordedTurns: (previous?.recordedTurns || 0) + 1,
      turnsWithoutUsage: (previous?.turnsWithoutUsage || 0) + (entries.length ? 0 : 1),
      inputTokens: (previous?.inputTokens || 0) + entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
      outputTokens: (previous?.outputTokens || 0) + entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
      totalTokens: (previous?.totalTokens || 0) + entries.reduce((sum, entry) => sum + entry.totalTokens, 0),
    };
  };
  const usage = (selectedModel: string, stage: string) => (tokens: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
    const key = JSON.stringify([selectedModel, stage]);
    const accumulated = turnUsage.get(key) || { model: selectedModel, stage, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    accumulated.calls++;
    accumulated.inputTokens += tokens.inputTokens; accumulated.outputTokens += tokens.outputTokens; accumulated.totalTokens += tokens.totalTokens;
    turnUsage.set(key, accumulated);
    void logAutopilotUsage({ configId: release.agentId, flowName: 'studioReasoningV2', modelName: selectedModel,
      inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, totalTokens: tokens.totalTokens, ruleName: stage })
      .catch(() => console.error('[STUDIO_REASONING_USAGE] Não foi possível registrar o consumo.'));
  };
  const result = await advanceStudioReasoningSession({ document, state, message: input.message, messageId: input.messageId,
    mediaAnalysisContext: input.mediaAnalysisContext,
    context: { contact: { ...input.contact, phone: studioContactPhone(input.contact) }, input: input.flowInput || {} },
    memory, sources, maxDecisions: settings.maxDecisions, suggestionOnly: input.suggestionOnly,
    historyCursor: !input.preview && history.length >= 80 ? history[0]?.messageId : null,
    dependencies: {
      ...dependencies,
      checkpoint: async (next, events) => {
        applyTurnUsage(next);
        // Preview continuity is scoped to its supplied session, not to customer persistence.
        await input.checkpoint(next, input.preview ? [] : events);
      },
      decide: (context) => requestPlatformJson({ model, apiKey: primaryKey, schema: StudioReasoningDecisionSchema,
        workspaceId: release.workspaceId,
        continuation,
        schemaName: 'dialogy_reasoning_decision', jsonSchema: studioReasoningDecisionJsonSchema,
        systemPrompt: studioReasoningSystemPrompt(document), userPrompt: JSON.stringify(context), reasoning: settings.effort,
        // Reasoning consumes this same provider budget. Reserve room for the decision after
        // thinking, including recovered choices, instead of truncating a valid reasoning call.
        maxTokens: Math.min(32_768, ({ low: 6144, medium: 12288, high: 16384 }[settings.effort])
          + (Array.isArray(context.requests) ? context.requests.length * 512 : 0)
          + (Array.isArray(context.capabilities) ? context.capabilities.length * 256 : 0)
          + (Array.isArray(context.choices) ? context.choices.length * 128 : 0) + input.message.length),
        timeoutMs: settings.maxTurnMs, signal: input.signal, onUsage: usage(model, 'decision'),
      }),
      recall: (cursor) => input.preview ? Promise.resolve({ records: [], nextCursor: null }) : readStudioDurableMemory(scope, { cursor }),
      recallSessionOperations: input.preview ? undefined : input.operationHistory?.recallSessionOperations ?? (async (sessionId) => {
        const archived = await readArchivedStudioSession(scope, sessionId);
        return archived ? { releaseId: archived.releaseId, operations: archived.reasoning?.operations || [] } : null;
      }),
      priorRequestOperations: input.preview ? undefined : input.operationHistory?.priorRequestOperations
        ?? ((requestId) => readStudioRequestOperationHistory(scope, requestId, state.id)),
      recallHistory: input.preview ? undefined : (cursor) => loadStudioOlderConversationPage(release.workspaceId, input.chatId, input.messageId, cursor),
      consult: settings.supportModel ? async (context) => {
        const supportModel = model;
        const output = await requestPlatformJson({ model: supportModel, apiKey: primaryKey,
          workspaceId: release.workspaceId,
          schema: z.object({ advice: z.string().min(1).max(6000) }), schemaName: 'dialogy_reasoning_advice',
          jsonSchema: { type: 'object', properties: { advice: { type: 'string' } }, required: ['advice'], additionalProperties: false },
          systemPrompt: `${studioReasoningSystemPrompt(document)}\nVocê é um consultor interno. Retorne somente advice com uma recomendação curta e fundamentada para destravar o pedido. Não execute ações, não fale com o cliente e não transcreva raciocínio interno.`,
          userPrompt: JSON.stringify(context), reasoning: 'high', maxTokens: 12_288, timeoutMs: settings.maxTurnMs,
          signal: input.signal, onUsage: usage(supportModel, 'consult'),
        });
        return output.advice;
      } : undefined,
    },
  });
  if (!result.replay) applyTurnUsage(result.state);
  return result;
}
