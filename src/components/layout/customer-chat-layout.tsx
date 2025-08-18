
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';

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

  // Use a ref to hold the current selected chat ID to avoid stale closures in interval
  const selectedChatIdRef = useRef<string | null>(null);
  useEffect(() => {
      selectedChatIdRef.current = selectedChat?.id || null;
  }, [selectedChat]);


   const handleSetSelectedChat = async (chat: Chat) => {
    // Optimistic Update: Set the selected chat immediately for instant UI feedback.
    setSelectedChat(chat);
    setShowFullHistory(true);

    if (chat.unreadCount && chat.unreadCount > 0) {
      // Optimistically update the unread count in the UI
      setChats(prevChats => 
          prevChats.map(c => 
              c.id === chat.id ? { ...c, unreadCount: 0 } : c
          )
      );
      
      const unreadMessages = chat.messages.filter(m => !m.from_me && !m.is_read);
      const messageDbIdsToUpdate = unreadMessages.map(m => m.id);

      if (messageDbIdsToUpdate.length > 0) {
        const payload = {
            messageIds: messageDbIdsToUpdate,
            instanceName: chat.instance_name,
            messagesToMark: chat.instance_name ? unreadMessages
                .filter(m => m.message_id_from_api)
                .map(m => ({
                    remoteJid: chat.contact.phone_number_jid!,
                    fromMe: false,
                    id: m.message_id_from_api!,
                })) : undefined,
        };

        // Fire and forget the API call. The UI is already updated.
        // If it fails, the next poll will correct the unread count anyway.
        fetch('/api/chats/mark-as-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).catch(err => {
            console.error("Failed to mark messages as read in the background:", err);
        });
      }
    }
  };
  
  const updateData = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;

    const latestChats = await fetchChatsForWorkspace(currentUser.activeWorkspaceId);
    setChats(latestChats);

    // After fetching, find the currently selected chat in the new list and update it
    // This keeps the selected chat's data fresh without changing the selection
    const currentChatId = selectedChatIdRef.current;
    if (currentChatId) {
      const updatedSelectedChat = latestChats.find(c => c.id === currentChatId);
      if (updatedSelectedChat) {
        setSelectedChat(prevSelected => ({
          ...updatedSelectedChat,
          // Preserve the messages from the *previous* state if the new one is empty
          // This prevents a "flash" of empty messages if the API is slow
          messages: updatedSelectedChat.messages.length > 0 ? updatedSelectedChat.messages : (prevSelected?.messages || [])
        }));
      } else {
        // If the chat doesn't exist anymore, deselect it
        setSelectedChat(null);
      }
    }
}, [currentUser.activeWorkspaceId]);


   useEffect(() => {
    const initialLoad = async () => {
        setChats(initialChats);
        
        if(currentUser.activeWorkspaceId){
            const tagsResult = await getTags(currentUser.activeWorkspaceId);
            if (!tagsResult.error && tagsResult.tags) {
                setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
            }
        }
    };

    initialLoad();

    return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChats, currentUser.activeWorkspaceId]);

  // Separate effect for polling to handle dependencies correctly
  useEffect(() => {
     if (currentUser.activeWorkspaceId) {
        if(pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = setInterval(() => updateData(), 1000); 
    }
     return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };
  }, [currentUser.activeWorkspaceId, updateData]);


  return (
    <div className="h-full flex-1 w-full min-h-0 flex">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
        onUpdate={() => updateData()}
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
        currentUser={currentUser} 
        onActionSuccess={() => updateData()}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
      />
      <ContactPanel 
        chat={selectedChat} 
        onTransferSuccess={() => updateData()}
        onContactUpdate={() => updateData()}
      />
    </div>
  );
}
