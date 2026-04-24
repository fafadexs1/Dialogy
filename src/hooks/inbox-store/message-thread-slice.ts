import type { Message } from '@/lib/types';
import type { BooleanRecord, IdRecord, InboxState, MessagesRecord, TimestampRecord } from './types';

const MAX_IN_MEMORY_MESSAGE_THREADS = 12;

type MessageThreadState = Pick<
  InboxState,
  'messagesByChat' | 'messageThreadOrder' | 'lastSyncMessages' | 'oldestMessageDateByChat' | 'oldestMessageIdByChat' | 'hasMoreHistoryByChat' | 'selectedChatId'
>;

export function touchMessageThread(order: string[], chatId: string | null | undefined): string[] {
  if (!chatId) return order;
  const next = order.filter((id) => id !== chatId);
  next.push(chatId);
  return next;
}

export function pruneMessageThreads(state: MessageThreadState): Pick<
  InboxState,
  'messagesByChat' | 'messageThreadOrder' | 'lastSyncMessages' | 'oldestMessageDateByChat' | 'oldestMessageIdByChat' | 'hasMoreHistoryByChat'
> {
  const retainedIds = new Set<string>();

  if (state.selectedChatId) {
    retainedIds.add(state.selectedChatId);
  }

  for (let index = state.messageThreadOrder.length - 1; index >= 0; index -= 1) {
    const chatId = state.messageThreadOrder[index];
    if (!state.messagesByChat[chatId]) continue;
    retainedIds.add(chatId);
    if (retainedIds.size >= MAX_IN_MEMORY_MESSAGE_THREADS) break;
  }

  const nextMessagesByChat: MessagesRecord = {};
  const nextLastSyncMessages: TimestampRecord = {};
  const nextOldestMessageDateByChat: TimestampRecord = {};
  const nextOldestMessageIdByChat: IdRecord = {};
  const nextHasMoreHistoryByChat: BooleanRecord = {};

  retainedIds.forEach((chatId) => {
    if (state.messagesByChat[chatId]) {
      nextMessagesByChat[chatId] = state.messagesByChat[chatId];
    }
    if (chatId in state.lastSyncMessages) {
      nextLastSyncMessages[chatId] = state.lastSyncMessages[chatId];
    }
    if (chatId in state.oldestMessageDateByChat) {
      nextOldestMessageDateByChat[chatId] = state.oldestMessageDateByChat[chatId];
    }
    if (chatId in state.oldestMessageIdByChat) {
      nextOldestMessageIdByChat[chatId] = state.oldestMessageIdByChat[chatId];
    }
    if (chatId in state.hasMoreHistoryByChat) {
      nextHasMoreHistoryByChat[chatId] = state.hasMoreHistoryByChat[chatId];
    }
  });

  return {
    messagesByChat: nextMessagesByChat,
    messageThreadOrder: state.messageThreadOrder.filter((chatId) => retainedIds.has(chatId)),
    lastSyncMessages: nextLastSyncMessages,
    oldestMessageDateByChat: nextOldestMessageDateByChat,
    oldestMessageIdByChat: nextOldestMessageIdByChat,
    hasMoreHistoryByChat: nextHasMoreHistoryByChat,
  };
}

export function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Map<string, Message>();
  messages.forEach((message) => {
    seen.set(message.id, message);
  });
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export function removeReplacedOptimisticMessages(current: Message[], incomingMessages: Message[]): Message[] {
  return incomingMessages.reduce((acc, incoming) => {
    if (!incoming.sentByTab) {
      return acc;
    }

    const incomingOptimisticId = incoming.metadata?.optimisticId;
    const contentCandidates = acc.filter(
      (message) =>
        message.optimistic &&
        message.sentByTab === incoming.sentByTab &&
        message.content === incoming.content
    );
    const contentMatchIdToRemove =
      contentCandidates.length === 1 ? contentCandidates[0].id : null;

    return acc.filter((message) => {
      if (message.optimistic && message.sentByTab === incoming.sentByTab) {
        if (message.id === incoming.id) return false;
        if (incomingOptimisticId && message.id === incomingOptimisticId) return false;
        if (contentMatchIdToRemove && message.id === contentMatchIdToRemove) return false;
      }
      return true;
    });
  }, current);
}
