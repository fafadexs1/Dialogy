
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { markMessagesAsReadAction } from '@/actions/evolution-api';

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

    // Immediately mark messages as read when a chat is selected
    if (chat.unreadCount && chat.unreadCount > 0 && chat.contact.phone_number_jid && chat.instance_name) {
      console.log(`[MARK_AS_READ_ACTION] Marking ${chat.unreadCount} messages as read for chat ${chat.id}`);
      const unreadMessages = chat.messages.filter(m => !m.from_me && !m.is_read && m.message_id_from_api);
      
      const messagesToMarkForApi = unreadMessages.map(m => ({
        remoteJid: chat.contact.phone_number_jid!,
        fromMe: false,
        id: m.message_id_from_api!,
      }));
      const messageDbIdsToUpdate = unreadMessages.map(m => m.id);

      markMessagesAsReadAction(chat.instance_name, messagesToMarkForApi, messageDbIdsToUpdate).then(() => {
        // Optimistically update the UI
        setChats(prevChats => 
            prevChats.map(c => 
                c.id === chat.id ? { ...c, unreadCount: 0 } : c
            )
        );
      });
    }
  };
  
  const updateData = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;

    const latestChats = await fetchChatsForWorkspace(currentUser.activeWorkspaceId);
    setChats(latestChats);

    // Update selected chat with latest data from the list
    if (selectedChat) {
      const updatedSelectedChat = latestChats.find(c => c.id === selectedChat.id);
      if (updatedSelectedChat) {
        setSelectedChat(updatedSelectedChat);
      }
    }

}, [currentUser.activeWorkspaceId, selectedChat]);


   useEffect(() => {
    const initialLoad = async () => {
        setChats(initialChats);
        if (initialChats.length > 0 && !selectedChat) {
            const atendimentoChat = initialChats.find(c => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
            const geraisChat = initialChats.find(c => c.status === 'gerais');
            const chatToSelect = atendimentoChat || geraisChat || initialChats[0];
            if (chatToSelect) {
              handleSetSelectedChat(chatToSelect);
            }
        }
        
        if(currentUser.activeWorkspaceId){
            const tagsResult = await getTags(currentUser.activeWorkspaceId);
            if (!tagsResult.error && tagsResult.tags) {
                setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
            }
        }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChats, currentUser.activeWorkspaceId, currentUser.id]);


  return (
    <div className="flex flex-1 w-full min-h-0">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
        onUpdate={updateData}
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
