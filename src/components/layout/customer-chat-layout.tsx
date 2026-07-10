'use client';
import { v4 as uuidv4 } from 'uuid';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
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
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { replaceChatPath } from '@/lib/chat-navigation';
import { useRouter } from 'next/navigation';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { useInboxConnectionRecovery } from '@/hooks/use-inbox-connection-recovery';
import ReactDOM from 'react-dom';
import { useRealtimeSubscriptions } from '@/hooks/use-realtime-subscriptions';
import ErrorBoundary from '@/components/layout/error-boundary';
import { reportClientMetric } from '@/lib/observability/client';
import { formatMessageDate } from '@/lib/utils';
import { resolveRealtimeSender } from '@/lib/realtime-message-sender';
import { isChatVisibleForOwnership } from '@/lib/inbox-ownership';
import { reconcileRealtimeChatAssignment } from '@/lib/realtime/realtime-reconciler';
import { shouldMarkChatAsRead } from '@/lib/inbox-read-state';
import { persistChatRead } from '@/lib/inbox-mark-as-read';

const ContactPanel = dynamic(() => import('../chat/contact-panel'), {
  ssr: false,
  loading: () => <div className="hidden h-full w-[280px] shrink-0 border-l border-border lg:block xl:w-[340px]" />,
});

// Notification sounds served from public assets
const SOUND_SOURCES = {
  queue: '/sounds/new-message.mp3',
  attending: '/sounds/message-incoming-02-199577.mp3',
} as const;
const FALLBACK_TIMEZONE = 'America/Sao_Paulo';
const IS_DEV = process.env.NODE_ENV !== 'production';
const DELTA_SYNC_MIN_INTERVAL_MS = 3000;
const HEALTHY_REALTIME_POLL_VISIBLE_MS = 60000;
const HEALTHY_REALTIME_POLL_HIDDEN_MS = 30000;
const FALLBACK_POLL_VISIBLE_MS = 15000;
const FALLBACK_POLL_HIDDEN_MS = 15000;
const HIDDEN_TAB_CATCH_UP_DELAY_MS = 1000;

type NotificationSoundKind = keyof typeof SOUND_SOURCES;
type InboxSnapshot = ReturnType<typeof useInboxStore.getState>;

function getLatestChatMessage(chat: Chat | null | undefined): Message | null {
  const messages = chat?.messages;
  if (!messages?.length) return null;
  return messages[messages.length - 1] ?? null;
}

function isMessageCached(snapshot: InboxSnapshot, message: Message): boolean {
  const threadHasMessage = snapshot.messagesByChat[message.chat_id]?.some((cached) => cached.id === message.id);
  if (threadHasMessage) return true;

  const chatPreviewHasMessage = snapshot.chats
    .find((chat) => chat.id === message.chat_id)
    ?.messages?.some((cached) => cached.id === message.id);

  return Boolean(chatPreviewHasMessage);
}

function getNotificationSoundKind(
  chat: Pick<Chat, 'status' | 'agent' | 'agentId'> | null | undefined,
  userId?: string | null,
): NotificationSoundKind | null {
  if (!chat) return 'queue';
  if (chat.status === 'gerais') return 'queue';
  if (chat.status === 'atendimentos' && (chat.agent?.id === userId || chat.agentId === userId)) {
    return 'attending';
  }
  return null;
}

const hasRecordKey = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

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
      className="fixed z-50 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-foreground cursor-move"
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
    <div className="flex flex-1 w-full min-h-0 h-full bg-background">
      <div className="flex flex-col w-[260px] lg:w-[300px] xl:w-[360px] 2xl:w-[400px] shrink-0 min-w-0 max-w-full border-r border-border bg-background p-4 gap-4">
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
      <div className="hidden lg:flex lg:flex-col lg:w-[260px] xl:w-[320px] 2xl:w-[380px] lg:flex-shrink-0 border-l border-border bg-background p-4 gap-4">
        <Skeleton className="h-16 w-full bg-muted" />
        <Skeleton className="h-24 w-full bg-muted" />
        <Skeleton className="h-32 w-full bg-muted" />
      </div>
    </div>
  );
}

function ChatListSkeleton() {
  return (
    <div className="flex flex-col w-[260px] lg:w-[300px] xl:w-[360px] 2xl:w-[400px] shrink-0 min-w-0 max-w-full border-r border-border bg-background p-4 gap-4">
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
  const [ownershipFilter, setOwnershipFilter] = useState<'mine' | 'everyone'>('mine');
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
  const lastSyncMessages = useInboxStore((state) => state.lastSyncMessages);
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
  const removeChat = useInboxStore((state) => state.removeChat);

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
  const activatedChatIdsRef = useRef<Set<string>>(new Set());
  const messageWindowLoadsInFlightRef = useRef<Set<string>>(new Set());
  const pendingContactFetchRef = useRef<Set<string>>(new Set());
  const deltaSyncInFlightRef = useRef<Promise<void> | null>(null);
  const deltaSyncQueuedRef = useRef(false);
  const lastDeltaSyncCompletedAtRef = useRef(0);
  const realtimeHealthyRef = useRef(false);

  const isHydratedRef = useRef(false);
  const initialResetDoneRef = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Strict Mode Safety: Only reset once per mount cycle.
    // This prevents double-reset on dev hot-reloads/strict mode remounts.
    if (!initialResetDoneRef.current) {
      initialResetDoneRef.current = true;
      useInboxStore.getState().reset();
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
  const hasLoadedSelectedMessageWindow = selectedChatId
    ? hasRecordKey(lastSyncMessages, selectedChatId) || hasRecordKey(oldestMessageDateByChat, selectedChatId)
    : false;

  const enrichedSelectedChat = useMemo(() => {
    if (!selectedChat) return null;

    const fallbackMessages = selectedChat.messages || [];
    const threadMessages = (selectedChat as any)?.protocolScoped
      ? fallbackMessages
      : hasLoadedSelectedMessageWindow
        ? currentChatMessages
        : [];

    return {
      ...selectedChat,
      messages: threadMessages,
      unreadCount: threadMessages.filter(m => !m.from_me && !m.is_read).length,
    };
  }, [selectedChat, currentChatMessages, hasLoadedSelectedMessageWindow]);

  const messagesListChatIdsCsv = useMemo(() => {
    if (!initialUser?.id || ownershipFilter !== 'mine') return '';
    const ids = chats
      .filter((chat) => chat.status === 'gerais' || chat.agent?.id === initialUser.id || chat.agentId === initialUser.id)
      .map((chat) => chat.id)
      .sort();
    return ids.join(',');
  }, [chats, initialUser?.id, ownershipFilter]);

  const chatUpdatesChatIdsCsv = useMemo(() => {
    if (!initialUser?.id || ownershipFilter !== 'mine') return '';
    const ids = new Set<string>();
    chats.forEach((chat) => {
      if (chat.status === 'gerais' || chat.agent?.id === initialUser.id || chat.agentId === initialUser.id) {
        ids.add(chat.id);
      }
    });
    if (selectedChatId) {
      ids.add(selectedChatId);
    }
    return Array.from(ids).sort().join(',');
  }, [chats, initialUser?.id, ownershipFilter, selectedChatId]);

  const formatMessageDay = useCallback((date: Date) => {
    return formatMessageDate(date, workspaceTimezone);
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
      const store = useInboxStore.getState();
      const chat = store.chats.find((c) => c.id === data.chat_id);
      const sender = resolveRealtimeSender({
        data,
        metadata,
        chat,
        currentUser: initialUser,
        existingMessages: store.messagesByChat[data.chat_id] || [],
      });

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

  const getIncomingMessageSoundKind = useCallback((
    message: Message,
    chat: Chat | null | undefined,
    currentSelectedChatId: string | null,
  ): NotificationSoundKind | null => {
    if (message.from_me) return null;
    if (message.sentByTab && message.sentByTab === tabIdRef.current) return null;

    const kind = getNotificationSoundKind(chat, initialUser?.id);
    if (!kind) return null;

    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const isSelectedChat = message.chat_id === currentSelectedChatId;

    if (isVisible && isSelectedChat && kind !== 'queue') {
      return null;
    }

    return kind;
  }, [initialUser?.id]);

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

    if (initialUser?.activeWorkspaceId && message.workspace_id && message.workspace_id !== initialUser.activeWorkspaceId) {
      return;
    }

    console.log('[REALTIME] Message received:', message.id, 'Chat:', message.chat_id, 'FromMe:', message.from_me, 'Event:', payload.eventType);

    const snapshot = useInboxStore.getState();
    const messageChat = snapshot.chats.find((chat) => chat.id === message.chat_id);
    const isQueueMessage = messageChat?.status === 'gerais';
    const isAttendingMessage = messageChat?.status === 'atendimentos';
    const isOwnAttending = isAttendingMessage && (messageChat?.agent?.id === initialUser?.id || messageChat?.agentId === initialUser?.id);
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

      const soundKind = getIncomingMessageSoundKind(message, messageChat, currentSelectedChatId);
      if (soundKind) {
        playNotificationSound(soundKind);
      }
    }
  }, [appendMessagesToChat, getIncomingMessageSoundKind, incrementUnread, initialUser?.id, initialUser?.activeWorkspaceId, mapRealtimePayload, playNotificationSound, removeMessagesForChat]);

  const loadChatMessages = useCallback(async (chatId: string, beforeDate?: string | null, beforeId?: string | null) => {
    const startedAt = performance.now();
    try {
      console.log('[LOAD_MESSAGES] Fetching messages for chat:', chatId, 'before:', beforeDate, 'beforeId:', beforeId);
      const state = useInboxStore.getState();
      const activeChat = state.chats.find((candidate) => candidate.id === chatId);
      const chatOnly = !!(activeChat as any)?.protocolScoped;
      const result = await getChatMessagesWindow({
        chatId,
        before: beforeDate ?? undefined,
        beforeId: beforeId ?? undefined,
        limit: 50,
        timezone: workspaceTimezone,
        chatOnly,
      });
      console.log('[LOAD_MESSAGES] Result:', {
        messagesCount: result.messages.length,
        oldestMessageDate: result.oldestMessageDate,
        oldestMessageId: result.oldestMessageId,
        hasMoreHistory: result.hasMoreHistory
      });
      if (beforeDate) {
        prependMessagesToChat(chatId, result.messages, result.oldestMessageDate, result.oldestMessageId, result.hasMoreHistory);
      } else {
        setMessagesForChat(
          chatId,
          result.messages,
          result.lastSyncMessage,
          result.oldestMessageDate,
          result.oldestMessageId,
          result.hasMoreHistory,
          chatOnly
        );
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

  const loadOlderMessages = useCallback(async () => {
    console.log('[LOAD_OLDER] Called. selectedChatId:', selectedChatId, 'beforeDate:', oldestLoadedMessageDate, 'beforeId:', oldestLoadedMessageId);
    if (!selectedChatId) {
      console.log('[LOAD_OLDER] No selected chat, returning');
      return;
    }
    const state = useInboxStore.getState();
    const currentMessages = state.messagesByChat[selectedChatId] || [];
    const oldestMessage = currentMessages[0];
    const beforeDate = oldestLoadedMessageDate ?? oldestMessage?.createdAt ?? null;
    const beforeId = oldestLoadedMessageId ?? oldestMessage?.id ?? null;
    console.log('[LOAD_OLDER] Computed cursors:', {
      storedOldestDate: oldestLoadedMessageDate,
      storedOldestId: oldestLoadedMessageId,
      fallbackFromMessage: oldestMessage?.createdAt,
      finalBeforeDate: beforeDate,
      finalBeforeId: beforeId,
      hasMoreHistory: state.hasMoreHistoryByChat[selectedChatId]
    });
    if (!beforeDate) {
      console.log('[LOAD_OLDER] Missing cursor date, returning');
      return;
    }
    await loadChatMessages(selectedChatId, beforeDate, beforeId ?? undefined);
  }, [loadChatMessages, oldestLoadedMessageDate, oldestLoadedMessageId, selectedChatId]);

  const ensureMessagesForChat = useCallback(async (chatId: string, options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    const state = useInboxStore.getState();
    const currentMessages = state.messagesByChat[chatId] || [];
    const hasLoadedMessageWindow =
      hasRecordKey(state.lastSyncMessages, chatId) ||
      hasRecordKey(state.oldestMessageDateByChat, chatId);
    console.log('[ENSURE_MESSAGES] Called for chat:', chatId, 'force:', force, 'currentMessages:', currentMessages.length, 'hasLoadedMessageWindow:', hasLoadedMessageWindow, 'hasMoreHistory:', state.hasMoreHistoryByChat[chatId]);
    if (force || !hasLoadedMessageWindow || !currentMessages.length) {
      if (messageWindowLoadsInFlightRef.current.has(chatId)) {
        console.log('[ENSURE_MESSAGES] Skipped - load already in flight:', chatId);
        return;
      }
      console.log('[ENSURE_MESSAGES] Loading messages (force or empty)');
      messageWindowLoadsInFlightRef.current.add(chatId);
      try {
        await loadChatMessages(chatId);
      } finally {
        messageWindowLoadsInFlightRef.current.delete(chatId);
      }
      return;
    }

    const chat = state.chats.find((candidate) => candidate.id === chatId);
    const latestMessages = chat?.messages;
    const latestMessage = latestMessages && latestMessages.length
      ? latestMessages[latestMessages.length - 1]
      : undefined;
    if (latestMessage && !currentMessages.some((message) => message.id === latestMessage.id)) {
      // Chat list is fresher than the cached thread; refresh the window.
      console.log('[ENSURE_MESSAGES] Chat list fresher, loading messages');
      await loadChatMessages(chatId);
    } else {
      console.log('[ENSURE_MESSAGES] Skipped loading, messages already present');
    }
  }, [loadChatMessages]);

  const prefetchChat = useCallback((chatId: string) => {
    void ensureMessagesForChat(chatId);
  }, [ensureMessagesForChat]);

  useEffect(() => {
    if (!selectedChatId) return;
    if (activatedChatIdsRef.current.has(selectedChatId) && hasLoadedSelectedMessageWindow) {
      console.log('[ENSURE_MESSAGES_EFFECT] Skipped - already activated:', selectedChatId);
      return;
    }
    console.log('[ENSURE_MESSAGES_EFFECT] First activation for chat:', selectedChatId);
    activatedChatIdsRef.current.add(selectedChatId);
    void ensureMessagesForChat(selectedChatId, { force: !hasLoadedSelectedMessageWindow });
  }, [selectedChatId, ensureMessagesForChat, hasLoadedSelectedMessageWindow]);

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

    // FIX: Force-persist the chat in the store immediately.
    // This prevents "Ghosting" if the chat list was just refreshed and this chat was excluded,
    // or if it's a search result. We ensure it exists so the UI can render it.
    upsertChats([chat]);

    // Fix: Check against the *Store State* (selectedChatId) rather than just the Ref.
    // We only skip if BOTH the store and the ref agree it's already selected.
    if (selectedChatId === chat.id && selectedChatIdRef.current === chat.id) {
      const isFirstActivation = !activatedChatIdsRef.current.has(chat.id);
      if (isFirstActivation) {
        activatedChatIdsRef.current.add(chat.id);
        void ensureMessagesForChat(chat.id, { force: true });
      }
      // If it's already selected and in the store (thanks to upsert), we can safely return.
      // The upsert above triggers the re-render if it was missing.
      return;
    }

    const isFirstActivation = !activatedChatIdsRef.current.has(chat.id);

    // Update Ref immediately to prevent rapid-fire duplicates
    selectedChatIdRef.current = chat.id;

    setSelectedChatId(chat.id);
    setShowFullHistory(false);

    updateSelectedChatPath(chat.id);
    activatedChatIdsRef.current.add(chat.id);
    void ensureMessagesForChat(chat.id, { force: isFirstActivation });
  }, [selectedChatId, ensureMessagesForChat, setSelectedChatId, updateSelectedChatPath, upsertChats]);

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

  const runDeltaSync = useCallback(async (options?: { force?: boolean }) => {
    const workspaceId = initialUser?.activeWorkspaceId;
    if (!workspaceId) return;

    const force = options?.force === true;
    const now = Date.now();

    if (deltaSyncInFlightRef.current) {
      if (force) {
        deltaSyncQueuedRef.current = true;
      }
      return deltaSyncInFlightRef.current;
    }

    if (!force && now - lastDeltaSyncCompletedAtRef.current < DELTA_SYNC_MIN_INTERVAL_MS) {
      return;
    }

    const snapshot = useInboxStore.getState();
    const selectedChatId = snapshot.selectedChatId;
    const hasActivatedChat =
      !!selectedChatId && activatedChatIdsRef.current.has(selectedChatId);
    const lastSyncMessage =
      hasActivatedChat && selectedChatId
        ? snapshot.lastSyncMessages[selectedChatId] ?? null
        : null;
    const shouldSyncMessages = hasActivatedChat && lastSyncMessage !== null;

    const syncPromise = (async () => {
      try {
        const result = await syncInboxData({
          workspaceId,
          lastSyncChats: snapshot.lastSyncChats,
          chatId: shouldSyncMessages ? selectedChatId : null,
          lastSyncMessages: shouldSyncMessages ? lastSyncMessage : null,
          ownership: ownershipFilter,
        });
        if (result.error) {
          console.error('[SYNC_INBOX] Error:', result.error);
          return;
        }

        const visibleDeltaChats = result.deltaChats.filter((chat) =>
          isChatVisibleForOwnership(chat, ownershipFilter, initialUser?.id, snapshot.selectedChatId)
        );
        const hiddenDeltaChatIds = result.deltaChats
          .filter((chat) => !isChatVisibleForOwnership(chat, ownershipFilter, initialUser?.id, snapshot.selectedChatId))
          .map((chat) => chat.id)
          .filter((chatId) => chatId !== snapshot.selectedChatId);

        const latestSnapshot = useInboxStore.getState();
        const notificationKinds = new Set<NotificationSoundKind>();
        const notificationMessageKeys = new Set<string>();
        const queueNotification = (message: Message | null | undefined, chat: Chat | null | undefined) => {
          if (!message) return;
          const key = `${message.chat_id}:${message.id}`;
          if (notificationMessageKeys.has(key)) return;
          if (isMessageCached(latestSnapshot, message)) return;

          const resolvedChat =
            chat ||
            latestSnapshot.chats.find((candidate) => candidate.id === message.chat_id) ||
            visibleDeltaChats.find((candidate) => candidate.id === message.chat_id) ||
            null;
          const soundKind = getIncomingMessageSoundKind(message, resolvedChat, latestSnapshot.selectedChatId);
          if (!soundKind) return;

          notificationMessageKeys.add(key);
          notificationKinds.add(soundKind);
        };

        visibleDeltaChats.forEach((chat) => {
          queueNotification(getLatestChatMessage(chat), chat);
        });
        result.deltaMessages.forEach((message) => {
          queueNotification(message, latestSnapshot.chats.find((chat) => chat.id === message.chat_id) || null);
        });

        // Wrap state updates in startTransition to keep UI fluid (high refresh rate feel)
        React.startTransition(() => {
          hiddenDeltaChatIds.forEach((chatId) => removeChat(chatId));

          // If the chat is currently selected and visible, it should remain read
          // even if delta sync sends a stale unread_count from the chats table.
          const deltaChatsToUpsert = visibleDeltaChats.map(chat => {
            if (chat.id === snapshot.selectedChatId && document.hasFocus()) {
              return { ...chat, unreadCount: 0 };
            }
            return chat;
          });

          upsertChats(deltaChatsToUpsert, result.lastSyncChats);

          // SHARED POLLING: If the chat list received an update for the currently selected chat,
          // we immediately push that message to the chat panel as well.
          // This ensures that "active polling in chatlist" is shared with the chat view.
          if (snapshot.selectedChatId) {
            const chatFromList = visibleDeltaChats.find(c => c.id === snapshot.selectedChatId);
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

        notificationKinds.forEach((kind) => {
          playNotificationSound(kind);
        });
      } catch (error) {
        console.error('[SYNC_INBOX] Unexpected error:', error);
      } finally {
        lastDeltaSyncCompletedAtRef.current = Date.now();
        deltaSyncInFlightRef.current = null;
      }
    })();

    deltaSyncInFlightRef.current = syncPromise;
    await syncPromise;

    if (deltaSyncQueuedRef.current) {
      deltaSyncQueuedRef.current = false;
      await runDeltaSync({ force: true });
    }
  }, [appendMessagesToChat, getIncomingMessageSoundKind, initialUser?.activeWorkspaceId, initialUser?.id, ownershipFilter, playNotificationSound, removeChat, updateChatContact, upsertChats]);

  useEffect(() => {
    runDeltaSyncRef.current = () => runDeltaSync({ force: true });
  }, [runDeltaSync]);

  const { scheduleRecoverySync, clearRecoverySync } = useInboxConnectionRecovery({
    workspaceId: initialUser?.activeWorkspaceId,
    runDeltaSync,
    realtimeHealthyRef,
  });

  const notifyPeers = useCallback(() => {
    if (!broadcastChannel) return;
    broadcastChannel.postMessage({ type: 'DELTA_SYNC', sourceTabId: tabIdRef.current });
  }, [broadcastChannel]);

  const handleDataMutation = useCallback(async () => {
    await runDeltaSync({ force: true });
    notifyPeers();
  }, [notifyPeers, runDeltaSync]);

  const handleLocalContactUpdate = useCallback((updatedContact?: Contact) => {
    if (updatedContact) {
      updateChatContact(updatedContact);
    }
    handleDataMutation();
  }, [updateChatContact, handleDataMutation]);

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

  const handleSelectAllForwarding = useCallback((chatIds: string[]) => {
    setSelectedForwardingChatIds(prev => {
      const next = new Set(prev);
      chatIds.forEach((chatId) => next.add(chatId));
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

  const markSelectedChatAsRead = useCallback(() => {
    if (!selectedChatId || !document.hasFocus()) return;
    if (!shouldMarkChatAsRead(selectedChat, currentChatMessages)) return;

    markChatAsReadInStore(selectedChatId);
    void persistChatRead(selectedChatId).then((persisted) => {
      if (!persisted) {
        console.error('Failed to mark messages as read on the server. Data will sync on next fetch.');
        void runDeltaSync({ force: true });
      }
    });
  }, [selectedChat, selectedChatId, currentChatMessages, markChatAsReadInStore, runDeltaSync]);

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    let hiddenCatchUpTimeout: ReturnType<typeof setTimeout> | undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (hiddenCatchUpTimeout) {
          clearTimeout(hiddenCatchUpTimeout);
          hiddenCatchUpTimeout = undefined;
        }
        runDeltaSync({ force: true });
        markSelectedChatAsRead();
        return;
      }

      runDeltaSync({ force: true });
      hiddenCatchUpTimeout = setTimeout(() => {
        runDeltaSync({ force: true });
      }, HIDDEN_TAB_CATCH_UP_DELAY_MS);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (hiddenCatchUpTimeout) {
        clearTimeout(hiddenCatchUpTimeout);
      }
    };
  }, [initialUser?.activeWorkspaceId, runDeltaSync, markSelectedChatAsRead]);

  useEffect(() => {
    markSelectedChatAsRead();
  }, [selectedChatId, currentChatMessages, markSelectedChatAsRead]);

  // Polling mechanism
  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
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
        const isRealtimeHealthy = realtimeHealthyRef.current;

        // Realtime handles most live updates; polling is a safety-net fallback.
        // When chats and messages channels are healthy, poll less often.
        let interval = isRealtimeHealthy
          ? (isVisible ? HEALTHY_REALTIME_POLL_VISIBLE_MS : HEALTHY_REALTIME_POLL_HIDDEN_MS)
          : (isVisible ? FALLBACK_POLL_VISIBLE_MS : FALLBACK_POLL_HIDDEN_MS);

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
    markSelectedChatAsRead();
  }, [markSelectedChatAsRead]);

  useEffect(() => {
    const handleFocus = () => {
      markSelectedChatAsRead();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [markSelectedChatAsRead]);

  const fetchContactById = useCallback(async (contactId: string) => {
    if (!initialUser?.activeWorkspaceId) return;
    if (pendingContactFetchRef.current.has(contactId)) return;
    pendingContactFetchRef.current.add(contactId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('id,workspace_id,name,avatar_url,email,phone,phone_number_jid,address,owner_id,created_at')
        .eq('id', contactId)
        .maybeSingle();

      if (error || !data) return;
      if (data.workspace_id !== initialUser.activeWorkspaceId) return;
      updateChatContact(data as Contact);
    } catch (err) {
      console.error('[REALTIME] Failed to fetch contact for chat insert', err);
    } finally {
      pendingContactFetchRef.current.delete(contactId);
    }
  }, [initialUser?.activeWorkspaceId, updateChatContact]);

  // Centralized Realtime subscriptions - prevents duplicate channel conflicts
  const handleRealtimeChatUpdate = useCallback(async (payload: RealtimePostgresChangesPayload<any>) => {
    console.log('[REALTIME] Chat update received:', payload);
    const newChatData = payload.new as any;
    if (!newChatData?.id) return;
    if (newChatData.workspace_id && newChatData.workspace_id !== initialUser?.activeWorkspaceId) return;

    const snapshot = useInboxStore.getState();
    const existingChat = snapshot.chats.find((chat) => chat.id === newChatData.id);
    const incomingStatus = newChatData.status || existingChat?.status || 'gerais';
    const shouldKeepVisible = isChatVisibleForOwnership(
      {
        id: newChatData.id,
        status: incomingStatus,
        agent_id: newChatData.agent_id ?? existingChat?.agentId ?? existingChat?.agent?.id ?? null,
      },
      ownershipFilter,
      initialUser?.id,
      snapshot.selectedChatId
    );

    if (!shouldKeepVisible) {
      if (existingChat && snapshot.selectedChatId !== newChatData.id) {
        removeChat(newChatData.id);
      }
      return;
    }

    const contactId: string | null = newChatData.contact_id ?? existingChat?.contact?.id ?? null;

    const previewRawDate =
      newChatData.updated_at ||
      newChatData.created_at ||
      existingChat?.updatedAt ||
      new Date().toISOString();
    const parsedPreviewDate = new Date(previewRawDate);
    const previewIso = Number.isNaN(parsedPreviewDate.getTime())
      ? new Date().toISOString()
      : parsedPreviewDate.toISOString();

    const existingLastMessage = existingChat?.messages?.[existingChat.messages.length - 1];
    const previewContent =
      typeof newChatData.last_message_preview === 'string'
        ? newChatData.last_message_preview.trim()
        : '';

    const previewMessage: Message | undefined = previewContent
      ? {
        id: existingLastMessage?.id || `chat-preview-${newChatData.id}`,
        chat_id: newChatData.id,
        workspace_id:
          newChatData.workspace_id ||
          existingChat?.workspace_id ||
          initialUser?.activeWorkspaceId ||
          '',
        content: previewContent,
        type: existingLastMessage?.type || 'text',
        status: existingLastMessage?.status || 'default',
        metadata: existingLastMessage?.metadata,
        transcription: existingLastMessage?.transcription ?? null,
        timestamp: formatInTimeZone(previewIso, workspaceTimezone, 'HH:mm', { locale: ptBR }),
        createdAt: previewIso,
        updatedAt: previewIso,
        formattedDate: formatMessageDay(new Date(previewIso)),
        sender: existingLastMessage?.sender,
        instance_name: newChatData.instance_name || existingLastMessage?.instance_name,
        source_from_api: newChatData.source || existingLastMessage?.source_from_api,
        api_message_status: existingLastMessage?.api_message_status,
        message_id_from_api: existingLastMessage?.message_id_from_api,
        from_me: existingLastMessage?.from_me,
        is_read: existingLastMessage?.is_read,
        sentByTab: existingLastMessage?.sentByTab ?? null,
        optimistic: false,
      }
      : undefined;

    let unreadCountValue = Number(newChatData.unread_count);

    // If the chat is currently selected and visible, it should remain read
    // even if Realtime sends a stale unread_count from the chats table.
    if (snapshot.selectedChatId === newChatData.id && document.hasFocus()) {
      unreadCountValue = 0;
    }

    const assignmentUpdate = reconcileRealtimeChatAssignment(existingChat, newChatData, initialUser);
    const optimisticUpdate: Partial<Chat> = {
      ...newChatData,
      id: newChatData.id,
      workspace_id:
        newChatData.workspace_id ||
        existingChat?.workspace_id ||
        initialUser?.activeWorkspaceId ||
        '',
      status: incomingStatus,
      ...assignmentUpdate,
      updatedAt: newChatData.updated_at || existingChat?.updatedAt || previewIso,
      unreadCount:
        Number.isFinite(unreadCountValue)
          ? unreadCountValue
          : existingChat?.unreadCount,
      teamName: newChatData.team_name || existingChat?.teamName,
      team_id: newChatData.team_id || existingChat?.team_id,
      teamColor: newChatData.team_color || existingChat?.teamColor,
      instance_name: newChatData.instance_name || existingChat?.instance_name,
      protocol: newChatData.protocol || existingChat?.protocol || `PRT-${String(newChatData.id).toUpperCase()}`,
      tag: typeof newChatData.tag === 'string' ? newChatData.tag : existingChat?.tag,
      color: typeof newChatData.color === 'string' ? newChatData.color : existingChat?.color,
      is_autopilot_active:
        typeof newChatData.is_autopilot_active === 'boolean'
          ? newChatData.is_autopilot_active
          : existingChat?.is_autopilot_active,
      autopilot_config_id:
        Object.prototype.hasOwnProperty.call(newChatData, 'autopilot_config_id')
          ? newChatData.autopilot_config_id
          : existingChat?.autopilot_config_id,
      copilot_mode:
        (newChatData.copilot_mode || existingChat?.copilot_mode || 'auto') as Chat['copilot_mode'],
      metaPlatform: (newChatData.meta_platform || existingChat?.metaPlatform || undefined) as Chat['metaPlatform'],
      metaContactExternalId: newChatData.meta_contact_external_id || existingChat?.metaContactExternalId,
      metaContactUsername: newChatData.meta_contact_username || existingChat?.metaContactUsername,
      contact: existingChat?.contact,
      messages: previewMessage
        ? [previewMessage]
        : (existingChat?.messages || []),
    };

    if (!optimisticUpdate.contact && contactId) {
      optimisticUpdate.contact = {
        id: contactId,
        name: 'Novo Contato...',
        workspace_id: optimisticUpdate.workspace_id || initialUser?.activeWorkspaceId || '',
        avatar_url: undefined,
        phone: '',
      } as Contact;
      void fetchContactById(contactId);
    }

    snapshot.upsertChats([optimisticUpdate as Chat]);
  }, [fetchContactById, formatMessageDay, initialUser, initialUser?.activeWorkspaceId, initialUser?.id, ownershipFilter, removeChat, workspaceTimezone]);

  const handleRealtimeStatusChange = useCallback((status: string, type: 'chats' | 'messages') => {
    console.info(`[REALTIME] ${type} channel status: ${status}`);
    if (status === 'SUBSCRIBED') {
      if (realtimeHealthyRef.current) {
        clearRecoverySync();
      } else {
        scheduleRecoverySync(`${type}:subscribed-waiting-peer`);
      }
      return;
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      console.warn(`[REALTIME] Connection lost (${status}). Running delta sync recovery.`);
      scheduleRecoverySync(`${type}:${status}`);
    }
  }, [clearRecoverySync, scheduleRecoverySync]);

  const handleRealtimeContactUpdate = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
    if (payload.eventType === 'DELETE') return;
    const contact = payload.new as any;
    if (!contact?.id) return;
    if (initialUser?.activeWorkspaceId && contact.workspace_id && contact.workspace_id !== initialUser.activeWorkspaceId) {
      return;
    }
    updateChatContact(contact);
  }, [initialUser?.activeWorkspaceId, updateChatContact]);

  // Use centralized Realtime hook
  const { isChatsConnected, isMessagesConnected } = useRealtimeSubscriptions({
    workspaceId: initialUser?.activeWorkspaceId,
    selectedChatId,
    chatUpdatesChatIdsCsv: undefined, // Always subscribe to all workspace updates to catch TRANSFERS (incoming chats not yet in my list)
    messagesListChatIdsCsv: ownershipFilter === 'mine' ? messagesListChatIdsCsv : undefined,
    onChatUpdate: handleRealtimeChatUpdate,
    onMessageUpdate: handleRealtimeMessage,
    onContactUpdate: handleRealtimeContactUpdate,
    onStatusChange: handleRealtimeStatusChange,
  });
  const isRealtimeHealthy = isChatsConnected && isMessagesConnected;
  realtimeHealthyRef.current = isRealtimeHealthy;

  useEffect(() => {
    if (initialData) {
      setWorkspaceTimezone(initialData.timezone || FALLBACK_TIMEZONE);

      // FIX: Prevent overwriting client-side state with stale/empty server selection during revalidation.
      // If we are already hydrated, the CLIENT selection is the source of truth, unless the user explicitly navigated.
      // initialData often comes from generic revalidations (like cookie updates) that reset selectedChatId to null.

      // Determine if we should preserve the current selection
      const clientHasSelection = !!selectedChatIdRef.current;

      // If hydrated, we almost ALWAYS trust the client ref over the server's suggestion for selection,
      // because the server prompt is often lagging or generic.
      const shouldPreserveSelection = isHydratedRef.current && clientHasSelection;

      let effectiveSelectedChatId = initialData.selectedChatId;
      let effectiveChats = initialData.chats;

      if (shouldPreserveSelection && selectedChatIdRef.current) {
        // console.log('[hydrate] Preserving client selection.', {
        //   client: selectedChatIdRef.current,
        //   server: initialData.selectedChatId
        // });

        effectiveSelectedChatId = selectedChatIdRef.current;

        // Crucially: Ensure the selected chat object is in the new list. 
        // The server query (limited by N) might have excluded it, or it moved lists (e.g. to Queue).
        const isInNewList = effectiveChats.some(c => c.id === effectiveSelectedChatId);

        if (!isInNewList) {
          const currentStoreChats = useInboxStore.getState().chats;
          const cachedChat = currentStoreChats.find(c => c.id === effectiveSelectedChatId);

          if (cachedChat) {
            // console.log('[hydrate] Injecting cached chat object into new server list to prevent disappearance.');
            // Add to start so it's visible. Logic will sort it anyway.
            effectiveChats = [cachedChat, ...effectiveChats];
          } else {
            console.warn('[hydrate] Selected chat ID preserved but object missing from cache and server. UI may be empty.');
            // Fallback: If we can't find it anywhere, maybe we SHOULD let the server overwrite it?
            // For now, keep it to prevent erratic jumping. The user will see a skeleton or empty state which is better than losing context.
          }
        }
      }
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
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-transparent">

      <>
        <div
          className={`relative z-10 flex h-full w-full overflow-hidden bg-background selection:bg-primary/20 ${highContrast ? 'contrast-125' : ''}`}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {needsAudioUnlock && (
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-foreground">
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
              onOwnershipFilterChange={setOwnershipFilter}
              isForwarding={isForwarding}
              selectedForwardingChatIds={selectedForwardingChatIds}
              onToggleForwardSelection={handleToggleForwardSelection}
              onSelectAllForwarding={handleSelectAllForwarding}
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
              canLoadOlder={hasLoadedSelectedMessageWindow && hasMoreHistory}
              isLoadingInitialMessages={Boolean(enrichedSelectedChat && !hasLoadedSelectedMessageWindow && !(enrichedSelectedChat as any)?.protocolScoped)}
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
              onContactUpdate={handleLocalContactUpdate}
            />
          )}
        </div>

        <CommandPalette />

      </>
    </div>
  );
}
