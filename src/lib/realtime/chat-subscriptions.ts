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
  onChatUpdate: (payload: RealtimePostgresChangesPayload<any>) => void;
  onStatusChange?: (status: string) => void;
};

export const buildChatMessageChannelName = (workspaceId: string, chatId: string) =>
  `realtime-messages-${workspaceId}-${chatId}`;

export const buildWorkspaceChatChannelName = (workspaceId: string) =>
  `realtime-chats-workspace-${workspaceId}`;

export function subscribeToChatMessages({
  client,
  workspaceId,
  chatId,
  onMessage,
  onStatusChange,
}: ChatMessageSubscriptionParams): RealtimeChannel {
  return client
    .channel(buildChatMessageChannelName(workspaceId, chatId))
    .on(
      'postgres_changes',
      {
        event: '*', // Listen for INSERT and UPDATE
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      },
      onMessage,
    )
    .subscribe(onStatusChange);
}

export function subscribeToWorkspaceChatUpdates({
  client,
  workspaceId,
  onChatUpdate,
  onStatusChange,
}: WorkspaceChatSubscriptionParams): RealtimeChannel {
  return client
    .channel(buildWorkspaceChatChannelName(workspaceId))
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chats',
        filter: `workspace_id=eq.${workspaceId}`,
      },
      onChatUpdate,
    )
    .subscribe(onStatusChange);
}

export function teardownChannel(client: SupabaseLike, channel: RealtimeChannel | null) {
  if (channel) {
    client.removeChannel(channel);
  }
}
