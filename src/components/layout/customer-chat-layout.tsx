
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
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

    setSelectedChat(currentSelectedChat => {
        if (!currentSelectedChat) {
            const atendimentoChat = latestChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            if (atendimentoChat) return atendimentoChat;
            const geraisChat = latestChats.find(c => c.status === 'gerais');
            if (geraisChat) return geraisChat;
            return latestChats.length > 0 ? latestChats[0] : null;
        }

        const updatedSelectedChatInList = latestChats.find(c => c.id === currentSelectedChat.id);

        if (updatedSelectedChatInList) {
            return updatedSelectedChatInList;
        } else {
            return currentSelectedChat;
        }
    });

}, [currentUser.activeWorkspaceId, currentUser.id]);


   useEffect(() => {
    const initialLoad = async () => {
        setChats(initialChats);
        if (initialChats.length > 0 && !selectedChat) {
            const atendimentoChat = initialChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            const geraisChat = initialChats.find(c => c.status === 'gerais');
            handleSetSelectedChat(atendimentoChat || geraisChat || initialChats[0]);
        }
        setCloseReasons(mockTags.filter(t => t.is_close_reason));

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
  }, [initialChats, currentUser.activeWorkspaceId, currentUser.id, updateData, selectedChat]);


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
