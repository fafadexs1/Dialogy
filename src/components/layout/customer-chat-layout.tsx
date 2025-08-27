
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '../ui/skeleton';
import { supabase } from '@/lib/supabase';

function ClientCustomerChatLayout({ currentUser }: { currentUser: User }) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const selectedChatIdRef = useRef<string | null>(null);

  const fetchChatList = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;

    try {
        const response = await fetch(`/api/chats/${currentUser.activeWorkspaceId}`, { cache: 'no-store' });
        if (!response.ok) {
            console.error("Failed to fetch chats, status:", response.status);
            return;
        }
        const data = await response.json();
        setChats(data.chats || []);
    } catch(e) {
        console.error("Failed to fetch chats", e);
    }
  }, [currentUser.activeWorkspaceId]);

  const fetchMessagesForChat = useCallback(async (chatId: string) => {
    if (!currentUser.activeWorkspaceId) return;
    setIsLoadingMessages(true);

    try {
        const response = await fetch(`/api/chats/${currentUser.activeWorkspaceId}/${chatId}/messages`);
        if (!response.ok) {
            console.error("Failed to fetch messages, status:", response.status);
            setMessages([]);
            return;
        }
        const data = await response.json();
        setMessages(data.messages || []);
    } catch(e) {
        console.error("Failed to fetch messages for chat", chatId, e);
        setMessages([]);
    } finally {
        setIsLoadingMessages(false);
    }
  }, [currentUser.activeWorkspaceId]);

  const handleSetSelectedChat = async (chat: Chat) => {
    setSelectedChat(chat);
    selectedChatIdRef.current = chat.id;
    setShowFullHistory(false);
    
    // Immediately fetch messages for the selected chat
    fetchMessagesForChat(chat.id);
  };

  useEffect(() => {
    fetchChatList();
  }, [fetchChatList]);

  useEffect(() => {
    if (selectedChatIdRef.current) {
      fetchMessagesForChat(selectedChatIdRef.current);
    }
  }, [fetchMessagesForChat, selectedChat?.id]);

  useEffect(() => {
    if (!currentUser.activeWorkspaceId) return;

    const chatsChannel = supabase
      .channel('public:chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats', filter: `workspace_id=eq.${currentUser.activeWorkspaceId}` }, () => {
        fetchChatList();
      })
      .subscribe();

    const messagesChannel = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `workspace_id=eq.${currentUser.activeWorkspaceId}` }, payload => {
        const message = payload.new as { chat_id: string };
        if (selectedChatIdRef.current === message.chat_id) {
          fetchMessagesForChat(message.chat_id);
        }
        fetchChatList();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(chatsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [currentUser.activeWorkspaceId, fetchChatList, fetchMessagesForChat]);

  useEffect(() => {
      if(currentUser.activeWorkspaceId){
          getTags(currentUser.activeWorkspaceId).then(tagsResult => {
              if (!tagsResult.error && tagsResult.tags) {
                  setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
              }
          });
      }
  }, [currentUser.activeWorkspaceId]);

  return (
    <div className="h-full flex-1 w-full min-h-0 flex">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
        onUpdate={fetchChatList}
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
        messages={messages}
        isLoadingMessages={isLoadingMessages}
        currentUser={currentUser} 
        onActionSuccess={fetchChatList}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
      />
      <ContactPanel 
        chat={selectedChat} 
        onTransferSuccess={fetchChatList}
        onContactUpdate={fetchChatList}
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
