

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
  const workspaceTimezoneRef = useRef<string>(workspaceTimezone);
  const chatsRef = useRef<Chat[]>([]);

  // This logic is safe because it only runs on the client
  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = window.crypto.randomUUID();
  }

  const currentChatMessages = selectedChat ? messagesByChat[selectedChat.id] || [] : [];

  useEffect(() => {
    workspaceTimezoneRef.current = workspaceTimezone;
  }, [workspaceTimezone]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const playNotificationSound = useCallback(() => {
    const isSoundEnabled = JSON.parse(localStorage.getItem('notificationSoundEnabled') || 'true');
    if (isSoundEnabled && audioRef.current) {
        audioRef.current.play().catch(e => console.error("Error playing notification sound:", e));
    }
  }, []);

  const parseMetadata = useCallback((metadata: unknown): MessageMetadata | undefined => {
    if (!metadata) return undefined;
    if (typeof metadata === 'object') return metadata as MessageMetadata;
    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata) as MessageMetadata;
      } catch (error) {
        console.error('[REALTIME] Failed to parse metadata JSON:', error);
      }
    }
    return undefined;
  }, []);

  const formatMessageDateLabel = useCallback((date: Date, timezone: string) => {
    const zoned = toZonedTime(date, timezone);
    if (isToday(zoned)) {
      return 'Hoje';
    }
    if (isYesterday(zoned)) {
      return 'Ontem';
    }
    return formatDate(zoned, 'dd/MM/yyyy', { locale: ptBR });
  }, []);

  const normalizeRealtimeMessage = useCallback((rawMessage: any): Message | null => {
    if (!rawMessage) return null;

    if ('formattedDate' in rawMessage && 'createdAt' in rawMessage) {
      return {
        ...rawMessage,
        metadata: parseMetadata(rawMessage.metadata),
      } as Message;
    }

    if (!rawMessage.chat_id) {
      return null;
    }

    const createdAtIso = rawMessage.created_at || rawMessage.createdAt || rawMessage.timestamp || new Date().toISOString();
    const createdAtDate = new Date(createdAtIso);
    const safeCreatedAt = isNaN(createdAtDate.getTime()) ? new Date() : createdAtDate;
    const timezone = workspaceTimezoneRef.current || FALLBACK_TIMEZONE;
    const timestamp = formatInTimeZone(safeCreatedAt, 'HH:mm', { locale: ptBR, timeZone: timezone });
    const formattedDate = formatMessageDateLabel(safeCreatedAt, timezone);

    const chatsSnapshot = chatsRef.current;
    const relatedChat = chatsSnapshot.find(chat => chat.id === rawMessage.chat_id);

    let sender: Message['sender'];
    if (rawMessage.from_me) {
      if (relatedChat?.agent) {
        sender = relatedChat.agent;
      } else if (initialUser) {
        sender = {
          id: initialUser.id,
          name: initialUser.name,
          firstName: initialUser.firstName,
          lastName: initialUser.lastName,
          avatar: initialUser.avatar,
          email: initialUser.email,
        } as Message['sender'];
      }
    } else if (relatedChat?.contact) {
      sender = relatedChat.contact;
    }

    return {
      id: rawMessage.id,
      chat_id: rawMessage.chat_id,
      workspace_id: rawMessage.workspace_id,
      content: rawMessage.content || '',
      type: rawMessage.type,
      status: rawMessage.content === 'Mensagem apagada' || rawMessage.status === 'deleted' ? 'deleted' : 'default',
      metadata: parseMetadata(rawMessage.metadata),
      transcription: rawMessage.transcription ?? null,
      timestamp,
      createdAt: safeCreatedAt.toISOString(),
      formattedDate,
      sender,
      instance_name: rawMessage.instance_name,
      source_from_api: rawMessage.source_from_api,
      api_message_status: rawMessage.api_message_status,
      message_id_from_api: rawMessage.message_id_from_api,
      from_me: Boolean(rawMessage.from_me),
      is_read: Boolean(rawMessage.is_read),
      sent_by_tab: rawMessage.sent_by_tab,
    } as Message;
  }, [formatMessageDateLabel, initialUser, parseMetadata]);

  const handleNewMessage = useCallback((incomingMessage: any) => {
     const normalizedMessage = normalizeRealtimeMessage(incomingMessage);
     if (!normalizedMessage || !normalizedMessage.chat_id) return;
     if (normalizedMessage.sent_by_tab === tabIdRef.current) return;

     if (!normalizedMessage.from_me && selectedChatIdRef.current !== normalizedMessage.chat_id) {
        playNotificationSound();
     }

    setMessagesByChat(prev => {
        const currentMessages = prev[normalizedMessage.chat_id] || [];
        if (currentMessages.some(m => m.id === normalizedMessage.id)) return prev;
        const updatedMessages = [...currentMessages, normalizedMessage].sort((a, b) => {
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        return {
            ...prev,
            [normalizedMessage.chat_id]: updatedMessages,
        };
    });

    setChats(prev => {
        const chatIndex = prev.findIndex(c => c.id === normalizedMessage.chat_id);
        if (chatIndex === -1) {
            fetchData();
            return prev;
        }

        const updatedChat = {
            ...prev[chatIndex],
            messages: [normalizedMessage],
            unreadCount: !normalizedMessage.from_me ? (prev[chatIndex].unreadCount || 0) + 1 : prev[chatIndex].unreadCount,
        };

        const otherChats = prev.filter(c => c.id !== normalizedMessage.chat_id);
        return [updatedChat, ...otherChats];
    });

  }, [playNotificationSound, fetchData, normalizeRealtimeMessage]);

  const handleChatUpdate = useCallback((updatedChat: Partial<Chat> & { id: string }) => {
      setChats(prev => prev.map(c => c.id === updatedChat.id ? { ...c, ...updatedChat } : c));
      if (selectedChatIdRef.current === updatedChat.id) {
          setSelectedChat(prev => prev ? { ...prev, ...updatedChat } : null);
      }
  }, []);
  
  const handleContactUpdate = useCallback((updatedContact: Partial<Contact> & { id: string }) => {
        setChats(prev => prev.map(c => c.contact.id === updatedContact.id ? { ...c, contact: {...c.contact, ...updatedContact} } : c));
        if (selectedChat?.contact.id === updatedContact.id) {
            setSelectedChat(prev => prev ? { ...prev, contact: {...prev.contact, ...updatedContact} } : null);
        }
  }, [selectedChat?.contact.id]);
  
  const handleMessageDelete = useCallback((deletedMessage: Message) => {
        setMessagesByChat(prev => {
         const currentMessages = prev[deletedMessage.chat_id] || [];
         return {
             ...prev,
             [deletedMessage.chat_id]: currentMessages.filter(m => m.id !== deletedMessage.id),
         };
     });
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
        
        if (sourceTabId === tabIdRef.current) return;
        
        console.log(`[BROADCAST] Event '${type}' received from another tab.`, payload);
        switch(type) {
            case 'NEW_MESSAGE':
                handleNewMessage(payload);
                break;
            case 'UPDATE_CHAT':
                handleChatUpdate(payload);
                break;
            case 'UPDATE_CONTACT':
                handleContactUpdate(payload);
                break;
            case 'DELETE_MESSAGE':
                handleMessageDelete(payload);
                break;
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

        const record = payload.new as any;
        let eventType: string | null = null;
        let eventPayload: any = null;

        switch (payload.eventType) {
            case 'INSERT':
                if (payload.table === 'messages') {
                    const normalized = normalizeRealtimeMessage(record);
                    if (!normalized || normalized.sent_by_tab === tabIdRef.current) return;
                    eventType = 'NEW_MESSAGE';
                    eventPayload = normalized;
                    handleNewMessage(normalized);
                }
                break;
            case 'UPDATE':
                if (payload.table === 'chats') {
                    eventType = 'UPDATE_CHAT';
                    eventPayload = record as Chat;
                    handleChatUpdate(eventPayload);
                } else if (payload.table === 'contacts') {
                    eventType = 'UPDATE_CONTACT';
                    eventPayload = record as Contact;
                    handleContactUpdate(eventPayload);
                }
                break;
            case 'DELETE':
                if(payload.table === 'messages') {
                    eventType = 'DELETE_MESSAGE';
                    eventPayload = payload.old as Message;
                    handleMessageDelete(eventPayload);
                }
                 break;
            default:
                break;
        }

        if (eventType && broadcastChannel) {
            broadcastChannel.postMessage({ type: eventType, payload: eventPayload, sourceTabId: tabIdRef.current });
        }
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
  }, [initialUser?.activeWorkspaceId, fetchData, broadcastChannel, handleNewMessage, handleChatUpdate, handleContactUpdate, handleMessageDelete, normalizeRealtimeMessage]);

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
