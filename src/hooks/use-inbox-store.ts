import { create } from 'zustand';
import type { Chat, Contact, Message } from '@/lib/types';
import { cacheService } from '@/lib/cache';

type MessagesRecord = Record<string, Message[]>;
type TimestampRecord = Record<string, string | null>;
type IdRecord = Record<string, string | null>;
type BooleanRecord = Record<string, boolean>;

type InboxState = {
  chats: Chat[];
  messagesByChat: MessagesRecord;
  messageThreadOrder: string[];
  selectedChatId: string | null;
  lastSyncChats: string | null;
  lastSyncMessages: TimestampRecord;
  oldestMessageDateByChat: TimestampRecord;
  oldestMessageIdByChat: IdRecord;
  hasMoreHistoryByChat: BooleanRecord;
  hasMoreChats: boolean;
  setInitialData: (payload: {
    chats: Chat[];
    selectedChatId: string | null;
    messages: Message[];
    lastSyncChats: string | null;
    lastSyncMessageForSelected: string | null;
    oldestMessageDate: string | null;
    oldestMessageId: string | null;
    hasMoreHistory: boolean;
    hasMoreChats: boolean;
  }) => void;
  setSelectedChatId: (chatId: string | null) => void;
  upsertChats: (chats: Chat[], lastSyncChats?: string | null) => void;
  appendChats: (chats: Chat[]) => void;
  setHasMoreChats: (hasMore: boolean) => void;
  updateChatContact: (contact: Contact) => void;
  setMessagesForChat: (chatId: string, messages: Message[], lastSync?: string | null, oldestDate?: string | null, oldestId?: string | null, hasMoreHistory?: boolean, replace?: boolean) => void;
  appendMessagesToChat: (chatId: string, messages: Message[], lastSync?: string | null) => void;
  prependMessagesToChat: (chatId: string, messages: Message[], oldestDate?: string | null, oldestId?: string | null, hasMoreHistory?: boolean) => void;
  markChatAsRead: (chatId: string) => void;
  incrementUnread: (chatId: string) => void;
  removeMessagesForChat: (chatId: string, predicate: (message: Message) => boolean) => void;
  markMessagesAsReadByRecipient: (chatId: string, upToDate: string) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  replaceOptimisticMessage: (chatId: string, optimisticId: string, realMessage: Message) => void;
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
  removeChat: (chatId: string) => void;
  drafts: Record<string, string>;
  setDraft: (chatId: string, text: string) => void;
  reset: () => void;
};

const baseState = {
  chats: [] as Chat[],
  messagesByChat: {} as MessagesRecord,
  messageThreadOrder: [] as string[],
  selectedChatId: null as string | null,
  lastSyncChats: null as string | null,
  lastSyncMessages: {} as TimestampRecord,
  oldestMessageDateByChat: {} as TimestampRecord,
  oldestMessageIdByChat: {} as IdRecord,
  hasMoreHistoryByChat: {} as BooleanRecord,
  hasMoreChats: false,
  drafts: {} as Record<string, string>,
};

const getChatSortValue = (chat: Chat): number => {
  if (chat.updatedAt) {
    return new Date(chat.updatedAt).getTime();
  }
  const lastMessage = chat.messages?.[chat.messages.length - 1];
  if (lastMessage) {
    return new Date(lastMessage.createdAt).getTime();
  }
  return 0;
};

const MAX_IN_MEMORY_MESSAGE_THREADS = 12;

type MessageThreadState = Pick<
  InboxState,
  'messagesByChat' | 'messageThreadOrder' | 'lastSyncMessages' | 'oldestMessageDateByChat' | 'oldestMessageIdByChat' | 'hasMoreHistoryByChat' | 'selectedChatId'
>;

function touchMessageThread(order: string[], chatId: string | null | undefined): string[] {
  if (!chatId) return order;
  const next = order.filter((id) => id !== chatId);
  next.push(chatId);
  return next;
}

function pruneMessageThreads(state: MessageThreadState): Pick<
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

export const useInboxStore = create<InboxState>((set, get) => ({
  ...baseState,
  setInitialData: ({
    chats,
    selectedChatId,
    messages,
    lastSyncChats,
    lastSyncMessageForSelected,
    oldestMessageDate,
    oldestMessageId,
    hasMoreHistory,
    hasMoreChats,
  }) => {
    set((state) => {
      const hasSelection = !!selectedChatId;
      const existingMessages = hasSelection ? state.messagesByChat[selectedChatId!] || [] : [];
      const shouldPreserveMessages = hasSelection && messages.length === 0 && existingMessages.length > 0;
      const nextMessagesByChat = hasSelection
        ? {
          ...state.messagesByChat,
          ...(shouldPreserveMessages ? {} : { [selectedChatId!]: messages }),
        }
        : state.messagesByChat;
      const nextLastSyncMessages = hasSelection
        ? {
          ...state.lastSyncMessages,
          ...(shouldPreserveMessages && lastSyncMessageForSelected == null
            ? {}
            : { [selectedChatId!]: lastSyncMessageForSelected ?? null }),
        }
        : state.lastSyncMessages;
      const nextOldestMessageDateByChat = hasSelection
        ? {
          ...state.oldestMessageDateByChat,
          ...(shouldPreserveMessages ? {} : { [selectedChatId!]: oldestMessageDate ?? null }),
        }
        : state.oldestMessageDateByChat;
      const nextOldestMessageIdByChat = hasSelection
        ? {
          ...state.oldestMessageIdByChat,
          ...(shouldPreserveMessages ? {} : { [selectedChatId!]: oldestMessageId ?? null }),
        }
        : state.oldestMessageIdByChat;
      const nextHasMoreHistoryByChat = hasSelection
        ? {
          ...state.hasMoreHistoryByChat,
          ...(shouldPreserveMessages ? {} : { [selectedChatId!]: hasMoreHistory }),
        }
        : state.hasMoreHistoryByChat;
      const nextMessageThreadOrder = touchMessageThread(state.messageThreadOrder, selectedChatId);
      const prunedState = pruneMessageThreads({
        messagesByChat: nextMessagesByChat,
        messageThreadOrder: nextMessageThreadOrder,
        lastSyncMessages: nextLastSyncMessages,
        oldestMessageDateByChat: nextOldestMessageDateByChat,
        oldestMessageIdByChat: nextOldestMessageIdByChat,
        hasMoreHistoryByChat: nextHasMoreHistoryByChat,
        selectedChatId,
      });

      return {
        chats: chats.sort((a, b) => getChatSortValue(b) - getChatSortValue(a)),
        selectedChatId,
        ...prunedState,
        lastSyncChats,
        hasMoreChats,
      };
    });

    // Persist to IndexedDB (fire-and-forget)
    if (chats.length > 0 && chats[0]?.workspace_id) {
      const workspaceId = chats[0].workspace_id;
      cacheService.setChats(workspaceId, chats).catch(() => { });
      if (selectedChatId && messages.length > 0) {
        cacheService.setMessages(selectedChatId, workspaceId, messages).catch(() => { });
      }
    }
  },
  setSelectedChatId: (chatId) => set((state) => {
    const nextMessageThreadOrder = touchMessageThread(state.messageThreadOrder, chatId);
    return {
      selectedChatId: chatId,
      ...pruneMessageThreads({
        messagesByChat: state.messagesByChat,
        messageThreadOrder: nextMessageThreadOrder,
        lastSyncMessages: state.lastSyncMessages,
        oldestMessageDateByChat: state.oldestMessageDateByChat,
        oldestMessageIdByChat: state.oldestMessageIdByChat,
        hasMoreHistoryByChat: state.hasMoreHistoryByChat,
        selectedChatId: chatId,
      }),
    };
  }),
  upsertChats: (incomingChats, lastSyncChats) => {
    if (!incomingChats.length) {
      if (lastSyncChats) {
        set({ lastSyncChats });
      }
      return;
    }
    set((state) => {
      const chatMap = new Map<string, Chat>();
      state.chats.forEach((chat) => chatMap.set(chat.id, chat));
      incomingChats.forEach((chat) => {
        const existing = chatMap.get(chat.id);
        if (existing) {
          chatMap.set(chat.id, {
            ...existing,
            ...chat,
            messages: chat.messages?.length ? chat.messages : existing.messages,
            contact: chat.contact || existing.contact,
            agent: chat.agent || existing.agent,
          });
        } else {
          chatMap.set(chat.id, chat);
        }
      });
      const nextChats = Array.from(chatMap.values()).sort(
        (a, b) => getChatSortValue(b) - getChatSortValue(a)
      );
      return {
        chats: nextChats,
        lastSyncChats: lastSyncChats ?? state.lastSyncChats,
      };
    });

    // Persist full merged chats to IndexedDB (fire-and-forget)
    const workspaceId = incomingChats[0]?.workspace_id;
    if (incomingChats.length > 0 && workspaceId) {
      const fullChats = get().chats;
      cacheService.setChats(workspaceId, fullChats).catch(() => { });
    }
  },
  appendChats: (incomingChats) => {
    if (!incomingChats.length) return;
    set((state) => {
      const chatMap = new Map<string, Chat>();
      state.chats.forEach((chat) => chatMap.set(chat.id, chat));
      incomingChats.forEach((chat) => {
        if (!chatMap.has(chat.id)) {
          chatMap.set(chat.id, chat);
        }
      });
      const nextChats = Array.from(chatMap.values()).sort(
        (a, b) => getChatSortValue(b) - getChatSortValue(a)
      );
      return { chats: nextChats };
    });
  },
  setHasMoreChats: (hasMore) => set({ hasMoreChats: hasMore }),
  updateChatContact: (contact) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.contact?.id === contact.id ? { ...chat, contact: { ...chat.contact, ...contact } } : chat
      ),
    }));
  },
  setMessagesForChat: (chatId, messages, lastSync, oldestDate, oldestId, hasMoreHistory, replace = false) => {
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      const merged = replace ? dedupeMessages(messages) : dedupeMessages([...current, ...messages]);
      const nextMessagesByChat = { ...state.messagesByChat, [chatId]: merged };
      const nextLastSyncMessages =
        typeof lastSync !== 'undefined'
          ? { ...state.lastSyncMessages, [chatId]: lastSync }
          : state.lastSyncMessages;
      const nextOldestMessageDateByChat =
        typeof oldestDate !== 'undefined'
          ? { ...state.oldestMessageDateByChat, [chatId]: oldestDate }
          : state.oldestMessageDateByChat;
      const nextOldestMessageIdByChat =
        typeof oldestId !== 'undefined'
          ? { ...state.oldestMessageIdByChat, [chatId]: oldestId }
          : state.oldestMessageIdByChat;
      const nextHasMoreHistoryByChat =
        typeof hasMoreHistory !== 'undefined'
          ? { ...state.hasMoreHistoryByChat, [chatId]: hasMoreHistory }
          : state.hasMoreHistoryByChat;
      const prunedState = pruneMessageThreads({
        messagesByChat: nextMessagesByChat,
        messageThreadOrder: touchMessageThread(state.messageThreadOrder, chatId),
        lastSyncMessages: nextLastSyncMessages,
        oldestMessageDateByChat: nextOldestMessageDateByChat,
        oldestMessageIdByChat: nextOldestMessageIdByChat,
        hasMoreHistoryByChat: nextHasMoreHistoryByChat,
        selectedChatId: state.selectedChatId,
      });
      return {
        ...prunedState,
      };
    });
  },
  appendMessagesToChat: (chatId, messages, lastSync) => {
    if (!messages.length) return;
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      const cleanedCurrent = messages.reduce((acc, incoming) => {
        if (incoming.sentByTab) {
          const incomingOptimisticId = incoming.metadata?.optimisticId;
          const contentCandidates = acc.filter(
            (message) =>
              message.optimistic &&
              message.sentByTab === incoming.sentByTab &&
              message.content === incoming.content
          );
          const contentMatchIdToRemove =
            contentCandidates.length === 1 ? contentCandidates[0].id : null;
          return acc.filter(
            (message) => {
              // Remove only the matching optimistic message for this tab.
              // Prefer ID/optimisticId match; use content match only when it's unambiguous.
              if (message.optimistic && message.sentByTab === incoming.sentByTab) {
                // Strict ID match: Always replace.
                if (message.id === incoming.id) return false;

                // Optimistic ID match (via metadata): Logic for when server ID differs but it's the same message.
                if (incomingOptimisticId && message.id === incomingOptimisticId) return false;

                // Content match: If IDs differ (server ignored client ID), assume same message if content matches.
                // This prevents "stuck as sending" duplicates while preserving other distinct pending messages.
                if (contentMatchIdToRemove && message.id === contentMatchIdToRemove) return false;

                return true;
              }
              return true;
            }
          );
        }
        return acc;
      }, current);
      const merged = dedupeMessages([...cleanedCurrent, ...messages]);
      const latest = merged[merged.length - 1];
      const chats = state.chats.map((chat) =>
        chat.id === chatId
          ? {
            ...chat,
            messages: latest ? [latest] : chat.messages,
            updatedAt: latest?.createdAt || chat.updatedAt,
          }
          : chat
      );
      const nextMessagesByChat = { ...state.messagesByChat, [chatId]: merged };
      const nextLastSyncMessages = lastSync
        ? { ...state.lastSyncMessages, [chatId]: lastSync }
        : state.lastSyncMessages;
      const prunedState = pruneMessageThreads({
        messagesByChat: nextMessagesByChat,
        messageThreadOrder: touchMessageThread(state.messageThreadOrder, chatId),
        lastSyncMessages: nextLastSyncMessages,
        oldestMessageDateByChat: state.oldestMessageDateByChat,
        oldestMessageIdByChat: state.oldestMessageIdByChat,
        hasMoreHistoryByChat: state.hasMoreHistoryByChat,
        selectedChatId: state.selectedChatId,
      });
      return {
        ...prunedState,
        chats: chats.sort((a, b) => getChatSortValue(b) - getChatSortValue(a)),
      };
    });

    // Persist new messages to IndexedDB (fire-and-forget, only non-optimistic)
    const nonOptimisticMessages = messages.filter((m) => !m.optimistic);
    if (nonOptimisticMessages.length > 0 && nonOptimisticMessages[0]?.workspace_id) {
      cacheService.appendMessages(
        chatId,
        nonOptimisticMessages[0].workspace_id,
        nonOptimisticMessages
      ).catch(() => { });
    }
  },
  prependMessagesToChat: (chatId, messages, oldestDate, oldestId, hasMoreHistory) => {
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      const merged = messages.length ? dedupeMessages([...messages, ...current]) : current;
      const shouldUpdateCursor = messages.length > 0;
      const nextMessagesByChat = messages.length
        ? { ...state.messagesByChat, [chatId]: merged }
        : state.messagesByChat;
      const nextOldestMessageDateByChat =
        shouldUpdateCursor && typeof oldestDate !== 'undefined'
          ? { ...state.oldestMessageDateByChat, [chatId]: oldestDate }
          : state.oldestMessageDateByChat;
      const nextOldestMessageIdByChat =
        shouldUpdateCursor && typeof oldestId !== 'undefined'
          ? { ...state.oldestMessageIdByChat, [chatId]: oldestId }
          : state.oldestMessageIdByChat;
      const nextHasMoreHistoryByChat =
        typeof hasMoreHistory !== 'undefined'
          ? { ...state.hasMoreHistoryByChat, [chatId]: hasMoreHistory }
          : state.hasMoreHistoryByChat;
      const prunedState = pruneMessageThreads({
        messagesByChat: nextMessagesByChat,
        messageThreadOrder: touchMessageThread(state.messageThreadOrder, chatId),
        lastSyncMessages: state.lastSyncMessages,
        oldestMessageDateByChat: nextOldestMessageDateByChat,
        oldestMessageIdByChat: nextOldestMessageIdByChat,
        hasMoreHistoryByChat: nextHasMoreHistoryByChat,
        selectedChatId: state.selectedChatId,
      });
      return {
        ...prunedState,
      };
    });
  },
  markChatAsRead: (chatId) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
      ),
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: (state.messagesByChat[chatId] || []).map((message) =>
          !message.from_me ? { ...message, is_read: true } : message
        ),
      },
    }));
  },
  incrementUnread: (chatId) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId
          ? { ...chat, unreadCount: (chat.unreadCount || 0) + 1 }
          : chat
      ),
    }));
  },
  removeMessagesForChat: (chatId, predicate) => {
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: current.filter((message) => !predicate(message)),
        },
      };
    });
  },
  markMessagesAsReadByRecipient: (chatId, upToDate) => {
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      // Add a small buffer (2 seconds) to account for minor clock skews or precision loss
      const upToTime = new Date(upToDate).getTime() + 2000;

      let updatedCount = 0;
      const updated = current.map((message) => {
        if (message.from_me && new Date(message.createdAt).getTime() <= upToTime && message.api_message_status !== 'READ') {
          updatedCount++;
          return { ...message, api_message_status: 'READ' };
        }
        return message;
      });

      if (updatedCount > 0) {
        console.log(`[STORE] Optimistically marked ${updatedCount} messages as READ in chat ${chatId}`);
      }

      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: updated,
        },
      };
    });
  },
  updateMessage: (chatId, messageId, updates) => {
    set((state) => {
      const currentMessages = state.messagesByChat[chatId] || [];
      const updatedMessages = currentMessages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      );
      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: updatedMessages,
        },
      };
    });
  },
  replaceOptimisticMessage: (chatId, optimisticId, realMessage) => {
    set((state) => {
      const currentMessages = state.messagesByChat[chatId] || [];
      // Replace the message with the matching optimisticId
      const updatedMessages = currentMessages.map((msg) =>
        msg.id === optimisticId ? realMessage : msg
      );

      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: updatedMessages,
        },
      };
    });
  },
  updateChat: (chatId, updates) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, ...updates } : chat
      ),
    }));
  },
  removeChat: (chatId) => {
    set((state) => {
      const { [chatId]: _removedMessages, ...remainingMessagesByChat } = state.messagesByChat;
      const { [chatId]: _removedSync, ...remainingLastSyncMessages } = state.lastSyncMessages;
      const { [chatId]: _removedOldestDate, ...remainingOldestMessageDates } = state.oldestMessageDateByChat;
      const { [chatId]: _removedOldestId, ...remainingOldestMessageIds } = state.oldestMessageIdByChat;
      const { [chatId]: _removedHasMore, ...remainingHasMoreHistory } = state.hasMoreHistoryByChat;

      return {
        chats: state.chats.filter((chat) => chat.id !== chatId),
        selectedChatId: state.selectedChatId === chatId ? null : state.selectedChatId,
        ...pruneMessageThreads({
          messagesByChat: remainingMessagesByChat,
          messageThreadOrder: state.messageThreadOrder.filter((id) => id !== chatId),
          lastSyncMessages: remainingLastSyncMessages,
          oldestMessageDateByChat: remainingOldestMessageDates,
          oldestMessageIdByChat: remainingOldestMessageIds,
          hasMoreHistoryByChat: remainingHasMoreHistory,
          selectedChatId: state.selectedChatId === chatId ? null : state.selectedChatId,
        }),
      };
    });
  },
  setDraft: (chatId, text) => {
    const normalizedText = normalizeDraftForStorage(text);
    set((state) => {
      if (!normalizedText) {
        const { [chatId]: _removed, ...remainingDrafts } = state.drafts;
        return { drafts: remainingDrafts };
      }

      return {
        drafts: { ...state.drafts, [chatId]: normalizedText },
      };
    });
  },
  reset: () =>
    set({
      ...baseState,
    }),
}));

function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Map<string, Message>();
  messages.forEach((message) => {
    seen.set(message.id, message);
  });
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function normalizeDraftForStorage(text: string): string {
  if (!text) return '';

  const plainText = text
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\u200B/g, '')
    .trim();

  return plainText.length > 0 ? text : '';
}
