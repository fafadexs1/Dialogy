
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { getChatsAndMessages } from '@/actions/chats';
import { Skeleton } from '../ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';

// Base64 encoded, short, and browser-safe notification sound
const NOTIFICATION_SOUND_DATA_URL = 'data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gUmVhbGl0eSBTRlgவனின்';

function ClientCustomerChatLayout({ initialUser }: { initialUser: User }) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const selectedChatIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousMessagesCount = useRef<Record<string, number>>({});
  
  const currentChatMessages = selectedChat ? messagesByChat[selectedChat.id] || [] : [];

  const playNotificationSound = useCallback(() => {
    const isSoundEnabled = JSON.parse(localStorage.getItem('notificationSoundEnabled') || 'true');
    if (isSoundEnabled && audioRef.current) {
        audioRef.current.play().catch(e => console.error("Error playing notification sound:", e));
    }
  }, []);

  const fetchData = useCallback(async (isInitial = false) => {
    if (!initialUser.activeWorkspaceId) return;
    
    if (isInitial) {
        setIsLoading(true);
        setFetchError(null);
    }
    
    try {
        const { chats: fetchedChats, messagesByChat: fetchedMessagesByChat, error } = await getChatsAndMessages(initialUser.activeWorkspaceId);
        
        if (error) {
            throw new Error(error);
        }
        
        const newChats = fetchedChats || [];
        const newMessagesByChat = fetchedMessagesByChat || {};

        // Check for new messages that should trigger a notification
        newChats.forEach(chat => {
            const isMyAttendance = chat.status === 'atendimentos' && chat.agent?.id === initialUser.id;
            const newMessages = newMessagesByChat[chat.id] || [];
            const oldMessageCount = previousMessagesCount.current[chat.id] || 0;
            const lastMessage = newMessages[newMessages.length - 1];

            if (isMyAttendance && newMessages.length > oldMessageCount && lastMessage && !lastMessage.from_me) {
                 playNotificationSound();
            }
            previousMessagesCount.current[chat.id] = newMessages.length;
        });

        setChats(newChats);
        setMessagesByChat(newMessagesByChat);
        
        // If there's a selected chat, find its updated version in the new list and update the state
        if (selectedChatIdRef.current) {
            const updatedSelectedChat = newChats.find(c => c.id === selectedChatIdRef.current);
            if (updatedSelectedChat) {
                setSelectedChat(updatedSelectedChat);
            } else {
                // The chat might have been closed or removed from the list
                setSelectedChat(null);
                selectedChatIdRef.current = null;
            }
        }
        
        setFetchError(null);
        
    } catch(e: any) {
        console.error("Failed to fetch chat data", e);
        const errorMessage = e.message || "Não foi possível buscar os dados do chat.";
        toast({ title: "Erro ao carregar conversas", description: errorMessage, variant: "destructive" });
        setFetchError(errorMessage);
    } finally {
        if(isInitial) setIsLoading(false);
    }
  }, [initialUser.activeWorkspaceId, initialUser.id, playNotificationSound]);

  const handleSetSelectedChat = useCallback((chat: Chat) => {
    selectedChatIdRef.current = chat.id;
    setSelectedChat(chat);
    setShowFullHistory(false);
    
    if (!messagesByChat[chat.id]) {
        fetchData();
    }
  }, [fetchData, messagesByChat]);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    if (!initialUser.activeWorkspaceId) return;
    
    const supabase = createClient();

    const handleChange = (payload: any) => {
        console.log('[REALTIME] Mudança detectada:', payload);
        fetchData();
    };

    const chatsChannel = supabase
      .channel('public:chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats', filter: `workspace_id=eq.${initialUser.activeWorkspaceId}` }, handleChange)
      .subscribe();

    const messagesChannel = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `workspace_id=eq.${initialUser.activeWorkspaceId}` }, handleChange)
      .subscribe();

    return () => {
      supabase.removeChannel(chatsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [initialUser.activeWorkspaceId, fetchData]);

  useEffect(() => {
      if(initialUser.activeWorkspaceId){
          getTags(initialUser.activeWorkspaceId).then(tagsResult => {
              if (!tagsResult.error && tagsResult.tags) {
                  setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
              }
          });
      }
  }, [initialUser.activeWorkspaceId]);

  // Effect to mark messages as read
  useEffect(() => {
    if (!selectedChat || !currentChatMessages.length) return;

    const hasUnread = currentChatMessages.some(m => !m.from_me && !m.is_read);

    if (hasUnread) {
        console.log(`[MARK_AS_READ] Marking messages as read for chat ${selectedChat.id}.`);

        // Optimistically update UI to remove unread count immediately
        setChats(prevChats => prevChats.map(c => 
            c.id === selectedChat.id ? { ...c, unreadCount: 0 } : c
        ));
        
        setMessagesByChat(prevMessages => {
            const updatedMessages = { ...prevMessages };
            if (updatedMessages[selectedChat.id]) {
                updatedMessages[selectedChat.id] = updatedMessages[selectedChat.id].map(m => ({ ...m, is_read: true }));
            }
            return updatedMessages;
        });
        
        // Call API in the background
        fetch('/api/chats/mark-as-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: selectedChat.id })
        }).then(res => {
            if (!res.ok) {
                console.error("Failed to mark messages as read on the server. Re-fetching to sync.");
                // If the API call fails, refetch data to get the correct state
                fetchData();
            }
        }).catch(() => {
            console.error("Failed to mark messages as read on the server. Re-fetching to sync.");
            fetchData();
        });
    }
}, [selectedChat, currentChatMessages, fetchData]);

  
  if (isLoading) {
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
      // Calculate unread count on the fly for the selected chat
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


export default function CustomerChatLayout({ initialUser }: { initialUser: User | null }) {
  if (!initialUser) {
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
    )
  }
  
  return (
    <ClientCustomerChatLayout
        initialUser={initialUser}
    />
  );
}
