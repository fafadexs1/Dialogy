
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { getChatsAndMessages } from '@/actions/chats';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '../ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/hooks/use-toast';

function ClientCustomerChatLayout({ currentUser }: { currentUser: User }) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // This ref helps us keep track of the selected chat ID to avoid race conditions in subscriptions
  const selectedChatIdRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;
    setIsLoading(true);
    
    try {
        const { chats: fetchedChats, messagesByChat } = await getChatsAndMessages(currentUser.activeWorkspaceId);
        setChats(fetchedChats || []);
        
        // If a chat is selected, update its messages from the new data
        if (selectedChatIdRef.current && messagesByChat[selectedChatIdRef.current]) {
            setMessages(messagesByChat[selectedChatIdRef.current]);
        }
        
    } catch(e) {
        console.error("Failed to fetch chat data", e);
        toast({ title: "Erro ao carregar conversas", description: "Não foi possível buscar os dados do chat.", variant: "destructive" });
    } finally {
        setIsLoading(false);
    }
  }, [currentUser.activeWorkspaceId]);

  const handleSetSelectedChat = useCallback((chat: Chat) => {
    selectedChatIdRef.current = chat.id;
    setSelectedChat(chat);
    setShowFullHistory(false);
    
    // We fetch data again to ensure we have the latest messages for the selected chat
    fetchData(); 
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!currentUser.activeWorkspaceId) return;
    
    const supabase = createClient();

    const handleChange = (payload: any) => {
        // A smart refetch that only triggers if the change is relevant
        const relevantChatId = payload.new?.chat_id || payload.old?.id;
        const currentSelectedId = selectedChatIdRef.current;
        
        // Always refetch the list, but only refetch messages if the change affects the selected chat
        fetchData();
    };

    const chatsChannel = supabase
      .channel('public-chats-listener')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats', filter: `workspace_id=eq.${currentUser.activeWorkspaceId}` }, handleChange)
      .subscribe();

    const messagesChannel = supabase
      .channel('public-messages-listener')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `workspace_id=eq.${currentUser.activeWorkspaceId}` }, handleChange)
      .subscribe();

    return () => {
      supabase.removeChannel(chatsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [currentUser.activeWorkspaceId, fetchData]);

  useEffect(() => {
      if(currentUser.activeWorkspaceId){
          getTags(currentUser.activeWorkspaceId).then(tagsResult => {
              if (!tagsResult.error && tagsResult.tags) {
                  setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
              }
          });
      }
  }, [currentUser.activeWorkspaceId]);
  
  if (isLoading && chats.length === 0) {
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

  return (
    <div className="h-full flex-1 w-full min-h-0 flex">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
        onUpdate={fetchData}
      />
      <ChatPanel
        key={selectedChat?.id}
        chat={selectedChat}
        currentUser={currentUser}
        onActionSuccess={fetchData}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
      />
      <ContactPanel
        chat={selectedChat}
        onTransferSuccess={fetchData}
        onContactUpdate={fetchData}
      />
    </div>
  );
}


export default function CustomerChatLayout({ currentUser }: { currentUser: User }) {
  if (!currentUser) {
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
        currentUser={currentUser}
    />
  );
}

    