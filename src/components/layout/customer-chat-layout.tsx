
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '../ui/skeleton';

function ClientCustomerChatLayout({ currentUser }: { currentUser: User }) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingChatList, setIsLoadingChatList] = useState(true);

  const selectedChatIdRef = useRef<string | null>(null);

  const fetchChatList = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;
    // Don't set loading for subsequent polls
    if (isLoadingChatList) setIsLoadingChatList(true); 

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
    } finally {
        setIsLoadingChatList(false);
    }
  }, [currentUser.activeWorkspaceId, isLoadingChatList]);

  const fetchMessagesForChat = useCallback(async (chatId: string) => {
    if (!currentUser.activeWorkspaceId) return;
    setIsLoadingMessages(true);
    try {
        const response = await fetch(`/api/chats/${currentUser.activeWorkspaceId}/${chatId}/messages`, { cache: 'no-store' });
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

  const handleSetSelectedChat = useCallback(async (chat: Chat) => {
    setSelectedChat(chat);
    selectedChatIdRef.current = chat.id;
    setShowFullHistory(false);
    fetchMessagesForChat(chat.id);
  }, [fetchMessagesForChat]);

  // Initial data fetch and polling setup
  useEffect(() => {
    fetchChatList(); // Initial fetch
    const chatListInterval = setInterval(fetchChatList, 2000); // Poll chat list every 2 seconds

    return () => clearInterval(chatListInterval);
  }, [fetchChatList]);
  
  useEffect(() => {
    let messagesInterval: NodeJS.Timeout | null = null;
    if (selectedChatIdRef.current) {
        messagesInterval = setInterval(() => {
            fetchMessagesForChat(selectedChatIdRef.current!);
        }, 1000); // Poll messages every 1 second for the active chat
    }

    return () => {
        if (messagesInterval) {
            clearInterval(messagesInterval);
        }
    };
  }, [fetchMessagesForChat, selectedChat?.id]);
  
  // Fetch close reasons (less frequent update needed)
  useEffect(() => {
      if(currentUser.activeWorkspaceId){
          getTags(currentUser.activeWorkspaceId).then(tagsResult => {
              if (!tagsResult.error && tagsResult.tags) {
                  setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
              }
          });
      }
  }, [currentUser.activeWorkspaceId]);

  if (isLoadingChatList) {
       return (
            <div className="flex flex-1 w-full min-h-0 h-full">
                <Skeleton className="w-[360px] flex-shrink-0" />
                <div className="flex-1 flex flex-col min-w-0">
                    <Skeleton className="h-16 w-full" />
                    <div className="flex-1 p-6"><Skeleton className="h-full w-full" /></div>
                    <Skeleton className="h-24 w-full" />
                </div>
                <Skeleton className="w-1/4 hidden lg:block" />
            </div>
        )
  }

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
        onActionSuccess={() => {
            fetchChatList();
            if (selectedChat) fetchMessagesForChat(selectedChat.id);
        }}
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
  const [loading, setLoading] = useState(true);
  const auth = useAuth(); // Use auth hook to wait for user session

  useEffect(() => {
    if (auth) {
        setLoading(false);
    }
  }, [auth]);
  
  if (loading || !auth) {
      return (
        <div className="flex flex-1 w-full min-h-0 h-full">
            <Skeleton className="w-[360px] flex-shrink-0" />
            <div className="flex-1 flex flex-col min-w-0">
                <Skeleton className="h-16 w-full" />
                <div className="flex-1 p-6"><Skeleton className="h-full w-full" /></div>
                <Skeleton className="h-24 w-full" />
            </div>
            <Skeleton className="w-1/4 hidden lg:block" />
        </div>
      )
  }

  return (
    <ClientCustomerChatLayout currentUser={currentUser} />
  );
}
