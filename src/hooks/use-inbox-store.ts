import { create } from 'zustand';
import type { Chat, Contact, Message } from '@/lib/types';
import { cacheService } from '@/lib/cache';
import { appendNewChatsById, dedupeChats, mergeChatsById, sortChatsByActivity } from '@/hooks/inbox-store/chat-list-slice';
import { dedupeMessages, pruneMessageThreads, removeReplacedOptimisticMessages, touchMessageThread } from '@/hooks/inbox-store/message-thread-slice';
import { normalizeDraftForStorage } from '@/hooks/inbox-store/draft-slice';
import { baseInboxState, type InboxState } from '@/hooks/inbox-store/types';
import { isChatInInboxQueueScope } from '@/lib/inbox-pagination';

const messagesForChat = (chatId: string, messages: Message[]) =>
  messages.filter((message) => message.chat_id === chatId);

export const useInboxStore = create<InboxState>((set, get) => ({
  ...baseInboxState,
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
    inboxCounts,
    chatPagination,
  }) => {
    const scopedMessages = selectedChatId ? messagesForChat(selectedChatId, messages) : [];
    set((state) => {
      const hasSelection = !!selectedChatId;
      const existingMessages = hasSelection
        ? messagesForChat(selectedChatId!, state.messagesByChat[selectedChatId!] || [])
        : [];
      const shouldPreserveMessages = hasSelection && scopedMessages.length === 0 && existingMessages.length > 0;
      const nextMessagesByChat = hasSelection
        ? {
          ...state.messagesByChat,
          ...(shouldPreserveMessages ? {} : { [selectedChatId!]: scopedMessages }),
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
        chats: dedupeChats(
          sortChatsByActivity(chats),
          selectedChatId
        ),
        selectedChatId,
        ...prunedState,
        lastSyncChats,
        hasMoreChats,
        inboxCounts: inboxCounts ?? state.inboxCounts,
        chatPagination: chatPagination ?? state.chatPagination,
      };
    });

    // Persist to IndexedDB (fire-and-forget)
    const persistedChats = get().chats;
    if (persistedChats.length > 0 && persistedChats[0]?.workspace_id) {
      const workspaceId = persistedChats[0].workspace_id;
      cacheService.setChats(workspaceId, persistedChats).catch(() => { });
      if (selectedChatId && scopedMessages.length > 0) {
        cacheService.setMessages(selectedChatId, workspaceId, scopedMessages).catch(() => { });
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
      const nextChats = mergeChatsById(state.chats, incomingChats);
      return {
        chats: dedupeChats(nextChats, state.selectedChatId),
        lastSyncChats: lastSyncChats ?? state.lastSyncChats,
      };
    });

    // Persiste só o que mudou. Reescrever a lista inteira aqui custava um
    // JSON.stringify + put por chat em memoria a cada delta sync (a cada 3s sob
    // carga), mesmo quando um único chat tinha mudado — era a maior fonte de
    // lixo no heap e de travada na aba.
    const workspaceId = incomingChats[0]?.workspace_id;
    if (workspaceId) {
      const touchedIds = new Set(incomingChats.map((chat) => chat.id));
      const mergedTouchedChats = get().chats.filter((chat) => touchedIds.has(chat.id));
      if (mergedTouchedChats.length > 0) {
        cacheService.setChats(workspaceId, mergedTouchedChats).catch(() => { });
      }
    }
  },
  appendChats: (incomingChats) => {
    if (!incomingChats.length) return;
    set((state) => {
      const nextChats = appendNewChatsById(state.chats, incomingChats);
      return { chats: dedupeChats(nextChats, state.selectedChatId) };
    });
  },
  replaceChatsForStatus: (status, incomingChats) => {
    set((state) => {
      const selectedStatusChat = state.chats.find((chat) => (
        chat.id === state.selectedChatId && chat.status === status
      ));
      const otherStatuses = state.chats.filter((chat) => chat.status !== status);
      const nextStatusChats = selectedStatusChat && !incomingChats.some((chat) => chat.id === selectedStatusChat.id)
        ? [...incomingChats, selectedStatusChat]
        : incomingChats;

      return {
        chats: dedupeChats(
          sortChatsByActivity([...otherStatuses, ...nextStatusChats]),
          state.selectedChatId
        ),
      };
    });
  },
  replaceChatsForQueueScope: (scope, incomingChats) => {
    set((state) => {
      const belongsToScope = (chat: Chat) => isChatInInboxQueueScope(chat, scope);
      const selectedScopeChat = state.chats.find((chat) => (
        chat.id === state.selectedChatId && belongsToScope(chat)
      ));
      const otherScopes = state.chats.filter((chat) => !belongsToScope(chat));
      const nextScopeChats = selectedScopeChat && !incomingChats.some((chat) => chat.id === selectedScopeChat.id)
        ? [...incomingChats, selectedScopeChat]
        : incomingChats;

      return {
        chats: dedupeChats(
          sortChatsByActivity([...otherScopes, ...nextScopeChats]),
          state.selectedChatId
        ),
      };
    });
  },
  setInboxCounts: (inboxCounts) => set({ inboxCounts }),
  setChatPagination: (tab, pagination) => set((state) => {
    const chatPagination = {
      ...state.chatPagination,
      [tab]: pagination,
    };
    return {
      chatPagination,
      hasMoreChats: Object.values(chatPagination).some((page) => page.hasMore),
    };
  }),
  setHasMoreChats: (hasMore) => set({ hasMoreChats: hasMore }),
  updateChatContact: (contact) => {
    set((state) => ({
      chats: state.chats.map((chat) => {
        const matchesContact =
          chat.contact?.id === contact.id ||
          (chat as any).contact_id === contact.id ||
          (Boolean(contact.phone_number_jid) && chat.contact?.phone_number_jid === contact.phone_number_jid);
        if (!matchesContact) return chat;
        return {
          ...chat,
          contact_id: contact.id,
          contact: { ...(chat.contact || {}), ...contact },
        };
      }),
    }));
  },
  setMessagesForChat: (chatId, messages, lastSync, oldestDate, oldestId, hasMoreHistory, replace = false) => {
    const scopedMessages = messagesForChat(chatId, messages);
    set((state) => {
      const current = messagesForChat(chatId, state.messagesByChat[chatId] || []);
      const merged = replace ? dedupeMessages(scopedMessages) : dedupeMessages([...current, ...scopedMessages]);
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
    const scopedMessages = messagesForChat(chatId, messages);
    if (!scopedMessages.length) return;
    set((state) => {
      const current = messagesForChat(chatId, state.messagesByChat[chatId] || []);
      const cleanedCurrent = removeReplacedOptimisticMessages(current, scopedMessages);
      const merged = dedupeMessages([...cleanedCurrent, ...scopedMessages]);
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
        chats: sortChatsByActivity(chats),
      };
    });

    // Persist new messages to IndexedDB (fire-and-forget, only non-optimistic)
    const nonOptimisticMessages = scopedMessages.filter((m) => !m.optimistic);
    if (nonOptimisticMessages.length > 0 && nonOptimisticMessages[0]?.workspace_id) {
      cacheService.appendMessages(
        chatId,
        nonOptimisticMessages[0].workspace_id,
        nonOptimisticMessages
      ).catch(() => { });
    }
  },
  prependMessagesToChat: (chatId, messages, oldestDate, oldestId, hasMoreHistory) => {
    const scopedMessages = messagesForChat(chatId, messages);
    set((state) => {
      const current = messagesForChat(chatId, state.messagesByChat[chatId] || []);
      const merged = scopedMessages.length ? dedupeMessages([...scopedMessages, ...current]) : current;
      const shouldUpdateCursor = scopedMessages.length > 0;
      const nextMessagesByChat = scopedMessages.length
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
  setAudioTranscription: (messageId, job) => {
    set((state) => {
      if (!job) {
        const remaining = { ...state.audioTranscriptions };
        delete remaining[messageId];
        return { audioTranscriptions: remaining };
      }

      return {
        audioTranscriptions: {
          ...state.audioTranscriptions,
          [messageId]: job,
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
      ...baseInboxState,
    }),
}));
