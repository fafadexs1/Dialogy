import { db } from '@/lib/db';
import type { Chat, Contact } from '@/lib/types';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { processAutopilotForChat } from '@/services/autopilot-service';
import { runAutopilotLearningCycle } from '@/services/autopilot/learning-cycle';
import { handoffAutopilotFailureToHuman } from '@/services/autopilot/runtime/failure-handoff';
import { isUncertainProviderDeliveryError } from '@/services/autopilot/runtime/provider-delivery';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';
import { ingestKnowledgeBaseDocument } from '@/services/rag/document-ingestion';
import type {
  AiAutopilotLearningCyclePayload,
  AiAutopilotProcessPayload,
  AiCaseMemoryRefreshPayload,
  AiDocumentIngestPayload,
  QueueJobRecord,
  QueueJobType,
} from './types';

type QueueHandler = (job: QueueJobRecord) => Promise<void>;

async function loadChatForAutopilot(chatId: string, workspaceId: string): Promise<Chat | null> {
  const { rows } = await db.query(
    `SELECT
        c.id,
        c.workspace_id,
        c.status,
        c.agent_id,
        c.assigned_system_agent_id,
        c.source,
        c.instance_type,
        c.is_autopilot_active,
        c.autopilot_config_id,
        c.copilot_mode,
        ct.id AS contact_id,
        ct.name AS contact_name,
        ct.email AS contact_email,
        ct.phone AS contact_phone,
        ct.phone_number_jid AS contact_phone_number_jid,
        ct.avatar_url AS contact_avatar_url,
        ct.address AS contact_address
     FROM chats c
     JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
     WHERE c.id = $1 AND c.workspace_id = $2
     LIMIT 1`,
    [chatId, workspaceId]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    status: row.status,
    source: row.source,
    instance_type: row.instance_type,
    agentId: row.agent_id,
    assigned_system_agent_id: row.assigned_system_agent_id,
    is_autopilot_active: row.is_autopilot_active,
    autopilot_config_id: row.autopilot_config_id,
    copilot_mode: row.copilot_mode,
    messages: [],
    contact: {
      id: row.contact_id,
      name: row.contact_name,
      email: row.contact_email,
      phone: row.contact_phone,
      phone_number_jid: row.contact_phone_number_jid,
      avatar_url: row.contact_avatar_url,
      address: row.contact_address,
    } as Contact,
  } as Chat;
}

const HANDLERS: Record<QueueJobType, QueueHandler | undefined> = {
  evolution_webhook_process: undefined,
  nexus_workflow: undefined,
  ai_document_ingest: async (job) => {
    const payload = job.payload as AiDocumentIngestPayload;
    if (!payload.workspaceId || !payload.documentId || !payload.documentName || !payload.content) {
      throw new Error('Invalid ai_document_ingest payload.');
    }

    await ingestKnowledgeBaseDocument({
      workspaceId: payload.workspaceId,
      autopilotConfigId: payload.autopilotConfigId ?? null,
      documentId: payload.documentId,
      documentName: payload.documentName,
      content: payload.content,
      document: payload.document,
    });
  },
  ai_autopilot_process: async (job) => {
    const payload = job.payload as AiAutopilotProcessPayload;
    if (!payload.workspaceId || !payload.chatId || !payload.messageId || !payload.instanceName) {
      throw new Error('Invalid ai_autopilot_process payload.');
    }

    const chat = await loadChatForAutopilot(payload.chatId, payload.workspaceId);
    if (!chat) {
      console.warn(`[AI_QUEUE] Chat ${payload.chatId} not found for autopilot job.`);
      return;
    }

    if (!chat.is_autopilot_active) {
      console.log(`[AI_QUEUE] Skipping autopilot for chat ${payload.chatId}. Inactive.`);
      return;
    }

    try {
      await processAutopilotForChat(
        payload.workspaceId,
        chat,
        payload.lastMessageContent || '',
        payload.instanceName,
        payload.messageId,
        payload.suggestionRequest
      );
    } catch (error) {
      if (
        isUncertainProviderDeliveryError(error)
        && chat.assigned_system_agent_id
      ) {
        await handoffAutopilotFailureToHuman({
          workspaceId: payload.workspaceId,
          chatId: payload.chatId,
          systemAgentId: chat.assigned_system_agent_id,
          sourceMessageId: payload.messageId,
          failedToolNames: [],
          reason: 'uncertain_provider_delivery',
        });
        console.error(
          `[AI_QUEUE] Provider delivery became uncertain for chat ${payload.chatId}. `
          + 'Automatic retry was blocked and the chat returned to the human queue.',
        );
        return;
      }
      throw error;
    }
  },
  ai_autopilot_learning_cycle: async (job) => {
    const payload = job.payload as AiAutopilotLearningCyclePayload;
    const result = await runAutopilotLearningCycle({
      workspaceId: payload.workspaceId || null,
      vertical: payload.vertical || null,
      sinceDays: payload.sinceDays,
      limit: payload.limit,
      dryRun: payload.dryRun,
      promoteEcosystem: payload.promoteEcosystem,
      createScoreSuggestions: payload.createScoreSuggestions,
    });

    console.log('[AI_QUEUE] Autopilot learning cycle completed:', JSON.stringify({
      workspaceCount: result.workspaceCount,
      sinceDays: result.sinceDays,
      dryRun: result.dryRun,
      detectedPatterns: result.results.reduce((sum, item) => sum + item.detectedPatterns, 0),
      scoreSuggestionsCreated: result.results.reduce((sum, item) => sum + item.scoreSuggestionsCreated, 0),
      ecosystemPromoted: result.ecosystemPromotion?.promoted.length || 0,
      errors: result.results.filter((item) => item.error).length,
    }));
  },
  ai_case_memory_refresh: async (job) => {
    const payload = job.payload as AiCaseMemoryRefreshPayload;
    if (!payload.workspaceId || !payload.chatId) {
      throw new Error('Invalid ai_case_memory_refresh payload.');
    }

    await refreshCaseMemoryForChat({
      workspaceId: payload.workspaceId,
      chatId: payload.chatId,
      closedAt: payload.closedAt ?? null,
      force: Boolean(payload.force),
    });
  },
  whatsapp_send: undefined,
  webhook_outbound: undefined,
  queue_auto_close: undefined,
  marketing_auto_close: undefined,
  nexus_internal_event: undefined,
  analytics_event: undefined,
  notification_send: undefined,
  ai_task: undefined,
};

export async function handleAiQueueJob(job: QueueJobRecord): Promise<void> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    throw new Error(`No AI handler registered for job type ${job.type}`);
  }

  await handler(job);
}

type AiQueueFailureDependencies = {
  database?: Pick<typeof db, 'connect'>;
  broadcastChat?: typeof broadcastHydratedChatUpdate;
};

export function isFinalAiQueueAttempt(job: QueueJobRecord): boolean {
  const attempts = Number(job.attempts);
  const maxAttempts = Number(job.max_attempts);
  return Number.isFinite(attempts)
    && Number.isFinite(maxAttempts)
    && maxAttempts > 0
    && attempts >= maxAttempts;
}

export async function handleAiQueueJobFailure(
  job: QueueJobRecord,
  error: unknown,
  dependencies: AiQueueFailureDependencies = {},
): Promise<void> {
  if (job.type !== 'ai_autopilot_process' || !isFinalAiQueueAttempt(job)) {
    return;
  }

  const payload = job.payload as AiAutopilotProcessPayload;
  if (!payload?.workspaceId || !payload.chatId || !payload.messageId) {
    return;
  }

  const database = dependencies.database || db;
  const broadcastChat = dependencies.broadcastChat || broadcastHydratedChatUpdate;
  const client = await database.connect();
  let escalated = false;
  try {
    await client.query('BEGIN');
    const sourceState = await client.query(
      `WITH source_message AS (
         SELECT created_at
         FROM messages
         WHERE id = $1
           AND workspace_id = $2
           AND chat_id = $3
           AND from_me = false
         LIMIT 1
       )
       SELECT
         EXISTS(SELECT 1 FROM source_message) AS source_exists,
         EXISTS(
           SELECT 1
           FROM messages m
           JOIN source_message source ON true
           WHERE m.chat_id = $3
             AND m.from_me = false
             AND m.id <> $1
             AND m.created_at >= source.created_at
         ) AS superseded,
         EXISTS(
           SELECT 1
           FROM orchestrator_runs run
           WHERE run.workspace_id = $2
             AND run.chat_id = $3
             AND run.source_message_id = $1
             AND run.status IN ('success', 'fallback', 'skipped')
             AND (
               COALESCE(run.metadata->>'workflowHandoffCompleted', 'false') = 'true'
               OR EXISTS (
                 SELECT 1
                 FROM messages response
                 WHERE response.workspace_id = $2
                   AND response.chat_id = $3
                   AND response.from_me = true
                   AND response.metadata->>'autopilotSourceMessageId' = $1::text
                   AND COALESCE(upper(response.api_message_status), '') NOT IN ('FAILED', 'ERROR')
               )
             )
         ) AS completed`,
      [payload.messageId, payload.workspaceId, payload.chatId],
    );
    const state = sourceState.rows[0];
    if (!state?.source_exists || state.superseded || state.completed) {
      await client.query('COMMIT');
      return;
    }

    const chatState = await client.query(
      `SELECT assigned_system_agent_id
       FROM chats
       WHERE id = $1
         AND workspace_id = $2
         AND is_autopilot_active = true
         AND agent_id IS NULL
         AND status <> 'encerrados'
       FOR UPDATE`,
      [payload.chatId, payload.workspaceId],
    );
    const systemAgentId = chatState.rows[0]?.assigned_system_agent_id;
    if (!systemAgentId) {
      await client.query('COMMIT');
      return;
    }

    await client.query(
      `UPDATE chats
       SET agent_id = NULL,
           assigned_system_agent_id = NULL,
           is_autopilot_active = false,
           copilot_mode = 'off',
           status = 'gerais',
           assigned_at = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1
         AND workspace_id = $2
         AND status <> 'encerrados'
         AND agent_id IS NULL
         AND assigned_system_agent_id = $3
         AND is_autopilot_active = true`,
      [payload.chatId, payload.workspaceId, systemAgentId],
    );

    const errorMessage = error instanceof Error ? error.message : String(error);
    await client.query(
      `INSERT INTO messages (
         workspace_id,
         chat_id,
         type,
         content,
         from_me,
         api_message_status,
         metadata,
         is_read,
         sender_system_agent_id,
         created_at
       )
       SELECT $1, $2, 'text', $3, true, 'internal', $4::jsonb, true, $5, clock_timestamp()
       WHERE NOT EXISTS (
         SELECT 1
         FROM messages existing
         WHERE existing.workspace_id = $1
           AND existing.chat_id = $2
           AND existing.metadata->>'event' = 'autopilot_dead_letter'
           AND existing.metadata->>'sourceMessageId' = $6
       )`,
      [
        payload.workspaceId,
        payload.chatId,
        'O agente de IA esgotou as tentativas deste turno. O atendimento foi devolvido para a fila humana.',
        JSON.stringify({
          isInternalNote: true,
          isAiAnalysis: true,
          analysisKind: 'routing_context',
          sentBy: 'system_agent',
          event: 'autopilot_dead_letter',
          sourceMessageId: payload.messageId,
          queueJobId: job.id,
          queueAttempts: job.attempts,
          queueError: errorMessage.slice(0, 2000),
        }),
        systemAgentId,
        payload.messageId,
      ],
    );
    await client.query('COMMIT');
    escalated = true;
  } catch (failureHandlerError) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw failureHandlerError;
  } finally {
    client.release();
  }

  if (escalated) {
    await broadcastChat(payload.workspaceId, payload.chatId);
    console.error(
      `[AI_QUEUE] Autopilot job ${job.id} exhausted ${job.attempts}/${job.max_attempts} attempts. Chat ${payload.chatId} returned to human queue.`,
    );
  }
}
