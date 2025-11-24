'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag, Contact } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { getInitialChatsData, syncInboxData, getChatMessagesWindow } from '@/actions/chats';
import { Skeleton } from '../ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { replaceChatPath } from '@/lib/chat-navigation';
import { useRouter } from 'next/navigation';
import { useInboxStore } from '@/hooks/use-inbox-store';

// Notification sounds served from public assets
const SOUND_SOURCES = {
  queue: '/sounds/new-message.mp3',
  attending: '/sounds/message-incoming-02-199577.mp3',
} as const;
const FALLBACK_TIMEZONE = 'America/Sao_Paulo';
const IS_DEV = process.env.NODE_ENV !== 'production';

function LoadingSkeleton() {
  return (
    <div className="flex flex-1 w-full min-h-0 h-full bg-black/20 backdrop-blur-xl">
      <div className="flex w-[360px] flex-shrink-0 flex-col border-r border-white/10 bg-black/20 backdrop-blur-xl p-4 gap-4">
        <Skeleton className="h-12 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
        <div className="space-y-2 mt-4">
          <Skeleton className="h-16 w-full bg-white/5" />
          <Skeleton className="h-16 w-full bg-white/5" />
          <Skeleton className="h-16 w-full bg-white/5" />
          <Skeleton className="h-16 w-full bg-white/5" />
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-transparent">
        <Skeleton className="h-16 w-full bg-white/5" />
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-10 w-1/2 ml-auto bg-white/5" />
          <Skeleton className="h-10 w-1/2 bg-white/5" />
          <Skeleton className="h-10 w-1/2 ml-auto bg-white/5" />
        </div>
        <Skeleton className="h-24 w-full bg-white/5" />
      </div>
      <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l border-white/10 bg-black/20 backdrop-blur-xl p-4 gap-4">
        <Skeleton className="h-16 w-full bg-white/5" />
        <Skeleton className="h-24 w-full bg-white/5" />
        <Skeleton className="h-32 w-full bg-white/5" />
      </div>
    </div>
  );
}



export default function CustomerChatLayout({ initialUser, chatId: initialChatId }: { initialUser: User | null, chatId: string | null }) {
  const router = useRouter();
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [broadcastChannel, setBroadcastChannel] = useState<BroadcastChannel | null>(null);
  const [workspaceTimezone, setWorkspaceTimezone] = useState<string>(FALLBACK_TIMEZONE);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [debugCounter, setDebugCounter] = useState(0);

  const chats = useInboxStore((state) => state.chats);
  const selectedChatId = useInboxStore((state) => state.selectedChatId);
  const messagesByChat = useInboxStore((state) => state.messagesByChat);
  const oldestMessageDateByChat = useInboxStore((state) => state.oldestMessageDateByChat);
  const hasMoreHistoryByChat = useInboxStore((state) => state.hasMoreHistoryByChat);
  const setInitialData = useInboxStore((state) => state.setInitialData);
  const setSelectedChatId = useInboxStore((state) => state.setSelectedChatId);
  const upsertChats = useInboxStore((state) => state.upsertChats);
  const setMessagesForChat = useInboxStore((state) => state.setMessagesForChat);
  const appendMessagesToChat = useInboxStore((state) => state.appendMessagesToChat);
  const prependMessagesToChat = useInboxStore((state) => state.prependMessagesToChat);
  const updateChatContact = useInboxStore((state) => state.updateChatContact);
  const markChatAsReadInStore = useInboxStore((state) => state.markChatAsRead);
  const incrementUnread = useInboxStore((state) => state.incrementUnread);
  const removeMessagesForChat = useInboxStore((state) => state.removeMessagesForChat);

  const selectedChatIdRef = useRef<string | null>(initialChatId);
  const audioRefs = useRef<{ queue: HTMLAudioElement | null; attending: HTMLAudioElement | null }>({
    queue: null,
    attending: null,
  });
  const tabIdRef = useRef<string>('');
  const audioUnlockRequestedRef = useRef(false);
  const unreadCountsRef = useRef<Record<string, number>>({});
  const unreadWatchInitializedRef = useRef(false);

  useEffect(() => {
    useInboxStore.getState().reset();
    console.log('[NOTIFICATION] Layout mounted. Waiting for inbox data...');
  }, []);

  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = window.crypto.randomUUID();
    console.log('[NOTIFICATION] Generated tabId for notifications:', tabIdRef.current);
  }

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && !session) {
        router.replace('/login');
      }
    });

    console.log('[NOTIFICATION] Auth listener registered');
    return () => {
      data.subscription.unsubscribe();
    };
  }, [router]);

  const updateSelectedChatPath = useCallback((chatId?: string | null) => {
    replaceChatPath(chatId);
  }, []);

  const selectedChat = useMemo(() => chats.find((chat) => chat.id === selectedChatId) || null, [chats, selectedChatId]);
  const currentChatMessages = selectedChatId ? messagesByChat[selectedChatId] || [] : [];
  const hasMoreHistory = selectedChatId ? hasMoreHistoryByChat[selectedChatId] ?? true : false;
  const oldestLoadedMessageDate = selectedChatId ? oldestMessageDateByChat[selectedChatId] : null;

  const formatMessageDay = useCallback((date: Date) => {
    const zonedDate = toZonedTime(date, workspaceTimezone);
    if (isToday(zonedDate)) return 'Hoje';
    if (isYesterday(zonedDate)) return 'Ontem';
    return formatDate(zonedDate, 'dd/MM/yyyy', { locale: ptBR });
  }, [workspaceTimezone]);

  const mapRealtimePayload = useCallback((payload: RealtimePostgresChangesPayload<any>): Message | null => {
    const data = payload.new as any;
    if (!data) return null;
    try {
      const createdAt = new Date(data.created_at);
      const timestamp = formatInTimeZone(createdAt, workspaceTimezone, 'HH:mm', { locale: ptBR });
      const formattedDate = formatMessageDay(createdAt);
      let metadata;
      if (data.metadata) {
        metadata = typeof data.metadata === 'object' ? data.metadata : JSON.parse(data.metadata);
      }
      const chat = chats.find((c) => c.id === data.chat_id);
      let sender = undefined;
      if (data.from_me) {
        if (chat?.agent) {
          sender = { id: chat.agent.id, name: chat.agent.name, avatar: chat.agent.avatar_url, type: 'user' } as const;
        } else if (initialUser) {
          sender = { id: initialUser.id, name: initialUser.name, avatar: initialUser.avatar_url, type: 'user' } as const;
        }
      } else if (chat?.contact) {
        sender = { id: chat.contact.id, name: chat.contact.name, avatar: chat.contact.avatar_url, type: 'contact' } as const;
      }
      return {
        id: data.id,
        chat_id: data.chat_id,
        workspace_id: data.workspace_id,
        content: data.content || '',
        type: data.type,
        status: data.content === 'Mensagem apagada' ? 'deleted' : 'default',
        metadata,
        transcription: data.transcription,
        timestamp,
        createdAt: createdAt.toISOString(),
        updatedAt: data.updated_at ? new Date(data.updated_at).toISOString() : createdAt.toISOString(),
        formattedDate,
        sender,
        instance_name: data.instance_name,
        source_from_api: data.source_from_api,
        api_message_status: data.api_message_status,
        message_id_from_api: data.message_id_from_api,
        from_me: data.from_me,
        is_read: data.is_read,
        sentByTab: data.sent_by_tab ?? null,
      };
    } catch (error) {
      console.error('[REALTIME] Failed to parse payload', error);
      return null;
    }
  }, [chats, formatMessageDay, workspaceTimezone, initialUser]);

  const unlockAudio = useCallback(async () => {
    const refs = [audioRefs.current.queue, audioRefs.current.attending];
    let unlocked = false;
    for (const audio of refs) {
      if (!audio) continue;
      try {
        audio.muted = true;
        audio.currentTime = 0;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        unlocked = true;
      } catch (err) {
        console.warn('[NOTIFICATION] Audio unlock failed for one source, still blocked by browser', err);
      }
    }
    setNeedsAudioUnlock(!unlocked);
    if (unlocked) {
      console.log('[NOTIFICATION] Audio unlocked by user gesture');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleGesture = () => {
      unlockAudio();
    };
    window.addEventListener('pointerdown', handleGesture, { once: true });
    window.addEventListener('keydown', handleGesture, { once: true });
    window.addEventListener('touchstart', handleGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, [unlockAudio]);

  useEffect(() => {
    console.log('[NOTIFICATION] Audio element ready? queue:', !!audioRefs.current.queue, 'attending:', !!audioRefs.current.attending, 'Needs unlock?', needsAudioUnlock);
  }, [needsAudioUnlock]);

  const playNotificationSound = useCallback((kind: keyof typeof SOUND_SOURCES = 'queue') => {
    const isSoundEnabled = JSON.parse(localStorage.getItem('notificationSoundEnabled') || 'true');
    const audio = audioRefs.current[kind];
    const src = SOUND_SOURCES[kind];
    console.log('[NOTIFICATION] Attempting to play sound. Kind:', kind, 'Enabled:', isSoundEnabled, 'AudioRef:', !!audio, 'Src:', audio?.src, 'Volume:', audio?.volume);
    if (!isSoundEnabled) return;

    const tryPlay = async () => {
      if (!audio) return;
      audio.muted = false;
      audio.volume = 1;
      audio.currentTime = 0;
      await audio.play();
      console.log('[NOTIFICATION] Sound played successfully (ref)', kind);
    };

    tryPlay().catch(async (e) => {
      console.error('[NOTIFICATION] Error playing notification sound (ref):', e);
      if (e?.name === 'NotAllowedError' && !audioUnlockRequestedRef.current) {
        setNeedsAudioUnlock(true);
        audioUnlockRequestedRef.current = true;
      }
      try {
        console.log('[NOTIFICATION] Trying fallback Audio() playback');
        const fallback = new Audio(src);
        fallback.volume = 1;
        await fallback.play();
        console.log('[NOTIFICATION] Sound played successfully (fallback)', kind);
      } catch (fallbackError) {
        console.error('[NOTIFICATION] Fallback playback failed:', fallbackError);
      }
    });
  }, []);

  useEffect(() => {
    if (!unreadWatchInitializedRef.current) {
      unreadCountsRef.current = Object.fromEntries(chats.map((c) => [c.id, c.unreadCount || 0]));
      unreadWatchInitializedRef.current = true;
      return;
    }

    chats.forEach((chat) => {
      const prev = unreadCountsRef.current[chat.id] ?? 0;
      const current = chat.unreadCount || 0;
      if (current > prev) {
        if (chat.status === 'gerais') {
          console.log('[NOTIFICATION] Unread increased for queue chat', chat.id, 'from', prev, 'to', current);
          playNotificationSound('queue');
        } else if (chat.status === 'atendimentos') {
          console.log('[NOTIFICATION] Unread increased for attending chat', chat.id, 'from', prev, 'to', current);
          playNotificationSound('attending');
        }
      }
      unreadCountsRef.current[chat.id] = current;
    });
  }, [chats, playNotificationSound]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__playNotificationTest = (kind: keyof typeof SOUND_SOURCES = 'queue') => {
      console.log('[NOTIFICATION] Manual test trigger', kind);
      playNotificationSound(kind);
    };
    return () => {
      delete (window as any).__playNotificationTest;
    };
  }, [playNotificationSound]);

  const handleRealtimeMessage = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
    const message = mapRealtimePayload(payload);
    if (!message) return;

    console.log('[REALTIME] Message received:', message.id, 'Chat:', message.chat_id, 'FromMe:', message.from_me);

    const messageChat = chats.find((chat) => chat.id === message.chat_id);
    const isQueueMessage = messageChat?.status === 'gerais';
    const isAttendingMessage = messageChat?.status === 'atendimentos';

    appendMessagesToChat(message.chat_id, [message], message.updatedAt);
    if (message.sentByTab && message.sentByTab === tabIdRef.current) {
      removeMessagesForChat(message.chat_id, (m) => !!m.optimistic && m.sentByTab === message.sentByTab);
    }
    if (!message.from_me) {
      if (message.chat_id !== selectedChatId) {
        incrementUnread(message.chat_id);
      }

      const shouldPlay = isQueueMessage || document.visibilityState !== 'visible' || message.chat_id !== selectedChatId;
      console.log('[REALTIME] Should play?', shouldPlay, 'Visibility:', document.visibilityState, 'SelectedChat:', selectedChatId, 'MsgChat:', message.chat_id, 'QueueMsg:', isQueueMessage, 'AttendingMsg:', isAttendingMessage);

      if (shouldPlay) {
        if (isAttendingMessage) {
          playNotificationSound('attending');
        } else {
          playNotificationSound('queue');
        }
      }
    }
  }, [appendMessagesToChat, chats, incrementUnread, mapRealtimePayload, playNotificationSound, selectedChatId, removeMessagesForChat]);

  const loadChatMessages = useCallback(async (chatId: string, before?: string | null) => {
    try {
      const result = await getChatMessagesWindow({ chatId, before: before ?? undefined });
      if (result.error) throw new Error(result.error);
      if (before) {
        prependMessagesToChat(chatId, result.messages, result.oldestMessageDate, result.hasMoreHistory);
      } else {
        setMessagesForChat(chatId, result.messages, result.lastSyncMessage, result.oldestMessageDate, result.hasMoreHistory);
      }
      if (result.contact) {
        updateChatContact(result.contact);
      }
    } catch (error: any) {
      console.error('[LOAD_MESSAGES] Error:', error);
      toast({ title: 'Erro ao carregar mensagens', description: error.message || 'Tente novamente.', variant: 'destructive' });
    }
  }, [prependMessagesToChat, setMessagesForChat, updateChatContact]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedChatId) return;
    const before = oldestLoadedMessageDate;
    if (!before) return;
    await loadChatMessages(selectedChatId, before);
  }, [loadChatMessages, oldestLoadedMessageDate, selectedChatId]);

  const ensureMessagesForChat = useCallback(async (chatId: string) => {
    const currentMessages = useInboxStore.getState().messagesByChat[chatId];
    if (currentMessages && currentMessages.length) return;
    await loadChatMessages(chatId);
  }, [loadChatMessages]);

  const handleSetSelectedChat = useCallback((chat: Chat) => {
    selectedChatIdRef.current = chat.id;
    setSelectedChatId(chat.id);
    setShowFullHistory(false);
    updateSelectedChatPath(chat.id);
    void ensureMessagesForChat(chat.id);
  }, [ensureMessagesForChat, setSelectedChatId, updateSelectedChatPath]);

  const initializeInbox = useCallback(async () => {
    if (!initialUser?.activeWorkspaceId) {
      setFetchError('Usuário ou workspace não encontrado.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setFetchError(null);
    try {
      const result = await getInitialChatsData({
        workspaceId: initialUser.activeWorkspaceId,
        selectedChatId: initialChatId,
      });
      if (result.error) throw new Error(result.error);
      setWorkspaceTimezone(result.timezone || FALLBACK_TIMEZONE);
      setInitialData({
        chats: result.chats,
        selectedChatId: result.selectedChatId,
        messages: result.messages,
        lastSyncChats: result.lastSyncChats,
        lastSyncMessageForSelected: result.lastSyncMessageForSelected,
        oldestMessageDate: result.oldestMessageDate,
        hasMoreHistory: result.hasMoreHistory,
      });
      if (result.selectedChatId) {
        selectedChatIdRef.current = result.selectedChatId;
        updateSelectedChatPath(result.selectedChatId);
      } else {
        updateSelectedChatPath(null);
      }
    } catch (error: any) {
      console.error('[INITIAL_CHATS] Error:', error);
      const message = error.message || 'Não foi possível buscar os dados do chat.';
      toast({ title: 'Erro ao carregar conversas', description: message, variant: 'destructive' });
      setFetchError(message);
    } finally {
      setIsLoading(false);
    }
  }, [initialChatId, initialUser?.activeWorkspaceId, setInitialData, updateSelectedChatPath]);

  const runDeltaSync = useCallback(async () => {
    if (!initialUser?.activeWorkspaceId) return;
    const snapshot = useInboxStore.getState();
    try {
      const result = await syncInboxData({
        workspaceId: initialUser.activeWorkspaceId,
        lastSyncChats: snapshot.lastSyncChats,
        chatId: snapshot.selectedChatId,
        lastSyncMessages: snapshot.selectedChatId ? snapshot.lastSyncMessages[snapshot.selectedChatId] ?? null : null,
      });
      if (result.error) {
        console.error('[SYNC_INBOX] Error:', result.error);
        return;
      }

      // Wrap state updates in startTransition to keep UI fluid (high refresh rate feel)
      React.startTransition(() => {
        upsertChats(result.deltaChats, result.lastSyncChats);
        if (result.updatedContacts.length) {
          result.updatedContacts.forEach((contact) => updateChatContact(contact));
        }
        if (result.deltaMessages.length && snapshot.selectedChatId) {
          appendMessagesToChat(snapshot.selectedChatId, result.deltaMessages, result.lastSyncMessage ?? undefined);
        }
      });
    } catch (error) {
      console.error('[SYNC_INBOX] Unexpected error:', error);
    }
  }, [appendMessagesToChat, initialUser?.activeWorkspaceId, updateChatContact, upsertChats]);

  const notifyPeers = useCallback(() => {
    if (!broadcastChannel) return;
    broadcastChannel.postMessage({ type: 'DELTA_SYNC', sourceTabId: tabIdRef.current });
  }, [broadcastChannel]);

  const handleDataMutation = useCallback(async () => {
    await runDeltaSync();
    notifyPeers();
  }, [notifyPeers, runDeltaSync]);

  useEffect(() => {
    if (initialUser?.activeWorkspaceId) {
      getTags(initialUser.activeWorkspaceId).then(tagsResult => {
        if (!tagsResult.error && tagsResult.tags) {
          setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
        }
      });
    }
  }, [initialUser?.activeWorkspaceId]);

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runDeltaSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [initialUser?.activeWorkspaceId, runDeltaSync]);

  // Polling mechanism
  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    let timeoutId: NodeJS.Timeout;
    let isPolling = true;

    const poll = async () => {
      if (!isPolling) return;

      // Only poll if the tab is visible to save resources/bandwidth
      if (document.visibilityState === 'visible') {
        await runDeltaSync();
      }

      if (isPolling) {
        timeoutId = setTimeout(poll, 1000);
      }
    };

    // Start polling
    poll();

    return () => {
      isPolling = false;
      clearTimeout(timeoutId);
    };
  }, [initialUser?.activeWorkspaceId, runDeltaSync]);

  useEffect(() => {
    if (!selectedChatId || !currentChatMessages.length || !document.hasFocus()) return;
    const hasUnread = currentChatMessages.some(m => !m.from_me && !m.is_read);

    if (hasUnread) {
      markChatAsReadInStore(selectedChatId);

      fetch('/api/chats/mark-as-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: selectedChatId })
      }).catch(() => {
        console.error('Failed to mark messages as read on the server. Data will sync on next fetch.');
      });
    }
  }, [selectedChatId, currentChatMessages, markChatAsReadInStore]);

  const realtimeChannelRef = useRef<any>(null);

  // Ref to keep track of the latest handleRealtimeMessage without re-subscribing
  const handleRealtimeMessageRef = useRef(handleRealtimeMessage);
  useEffect(() => {
    handleRealtimeMessageRef.current = handleRealtimeMessage;
  }, [handleRealtimeMessage]);

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    // We want a single subscription for the whole workspace to handle incoming messages for ALL chats
    // This allows us to:
    // 1. Play notifications for messages in other chats
    // 2. Update unread counts for other chats
    // 3. Update the message list if the chat is open

    const channelName = `realtime-messages-workspace-${initialUser.activeWorkspaceId}`;

    if (realtimeChannelRef.current && realtimeChannelRef.current.topic !== channelName) {
      console.info(`[REALTIME] Removing old channel ${realtimeChannelRef.current.topic}`);
      const supabase = createClient();
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    if (realtimeChannelRef.current) {
      return; // Already subscribed to the correct channel
    }

    const supabase = createClient();
    console.info(`[REALTIME] Subscribing to channel ${channelName}`);

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `workspace_id=eq.${initialUser.activeWorkspaceId}`
      }, (payload) => handleRealtimeMessageRef.current(payload))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `workspace_id=eq.${initialUser.activeWorkspaceId}`
      }, (payload) => handleRealtimeMessageRef.current(payload))
      .subscribe((status) => {
        console.info(`[REALTIME] Channel ${channelName} status: ${status}`);
      });

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        console.info(`[REALTIME] Cleaning up channel ${channelName}`);
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [initialUser?.activeWorkspaceId]);

  useEffect(() => {
    if (initialUser) {
      initializeInbox();
    } else {
      setIsLoading(false);
    }
  }, [initialUser, initializeInbox]);

  useEffect(() => {
    if (selectedChatId) {
      selectedChatIdRef.current = selectedChatId;
    }
  }, [selectedChatId]);

  if (!initialUser) {
    return <LoadingSkeleton />;
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (fetchError) {
    return (
      <div className="flex flex-1 w-full min-h-0 h-full items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro Crítico ao Carregar Dados</AlertTitle>
          <AlertDescription className='break-all'>
            Não foi possível carregar os dados das conversas. Por favor, verifique o console do servidor para mais detalhes.
            <p className="mt-2 text-xs font-mono p-2 bg-secondary rounded">Detalhe: {fetchError}</p>
          </AlertDescription>
          <Button onClick={() => initializeInbox()} className="mt-4">
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar Novamente
          </Button>
        </Alert>
      </div>
    )
  }

  const enrichedSelectedChat = selectedChat ? {
    ...selectedChat,
    messages: currentChatMessages,
    unreadCount: currentChatMessages.filter(m => !m.from_me && !m.is_read).length,
  } : null;

  return (
    <div className="relative h-full flex-1 w-full min-h-0 flex overflow-hidden bg-black selection:bg-blue-500/30">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
        <div className="absolute -left-[10%] top-[20%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]" />
        <div className="absolute -right-[10%] bottom-[20%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[100px]" />
      </div>

      <div className="relative z-10 flex h-full w-full overflow-hidden backdrop-blur-[1px]">
        {needsAudioUnlock && (
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-md">
            <span>Habilite o som de novas mensagens</span>
            <Button size="sm" variant="secondary" onClick={unlockAudio}>Habilitar</Button>
          </div>
        )}
        {IS_DEV && (
          <div className="absolute top-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-md">
            <span>Som</span>
            <Button size="sm" variant="outline" onClick={() => { setDebugCounter((n) => n + 1); playNotificationSound('queue'); }}>
              Fila ({debugCounter})
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setDebugCounter((n) => n + 1); playNotificationSound('attending'); }}>
              Atend. ({debugCounter})
            </Button>
          </div>
        )}
        <audio ref={(el) => { audioRefs.current.queue = el; }} src={SOUND_SOURCES.queue} preload="auto" />
        <audio ref={(el) => { audioRefs.current.attending = el; }} src={SOUND_SOURCES.attending} preload="auto" />
        <ChatList
          chats={chats}
          selectedChat={enrichedSelectedChat}
          setSelectedChat={handleSetSelectedChat}
          currentUser={initialUser}
          onUpdate={handleDataMutation}
        />
        <ChatPanel
          key={selectedChat?.id}
          chat={enrichedSelectedChat}
          currentUser={initialUser}
          onActionSuccess={handleDataMutation}
          closeReasons={closeReasons}
          showFullHistory={showFullHistory}
          setShowFullHistory={setShowFullHistory}
          tabId={tabIdRef.current}
          onLoadOlderMessages={loadOlderMessages}
          canLoadOlder={hasMoreHistory}
        />
        <ContactPanel
          chat={enrichedSelectedChat}
          currentUser={initialUser}
          onTransferSuccess={handleDataMutation}
          onContactUpdate={handleDataMutation}
        />
      </div>
    </div>
  );
}
