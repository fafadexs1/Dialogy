

'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag, Contact, MessageMetadata } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { getChatsAndMessages } from '@/actions/chats';
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

// Base64 encoded, short, and browser-safe notification sound
const NOTIFICATION_SOUND_DATA_URL = 'data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gUmVhbGl0eSBTRlgவனின்';
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


export default function CustomerChatLayout({ initialUser }: { initialUser: User | null }) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [broadcastChannel, setBroadcastChannel] = useState<BroadcastChannel | null>(null);
  const [workspaceTimezone, setWorkspaceTimezone] = useState<string>(FALLBACK_TIMEZONE);

  const selectedChatIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tabIdRef = useRef<string>(''); // Ref to hold the unique tab ID

  // This logic is safe because it only runs on the client
  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = window.crypto.randomUUID();
  }

  const currentChatMessages = selectedChat ? messagesByChat[selectedChat.id] || [] : [];

  const playNotificationSound = useCallback(() => {
    const isSoundEnabled = JSON.parse(localStorage.getItem('notificationSoundEnabled') || 'true');
    if (isSoundEnabled && audioRef.current) {
        audioRef.current.play().catch(e => console.error("Error playing notification sound:", e));
    }
  }, []);

  const fetchData = useCallback(async (isInitial = false) => {
    if (!initialUser?.activeWorkspaceId) return;

    if (isInitial) {
        setIsLoading(true);
        setFetchError(null);
    }

    try {
        const { chats: fetchedChats, messagesByChat: fetchedMessagesByChat, timezone, error } = await getChatsAndMessages(initialUser.activeWorkspaceId);

        if (error) throw new Error(error);

        setChats(fetchedChats || []);
        setMessagesByChat(fetchedMessagesByChat || {});
        if (timezone) {
            setWorkspaceTimezone(timezone);
        }

        if (selectedChatIdRef.current) {
            const updatedSelectedChat = (fetchedChats || []).find(c => c.id === selectedChatIdRef.current);
            setSelectedChat(updatedSelectedChat || null);
        }
        
        setFetchError(null);
        
    } catch(e: any) {
        console.error("Failed to fetch chat data", e);
        const errorMessage = e.message || "Não foi possível buscar os dados do chat.";
        if (isInitial) {
            toast({ title: "Erro ao carregar conversas", description: errorMessage, variant: "destructive" });
            setFetchError(errorMessage);
        }
    } finally {
        if(isInitial) setIsLoading(false);
    }
  }, [initialUser?.activeWorkspaceId, toast]);

  const handleSetSelectedChat = useCallback((chat: Chat) => {
    selectedChatIdRef.current = chat.id;
    setSelectedChat(chat);
    setShowFullHistory(false);
  }, []);

  // Effect to establish the Broadcast Channel for cross-tab communication
  useEffect(() => {
    const channel = new BroadcastChannel('chat-updates');
    setBroadcastChannel(channel);

    const handleMessage = (event: MessageEvent) => {
        const { type, payload, sourceTabId } = event.data;
        
        // Ignore events originating from the same tab
        if (sourceTabId === tabIdRef.current) return;
        
        console.log(`[BROADCAST] Event '${type}' received from another tab.`, payload);
        fetchData();
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [fetchData]);

  useEffect(() => {
    if (initialUser) {
      fetchData(true);
    } else {
      setIsLoading(false);
    }
  }, [initialUser, fetchData]);

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;
    
    const supabase = createClient();
    const channelName = `realtime-updates-${initialUser.activeWorkspaceId}`;

    const handleChanges = (payload: RealtimePostgresChangesPayload<any>) => {
        console.log('[REALTIME] Change received:', payload.eventType, payload.table);
        
        if (payload.errors) {
            console.error('[REALTIME] Error:', payload.errors);
            return;
        }
        
        // Always refetch for simplicity and data consistency for now
        // A more advanced implementation would apply optimistic updates
        fetchData();
    };

    const channel = supabase.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats', filter: `workspace_id=eq.${initialUser.activeWorkspaceId}` }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `workspace_id=eq.${initialUser.activeWorkspaceId}` }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `workspace_id=eq.${initialUser.activeWorkspaceId}` }, handleChanges)
      .subscribe((status) => {
        console.log(`[REALTIME STATUS] Channel ${channelName}:`, status);
        if (status === 'SUBSCRIBED') {
          // Connection is stable, no need to force fetch here unless necessary
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
           toast({
              title: "Conexão em Tempo Real Falhou",
              description: "Tentando reconectar. Atualizar a página pode ajudar.",
              variant: "destructive"
           });
        }
      });
      
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[VISIBILITY] Tab is visible again, re-fetching data to ensure sync.');
        fetchData();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [initialUser?.activeWorkspaceId, fetchData]);

  useEffect(() => {
      if(initialUser?.activeWorkspaceId){
          getTags(initialUser.activeWorkspaceId).then(tagsResult => {
              if (!tagsResult.error && tagsResult.tags) {
                  setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
              }
          });
      }
  }, [initialUser?.activeWorkspaceId]);

  // Effect to mark messages as read
  useEffect(() => {
    if (!selectedChat || !currentChatMessages.length || !document.hasFocus()) return;

    const hasUnread = currentChatMessages.some(m => !m.from_me && !m.is_read);

    if (hasUnread) {
        console.log(`[MARK_AS_READ] Marking messages as read for chat ${selectedChat.id}.`);

        setChats(prevChats => prevChats.map(c => 
            c.id === selectedChat.id ? { ...c, unreadCount: 0 } : c
        ));
        
        setMessagesByChat(prevMessages => {
            const updatedMessages = { ...prevMessages };
            if (updatedMessages[selectedChat.id]) {
                updatedMessages[selectedChat.id] = updatedMessages[selectedChat.id].map(m => 
                    !m.from_me ? { ...m, is_read: true } : m
                );
            }
            return updatedMessages;
        });
        
        // Fire-and-forget the update to the server. The UI is already updated optimistically.
        fetch('/api/chats/mark-as-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: selectedChat.id })
        }).catch(() => {
            console.error("Failed to mark messages as read on the server. Data will sync on next fetch.");
        });
    }
  }, [selectedChat, currentChatMessages]);
  
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
                 <Button onClick={() => fetchData(true)} className="mt-4">
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
    <div className="h-full flex-1 w-full min-h-0 flex">
      <audio ref={audioRef} src={NOTIFICATION_SOUND_DATA_URL} preload="auto" />
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={initialUser}
        onUpdate={() => fetchData()}
      />
      <ChatPanel
        key={selectedChat?.id}
        chat={enrichedSelectedChat}
        currentUser={initialUser}
        onActionSuccess={() => fetchData()}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
        tabId={tabIdRef.current}
      />
      <ContactPanel
        chat={enrichedSelectedChat}
        currentUser={initialUser}
        onTransferSuccess={() => fetchData()}
        onContactUpdate={() => fetchData()}
      />
    </div>
  );
}
