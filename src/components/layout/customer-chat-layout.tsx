
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';

function ClientCustomerChatLayout({ initialChats, currentUser, initialCloseReasons }: {initialChats: Chat[], currentUser: User, initialCloseReasons: Tag[]}) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [closeReasons, setCloseReasons] = useState<Tag[]>(initialCloseReasons);
  const [showFullHistory, setShowFullHistory] = useState(true);

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

    try {
        const response = await fetch(`/api/chats/${currentUser.activeWorkspaceId}`, { cache: 'no-store' });
        if (!response.ok) {
            console.error("Failed to fetch chats, status:", response.status);
            return;
        }
        const data = await response.json();
        const latestChats = data.chats as Chat[];

        setChats(latestChats);

        // After fetching, find the currently selected chat in the new list and update it
        const currentChatId = selectedChatIdRef.current;
        if (currentChatId) {
            const updatedSelectedChat = latestChats.find(c => c.id === currentChatId);
            if (updatedSelectedChat) {
                 // Important: Update the entire selected chat object to get new messages.
                 setSelectedChat(updatedSelectedChat);
            } else {
                // If the previously selected chat no longer exists (e.g., closed by another agent), deselect it.
                setSelectedChat(null);
            }
        }
    } catch(e) {
        console.error("Failed to fetch chats", e);
    }
}, [currentUser.activeWorkspaceId]);


  // Initial data load and polling setup
  useEffect(() => {
    let pollingInterval: NodeJS.Timeout | null = null;
    if (currentUser.activeWorkspaceId) {
        // Fetch immediately and then set up polling
        updateData();
        pollingInterval = setInterval(updateData, 5000); // Poll every 5 seconds
    }
    
    return () => {
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
    };
  }, [currentUser.activeWorkspaceId, updateData]);

  // Fetch close reasons
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
        onUpdate={updateData}
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
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


export default function CustomerChatLayout({ currentUser }: { currentUser: User }) {
  const [initialChats, setInitialChats] = useState<Chat[]>([]);
  const [initialCloseReasons, setInitialCloseReasons] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const auth = useAuth(); // Use auth hook to wait for user session

  useEffect(() => {
    // This is a client component, so we fetch initial data here.
    // The server component `page.tsx` will provide a loading skeleton.
    const fetchInitialData = async () => {
        if (!auth?.activeWorkspaceId) {
            setLoading(false); // Stop loading if there's no workspace
            return;
        };
        setLoading(true);
        try {
            const response = await fetch(`/api/chats/${auth.activeWorkspaceId}`);
            if (!response.ok) return;
            const data = await response.json();
            setInitialChats(data.chats || []);
            
            const tagsResult = await getTags(auth.activeWorkspaceId);
            if (!tagsResult.error) {
                setInitialCloseReasons(tagsResult.tags?.filter(t => t.is_close_reason) || []);
            }
        } catch (error) {
            console.error("Error fetching initial layout data:", error);
        } finally {
            setLoading(false);
        }
    };
    if (auth) {
        fetchInitialData();
    }
  }, [auth]);
  
  if (loading || !auth) {
      return (
        <div className="flex flex-1 w-full min-h-0 h-full">
          <div className="flex w-[360px] flex-shrink-0 flex-col border-r bg-card p-4 gap-4">
              <div className="h-12 w-full rounded-md bg-muted animate-pulse" />
              <div className="h-10 w-full rounded-md bg-muted animate-pulse" />
              <div className="h-10 w-full rounded-md bg-muted animate-pulse" />
              <div className="space-y-2 mt-4">
                  <div className="h-16 w-full rounded-md bg-muted animate-pulse" />
                  <div className="h-16 w-full rounded-md bg-muted animate-pulse" />
                  <div className="h-16 w-full rounded-md bg-muted animate-pulse" />
                  <div className="h-16 w-full rounded-md bg-muted animate-pulse" />
              </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
              <div className="h-16 w-full bg-card animate-pulse" />
              <div className="flex-1 p-6 space-y-4 bg-muted/20">
                  <div className="h-10 w-1/2 ml-auto rounded-md bg-muted animate-pulse" />
                  <div className="h-10 w-1/2 rounded-md bg-muted animate-pulse" />
                  <div className="h-10 w-1/2 ml-auto rounded-md bg-muted animate-pulse" />
              </div>
              <div className="h-24 w-full bg-card animate-pulse" />
          </div>
           <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l bg-card p-4 gap-4">
              <div className="h-16 w-full rounded-md bg-muted animate-pulse" />
              <div className="h-24 w-full rounded-md bg-muted animate-pulse" />
              <div className="h-32 w-full rounded-md bg-muted animate-pulse" />
           </div>
        </div>
      )
  }

  return (
    <ClientCustomerChatLayout 
        initialChats={initialChats}
        currentUser={currentUser}
        initialCloseReasons={initialCloseReasons}
    />
  );
}
