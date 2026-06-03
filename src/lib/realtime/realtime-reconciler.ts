import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Chat, User } from '@/lib/types';

export type RealtimeRow = { [key: string]: any };

export type RealtimeBroadcastChangesPayload = {
  id: string;
  schema: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record: RealtimeRow | null;
  old_record: RealtimeRow | null;
};

export type RealtimeBroadcastEnvelope = {
  type: 'broadcast';
  event: string;
  meta?: {
    replayed?: boolean;
    id: string;
  };
  payload: RealtimeBroadcastChangesPayload;
};

export function parseVisibleIdSet(idsCsv?: string | null): Set<string> | null {
  if (!idsCsv) return null;
  const ids = idsCsv.split(',').map((value) => value.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export function toPostgresChangesPayload(
  payload: RealtimeBroadcastChangesPayload,
): RealtimePostgresChangesPayload<RealtimeRow> {
  const record = payload.record ?? {};
  const oldRecord = payload.old_record ?? {};
  const recordWithDates = record as { updated_at?: string; created_at?: string };
  const oldRecordWithDates = oldRecord as { updated_at?: string; created_at?: string };
  const commitTimestamp =
    recordWithDates.updated_at ||
    recordWithDates.created_at ||
    oldRecordWithDates.updated_at ||
    oldRecordWithDates.created_at ||
    new Date().toISOString();

  return {
    schema: payload.schema,
    table: payload.table,
    commit_timestamp: commitTimestamp,
    errors: [],
    eventType: payload.operation,
    new: record as RealtimeRow,
    old: oldRecord as Partial<RealtimeRow>,
  };
}

export function getPayloadChatId(payload: RealtimePostgresChangesPayload<RealtimeRow>): string | null {
  const nextChatId = (payload.new as { chat_id?: string } | null)?.chat_id;
  if (nextChatId) return nextChatId;
  return (payload.old as { chat_id?: string } | null)?.chat_id ?? null;
}

export function getPayloadRecordId(payload: RealtimePostgresChangesPayload<RealtimeRow>): string | null {
  const nextId = (payload.new as { id?: string } | null)?.id;
  if (nextId) return nextId;
  return (payload.old as { id?: string } | null)?.id ?? null;
}

export function shouldDeliverChatPayload(
  payload: RealtimePostgresChangesPayload<RealtimeRow>,
  visibleChatIds: Set<string> | null,
): boolean {
  if (!visibleChatIds) return true;
  const payloadId = getPayloadRecordId(payload);
  return !payloadId || visibleChatIds.has(payloadId);
}

export function shouldDeliverMessagePayload(
  payload: RealtimePostgresChangesPayload<RealtimeRow>,
  visibleChatIds: Set<string> | null,
): boolean {
  if (!visibleChatIds) return true;
  const payloadChatId = getPayloadChatId(payload);
  return !payloadChatId || visibleChatIds.has(payloadChatId);
}

const hasOwn = (record: RealtimeRow, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

export function reconcileRealtimeChatAssignment(
  existingChat: Chat | undefined,
  record: RealtimeRow,
  currentUser?: User | null,
): Pick<Partial<Chat>, 'agentId' | 'agent' | 'assigned_system_agent_id' | 'assignedSystemAgent'> {
  const hasAgentId = hasOwn(record, 'agent_id');
  const hasSystemAgentId = hasOwn(record, 'assigned_system_agent_id');
  const incomingAgentId = hasAgentId ? record.agent_id || undefined : existingChat?.agentId;
  const incomingSystemAgentId = hasSystemAgentId
    ? record.assigned_system_agent_id || null
    : existingChat?.assigned_system_agent_id;

  let agent = existingChat?.agent;
  let assignedSystemAgent = existingChat?.assignedSystemAgent;

  if (hasAgentId) {
    if (!incomingAgentId) {
      agent = undefined;
    } else if (currentUser?.id === incomingAgentId) {
      agent = currentUser ?? undefined;
    } else if (existingChat?.agent?.id !== incomingAgentId) {
      agent = record.agent_name
        ? {
            id: incomingAgentId,
            name: record.agent_name,
            avatar_url: record.agent_avatar_url || undefined,
          } as User
        : undefined;
    }
  }

  if (hasSystemAgentId) {
    if (!incomingSystemAgentId) {
      assignedSystemAgent = undefined;
    } else if (existingChat?.assignedSystemAgent?.id !== incomingSystemAgentId) {
      assignedSystemAgent = record.assigned_system_agent_name
        ? {
            id: incomingSystemAgentId,
            name: record.assigned_system_agent_name,
            avatar_url: record.assigned_system_agent_avatar_url || undefined,
            type: record.assigned_system_agent_type || undefined,
          }
        : undefined;
    }
  }

  if (hasAgentId && incomingAgentId) {
    assignedSystemAgent = undefined;
  }
  if (hasSystemAgentId && incomingSystemAgentId) {
    agent = undefined;
  }

  return {
    agentId: incomingAgentId,
    agent,
    assigned_system_agent_id: incomingSystemAgentId,
    assignedSystemAgent,
  };
}
