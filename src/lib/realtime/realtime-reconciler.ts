import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

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
