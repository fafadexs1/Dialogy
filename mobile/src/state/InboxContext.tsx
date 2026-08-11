import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadChatMessages, loadCurrentSessionBootstrap, loadInboxBootstrap, loadOlderChats as loadOlderChatsApi, markChatRead, sendMessage as sendMessageApi, signIn, signOut } from "@/services/mobileApi";
import { supabase } from "@/services/supabase";
import type { Chat, ChatPagination, InboxBootstrap, LoginInput, Message, SendMessageInput, User } from "@/types";
import {
  mergeInitialMessagePage,
  messageFromRealtimeRecord,
  parseMobileRealtimeEnvelope,
  reconcileMobileRealtimeMessages,
  upsertMobileMessage,
} from "@/state/inbox-reconciliation";

type InboxState = {
  user: User | null;
  chats: Chat[];
  messagesByChatId: Record<string, Message[]>;
  isLoading: boolean;
  error: string | null;
  selectedChatId: string | null;
  selectedChat: Chat | null;
  selectedMessages: Message[];
  loadingMessagesByChatId: Record<string, boolean>;
  loadingOlderMessagesByChatId: Record<string, boolean>;
  messageErrorsByChatId: Record<string, string | null>;
  hasMoreMessagesByChatId: Record<string, boolean>;
  hasMoreChats: boolean;
  isLoadingMoreChats: boolean;
  selectChat: (chatId: string) => void;
  refresh: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  sendMessage: (input: SendMessageInput) => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  loadOlderMessages: (chatId: string) => Promise<void>;
  loadMoreChats: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
};

const InboxContext = createContext<InboxState | null>(null);

const EMPTY_CHAT_PAGINATION: ChatPagination = {
  active: { hasMore: false, cursor: null },
  closed: { hasMore: false, cursor: null },
};

export function InboxProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesByChatId, setMessagesByChatId] = useState<Record<string, Message[]>>({});
  const [loadingMessagesByChatId, setLoadingMessagesByChatId] = useState<Record<string, boolean>>({});
  const [loadingOlderMessagesByChatId, setLoadingOlderMessagesByChatId] = useState<Record<string, boolean>>({});
  const [messageErrorsByChatId, setMessageErrorsByChatId] = useState<Record<string, string | null>>({});
  const [hasMoreMessagesByChatId, setHasMoreMessagesByChatId] = useState<Record<string, boolean>>({});
  const [oldestCursorByChatId, setOldestCursorByChatId] = useState<Record<string, { createdAt: string; id: string } | null>>({});
  const [chatPagination, setChatPagination] = useState<ChatPagination>(EMPTY_CHAT_PAGINATION);
  const [isLoadingMoreChats, setIsLoadingMoreChats] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chatIdsRef = useRef<Set<string>>(new Set());
  const chatsRef = useRef<Chat[]>([]);
  const selectedChatIdRef = useRef<string | null>(null);
  const messagesByChatIdRef = useRef<Record<string, Message[]>>({});

  useEffect(() => {
    chatIdsRef.current = new Set(chats.map((chat) => chat.id));
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    messagesByChatIdRef.current = messagesByChatId;
  }, [messagesByChatId]);

  const applyBootstrap = useCallback((bootstrap: InboxBootstrap) => {
    setUser(bootstrap.user);
    setChats(bootstrap.chats);
    setChatPagination(bootstrap.chatPagination ?? EMPTY_CHAT_PAGINATION);
    setMessagesByChatId((current) => ({ ...bootstrap.messagesByChatId, ...current }));
    setSelectedChatId((current) => current ?? bootstrap.chats[0]?.id ?? null);
  }, []);

  const loadMessages = useCallback(async (chatId: string) => {
    const idsPresentWhenRequestStarted = new Set(
      (messagesByChatIdRef.current[chatId] ?? []).map((message) => message.id),
    );
    setError(null);
    setLoadingMessagesByChatId((current) => ({ ...current, [chatId]: true }));
    setMessageErrorsByChatId((current) => ({ ...current, [chatId]: null }));
    try {
      const page = await loadChatMessages(chatId);
      setMessagesByChatId((current) => ({
        ...current,
        [chatId]: mergeInitialMessagePage(page.messages, current[chatId] ?? [], idsPresentWhenRequestStarted),
      }));
      setHasMoreMessagesByChatId((current) => ({ ...current, [chatId]: page.hasMore }));
      setOldestCursorByChatId((current) => ({ ...current, [chatId]: page.oldestCursor }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar mensagens.";
      setError(message);
      setMessageErrorsByChatId((current) => ({ ...current, [chatId]: message }));
    } finally {
      setLoadingMessagesByChatId((current) => ({ ...current, [chatId]: false }));
    }
  }, []);

  const loadOlderMessages = useCallback(async (chatId: string) => {
    const cursor = oldestCursorByChatId[chatId];
    if (!cursor || loadingOlderMessagesByChatId[chatId] || hasMoreMessagesByChatId[chatId] === false) return;

    setLoadingOlderMessagesByChatId((current) => ({ ...current, [chatId]: true }));
    setMessageErrorsByChatId((current) => ({ ...current, [chatId]: null }));
    try {
      const page = await loadChatMessages(chatId, cursor);
      setMessagesByChatId((current) => {
        const existing = current[chatId] ?? [];
        const existingIds = new Set(existing.map((message) => message.id));
        const older = page.messages.filter((message) => !existingIds.has(message.id));
        return { ...current, [chatId]: [...older, ...existing] };
      });
      setHasMoreMessagesByChatId((current) => ({ ...current, [chatId]: page.hasMore }));
      setOldestCursorByChatId((current) => ({ ...current, [chatId]: page.oldestCursor }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar mensagens antigas.";
      setError(message);
      setMessageErrorsByChatId((current) => ({ ...current, [chatId]: message }));
    } finally {
      setLoadingOlderMessagesByChatId((current) => ({ ...current, [chatId]: false }));
    }
  }, [hasMoreMessagesByChatId, loadingOlderMessagesByChatId, oldestCursorByChatId]);

  const loadMoreChats = useCallback(async () => {
    if (!user?.workspaceId || isLoadingMoreChats) return;
    const kind = chatPagination.active.hasMore && chatPagination.active.cursor
      ? "active"
      : chatPagination.closed.hasMore && chatPagination.closed.cursor
        ? "closed"
        : null;
    if (!kind) return;
    const cursor = chatPagination[kind].cursor;
    if (!cursor) return;

    setIsLoadingMoreChats(true);
    try {
      const page = await loadOlderChatsApi(user.workspaceId, kind, cursor);
      setChats((current) => {
        const byId = new Map(current.map((chat) => [chat.id, chat]));
        page.chats.forEach((chat) => byId.set(chat.id, chat));
        return [...byId.values()].sort(
          (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        );
      });
      setChatPagination((current) => ({
        ...current,
        [kind]: { hasMore: page.hasMore, cursor: page.nextCursor },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar mais conversas.");
    } finally {
      setIsLoadingMoreChats(false);
    }
  }, [chatPagination, isLoadingMoreChats, user?.workspaceId]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      applyBootstrap(await loadInboxBootstrap(user?.workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o inbox.");
    } finally {
      setIsLoading(false);
    }
  }, [applyBootstrap, user?.workspaceId]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (!workspaceId || workspaceId === user?.workspaceId) return;
    setIsLoading(true);
    setError(null);
    setMessagesByChatId({});
    setLoadingMessagesByChatId({});
    setLoadingOlderMessagesByChatId({});
    setMessageErrorsByChatId({});
    setHasMoreMessagesByChatId({});
    setOldestCursorByChatId({});
    setChatPagination(EMPTY_CHAT_PAGINATION);
    setSelectedChatId(null);
    try {
      applyBootstrap(await loadInboxBootstrap(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao trocar workspace.");
    } finally {
      setIsLoading(false);
    }
  }, [applyBootstrap, user?.workspaceId]);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (token) {
        supabase.realtime.setAuth(token);
      }
    });
    loadCurrentSessionBootstrap()
      .then((bootstrap) => {
        if (!mounted) return;
        if (bootstrap) {
          applyBootstrap(bootstrap);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Falha ao restaurar sessao.");
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token;
      if (token) {
        supabase.realtime.setAuth(token);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [applyBootstrap]);

  useEffect(() => {
    if (!user?.workspaceId) return;

    let disposed = false;
    const chatChannel = supabase
      .channel(`workspace:${user.workspaceId}:chats`, { config: { private: true } })
      .on("broadcast", { event: "*" }, (event) => {
        const record = event.payload?.payload?.record ?? event.payload?.record;
        if (!record?.id) return;
        let found = false;
        setChats((current) =>
          current.map((chat) => {
            if (chat.id !== record.id) return chat;
            found = true;
            return {
              ...chat,
              status: record.assigned_system_agent_id ? "robo" : record.status ?? chat.status,
              assignedTo: record.agent_name ?? chat.assignedTo,
              isAiActive: record.is_autopilot_active ?? Boolean(record.assigned_system_agent_id) ?? chat.isAiActive
            };
          })
        );
        if (!found) {
          void refresh();
        }
      })
      .subscribe();

    const messageChannel = supabase
      .channel(`workspace:${user.workspaceId}:messages`, { config: { private: true } })
      .on("broadcast", { event: "*" }, (event) => {
        const envelope = parseMobileRealtimeEnvelope(event);
        const record = envelope.record;
        const oldRecord = envelope.oldRecord;
        const recordChatId = record?.chat_id ?? oldRecord?.chat_id;
        if (!recordChatId) return;

        const belongsToVisibleChat = chatIdsRef.current.has(recordChatId);
        if (!belongsToVisibleChat) {
          void refresh();
          return;
        }

        const fallbackChannel = chatsRef.current.find((chat) => chat.id === recordChatId)?.contact.channel ?? "whatsapp";
        const currentSelectedChatId = selectedChatIdRef.current;
        setMessagesByChatId((current) => {
          const existing = current[recordChatId] ?? [];
          const reconciled = reconcileMobileRealtimeMessages(existing, envelope, recordChatId, fallbackChannel);
          return reconciled === existing ? current : { ...current, [recordChatId]: reconciled };
        });

        if (envelope.operation === "DELETE") {
          void refresh();
          return;
        }

        if (envelope.operation !== "INSERT" || !record?.id) return;
        const message = messageFromRealtimeRecord(record, recordChatId, fallbackChannel);
        const isActivelyReading = currentSelectedChatId === recordChatId;
        setChats((current) =>
          current
            .map((chat) =>
              chat.id === recordChatId
                ? {
                    ...chat,
                    lastMessage: message.content,
                    lastMessageAt: message.createdAt,
                    unreadCount: message.fromMe || isActivelyReading ? 0 : chat.unreadCount + 1
                  }
                : chat
            )
            .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        );
        if (!message.fromMe && isActivelyReading) {
          void markChatRead(recordChatId).catch(() => undefined);
        }
      })
      .subscribe();

    return () => {
      disposed = true;
      void disposed;
      supabase.removeChannel(chatChannel);
      supabase.removeChannel(messageChannel);
    };
  }, [refresh, user?.workspaceId]);

  const sendMessage = useCallback(async (input: SendMessageInput) => {
    const messageId = input.messageId ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: Message = {
      id: messageId,
      chatId: input.chatId,
      content: input.content,
      createdAt: new Date().toISOString(),
      fromMe: true,
      channel: chats.find((chat) => chat.id === input.chatId)?.contact.channel ?? "whatsapp",
      status: "pending"
    };

    setMessagesByChatId((current) => ({
      ...current,
      [input.chatId]: [...(current[input.chatId] ?? []), optimistic]
    }));

    try {
      const sent = await sendMessageApi({ ...input, messageId });
      setMessagesByChatId((current) => ({
        ...current,
        [input.chatId]: upsertMobileMessage(current[input.chatId] ?? [], sent),
      }));
      setChats((current) =>
        current.map((chat) =>
          chat.id === input.chatId
            ? { ...chat, lastMessage: input.content, lastMessageAt: sent.createdAt, unreadCount: 0 }
            : chat
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao enviar mensagem.";
      setError(message);
      setMessagesByChatId((current) => ({
        ...current,
        [input.chatId]: (current[input.chatId] ?? []).map((candidate) =>
          candidate.id === messageId ? { ...candidate, status: "error" as const } : candidate
        ),
      }));
      throw err;
    }
  }, [chats]);

  const selectChat = useCallback((chatId: string) => {
    selectedChatIdRef.current = chatId;
    setSelectedChatId(chatId);
    setChats((current) => current.map((chat) => (
      chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
    )));
    void markChatRead(chatId).catch(() => undefined);
  }, []);

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null;
  const selectedMessages = selectedChatId ? messagesByChatId[selectedChatId] ?? [] : [];

  const login = useCallback(async (input: LoginInput) => {
    setIsLoading(true);
    setError(null);
    try {
      applyBootstrap(await signIn(input.email, input.password));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao entrar.";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [applyBootstrap]);

  const logout = useCallback(async () => {
    await signOut();
    setUser(null);
    setChats([]);
    setMessagesByChatId({});
    setLoadingMessagesByChatId({});
    setLoadingOlderMessagesByChatId({});
    setMessageErrorsByChatId({});
    setHasMoreMessagesByChatId({});
    setOldestCursorByChatId({});
    setChatPagination(EMPTY_CHAT_PAGINATION);
    setSelectedChatId(null);
  }, []);

  const value = useMemo<InboxState>(() => ({
    user,
    chats,
    messagesByChatId,
    isLoading,
    error,
    selectedChatId,
    selectedChat,
    selectedMessages,
    loadingMessagesByChatId,
    loadingOlderMessagesByChatId,
    messageErrorsByChatId,
    hasMoreMessagesByChatId,
    hasMoreChats: chatPagination.active.hasMore || chatPagination.closed.hasMore,
    isLoadingMoreChats,
    selectChat,
    refresh,
    switchWorkspace,
    sendMessage,
    loadMessages,
    loadOlderMessages,
    loadMoreChats,
    login,
    logout
  }), [chatPagination.active.hasMore, chatPagination.closed.hasMore, chats, error, hasMoreMessagesByChatId, isLoading, isLoadingMoreChats, loadMessages, loadMoreChats, loadOlderMessages, loadingMessagesByChatId, loadingOlderMessagesByChatId, login, logout, messageErrorsByChatId, messagesByChatId, refresh, selectChat, selectedChat, selectedChatId, selectedMessages, sendMessage, switchWorkspace, user]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox() {
  const context = useContext(InboxContext);
  if (!context) {
    throw new Error("useInbox must be used inside InboxProvider");
  }
  return context;
}
