
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
    setSelectedChat(chat);
    setShowFullHistory(true);

    if (chat.unreadCount && chat.unreadCount > 0) {
      // Optimistically update the UI for instant feedback
      setChats(prevChats => 
          prevChats.map(c => 
              c.id === chat.id ? { ...c, unreadCount: 0 } : c
          )
      );
      
      const unreadMessages = chat.messages.filter(m => !m.from_me && !m.is_read);
      const messageDbIdsToUpdate = unreadMessages.map(m => m.id);

      if (messageDbIdsToUpdate.length > 0) {
        // Prepare payload for the new API route
        const payload = {
            messageIds: messageDbIdsToUpdate,
            // Include optional data for the Evolution API receipt
            instanceName: chat.instance_name,
            messagesToMark: chat.instance_name ? unreadMessages
                .filter(m => m.message_id_from_api) // Ensure message_id_from_api exists
                .map(m => ({
                    remoteJid: chat.contact.phone_number_jid!,
                    fromMe: false,
                    id: m.message_id_from_api!,
                })) : undefined,
        };

        // Call the new POST endpoint
        const res = await fetch('/api/chats/mark-as-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        
        const data = await res.json();
        if(data.success) {
            // After successful DB update, fetch the latest state to be sure
            updateData(chat.id);
        }
      }
    }
  };
  
  const updateData = useCallback(async (currentChatId: string | null) => {
    if (!currentUser.activeWorkspaceId) return;

    const latestChats = await fetchChatsForWorkspace(currentUser.activeWorkspaceId);
    setChats(latestChats);

    // Update selected chat with latest data from the list, using the ID from the argument
    if (currentChatId) {
      const updatedSelectedChat = latestChats.find(c => c.id === currentChatId);
      if (updatedSelectedChat) {
        setSelectedChat(updatedSelectedChat);
      } else {
        // If the selected chat no longer exists (e.g., closed by another agent), deselect it.
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
        // Pass the ref's current value to the interval function
        pollingIntervalRef.current = setInterval(() => updateData(selectedChatIdRef.current), 1000); 
    }
     return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };
  }, [currentUser.activeWorkspaceId, updateData]);


  return (
    <div className="h-full flex-1 w-full min-h-0">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
        onUpdate={() => updateData(selectedChat?.id || null)}
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
        messages={selectedChat?.messages || []} 
        currentUser={currentUser} 
        onActionSuccess={() => updateData(selectedChat?.id || null)}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
      />
      <ContactPanel 
        chat={selectedChat} 
        onTransferSuccess={() => updateData(selectedChat?.id || null)}
        onContactUpdate={() => updateData(selectedChat?.id || null)}
      />
    </div>
  );
}
