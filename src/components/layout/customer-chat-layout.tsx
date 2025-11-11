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


export default function CustomerChatLayout({ initialUser, chatId: initialChatId }: { initialUser: User | null, chatId: string | null }) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [broadcastChannel, setBroadcastChannel] = useState<BroadcastChannel | null>(null);
  const [workspaceTimezone, setWorkspaceTimezone] = useState<string>(FALLBACK_TIMEZONE);

  const selectedChatIdRef = useRef<string | null>(initialChatId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tabIdRef = useRef<string>(''); // Ref to hold the unique tab ID

  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = window.crypto.randomUUID();
  }

  const currentChatMessages = selectedChat ? messagesByChat[selectedChat.id] || [] : [];
  
  const fetchData = useCallback(async (isInitial = false) => {
    if (!initialUser?.activeWorkspaceId) {
      if (isInitial) {
        setFetchError("Workspace não encontrado. Por favor, atualize a página.");
        setIsLoading(false);
      }
      return;
    };

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
        
        const currentSelectedId = selectedChatIdRef.current;
        if (currentSelectedId) {
            const updatedSelectedChat = (fetchedChats || []).find(c => c.id === currentSelectedId);
            setSelectedChat(updatedSelectedChat || null);
        } else if ((fetchedChats || []).length > 0 && !currentSelectedId) {
            // If no chat is selected, but we have chats, select the first one.
            const firstChat = fetchedChats[0];
            setSelectedChat(firstChat);
            selectedChatIdRef.current = firstChat.id;
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
  }, [initialUser?.activeWorkspaceId]);

  const playNotificationSound = useCallback(() => {
    const isSoundEnabled = JSON.parse(localStorage.getItem('notificationSoundEnabled') || 'true');
    if (isSoundEnabled && audioRef.current) {
        audioRef.current.play().catch(e => console.error("Error playing notification sound:", e));
    }
  }, []);
  
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
        
        if (sourceTabId === tabIdRef.current) return;
        
        console.log(`[BROADCAST] Event '${type}' received from another tab.`, payload);
        switch(type) {
            case 'REFETCH':
                fetchData();
                break;
        }
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  useEffect(() => {
    if (initialUser) {
      fetchData(true);
    } else {
      setIsLoading(false);
    }
  }, [initialUser, fetchData]);

  // Polling mechanism as requested
  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    const intervalId = setInterval(() => {
        fetchData();
    }, 1000); // Poll every 1 second

    return () => clearInterval(intervalId);
  }, [initialUser?.activeWorkspaceId, fetchData]);


  const handleNewMessage = useCallback((newMessage: Message) => {
    setMessagesByChat(prevMessagesByChat => {
        const chatMessages = prevMessagesByChat[newMessage.chat_id] || [];
        if (chatMessages.some(m => m.id === newMessage.id)) {
            return prevMessagesByChat; // Avoid duplicates
        }
        return {
            ...prevMessagesByChat,
            [newMessage.chat_id]: [...chatMessages, newMessage]
        };
    });

    setChats(prevChats => {
        const chatIndex = prevChats.findIndex(c => c.id === newMessage.chat_id);
        if (chatIndex === -1) {
            // If chat doesn't exist, we might need to fetch it.
            // For now, let's log this case. A full refetch might be necessary here.
            console.warn(`[REALTIME] Received message for a chat not in the current list: ${newMessage.chat_id}. Refetching data.`);
            fetchData();
            return prevChats;
        }

        const chatToUpdate = { ...prevChats[chatIndex] };
        chatToUpdate.messages = [...(chatToUpdate.messages || []), newMessage];
        
        // Update unread count if the message is not from the current user
        if (!newMessage.from_me) {
            chatToUpdate.unreadCount = (chatToUpdate.unreadCount || 0) + 1;
        }
        
        // Move chat to the top
        const otherChats = prevChats.filter(c => c.id !== newMessage.chat_id);
        return [chatToUpdate, ...otherChats];
    });

    if (!newMessage.from_me && document.visibilityState !== 'visible') {
        playNotificationSound();
    }
  }, [playNotificationSound, fetchData]);

 const handleChatUpdate = useCallback((updatedChatData: Partial<Chat> & { id: string }) => {
    setChats(prevChats => {
        return prevChats.map(chat => {
            if (chat.id === updatedChatData.id) {
                // Merge new data, ensuring messages are handled correctly
                const existingMessages = chat.messages || [];
                return { ...chat, ...updatedChatData, messages: existingMessages };
            }
            return chat;
        });
    });
}, []);


const handleContactUpdate = useCallback((updatedContact: Contact) => {
    setChats(prevChats => {
        return prevChats.map(chat => {
            if (chat.contact.id === updatedContact.id) {
                return { ...chat, contact: updatedContact };
            }
            return chat;
        });
    });
}, []);

  useEffect(() => {
    if (!initialUser?.activeWorkspaceId) return;

    const supabase = createClient();
    // Use a single channel for all related tables
    const channelName = `realtime-updates-${initialUser.activeWorkspaceId}`;
    const channel = supabase.channel(channelName);

    const handleChanges = (payload: RealtimePostgresChangesPayload<any>) => {
      console.log('[REALTIME] Change received:', payload);

      if (payload.errors) {
        console.error('[REALTIME] Error:', payload.errors);
        return;
      }

      switch(payload.table) {
        case 'messages':
          if (payload.eventType === 'INSERT') {
            handleNewMessage(payload.new as Message);
          }
          break;
        case 'chats':
          if (payload.eventType === 'UPDATE') {
             handleChatUpdate(payload.new as Chat);
          }
          break;
        case 'contacts':
           if (payload.eventType === 'UPDATE') {
             handleContactUpdate(payload.new as Contact);
          }
          break;
      }
    };

    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, handleChanges)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[REALTIME] Subscribed to channel: ${channelName}`);
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
  }, [initialUser?.activeWorkspaceId, handleNewMessage, handleChatUpdate, handleContactUpdate, fetchData]);


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
    <div className="h-full flex-1 w-full min-h-0 flex overflow-hidden">
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
