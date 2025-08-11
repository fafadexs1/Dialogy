
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
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleSetSelectedChat = (chat: Chat) => {
    setSelectedChat(chat);
  };
  
  // Function to fetch and update data, memoized with useCallback
    const updateData = useCallback(async () => {
        if (!currentUser.activeWorkspaceId) return;

        const latestChats = await fetchChatsForWorkspace(currentUser.activeWorkspaceId);
        setChats(latestChats);

        // Preserve selection if possible, otherwise select the first chat in the new list
        setSelectedChat(currentSelectedChat => {
            if (currentSelectedChat) {
                const updatedSelectedChat = latestChats.find(c => c.id === currentSelectedChat.id);
                // If the selected chat is still in the list, keep it selected.
                if (updatedSelectedChat) {
                    return updatedSelectedChat;
                }
            }
            // If no chat is selected, or the selected chat is no longer in the list,
            // select the first one from the appropriate category.
            const atendimentoChat = latestChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            if (atendimentoChat) return atendimentoChat;

            const geraisChat = latestChats.find(c => c.status === 'gerais');
            if (geraisChat) return geraisChat;
            
            return latestChats.length > 0 ? latestChats[0] : null;
        });

    }, [currentUser.activeWorkspaceId, currentUser.id]);


   useEffect(() => {
    // Fetch initial data and set loading states
    const initialLoad = async () => {
        setChats(initialChats);
        if (initialChats.length > 0) {
            const atendimentoChat = initialChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            const geraisChat = initialChats.find(c => c.status === 'gerais');
            handleSetSelectedChat(atendimentoChat || geraisChat || initialChats[0]);
        }
        // TODO: Replace mockTags with a real API call to fetch tags for the workspace
        setCloseReasons(mockTags.filter(t => t.is_close_reason));
        setLoading(false);

        // Start polling when component mounts and user is available
        if (currentUser.activeWorkspaceId) {
            if(pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = setInterval(updateData, 5000); // Poll every 5 seconds
        }
    };

    initialLoad();

    // Cleanup interval on component unmount
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
      />
      <ContactPanel chat={selectedChat} onTransferSuccess={updateData} />
    </div>
  );
}
