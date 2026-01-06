'use client';
import { v4 as uuidv4 } from 'uuid';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { LayoutGroup } from 'framer-motion';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { CommandPalette } from '../chat/command-palette';
import { type Chat, Message, User, Tag, Contact } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { getInitialChatsData, syncInboxData, getChatMessagesWindow, loadOlderChatsAction } from '@/actions/chats';
import type { InitialChatsPayload } from '@/actions/chats';
import { Skeleton } from '../ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { replaceChatPath } from '@/lib/chat-navigation';
import { useRouter } from 'next/navigation';
import { useInboxStore } from '@/hooks/use-inbox-store';
import ReactDOM from 'react-dom';
import { useRealtimeSubscriptions } from '@/hooks/use-realtime-subscriptions';
import ErrorBoundary from '@/components/layout/error-boundary';
import { reportClientMetric } from '@/lib/observability/client';

// Notification sounds served from public assets
const SOUND_SOURCES = {
  queue: '/sounds/new-message.mp3',
  attending: '/sounds/message-incoming-02-199577.mp3',
} as const;
const FALLBACK_TIMEZONE = 'America/Sao_Paulo';
const IS_DEV = process.env.NODE_ENV !== 'production';

function DraggableSoundTester({
  debugCounter,
  onPlay,
}: {
  debugCounter: number;
  onPlay: (kind: keyof typeof SOUND_SOURCES) => void;
}) {
  const [pos, setPos] = React.useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 16, y: 16 };
    const saved = localStorage.getItem('soundTesterPos');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      } catch { /* ignore */ }
    }
    return { x: 16, y: 16 };
  });

  const dragData = React.useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const savePos = (next: { x: number; y: number }) => {
    setPos(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('soundTesterPos', JSON.stringify(next));
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragData.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragData.current) return;
    const dx = e.clientX - dragData.current.startX;
    const dy = e.clientY - dragData.current.startY;
    savePos({ x: Math.max(8, dragData.current.originX + dx), y: Math.max(8, dragData.current.originY + dy) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragData.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragData.current = null;
  };

  return ReactDOM.createPortal(
    <div
      className="fixed z-50 flex items-center gap-2 rounded-lg border border-border bg-popover/90 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur-md cursor-move"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span>Som</span>
      <Button size="sm" variant="outline" onClick={() => onPlay('queue')}>
        Fila ({debugCounter})
      </Button>
      <Button size="sm" variant="outline" onClick={() => onPlay('attending')}>
        Atend. ({debugCounter})
      </Button>
    </div>,
    document.body
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-1 w-full min-h-0 h-full bg-background/20 backdrop-blur-xl">
      <div className="flex flex-col w-[450px] shrink-0 min-w-0 max-w-full border-r border-border bg-background/20 backdrop-blur-xl p-4 gap-4">
        <Skeleton className="h-12 w-full bg-muted" />
        <Skeleton className="h-10 w-full bg-muted" />
        <Skeleton className="h-10 w-full bg-muted" />
        <div className="space-y-2 mt-4">
          <Skeleton className="h-16 w-full bg-muted" />
          <Skeleton className="h-16 w-full bg-muted" />
          <Skeleton className="h-16 w-full bg-muted" />
          <Skeleton className="h-16 w-full bg-muted" />
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-transparent">
        <Skeleton className="h-16 w-full bg-muted" />
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-10 w-1/2 ml-auto bg-muted" />
          <Skeleton className="h-10 w-1/2 bg-muted" />
          <Skeleton className="h-10 w-1/2 ml-auto bg-muted" />
        </div>
        <Skeleton className="h-24 w-full bg-muted" />
      </div>
      <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l border-border bg-background/20 backdrop-blur-xl p-4 gap-4">
        <Skeleton className="h-16 w-full bg-muted" />
        <Skeleton className="h-24 w-full bg-muted" />
        <Skeleton className="h-32 w-full bg-muted" />
      </div>
    </div>
  );
}

function ChatListSkeleton() {
  return (
    <div className="flex flex-col w-[450px] shrink-0 min-w-0 max-w-full border-r border-border bg-background/20 backdrop-blur-xl p-4 gap-4">
      <Skeleton className="h-6 w-32 bg-muted" />
      <Skeleton className="h-10 w-full bg-muted" />
      <div className="space-y-2 mt-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full bg-muted" />
        ))}
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-transparent">
      <Skeleton className="h-16 w-full bg-muted" />
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-10 w-1/2 ml-auto bg-muted" />
        <Skeleton className="h-10 w-1/2 bg-muted" />
        <Skeleton className="h-10 w-1/2 ml-auto bg-muted" />
      </div>
      <Skeleton className="h-24 w-full bg-muted" />
    </div>
  );
}



export default function CustomerChatLayout({
  initialUser,
  chatId: initialChatId,
  initialData,
}: {
  initialUser: User | null;
  chatId: string | null;
  initialData?: InitialChatsPayload | null;
}) {
  const router = useRouter();
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMoreChats, setIsLoadingMoreChats] = useState(false); // New state for loading more chats
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [broadcastChannel, setBroadcastChannel] = useState<BroadcastChannel | null>(null);
  const [workspaceTimezone, setWorkspaceTimezone] = useState<string>(FALLBACK_TIMEZONE);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [debugCounter, setDebugCounter] = useState(0);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(true);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [selectedForwardingChatIds, setSelectedForwardingChatIds] = useState<Set<string>>(new Set());
  const [isForwarding, setIsForwarding] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [isRTL, setIsRTL] = useState(false);

  const chats = useInboxStore((state) => state.chats);
  const selectedChatId = useInboxStore((state) => state.selectedChatId);
  const messagesByChat = useInboxStore((state) => state.messagesByChat);
  const oldestMessageDateByChat = useInboxStore((state) => state.oldestMessageDateByChat);
  const oldestMessageIdByChat = useInboxStore((state) => state.oldestMessageIdByChat);
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
  const appendChats = useInboxStore((state) => state.appendChats);
  const hasMoreChats = useInboxStore((state) => state.hasMoreChats);
  const setHasMoreChats = useInboxStore((state) => state.setHasMoreChats);

  const handleBoundaryError = useCallback((error: Error) => {
    console.error('[INBOX_UI_ERROR]', error);
  }, []);

  const selectedChatIdRef = useRef<string | null>(initialData?.selectedChatId ?? initialChatId);
  const audioRefs = useRef<{ queue: HTMLAudioElement | null; attending: HTMLAudioElement | null }>({
    queue: null,
    attending: null,
  });
  const jumpChatByOffsetRef = useRef<((delta: number) => void) | null>(null);
  const tabIdRef = useRef<string>('');
  const audioUnlockRequestedRef = useRef(false);
  const unreadCountsRef = useRef<Record<string, number>>({});
  const unreadWatchInitializedRef = useRef(false);
  const runDeltaSyncRef = useRef<(() => Promise<void>) | null>(null);
  const initialBuildIdRef = useRef<string>('');
  const buildMismatchTriggeredRef = useRef(false);
  const prefetchedHistoryRef = useRef<Set<string>>(new Set());

  const isHydratedRef = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Strict Mode Safety: Only reset if we haven't successfully hydrated in this mount cycle.
    // This prevents double-fetching or clearing valid data on dev hot-reloads/strict mode remounts.
    if (!isHydratedRef.current) {
      useInboxStore.getState().reset();
      isHydratedRef.current = false;
      console.log('[NOTIFICATION] Layout mounted. Store reset. Waiting for inbox data...');
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    return () => {
      document.documentElement.dir = 'ltr';
    };
  }, [isRTL]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (highContrast) {
      (document.documentElement as HTMLElement).dataset.highContrast = 'true';
    } else {
      delete (document.documentElement as HTMLElement).dataset.highContrast;
    }
  }, [highContrast]);

  if (typeof window !== 'undefined' && !tabIdRef.current) {
    // Safe UUID generation fallback
    const genId = () => uuidv4();
    tabIdRef.current = genId();
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
  const oldestLoadedMessageId = selectedChatId ? oldestMessageIdByChat[selectedChatId] : null;

  const enrichedSelectedChat = useMemo(() => selectedChat ? {
    ...selectedChat,
    messages: currentChatMessages,
    unreadCount: currentChatMessages.filter(m => !m.from_me && !m.is_read).length,
  } : null, [selectedChat, currentChatMessages]);

  const formatMessageDay = useCallback((date: Date) => {
    const zonedDate = toZonedTime(date, workspaceTimezone);
    if (isToday(zonedDate)) return 'Hoje';
    if (isYesterday(zonedDate)) return 'Ontem';
    return formatDate(zonedDate, 'dd/MM/yyyy', { locale: ptBR });
  }, [workspaceTimezone]);

  const mapRealtimePayload = useCallback((payload: RealtimePostgresChangesPayload<any>): Message | null => {
    const data = payload.new as any;
    if (!data) return null;

    // [DEBUG] Inspect payload structure in production
    // console.log('[REALTIME-DEBUG] CustomerChatLayout mapRealtimePayload keys:', Object.keys(data));
    // console.log('[REALTIME-DEBUG] CustomerChatLayout mapRealtimePayload values:', JSON.stringify(data));
    // console.log('[REALTIME-DEBUG] initialUser:', JSON.stringify(initialUser)); // Check if avatar_url is present

    try {
      let createdAt: Date;
      try {
        createdAt = new Date(data.created_at);
        if (isNaN(createdAt.getTime())) throw new Error('Invalid date');
      } catch {
        createdAt = new Date(); // Fallback to now
      }
      const timestamp = formatInTimeZone(createdAt, workspaceTimezone, 'HH:mm', { locale: ptBR });
      const formattedDate = formatMessageDay(createdAt);
      let metadata;
      if (data.metadata) {
        metadata = typeof data.metadata === 'object' ? data.metadata : JSON.parse(data.metadata);
      }
      const chat = useInboxStore.getState().chats.find((c) => c.id === data.chat_id);
      let sender = undefined;

      // Helper to determine if message is from an automated agent
      const isSystemAgent = data.sender_system_agent_id || metadata?.sentBy === 'system_agent' || metadata?.sentBy === 'autopilot';

      if (data.from_me) {
        if (isSystemAgent) {
          // Use a generic agent profile or the chat's agent if available (but explicitly mark as system/bot if needed)
          sender = {
            id: data.sender_system_agent_id || 'system_agent',
            name: 'Assistente Virtual', // Or use a reliable way to get the agent name if possible
            avatar: chat?.agent?.avatar_url || undefined, // Fallback to chat agent avatar
            type: 'user'
          } as const;
        } else if (data.sender_user_id === initialUser?.id && initialUser) {
          sender = { id: initialUser.id, name: initialUser.name, avatar: initialUser.avatar || initialUser.avatar_url || undefined, type: 'user' } as const;
        } else if (chat?.agent && (!data.sender_user_id || data.sender_user_id === chat.agent.id)) {
          // If sender_id matches chat agent or is missing (legacy), use chat agent
          sender = { id: chat.agent.id, name: chat.agent.name, avatar: chat.agent.avatar || chat.agent.avatar_url || undefined, type: 'user' } as const;
        } else if (initialUser) {
          // Fallback to current user if nothing else matches (e.g. optimistic without ID persistence yet)
          sender = { id: initialUser.id, name: initialUser.name, avatar: initialUser.avatar || initialUser.avatar_url || undefined, type: 'user' } as const;
        }
      } else if (chat?.contact) {
        sender = { id: chat.contact.id, name: chat.contact.name, avatar: chat.contact.avatar_url ?? undefined, type: 'contact' } as const;
      }

      console.log('[REALTIME-DEBUG] Resolved sender:', JSON.stringify(sender)); // Check if avatar is in sender
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
    const readFlag = (key: string, fallback = true): boolean => {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      try {
        return JSON.parse(stored);
      } catch {
        return fallback;
      }
    };

    const isGlobalEnabled = readFlag('notificationSoundEnabled', true);
    const isQueueEnabled = readFlag('notificationSoundQueueEnabled', true);
    const isAttendingEnabled = readFlag('notificationSoundAttendingEnabled', true);
    const isSoundEnabled = isGlobalEnabled && (kind === 'queue' ? isQueueEnabled : isAttendingEnabled);

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
      // Suppress NotAllowedError spam, it's expected if user hasn't interacted
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
      } catch (fallbackError: any) {
        // Only log fallback error if it's not another autoplay block
        if (fallbackError?.name !== 'NotAllowedError') {
          console.error('[NOTIFICATION] Fallback playback failed:', fallbackError);
        }
      }
    });
  }, []);

  // REDUNDANT useEffect REMOVED HERE used to watch unreadCountsRef

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

    // Ensure from_me is correctly set for Realtime messages
    // We cast to any because sender_user_id is in the DB payload but not strictly in the frontend Message type yet
    const rawMessage = message as any;
    if (initialUser && rawMessage.sender_user_id) {
      message.from_me = rawMessage.sender_user_id === initialUser.id;
    }

    console.log('[REALTIME] Message received:', message.id, 'Chat:', message.chat_id, 'FromMe:', message.from_me, 'Event:', payload.eventType);

    const snapshot = useInboxStore.getState();
    const messageChat = snapshot.chats.find((chat) => chat.id === message.chat_id);
    const isQueueMessage = messageChat?.status === 'gerais';
    const isAttendingMessage = messageChat?.status === 'atendimentos';
    const isOwnAttending = isAttendingMessage && messageChat?.agent?.id === initialUser?.id;
    const currentSelectedChatId = snapshot.selectedChatId;

    // Always update the data store
    appendMessagesToChat(message.chat_id, [message], message.updatedAt);

    if (message.sentByTab && message.sentByTab === tabIdRef.current) {
      // Only remove optimistic messages that have temporary IDs (start with 'optimistic-')
      removeMessagesForChat(message.chat_id, (m) => !!m.optimistic && m.sentByTab === message.sentByTab && m.id.startsWith('optimistic-'));
    }

    // Optimistic update for read receipts:
    if (message.from_me && message.api_message_status === 'READ') {
      snapshot.markMessagesAsReadByRecipient(message.chat_id, message.createdAt);
    }

    if (!messageChat && runDeltaSyncRef.current) {
      runDeltaSyncRef.current();
    }

    // Notification Logic: strict check for INSERT event
    if (payload.eventType === 'INSERT' && !message.from_me) {
      const shouldTrackUnread = message.chat_id !== currentSelectedChatId && (isQueueMessage || isOwnAttending || !messageChat);
      if (shouldTrackUnread) {
        incrementUnread(message.chat_id);
      }

      const shouldPlay = document.visibilityState !== 'visible' || message.chat_id !== currentSelectedChatId || isQueueMessage;
      if (shouldPlay) {
        if (isQueueMessage || !messageChat) {
          playNotificationSound('queue');
        } else if (isOwnAttending) {
          playNotificationSound('attending');
        }
      }
    }
  }, [appendMessagesToChat, incrementUnread, initialUser?.id, mapRealtimePayload, playNotificationSound, removeMessagesForChat]);

  const loadChatMessages = useCallback(async (chatId: string, beforeDate?: string | null, beforeId?: string | null) => {
    const startedAt = performance.now();
    try {
      // console.log('[LOAD_MESSAGES] Fetching messages for chat:', chatId, 'before:', beforeDate, 'beforeId:', beforeId);
      const result = await getChatMessagesWindow({
        chatId,
        before: beforeDate ?? undefined,
        beforeId: beforeId ?? undefined,
        limit: 50,
        timezone: workspaceTimezone
      });
      /* console.log('[LOAD_MESSAGES] Result:', {
        messagesCount: result.messages.length,
        oldestMessageDate: result.oldestMessageDate,
        oldestMessageId: result.oldestMessageId,
        hasMoreHistory: result.hasMoreHistory
      }); */
      if (beforeDate) {
        prependMessagesToChat(chatId, result.messages, result.oldestMessageDate, result.oldestMessageId, result.hasMoreHistory);
      } else {
        setMessagesForChat(chatId, result.messages, result.lastSyncMessage, result.oldestMessageDate, result.oldestMessageId, result.hasMoreHistory);
      }
      if (result.contact) {
        updateChatContact(result.contact);
      }
    } catch (error: any) {
      console.error('[LOAD_MESSAGES] Error:', error);
      toast({ title: 'Erro ao carregar mensagens', description: error.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      reportClientMetric('load_messages', performance.now() - startedAt, { chatId, hasHistory: !!beforeDate });
    }
  }, [prependMessagesToChat, setMessagesForChat, updateChatContact, workspaceTimezone]);

  const prefetchChat = useCallback((chatId: string) => {
    // 1. Check if we already have messages
    const state = useInboxStore.getState();
    const hasMessages = state.messagesByChat[chatId]?.length > 0;
    if (hasMessages) return;

    // 2. Check if we already promised (or are fetching) this chat recently
    if (prefetchedHistoryRef.current.has(chatId)) return;

    // 3. Mark as prefetched to avoid spam
    prefetchedHistoryRef.current.add(chatId);

    // 4. Trigger fetch
    console.log('[PREFETCH] Hover prefetch started for:', chatId);
    loadChatMessages(chatId).catch(err => {
      console.error('[PREFETCH] Failed to prefetch:', err);
      // On error, maybe allow retrying later? For now, we leave it in the set to avoid spam loops.
    });
  }, [loadChatMessages]);

  const loadOlderMessages = useCallback(async () => {
    console.log('[LOAD_OLDER] Called. selectedChatId:', selectedChatId, 'beforeDate:', oldestLoadedMessageDate, 'beforeId:', oldestLoadedMessageId);
    if (!selectedChatId) {
      console.log('[LOAD_OLDER] No selected chat, returning');
      return;
    }
    const beforeDate = oldestLoadedMessageDate;
    const beforeId = oldestLoadedMessageId;
    if (!beforeDate || !beforeId) {
      console.log('[LOAD_OLDER] Missing cursor (beforeDate or beforeId is null), returning');
      return;
    }
    await loadChatMessages(selectedChatId, beforeDate, beforeId);
  }, [loadChatMessages, oldestLoadedMessageDate, oldestLoadedMessageId, selectedChatId]);

  const ensureMessagesForChat = useCallback(async (chatId: string) => {
    const state = useInboxStore.getState();
    const currentMessages = state.messagesByChat[chatId] || [];
    if (!currentMessages.length) {
      await loadChatMessages(chatId);
      return;
    }

    const chat = state.chats.find((candidate) => candidate.id === chatId);
    const latestMessages = chat?.messages;
    const latestMessage = latestMessages && latestMessages.length
      ? latestMessages[latestMessages.length - 1]
      : undefined;
    if (latestMessage && !currentMessages.some((message) => message.id === latestMessage.id)) {
      // Chat list is fresher than the cached thread; refresh the window.
      await loadChatMessages(chatId);
    }
  }, [loadChatMessages]);

  const handleLoadMoreChats = useCallback(async (options?: { statuses?: Chat['status'][], ownership?: 'mine' | 'everyone' }) => {
    if (isLoadingMoreChats || !hasMoreChats || !initialUser?.activeWorkspaceId) return;

    const state = useInboxStore.getState();
    const currentChats = state.chats;
    const { statuses = ['gerais', 'atendimentos'], ownership = 'mine' } = options || {};

    // Filter logic to find the LAST chat that is visible in the current view
    // This is critical because 'currentChats' contains ALL chats (mixed statuses)
    // We need the timestamp of the last chat *in the filtered list* to properly page
    const filteredChats = currentChats.filter(chat => {
      // 1. Status Check
      const matchesStatus = statuses.includes(chat.status);
      if (!matchesStatus) return false;

      // 2. Ownership Check
      const chatAgentId = chat.agent?.id || chat.agentId;
      const matchesOwner =
        ownership === 'everyone' ||
        chatAgentId === initialUser.id ||
        chat.status === 'gerais'; // Gerais always visible if status matches

      return matchesOwner;
    });

    if (filteredChats.length === 0) return;

    const lastChat = filteredChats[filteredChats.length - 1];
    if (!lastChat.updatedAt) return;

    setIsLoadingMoreChats(true);
    try {
      const result = await loadOlderChatsAction(
        initialUser.activeWorkspaceId,
        lastChat.updatedAt,
        statuses,
        ownership
      );

      if (result.success && result.chats) {
        if (result.chats.length === 0) {
          // If the server returns empty for this filter, it implies we reached the end *for this view*.
          // However, global 'hasMoreChats' might still be true for other views.
          // We don't setHasMoreChats(false) globally here to avoid breaking other tabs.
        } else {
          appendChats(result.chats);
        }
      } else {
        if (result.error) {
          console.error('[LOAD_MORE_CHATS] Error:', result.error);
        }
      }
    } catch (error) {
      console.error('[LOAD_MORE_CHATS] Exception:', error);
    } finally {
      setIsLoadingMoreChats(false);
    }
  }, [isLoadingMoreChats, hasMoreChats, initialUser, appendChats]);

  const handleSetSelectedChat = useCallback((chat: Chat | null) => {
    if (!chat) {
      selectedChatIdRef.current = null;
      setSelectedChatId(null);
      setShowFullHistory(false);
      updateSelectedChatPath(null);
      return;
    }

    if (selectedChatIdRef.current === chat.id) return; // Prevent duplicate navigation
    selectedChatIdRef.current = chat.id;
    React.startTransition(() => {
      setSelectedChatId(chat.id);
      setShowFullHistory(false);
    });
    updateSelectedChatPath(chat.id);
    void ensureMessagesForChat(chat.id);
  }, [ensureMessagesForChat, setSelectedChatId, updateSelectedChatPath]);

  const jumpChatByOffset = useCallback((delta: number) => {
    if (!chats.length) return;
    const currentIndex = chats.findIndex((c) => c.id === selectedChatIdRef.current);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + chats.length) % chats.length;
    const nextChat = chats[nextIndex];
    if (nextChat) {
      handleSetSelectedChat(nextChat);
    }
  }, [chats, handleSetSelectedChat]);

  useEffect(() => {
    jumpChatByOffsetRef.current = jumpChatByOffset;
  }, [jumpChatByOffset]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
        event.preventDefault();
        jumpChatByOffsetRef.current?.(1);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        event.preventDefault();
        jumpChatByOffsetRef.current?.(-1);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!selectedChatId) return;
    const state = useInboxStore.getState();
    const hasMessages = state.messagesByChat[selectedChatId]?.length;
    if (!hasMessages) return;
    if (prefetchedHistoryRef.current.has(selectedChatId)) return;
    const hasMore = state.hasMoreHistoryByChat[selectedChatId];
    const beforeDate = state.oldestMessageDateByChat[selectedChatId];
    const beforeId = state.oldestMessageIdByChat[selectedChatId];
    if (hasMore && beforeDate && beforeId) {
      prefetchedHistoryRef.current.add(selectedChatId);
      loadChatMessages(selectedChatId, beforeDate, beforeId).catch((err) => console.error('[PREFETCH_HISTORY]', err));
    }
  }, [selectedChatId, loadChatMessages]);

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
        userIdOverride: initialUser.id,
        workspaceTimezone: initialUser.activeWorkspaceTimezone,
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
        oldestMessageId: result.oldestMessageId,
        hasMoreHistory: result.hasMoreHistory,
        hasMoreChats: result.hasMoreChats,
      });
      if (result.selectedChatId) {
        selectedChatIdRef.current = result.selectedChatId;
        updateSelectedChatPath(result.selectedChatId);
      } else {
        updateSelectedChatPath(null);
      }
      // ✅ Marcar hydration completa e finalizar loading após sucesso
      isHydratedRef.current = true;
      setIsLoading(false);
    } catch (error: any) {
      console.error('[INITIAL_CHATS] Error:', error);
      const message = error.message || 'Não foi possível buscar os dados do chat.';
      // Auto-retry once for network blips
      if (retryCount < 1) {
        console.log('[INITIAL_CHATS] Retrying initialization in 1s...');
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 1000);
      } else {
        toast({ title: 'Erro ao carregar conversas', description: message, variant: 'destructive' });
        setFetchError(message);
        isHydratedRef.current = true;
        setIsLoading(false);
      }
    }
  }, [initialChatId, initialUser?.activeWorkspaceId, setInitialData, updateSelectedChatPath, retryCount, fetchError]);

  // Effect to trigger retry
  useEffect(() => {
    if (retryCount > 0 && isLoading) {
      initializeInbox();
    }
  }, [retryCount, initializeInbox, isLoading]);

  // 🛡️ Watchdog: Force stop loading after 15s to prevent infinite spinner in worst-case scenarios
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        if (isLoading) {
          console.error('[INBOX_WATCHDOG] Force stopping infinite loading after 15s.');
          setIsLoading(false);
          if (!initialData?.chats && !fetchError) {
            setFetchError('Tempo limite excedido. Tente recarregar a página.');
          }
        }
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, initialData, fetchError]);

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

        // SHARED POLLING: If the chat list received an update for the currently selected chat,
        // we immediately push that message to the chat panel as well.
        // This ensures that "active polling in chatlist" is shared with the chat view.
        if (snapshot.selectedChatId) {
          const chatFromList = result.deltaChats.find(c => c.id === snapshot.selectedChatId);
          if (chatFromList && chatFromList.messages.length > 0) {
            appendMessagesToChat(snapshot.selectedChatId, chatFromList.messages, undefined);
          }
        }

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

  useEffect(() => {
    runDeltaSyncRef.current = runDeltaSync;
  }, [runDeltaSync]);

  const notifyPeers = useCallback(() => {
    if (!broadcastChannel) return;
    broadcastChannel.postMessage({ type: 'DELTA_SYNC', sourceTabId: tabIdRef.current });
  }, [broadcastChannel]);

  const handleDataMutation = useCallback(async () => {
    await runDeltaSync();
    notifyPeers();
  }, [notifyPeers, runDeltaSync]);

  const handleForwardMessage = useCallback((message: Message) => {
    setForwardingMessage(message);
    setSelectedForwardingChatIds(new Set());
    setIsForwarding(true);
  }, []);

  const handleToggleForwardSelection = useCallback((chatId: string) => {
    setSelectedForwardingChatIds(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  const handleCancelForward = useCallback(() => {
    setForwardingMessage(null);
    setSelectedForwardingChatIds(new Set());
    setIsForwarding(false);
  }, []);

  const handleConfirmForward = useCallback(async () => {
    if (!forwardingMessage || selectedForwardingChatIds.size === 0) return;

    const chatIds = Array.from(selectedForwardingChatIds);
    setIsForwarding(false); // Close UI immediately

    // Import dynamically to avoid circular dependency issues if any, though here it's fine
    const { forwardMessageAction } = await import('@/actions/messages');

    let successCount = 0;
    let errorCount = 0;

    toast({ title: 'Encaminhando mensagens...', description: `Enviando para ${chatIds.length} conversas.` });

    // Send in parallel
    await Promise.all(chatIds.map(async (targetChatId) => {
      const result = await forwardMessageAction(forwardingMessage, targetChatId, null);
      if (result.success) successCount++;
      else errorCount++;
    }));

    if (errorCount === 0) {
      toast({ title: 'Sucesso', description: `Mensagem encaminhada para ${successCount} conversas.` });
    } else {
      toast({
        title: 'Encaminhamento concluído com erros',
        description: `Sucesso: ${successCount}. Falhas: ${errorCount}.`,
        variant: 'destructive'
      });
    }

    setForwardingMessage(null);
    setSelectedForwardingChatIds(new Set());
  }, [forwardingMessage, selectedForwardingChatIds]);

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
    let errorCount = 0;

    const poll = async () => {
      if (!isPolling) return;

      // Wait for hydration before polling
      if (!isHydratedRef.current) {
        console.log('[POLLING] Waiting for hydration...');
        timeoutId = setTimeout(poll, 1000);
        return;
      }

      try {
        await runDeltaSync();
        errorCount = 0;
      } catch (error: any) {
        console.error('[POLLING] Error in delta sync:', error);
        errorCount++;

        if (errorCount > 5) {
          console.warn('[POLLING] Too many errors, slowing down polling.');
          timeoutId = setTimeout(poll, 30000); // Backoff to 30s
          return;
        }
      }

      if (isPolling) {
        const isVisible = document.visibilityState === 'visible';

        // Strategy: 30s if visible, 5m if background
        // Realtime handles instant updates, polling is just a backup for consistency
        let interval = isVisible ? 30000 : 300000;

        // Exponential backoff on errors
        if (errorCount > 0) interval = Math.max(interval, 30000);

        timeoutId = setTimeout(poll, interval);
      }
    };

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

  // Centralized Realtime subscriptions - prevents duplicate channel conflicts
  const handleRealtimeChatUpdate = useCallback(async (payload: RealtimePostgresChangesPayload<any>) => {
    console.log('[REALTIME] Chat update received:', payload);
    const newChatData = payload.new as any;

    // 1. Optimistic update (preserving existing fields by merging top-level)
    const optimisticUpdate: Partial<Chat> = {
      ...newChatData,
      agentId: newChatData.agent_id,
    };
    // Fix agent object minimally if needed for optimistic update
    if (newChatData.agent_id === initialUser?.id) {
      optimisticUpdate.agent = initialUser ?? undefined;
    } else if (newChatData.agent_id === null) {
      optimisticUpdate.agent = undefined;
    }

    // CRITICAL FIX: For INSERT events, we MUST initialize messages array
    // and ensure updatedAt is set so it sorts correctly to the top
    if (payload.eventType === 'INSERT') {
      (optimisticUpdate as any).messages = [];
      optimisticUpdate.updatedAt = newChatData.updated_at || newChatData.created_at || new Date().toISOString();

      // Ensure contact object exists to prevent UI crashes (accessing property 'name' of undefined)
      if (!optimisticUpdate.contact && newChatData.contact_id) {
        // Try to find contact in existing chats if possible, or create a safe placeholder
        // Since we don't have access to a global contacts list here easily, we use a Safe Placeholder.
        // It will be replaced by the full fetch in the next step immediately.
        (optimisticUpdate as any).contact = {
          id: newChatData.contact_id,
          name: 'Novo Contato...',
          workspace_id: initialUser?.activeWorkspaceId || '',
          avatar_url: null,
          phone: '',
        };
      }
    }

    // CRITICAL: Ensure messages array exists for all events to prevent UI crashes if chat was previously removed
    if (!(optimisticUpdate as any).messages) {
      (optimisticUpdate as any).messages = [];
    }

    useInboxStore.getState().upsertChats([optimisticUpdate as Chat]);

    // 2. Fetch full updated chat data from server to ensure joins (team color, tags) are correct
    try {
      const { refreshChatAction } = await import('@/actions/chats');
      const result = await refreshChatAction(newChatData.id);
      if (result.chat) {
        useInboxStore.getState().upsertChats([result.chat]);

        // --- REALTIME FIX: Sync latest message to open chat ---
        // Since ChatList updates work (triggering this), we use the returned chat's last message
        // to update the open chat view if it matches. This covers cases where the 'messages' channel fails.
        const state = useInboxStore.getState();
        console.log('[REALTIME-DEBUG] Refresh Chat Result:', {
          resultChatId: result.chat.id,
          selectedChatId: state.selectedChatId,
          hasMessages: result.chat.messages?.length,
          latestMessage: result.chat.messages?.[0]
        });

        if (state.selectedChatId === result.chat.id && result.chat.messages?.length > 0) {
          console.log('[REALTIME-DEBUG] Appending late-arriving message to chat view');
          useInboxStore.getState().appendMessagesToChat(result.chat.id, result.chat.messages);
        } else {
          console.log('[REALTIME-DEBUG] Skipped appending message. Match:', state.selectedChatId === result.chat.id);
        }
        // -----------------------------------------------------
        // -----------------------------------------------------
      } else {
        console.warn('[REALTIME] Failed to refresh chat details:', result.error);
      }
    } catch (err) {
      console.error('[REALTIME] Error refreshing chat:', err);
    }
  }, [initialUser?.id, initialUser]);

  const handleRealtimeStatusChange = useCallback((status: string, type: 'chats' | 'messages') => {
    console.info(`[REALTIME] ${type} channel status: ${status}`);
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      console.warn(`[REALTIME] Connection lost (${status}). Running delta sync as fallback.`);
      if (document.visibilityState === 'visible') {
        runDeltaSync();
      }
    }
  }, [runDeltaSync]);

  // Use centralized Realtime hook
  useRealtimeSubscriptions({
    workspaceId: initialUser?.activeWorkspaceId,
    selectedChatId,
    onChatUpdate: handleRealtimeChatUpdate,
    onMessageUpdate: handleRealtimeMessage,
    onStatusChange: handleRealtimeStatusChange,
  });

  useEffect(() => {
    if (initialData) {
      // FIX: Prevent overwriting client-side state with stale/empty server selection during revalidation.
      // If the server sends selectedChatId: null (common in root revalidations), but we have a client-side selection,
      // we must preserve the client selection AND ensure the chat object exists in the new list.

      // Determine if we should preserve the current selection
      const clientHasSelection = !!selectedChatIdRef.current;
      const serverClearedSelection = initialData.selectedChatId === null;

      // We assume client selection is valid if we are hydrated and the URL/Ref indicates a chat.
      const shouldPreserveSelection = isHydratedRef.current && clientHasSelection && serverClearedSelection;

      let effectiveSelectedChatId = initialData.selectedChatId;
      let effectiveChats = initialData.chats;

      if (shouldPreserveSelection) {
        console.log('[hydrate] Preserving client selection against null server selection.', {
          client: selectedChatIdRef.current,
          server: initialData.selectedChatId
        });

        effectiveSelectedChatId = selectedChatIdRef.current;

        // Crucially: Ensure the selected chat object is in the new list. 
        // The server query (limited by N) might have excluded it, or it moved lists (e.g. to Queue).
        const isInNewList = effectiveChats.some(c => c.id === effectiveSelectedChatId);

        if (!isInNewList) {
          const currentStoreChats = useInboxStore.getState().chats;
          const cachedChat = currentStoreChats.find(c => c.id === effectiveSelectedChatId);

          if (cachedChat) {
            console.log('[hydrate] Injecting cached chat object into new server list to prevent disappearance.');
            // Add to start so it's visible. Logic will sort it anyway.
            effectiveChats = [cachedChat, ...effectiveChats];
          } else {
            console.warn('[hydrate] Selected chat ID preserved but object missing from cache and server. UI may be empty.');
          }
        }
      }

      setWorkspaceTimezone(initialData.timezone || FALLBACK_TIMEZONE);
      setInitialData({
        chats: effectiveChats,
        selectedChatId: effectiveSelectedChatId,
        messages: initialData.messages,
        lastSyncChats: initialData.lastSyncChats,
        lastSyncMessageForSelected: initialData.lastSyncMessageForSelected,
        oldestMessageDate: initialData.oldestMessageDate,
        oldestMessageId: initialData.oldestMessageId,
        hasMoreHistory: initialData.hasMoreHistory,
        hasMoreChats: initialData.hasMoreChats,
      });
      setFetchError(initialData.error ?? null);

      // Synch store selection
      setSelectedChatId(effectiveSelectedChatId);
      selectedChatIdRef.current = effectiveSelectedChatId ?? null;
      // We don't update URL here because we might be preserving it against a reset.
      // But if effective is null, we should clear.
      if (!effectiveSelectedChatId) {
        updateSelectedChatPath(null);
      }

      isHydratedRef.current = true;
      setIsLoading(false);
      return;
    }

    if (initialUser) {
      initializeInbox();
    } else {
      isHydratedRef.current = true;
      setIsLoading(false);
    }
  }, [initialData, initialUser, initializeInbox, setInitialData, setSelectedChatId, updateSelectedChatPath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!initialBuildIdRef.current) {
      initialBuildIdRef.current = (window as any).__NEXT_DATA__?.buildId || 'dev';
    }

    let cancelled = false;
    const controller = new AbortController();

    const checkBuild = async () => {
      if (cancelled || buildMismatchTriggeredRef.current) return;
      try {
        const res = await fetch('/api/build-id', { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.buildId && data.buildId !== initialBuildIdRef.current) {
          buildMismatchTriggeredRef.current = true;
          console.warn('[BUILD_ID] Mismatch detected. Reloading to refresh assets.', {
            current: initialBuildIdRef.current,
            server: data.buildId
          });
          window.location.reload();
        }
      } catch (err) {
        // Ignore network errors; will retry on next interval.
        console.debug('[BUILD_ID] Check failed', err);
      }
    };

    checkBuild();
    const interval = setInterval(checkBuild, 60000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

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



  return (
    <div className="flex h-screen w-full bg-background relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-50 dark:opacity-20 [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
      </div>

      <LayoutGroup>
        <div
          className={`relative z-10 flex h-full w-full overflow-hidden backdrop-blur-[1px] bg-background/50 dark:bg-black selection:bg-primary/30 ${highContrast ? 'contrast-125 saturate-150' : ''}`}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {needsAudioUnlock && (
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-popover/90 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur-md">
              <span>Habilite o som de novas mensagens</span>
              <Button size="sm" variant="secondary" onClick={unlockAudio}>Habilitar</Button>
            </div>
          )}
          {IS_DEV && (
            <DraggableSoundTester
              debugCounter={debugCounter}
              onPlay={(kind) => { setDebugCounter((n) => n + 1); playNotificationSound(kind); }}
            />
          )}
          <audio ref={(el) => { audioRefs.current.queue = el; }} src={SOUND_SOURCES.queue} preload="auto" />
          <audio ref={(el) => { audioRefs.current.attending = el; }} src={SOUND_SOURCES.attending} preload="auto" />
          <ErrorBoundary fallback={<ChatListSkeleton />} onError={handleBoundaryError}>
            <ChatList
              chats={chats}
              selectedChat={enrichedSelectedChat}
              setSelectedChat={handleSetSelectedChat}
              currentUser={initialUser}
              onUpdate={handleDataMutation}
              isForwarding={isForwarding}
              selectedForwardingChatIds={selectedForwardingChatIds}
              onToggleForwardSelection={handleToggleForwardSelection}
              onConfirmForward={handleConfirmForward}
              onCancelForward={handleCancelForward}
              onPrefetch={prefetchChat}
              loadMore={handleLoadMoreChats}
              hasMore={hasMoreChats}
              isLoadingMore={isLoadingMoreChats}
            />
          </ErrorBoundary>
          <ErrorBoundary fallback={<ThreadSkeleton />} onError={handleBoundaryError}>
            <ChatPanel
              chat={enrichedSelectedChat}
              currentUser={initialUser}
              onActionSuccess={handleDataMutation}
              closeReasons={closeReasons}
              showFullHistory={showFullHistory}
              setShowFullHistory={setShowFullHistory}
              tabId={tabIdRef.current}
              onLoadOlderMessages={loadOlderMessages}
              canLoadOlder={hasMoreHistory}
              workspaceTimezone={workspaceTimezone}
              onToggleContactPanel={() => setIsContactPanelOpen(!isContactPanelOpen)}
              onForwardMessage={handleForwardMessage}
              highContrast={highContrast}
              onToggleHighContrast={() => setHighContrast((v) => !v)}
              isRTL={isRTL}
              onToggleRTL={() => setIsRTL((v) => !v)}
            />
          </ErrorBoundary>
          {isContactPanelOpen && !isForwarding && (
            <ContactPanel
              chat={enrichedSelectedChat}
              currentUser={initialUser}
              onTransferSuccess={handleDataMutation}
              onContactUpdate={handleDataMutation}
            />
          )}
        </div>

        <CommandPalette />

      </LayoutGroup>
    </div>
  );
}
