import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';

export type SupabaseLike = Pick<SupabaseClient, 'channel' | 'removeChannel'>;

export type ChatMessageSubscriptionParams = {
  client: SupabaseLike;
  workspaceId: string;
  chatId: string;
  onMessage: (payload: RealtimePostgresChangesPayload<any>) => void;
  onStatusChange?: (status: string) => void;
};

export type WorkspaceChatSubscriptionParams = {
  client: SupabaseLike;
  workspaceId: string;
  chatIdsCsv?: string;
  onChatUpdate: (payload: RealtimePostgresChangesPayload<any>) => void;
  onStatusChange?: (status: string) => void;
};

export type WorkspaceMessageSubscriptionParams = {
  client: SupabaseLike;
  workspaceId: string;
  chatIdsCsv?: string;
  onMessage: (payload: RealtimePostgresChangesPayload<any>) => void;
  onStatusChange?: (status: string) => void;
};

export type WorkspaceContactSubscriptionParams = {
  client: SupabaseLike;
  workspaceId: string;
  onContactUpdate: (payload: RealtimePostgresChangesPayload<any>) => void;
  onStatusChange?: (status: string) => void;
};

type RealtimeRow = { [key: string]: any };
type RealtimeBroadcastChangesPayload = {
  id: string;
  schema: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record: RealtimeRow | null;
  old_record: RealtimeRow | null;
};
type RealtimeBroadcastEnvelope = {
  type: 'broadcast';
  event: string;
  meta?: {
    replayed?: boolean;
    id: string;
  };
  payload: RealtimeBroadcastChangesPayload;
};

export const buildChatMessageChannelName = (_workspaceId: string, chatId: string) =>
  `room:${chatId}:messages`;

export const buildWorkspaceChatChannelName = (workspaceId: string) =>
  `workspace:${workspaceId}:chats`;

export const buildWorkspaceMessageChannelName = (workspaceId: string) =>
  `workspace:${workspaceId}:messages`;

export const buildWorkspaceContactChannelName = (workspaceId: string) =>
  `workspace:${workspaceId}:contacts`;

function toPostgresChangesPayload(
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

function getPayloadChatId(payload: RealtimePostgresChangesPayload<RealtimeRow>): string | null {
  const nextChatId = (payload.new as { chat_id?: string } | null)?.chat_id;
  if (nextChatId) return nextChatId;
  return (payload.old as { chat_id?: string } | null)?.chat_id ?? null;
}

function getPayloadRecordId(payload: RealtimePostgresChangesPayload<RealtimeRow>): string | null {
  const nextId = (payload.new as { id?: string } | null)?.id;
  if (nextId) return nextId;
  return (payload.old as { id?: string } | null)?.id ?? null;
}

export function subscribeToChatMessages({
  client,
  workspaceId,
  chatId,
  onMessage,
  onStatusChange,
}: ChatMessageSubscriptionParams): RealtimeChannel {
  const topic =
    chatId === 'all'
      ? buildWorkspaceMessageChannelName(workspaceId)
      : buildChatMessageChannelName(workspaceId, chatId);

  return client
    .channel(topic, {
      config: {
        private: true,
      },
    })
    .on(
      'broadcast',
      { event: '*' },
      (payload: RealtimeBroadcastEnvelope) => {
        onMessage(toPostgresChangesPayload(payload.payload));
      },
    )
    .subscribe((status, err) => {
      console.log(`[REALTIME-DEBUG] Subscription status for message channel (${chatId === 'all' ? 'WORKSPACE' : 'CHAT'}): ${status}`, err ? err : '');
      if (err) {
        console.error('[REALTIME-DEBUG] Subscription ERROR:', err);
      }
      if (onStatusChange) onStatusChange(status);
    });
}

export function subscribeToWorkspaceChatUpdates({
  client,
  workspaceId,
  chatIdsCsv,
  onChatUpdate,
  onStatusChange,
}: WorkspaceChatSubscriptionParams): RealtimeChannel {
  console.log('[REALTIME-DEBUG-CHATS] Subscribing to chats for workspace:', workspaceId);
  const visibleChatIds = chatIdsCsv && chatIdsCsv.length > 0
    ? new Set(chatIdsCsv.split(',').map((value) => value.trim()).filter(Boolean))
    : null;

  return client
    .channel(buildWorkspaceChatChannelName(workspaceId), {
      config: {
        private: true,
      },
    })
    .on(
      'broadcast',
      { event: '*' },
      (payload: RealtimeBroadcastEnvelope) => {
        const normalizedPayload = toPostgresChangesPayload(payload.payload);
        const payloadId = getPayloadRecordId(normalizedPayload);
        if (visibleChatIds && payloadId && !visibleChatIds.has(payloadId)) {
          return;
        }
        onChatUpdate(normalizedPayload);
      },
    )
    .subscribe((status, err) => {
      console.log(`[REALTIME-DEBUG-CHATS] Subscription status for chats channel: ${status}`, err ? err : '');
      if (err) {
        console.error('[REALTIME-DEBUG-CHATS] Subscription ERROR:', err);
      }
      if (onStatusChange) onStatusChange(status);
    });
}

export function subscribeToWorkspaceMessages({
  client,
  workspaceId,
  chatIdsCsv,
  onMessage,
  onStatusChange,
}: WorkspaceMessageSubscriptionParams): RealtimeChannel {
  const visibleChatIds = chatIdsCsv && chatIdsCsv.length > 0
    ? new Set(chatIdsCsv.split(',').map((value) => value.trim()).filter(Boolean))
    : null;

  return client
    .channel(buildWorkspaceMessageChannelName(workspaceId), {
      config: {
        private: true,
      },
    })
    .on(
      'broadcast',
      { event: '*' },
      (payload: RealtimeBroadcastEnvelope) => {
        const normalizedPayload = toPostgresChangesPayload(payload.payload);
        const payloadChatId = getPayloadChatId(normalizedPayload);
        if (visibleChatIds && payloadChatId && !visibleChatIds.has(payloadChatId)) {
          return;
        }
        onMessage(normalizedPayload);
      },
    )
    .subscribe((status, err) => {
      console.log(`[REALTIME-DEBUG] Subscription status for workspace messages channel: ${status}`, err ? err : '');
      if (err) {
        console.error('[REALTIME-DEBUG] Subscription ERROR:', err);
      }
      if (onStatusChange) onStatusChange(status);
    });
}

export function subscribeToWorkspaceContacts({
  client,
  workspaceId,
  onContactUpdate,
  onStatusChange,
}: WorkspaceContactSubscriptionParams): RealtimeChannel {
  return client
    .channel(buildWorkspaceContactChannelName(workspaceId), {
      config: {
        private: true,
      },
    })
    .on(
      'broadcast',
      { event: '*' },
      (payload: RealtimeBroadcastEnvelope) => {
        onContactUpdate(toPostgresChangesPayload(payload.payload));
      },
    )
    .subscribe((status, err) => {
      console.log(`[REALTIME-DEBUG] Subscription status for contacts channel: ${status}`, err ? err : '');
      if (err) {
        console.error('[REALTIME-DEBUG] Subscription ERROR:', err);
      }
      if (onStatusChange) onStatusChange(status);
    });
}

export function teardownChannel(client: SupabaseLike, channel: RealtimeChannel | null) {
  if (channel) {
    client.removeChannel(channel);
  }
}
