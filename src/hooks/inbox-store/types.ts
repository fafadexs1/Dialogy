import type { Chat, Contact, Message } from '@/lib/types';

export type MessagesRecord = Record<string, Message[]>;
export type TimestampRecord = Record<string, string | null>;
export type IdRecord = Record<string, string | null>;
export type BooleanRecord = Record<string, boolean>;

export type InboxState = {
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

export const baseInboxState = {
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
