export type RealtimeChannelKind = 'chats' | 'messages' | 'messagesList';

export type RealtimeChannelHealth = Record<RealtimeChannelKind, boolean>;

export const INITIAL_REALTIME_CHANNEL_HEALTH: RealtimeChannelHealth = {
  chats: false,
  messages: false,
  messagesList: false,
};

export function applyRealtimeChannelStatus(
  current: RealtimeChannelHealth,
  channel: RealtimeChannelKind,
  status: string,
): RealtimeChannelHealth {
  const connected = status === 'SUBSCRIBED';
  if (current[channel] === connected) return current;
  return { ...current, [channel]: connected };
}

export function hasHealthyMessageCoverage(
  health: RealtimeChannelHealth,
  hasSelectedChat: boolean,
): boolean {
  return health.messagesList && (!hasSelectedChat || health.messages);
}
