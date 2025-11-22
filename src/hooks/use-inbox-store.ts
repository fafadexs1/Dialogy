import { create } from 'zustand';
import type { Chat, Contact, Message } from '@/lib/types';

type MessagesRecord = Record<string, Message[]>;
type TimestampRecord = Record<string, string | null>;
type BooleanRecord = Record<string, boolean>;

type InboxState = {
  chats: Chat[];
  messagesByChat: MessagesRecord;
  selectedChatId: string | null;
  lastSyncChats: string | null;
  lastSyncMessages: TimestampRecord;
  oldestMessageDateByChat: TimestampRecord;
  hasMoreHistoryByChat: BooleanRecord;
  setInitialData: (payload: {
    chats: Chat[];
    selectedChatId: string | null;
    messages: Message[];
    lastSyncChats: string | null;
    lastSyncMessageForSelected: string | null;
    oldestMessageDate: string | null;
    hasMoreHistory: boolean;
  }) => void;
  setSelectedChatId: (chatId: string | null) => void;
  upsertChats: (chats: Chat[], lastSyncChats?: string | null) => void;
  updateChatContact: (contact: Contact) => void;
  setMessagesForChat: (chatId: string, messages: Message[], lastSync?: string | null, oldestDate?: string | null, hasMoreHistory?: boolean) => void;
  appendMessagesToChat: (chatId: string, messages: Message[], lastSync?: string | null) => void;
  prependMessagesToChat: (chatId: string, messages: Message[], oldestDate?: string | null, hasMoreHistory?: boolean) => void;
  markChatAsRead: (chatId: string) => void;
  incrementUnread: (chatId: string) => void;
  removeMessagesForChat: (chatId: string, predicate: (message: Message) => boolean) => void;
  reset: () => void;
};

const baseState = {
  chats: [] as Chat[],
  messagesByChat: {} as MessagesRecord,
  selectedChatId: null as string | null,
  lastSyncChats: null as string | null,
  lastSyncMessages: {} as TimestampRecord,
  oldestMessageDateByChat: {} as TimestampRecord,
  hasMoreHistoryByChat: {} as BooleanRecord,
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

export const useInboxStore = create<InboxState>((set, get) => ({
  ...baseState,
  setInitialData: ({
    chats,
    selectedChatId,
    messages,
    lastSyncChats,
    lastSyncMessageForSelected,
    oldestMessageDate,
    hasMoreHistory,
  }) => {
    set({
      chats: chats.sort((a, b) => getChatSortValue(b) - getChatSortValue(a)),
      selectedChatId,
      messagesByChat: selectedChatId ? { [selectedChatId]: messages } : {},
      lastSyncChats,
      lastSyncMessages: selectedChatId ? { [selectedChatId]: lastSyncMessageForSelected ?? null } : {},
      oldestMessageDateByChat: selectedChatId ? { [selectedChatId]: oldestMessageDate ?? null } : {},
      hasMoreHistoryByChat: selectedChatId ? { [selectedChatId]: hasMoreHistory } : {},
    });
  },
  setSelectedChatId: (chatId) => set({ selectedChatId: chatId }),
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
  },
  updateChatContact: (contact) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.contact?.id === contact.id ? { ...chat, contact: { ...chat.contact, ...contact } } : chat
      ),
    }));
  },
  setMessagesForChat: (chatId, messages, lastSync, oldestDate, hasMoreHistory) => {
    set((state) => ({
      messagesByChat: { ...state.messagesByChat, [chatId]: dedupeMessages(messages) },
      lastSyncMessages:
        typeof lastSync !== 'undefined'
          ? { ...state.lastSyncMessages, [chatId]: lastSync }
          : state.lastSyncMessages,
      oldestMessageDateByChat:
        typeof oldestDate !== 'undefined'
          ? { ...state.oldestMessageDateByChat, [chatId]: oldestDate }
          : state.oldestMessageDateByChat,
      hasMoreHistoryByChat:
        typeof hasMoreHistory !== 'undefined'
          ? { ...state.hasMoreHistoryByChat, [chatId]: hasMoreHistory }
          : state.hasMoreHistoryByChat,
    }));
  },
  appendMessagesToChat: (chatId, messages, lastSync) => {
    if (!messages.length) return;
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      const cleanedCurrent = messages.reduce((acc, incoming) => {
        if (incoming.sentByTab) {
          return acc.filter(
            (message) => !(message.optimistic && message.sentByTab === incoming.sentByTab)
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
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: merged },
        chats: chats.sort((a, b) => getChatSortValue(b) - getChatSortValue(a)),
        lastSyncMessages: lastSync
          ? { ...state.lastSyncMessages, [chatId]: lastSync }
          : state.lastSyncMessages,
      };
    });
  },
  prependMessagesToChat: (chatId, messages, oldestDate, hasMoreHistory) => {
    if (!messages.length) return;
    set((state) => {
      const current = state.messagesByChat[chatId] || [];
      const merged = dedupeMessages([...messages, ...current]);
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: merged },
        oldestMessageDateByChat:
          typeof oldestDate !== 'undefined'
            ? { ...state.oldestMessageDateByChat, [chatId]: oldestDate }
            : state.oldestMessageDateByChat,
        hasMoreHistoryByChat:
          typeof hasMoreHistory !== 'undefined'
            ? { ...state.hasMoreHistoryByChat, [chatId]: hasMoreHistory }
            : state.hasMoreHistoryByChat,
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
