'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, User, Tag } from '@/lib/types';
import { getInitialChatsData, getChatMessagesWindow } from '@/actions/chats';
import { Skeleton } from '../ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { replaceChatPath } from '@/lib/chat-navigation';
import { useRouter } from 'next/navigation';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { RealtimeProvider } from '../providers/realtime-provider';

const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

function LoadingSkeleton() {
  return (
    <div className="flex flex-1 w-full min-h-0 h-full bg-black/20 backdrop-blur-xl">
      <div className="flex w-[360px] flex-shrink-0 flex-col border-r border-white/10 bg-black/20 backdrop-blur-xl p-4 gap-4">
        <Skeleton className="h-12 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
        <div className="space-y-2 mt-4">
          <Skeleton className="h-24 w-full bg-white/5" />
        </div>
        <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l border-white/10 bg-black/20 backdrop-blur-xl p-4 gap-4">
          <Skeleton className="h-16 w-full bg-white/5" />
          <Skeleton className="h-24 w-full bg-white/5" />
          <Skeleton className="h-32 w-full bg-white/5" />
        </div>
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
  const [workspaceTimezone, setWorkspaceTimezone] = useState<string>(FALLBACK_TIMEZONE);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(true);

  const chats = useInboxStore((state) => state.chats);
  const selectedChatId = useInboxStore((state) => state.selectedChatId);
  const messagesByChat = useInboxStore((state) => state.messagesByChat);
  const oldestMessageDateByChat = useInboxStore((state) => state.oldestMessageDateByChat);
  const hasMoreHistoryByChat = useInboxStore((state) => state.hasMoreHistoryByChat);
  const setInitialData = useInboxStore((state) => state.setInitialData);
  const setSelectedChatId = useInboxStore((state) => state.setSelectedChatId);
  const setMessagesForChat = useInboxStore((state) => state.setMessagesForChat);
  const prependMessagesToChat = useInboxStore((state) => state.prependMessagesToChat);
  const updateChatContact = useInboxStore((state) => state.updateChatContact);
  const markChatAsReadInStore = useInboxStore((state) => state.markChatAsRead);

  const selectedChatIdRef = useRef<string | null>(initialChatId);
  const tabIdRef = useRef<string>('');
  const initialBuildIdRef = useRef<string>('');
  const buildMismatchTriggeredRef = useRef(false);

  useEffect(() => {
    useInboxStore.getState().reset();
    console.log('[NOTIFICATION] Layout mounted. Waiting for inbox data...');
  }, []);

  if (typeof window !== 'undefined' && !tabIdRef.current) {
    // Safe UUID generation with fallback
    if (typeof window.crypto?.randomUUID === 'function') {
      tabIdRef.current = window.crypto.randomUUID();
    } else {
      tabIdRef.current = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
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
    if (selectedChatIdRef.current === chat.id) return; // Prevent duplicate navigation
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

  // Mark as read logic
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

  useEffect(() => {
    if (initialUser) {
      initializeInbox();
    } else {
      setIsLoading(false);
    }
  }, [initialUser, initializeInbox]);

  // Build mismatch check (kept as requested implicitly by not being part of polling removal)
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

  const handleDataMutation = useCallback(() => {
    console.log('[Layout] Data mutation occurred');
  }, []);

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
    );
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
        {initialUser.activeWorkspaceId && (
          <RealtimeProvider
            workspaceId={initialUser.activeWorkspaceId}
            userId={initialUser.id}
            workspaceTimezone={workspaceTimezone}
          />
        )}

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
          workspaceTimezone={workspaceTimezone}
          onToggleContactPanel={() => setIsContactPanelOpen(!isContactPanelOpen)}
        />
        {isContactPanelOpen && (
          <ContactPanel
            chat={enrichedSelectedChat}
            currentUser={initialUser}
            onTransferSuccess={handleDataMutation}
            onContactUpdate={handleDataMutation}
          />
        )}
      </div>
    </div>
  );
}
