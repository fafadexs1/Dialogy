
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';

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
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleSetSelectedChat = (chat: Chat) => {
    setSelectedChat(chat);
  };
  
   useEffect(() => {
    // Initial load
    setChats(initialChats);
    if (initialChats.length > 0) {
        handleSetSelectedChat(initialChats[0]);
    }
    setLoading(false);

    // Function to fetch and update data
    const updateData = async () => {
        if (!currentUser.activeWorkspaceId) return;

        const latestChats = await fetchChatsForWorkspace(currentUser.activeWorkspaceId);
        setChats(latestChats);

        // Update selected chat with new messages using a functional state update
        // This avoids issues with stale state in closures.
        setSelectedChat(currentSelectedChat => {
            if (currentSelectedChat) {
                const updatedSelectedChat = latestChats.find(c => c.id === currentSelectedChat.id);
                return updatedSelectedChat || currentSelectedChat;
            } else if (latestChats.length > 0) {
                 return latestChats[0];
            }
            return null;
        });
    };


    // Start polling when component mounts and user is available
    if (currentUser.activeWorkspaceId) {
        if(pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = setInterval(updateData, 5000); // Poll every 5 seconds
    }

    // Cleanup interval on component unmount
    return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };
  }, [initialChats, currentUser.activeWorkspaceId]);

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
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
        messages={selectedChat?.messages || []} 
        currentUser={currentUser} 
      />
      <ContactPanel chat={selectedChat} />
    </div>
  );
}
