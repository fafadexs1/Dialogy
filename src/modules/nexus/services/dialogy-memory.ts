import { db } from '@/lib/db';
import { resolveAgentMemoryForStage } from '@/services/agent-runtime/memory-store';
import type { AgentMemoryLayer, MergedAgentMemory } from '@/services/agent-runtime/memory';
import {
  loadAutopilotContactMemory,
  type AutopilotContactMemory,
} from '@/services/autopilot/flow-state-store';
import type { WorkflowExecution, WorkflowNode } from '@/services/workflow-runtime';
import { isRecord } from '@/services/workflow-runtime/utils';

type Queryable = Pick<typeof db, 'query'>;

type RecentMessageRow = {
  id: string;
  content: string;
  from_me: boolean;
  created_at: string | Date;
};

const EMPTY_CONTACT_MEMORY: AutopilotContactMemory = {
  slots: {},
  nativeState: {},
  updatedAt: null,
};

const EMPTY_AGENT_MEMORY: MergedAgentMemory = { entries: [], conflicts: [] };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function memoryScope(node?: WorkflowNode) {
  const value = String(node?.config.scope || 'hybrid');
  return value === 'conversation' || value === 'contact' ? value : 'hybrid';
}

function configuredLayers(node?: WorkflowNode): AgentMemoryLayer[] | undefined {
  if (!Array.isArray(node?.config.layers)) return undefined;
  const allowed = new Set<AgentMemoryLayer>([
    'turn_context',
    'operational_state',
    'contact_fact',
    'knowledge',
    'case_memory',
  ]);
  const layers = node.config.layers.map(String).filter((value): value is AgentMemoryLayer => allowed.has(value as AgentMemoryLayer));
  return layers.length > 0 ? layers : undefined;
}

function contextString(execution: WorkflowExecution, key: string) {
  const value = execution.context[key];
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export async function loadNexusDialogyMemory(input: {
  workspaceId: string;
  execution: WorkflowExecution;
  memoryNode?: WorkflowNode;
  database?: Queryable;
  loadContactMemory?: typeof loadAutopilotContactMemory;
  resolveMemory?: typeof resolveAgentMemoryForStage;
}): Promise<Record<string, unknown>> {
  const database = input.database || db;
  const node = input.memoryNode;
  const scope = memoryScope(node);
  const maxMessages = boundedInteger(node?.config.maxMessages, 20, 1, 200);
  const maxAgeDays = boundedInteger(node?.config.maxAgeDays, 180, 1, 730);
  const conversationId = input.execution.conversationId && UUID_PATTERN.test(input.execution.conversationId)
    ? input.execution.conversationId
    : null;
  let contactId = contextString(input.execution, 'contactId');

  if (conversationId && !contactId) {
    const chat = await database.query(
      `SELECT contact_id
       FROM public.chats
       WHERE id = $1
         AND workspace_id = $2
       LIMIT 1`,
      [conversationId, input.workspaceId],
    );
    const candidate = chat.rows[0]?.contact_id;
    contactId = typeof candidate === 'string' && UUID_PATTERN.test(candidate) ? candidate : null;
  }

  let recentMessages: Array<Record<string, unknown>> = [];
  if (conversationId && scope !== 'contact') {
    const messages = await database.query(
      `SELECT message.id, message.content, message.from_me, message.created_at
       FROM public.messages message
       JOIN public.chats chat ON chat.id = message.chat_id
       WHERE message.chat_id = $1
         AND chat.workspace_id = $2
         AND COALESCE(message.type, '') <> 'system'
         AND COALESCE(message.api_message_status, '') NOT IN ('internal', 'failed', 'error')
         AND NULLIF(BTRIM(message.content), '') IS NOT NULL
       ORDER BY message.created_at DESC, message.id DESC
       LIMIT $3`,
      [conversationId, input.workspaceId, maxMessages],
    );
    recentMessages = (messages.rows as RecentMessageRow[]).reverse().map((message) => ({
      id: String(message.id),
      role: message.from_me ? 'assistant' : 'user',
      fromMe: Boolean(message.from_me),
      content: String(message.content),
      createdAt: new Date(message.created_at).toISOString(),
    }));
  }

  const loadContact = input.loadContactMemory || loadAutopilotContactMemory;
  const contactMemory = conversationId && contactId
    ? await loadContact({ workspaceId: input.workspaceId, contactId, chatId: conversationId, maxAgeDays })
    : EMPTY_CONTACT_MEMORY;

  const resolveMemory = input.resolveMemory || resolveAgentMemoryForStage;
  const universalMemory = contactId || conversationId
    ? await resolveMemory({
      workspaceId: input.workspaceId,
      contactId,
      chatId: conversationId,
      taskExecutionId: UUID_PATTERN.test(input.execution.executionId) ? input.execution.executionId : null,
      layers: configuredLayers(node),
      limit: boundedInteger(node?.config.maxEntries, 100, 1, 500),
    })
    : EMPTY_AGENT_MEMORY;

  const entryFields = Object.fromEntries(
    universalMemory.entries
      .filter((entry) => entry.layer === 'contact_fact' || entry.layer === 'turn_context')
      .map((entry) => [entry.key, entry.value]),
  );
  const includeContact = scope !== 'conversation';

  return {
    provider: 'dialogy',
    scope,
    conversationId,
    contactId,
    recentMessages,
    knownFields: {
      ...(includeContact ? contactMemory.slots : {}),
      ...entryFields,
    },
    nativeState: isRecord(contactMemory.nativeState) ? contactMemory.nativeState : {},
    entries: universalMemory.entries.map((entry) => ({
      layer: entry.layer,
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      observedAt: entry.observedAt,
    })),
    conflicts: universalMemory.conflicts,
    updatedAt: contactMemory.updatedAt,
  };
}
