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

// Base64 encoded, short, and browser-safe notification sound
const NOTIFICATION_SOUND_DATA_URL = 'data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gUmVhbGl0eSBTRlgà®µà®©à®¿à®©à¯';
const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

function LoadingSkeleton() {
  return (
    <div className="flex flex-1 w-full min-h-0 h-full">
        <div className="flex w-[360px] flex-shrink-0 flex-col border-r bg-card p-4 gap-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <div className="space-y-2 mt-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        </div>
        <div className="flex-1 flex flex-col min-w-0">
            <Skeleton className="h-16 w-full" />
            <div className="flex-1 p-6 space-y-4">
                <Skeleton className="h-10 w-1/2 ml-auto" />
                <Skeleton className="h-10 w-1/2" />
                <Skeleton className="h-10 w-1/2 ml-auto" />
            </div>
            <Skeleton className="h-24 w-full" />
        </div>
        <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l bg-card p-4 gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tabIdRef = useRef<string>('');

  useEffect(() => {
    useInboxStore.getState().reset();
  }, []);

  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = window.crypto.randomUUID();
  }

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_OUT' || event === 'USER_DELETED') && !session) {
        router.replace('/login');
      }
    });

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
      const zoned = toZonedTime(createdAt, workspaceTimezone);
      const timestamp = formatInTimeZone(zoned, 'HH:mm', { locale: ptBR, timeZone: workspaceTimezone });
      const formattedDate = formatMessageDay(createdAt);
      let metadata;
      if (data.metadata) {
        metadata = typeof data.metadata === 'object' ? data.metadata : JSON.parse(data.metadata);
      }
      const chat = chats.find((c) => c.id === data.chat_id);
      let sender = undefined;
      if (data.from_me) {
        if (chat?.agent) {
          sender = { id: chat.agent.id, name: chat.agent.name, avatar: chat.agent.avatar_url, type: 'user' };
        } else if (initialUser) {
          sender = { id: initialUser.id, name: initialUser.name, avatar: initialUser.avatar_url, type: 'user' };
        }
      } else if (chat?.contact) {
        sender = { id: chat.contact.id, name: chat.contact.name, avatar: chat.contact.avatar_url, type: 'contact' };
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

  const playNotificationSound = useCallback(() => {
    const isSoundEnabled = JSON.parse(localStorage.getItem('notificationSoundEnabled') || 'true');
    if (isSoundEnabled && audioRef.current) {
        audioRef.current.play().catch(e => console.error('Error playing notification sound:', e));
    }
  }, []);

  const handleRealtimeMessage = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
    const message = mapRealtimePayload(payload);
    if (!message) return;
    appendMessagesToChat(message.chat_id, [message], message.updatedAt);
    if (message.sentByTab && message.sentByTab === tabIdRef.current) {
      removeMessagesForChat(message.chat_id, (m) => m.optimistic && m.sentByTab === message.sentByTab);
    }
    if (!message.from_me) {
      if (message.chat_id !== selectedChatId) {
        incrementUnread(message.chat_id);
      }
      if (document.visibilityState !== 'visible') {
        playNotificationSound();
      }
    }
  }, [appendMessagesToChat, incrementUnread, mapRealtimePayload, playNotificationSound, selectedChatId, removeMessagesForChat]);

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
      upsertChats(result.deltaChats, result.lastSyncChats);
      if (result.updatedContacts.length) {
        result.updatedContacts.forEach((contact) => updateChatContact(contact));
      }
      if (result.deltaMessages.length && snapshot.selectedChatId) {
        appendMessagesToChat(snapshot.selectedChatId, result.deltaMessages, result.lastSyncMessage ?? undefined);
      }
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supabase = createClient();
    if ((window as any).__SCHEMA_DB_CHANNEL__) return;

    const schemaChannel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public' },
        (payload) => console.log('[SCHEMA DB CHANGE]', payload)
      )
      .subscribe((status) => console.info('[SCHEMA DB CHANGE] status:', status));

    (window as any).__SCHEMA_DB_CHANNEL__ = schemaChannel;
    return () => {
      if ((window as any).__SCHEMA_DB_CHANNEL__) {
        supabase.removeChannel((window as any).__SCHEMA_DB_CHANNEL__);
        delete (window as any).__SCHEMA_DB_CHANNEL__;
      }
    };
  }, []);

  const realtimeChannelRef = useRef<any>(null);
  const subscribedChatRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;
    if (!selectedChatId) return;

    if (subscribedChatRef.current === selectedChatId && realtimeChannelRef.current) {
      return;
    }

    const supabase = createClient();
    const channelName = `realtime-messages-${selectedChatId}`;

    if (realtimeChannelRef.current) {
      console.info(`[REALTIME] Removing channel ${realtimeChannelRef.current.topic}`);
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    console.info(`[REALTIME] Subscribing to channel ${channelName}`);
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${selectedChatId}` }, handleRealtimeMessage)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${selectedChatId}` }, handleRealtimeMessage)
      .subscribe((status) => {
        console.info(`[REALTIME] Channel ${channelName} status: ${status}`);
      });

    realtimeChannelRef.current = channel;
    subscribedChatRef.current = selectedChatId;

    return () => {
      if (realtimeChannelRef.current?.topic === channelName) {
        console.info(`[REALTIME] Removing channel ${channelName}`);
        supabase.removeChannel(channel);
        realtimeChannelRef.current = null;
        subscribedChatRef.current = null;
      }
    };
  }, [handleRealtimeMessage, initialUser?.activeWorkspaceId, selectedChatId]);

  useEffect(() => {
    const channel = new BroadcastChannel('chat-updates');
    setBroadcastChannel(channel);

    const handleMessage = (event: MessageEvent) => {
        const { type, sourceTabId } = event.data || {};
        if (sourceTabId === tabIdRef.current) return;
        if (type === 'DELTA_SYNC') {
            runDeltaSync();
        }
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [runDeltaSync]);

  useEffect(() => {
    if (initialUser?.activeWorkspaceId){
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

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      await runDeltaSync();
      if (!stopped) {
        timeoutId = setTimeout(tick, 7000);
      }
    };

    timeoutId = setTimeout(tick, 7000);

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
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
    <div className="h-full flex-1 w-full min-h-0 flex overflow-hidden">
      <audio ref={audioRef} src={NOTIFICATION_SOUND_DATA_URL} preload="auto" />
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
  );
}
