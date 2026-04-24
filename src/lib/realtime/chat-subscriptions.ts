import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';
import {
  parseVisibleIdSet,
  shouldDeliverChatPayload,
  shouldDeliverMessagePayload,
  toPostgresChangesPayload,
  type RealtimeBroadcastEnvelope,
} from '@/lib/realtime/realtime-reconciler';

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

export const buildChatMessageChannelName = (_workspaceId: string, chatId: string) =>
  `room:${chatId}:messages`;

export const buildWorkspaceChatChannelName = (workspaceId: string) =>
  `workspace:${workspaceId}:chats`;

export const buildWorkspaceMessageChannelName = (workspaceId: string) =>
  `workspace:${workspaceId}:messages`;

export const buildWorkspaceContactChannelName = (workspaceId: string) =>
  `workspace:${workspaceId}:contacts`;

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
  const visibleChatIds = parseVisibleIdSet(chatIdsCsv);

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
        if (!shouldDeliverChatPayload(normalizedPayload, visibleChatIds)) {
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
  const visibleChatIds = parseVisibleIdSet(chatIdsCsv);

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
        if (!shouldDeliverMessagePayload(normalizedPayload, visibleChatIds)) {
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
