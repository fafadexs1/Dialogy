import { db } from '@/lib/db';
import type { Chat, Contact } from '@/lib/types';
import { processAutopilotForChat } from '@/services/autopilot-service';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';
import { ingestKnowledgeBaseDocument } from '@/services/rag/document-ingestion';
import type {
  AiAutopilotProcessPayload,
  AiCaseMemoryRefreshPayload,
  AiDocumentIngestPayload,
  QueueJobRecord,
  QueueJobType,
} from './types';

type QueueHandler = (job: QueueJobRecord) => Promise<void>;

async function loadChatForAutopilot(chatId: string): Promise<Chat | null> {
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
        ct.phone_number_jid AS contact_phone_number_jid,
        ct.avatar_url AS contact_avatar_url,
        ct.address AS contact_address
     FROM chats c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1
     LIMIT 1`,
    [chatId]
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
      phone_number_jid: row.contact_phone_number_jid,
      avatar_url: row.contact_avatar_url,
      address: row.contact_address,
    } as Contact,
  } as Chat;
}

const HANDLERS: Record<QueueJobType, QueueHandler | undefined> = {
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

    const chat = await loadChatForAutopilot(payload.chatId);
    if (!chat) {
      console.warn(`[AI_QUEUE] Chat ${payload.chatId} not found for autopilot job.`);
      return;
    }

    if (!chat.is_autopilot_active) {
      console.log(`[AI_QUEUE] Skipping autopilot for chat ${payload.chatId}. Inactive.`);
      return;
    }

    await processAutopilotForChat(
      payload.workspaceId,
      chat,
      payload.lastMessageContent || '',
      payload.instanceName,
      payload.messageId
    );
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
