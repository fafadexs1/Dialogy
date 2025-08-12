
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { mockTags } from '@/lib/mock-data'; // Assuming tags are fetched/mocked somewhere

interface CustomerChatLayoutProps {
    initialChats: Chat[];
    currentUser: User;
}

// Helper function to fetch chats for the workspace
async function fetchChatsForWorkspace(workspaceId: string): Promise<Chat[]> {
    if (!workspaceId) return [];
    try {
        const response = await fetch(`/api/chats/${workspaceId}`, { cache: 'no-store' });
        if (!response.ok) {
            console.error('Failed to fetch chats');
            return [];
        }
        const data = await response.json();
        return data.chats;
    } catch (error) {
        console.error('Error fetching chats:', error);
        return [];
    }
}


export default function CustomerChatLayout({ initialChats, currentUser }: CustomerChatLayoutProps) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [loading, setLoading] = useState(true);
  const [closeReasons, setCloseReasons] = useState<Tag[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(true);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleSetSelectedChat = (chat: Chat) => {
    setSelectedChat(chat);
    setShowFullHistory(true);
  };
  
  const updateData = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;

    const latestChats = await fetchChatsForWorkspace(currentUser.activeWorkspaceId);
    setChats(latestChats);

    // This logic ensures that if the currently selected chat is no longer in the main
    // list (e.g., it was closed), we don't just pick a random new one, which would
    // cause the UI to jump. We keep the state unless there's no chat selected at all.
    setSelectedChat(currentSelectedChat => {
        // If there's no chat selected, try to select a default one.
        if (!currentSelectedChat) {
            const atendimentoChat = latestChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            if (atendimentoChat) return atendimentoChat;
            const geraisChat = latestChats.find(c => c.status === 'gerais');
            if (geraisChat) return geraisChat;
            return latestChats.length > 0 ? latestChats[0] : null;
        }

        // If a chat is currently selected, find its updated version in the new list.
        const updatedSelectedChatInList = latestChats.find(c => c.id === currentSelectedChat.id);

        // If the updated version is found, return it.
        if (updatedSelectedChatInList) {
            return updatedSelectedChatInList;
        } else {
            // If the currently selected chat is NOT in the new list (e.g., it was closed and now filtered out),
            // DO NOT change the selection. Keep the existing `currentSelectedChat` object in state.
            // This prevents the details panel from suddenly changing. The user can manually select a new chat.
            return currentSelectedChat;
        }
    });

}, [currentUser.activeWorkspaceId, currentUser.id]);


   useEffect(() => {
    const initialLoad = async () => {
        setChats(initialChats);
        if (initialChats.length > 0) {
            const atendimentoChat = initialChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            const geraisChat = initialChats.find(c => c.status === 'gerais');
            handleSetSelectedChat(atendimentoChat || geraisChat || initialChats[0]);
        }
        setCloseReasons(mockTags.filter(t => t.is_close_reason));
        setLoading(false);

        if (currentUser.activeWorkspaceId) {
            if(pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = setInterval(updateData, 5000); 
        }
    };

    initialLoad();

    return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };
  }, [initialChats, currentUser.activeWorkspaceId, currentUser.id, updateData]);


  if (loading) {
      return (
          <div className="flex flex-1 w-full min-h-0">
            <div className="flex w-full max-w-sm flex-col border-r bg-card p-4 gap-4">
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
    <div className="flex flex-1 w-full min-h-0">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
        messages={selectedChat?.messages || []} 
        currentUser={currentUser} 
        onActionSuccess={updateData}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
      />
      <ContactPanel 
        chat={selectedChat} 
        onTransferSuccess={updateData}
        onContactUpdate={updateData}
      />
    </div>
  );
}
