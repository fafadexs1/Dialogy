'use client';

import React, { useEffect, useState } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User } from '@/lib/types';
import { agents, contacts } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '../ui/skeleton';

// This is a helper function to map sender IDs to user objects.
// In a real app, you might fetch this from a user management system or have it in a global state.
const allUsers = [...agents, ...contacts];
const getUserById = (id: string): User => {
  return allUsers.find(u => u.id === id) || { 
    id: 'unknown', 
    name: 'Unknown', 
    firstName: 'Unknown', 
    lastName: '', 
    avatar: 'https://placehold.co/40x40.png' 
  };
}

export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchChats = async () => {
        setLoading(true);
        const { data: chatsData, error: chatsError } = await supabase
            .from('chats')
            .select('*')
            .order('created_at', { ascending: false });

        if (chatsError) {
            console.error("Error fetching chats:", chatsError);
            setLoading(false);
            return;
        }

        // Map Supabase data to Chat[] type
        const formattedChats: Chat[] = chatsData.map(chat => {
            return {
                id: chat.id,
                contact: getUserById(chat.contact_id),
                agent: getUserById(chat.agent_id),
                messages: [], 
                status: chat.status as Chat['status'],
            };
        });

        setChats(formattedChats);
        if (formattedChats.length > 0) {
            setSelectedChat(formattedChats[0]);
        }
        setLoading(false);
    };

    fetchChats();
  }, [supabase]);


  useEffect(() => {
    if (!selectedChat) return;

    // Fetch initial messages for the selected chat
    const fetchMessages = async () => {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_id', selectedChat.id)
            .order('created_at', { ascending: true });

        if (error) {
            console.error("Error fetching messages:", error);
            return;
        }

        const formattedMessages: Message[] = data.map(msg => ({
            id: msg.id,
            sender: getUserById(msg.sender_id),
            content: msg.content,
            timestamp: new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        }));
        setMessages(formattedMessages);
    };

    fetchMessages();
  }, [selectedChat, supabase]);

  useEffect(() => {
    if (!selectedChat) return;

    const channel = supabase
      .channel(`realtime-chat:${selectedChat.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${selectedChat.id}` },
        (payload) => {
          const newMessagePayload = payload.new as any;
          const newMessage: Message = {
            id: newMessagePayload.id,
            sender: getUserById(newMessagePayload.sender_id),
            content: newMessagePayload.content,
            timestamp: new Date(newMessagePayload.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          };
          setMessages((prevMessages) => [...prevMessages, newMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, selectedChat]);


  if (loading) {
      return (
          <div className="flex flex-1 w-full min-h-0">
            <div className="flex w-full max-w-sm flex-col border-r bg-card p-4 gap-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <div className="space-y-2 mt-4">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
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
          </div>
      )
  }

  if (!selectedChat) {
      // TODO: Improve this empty state
      return <div className="flex-1 flex items-center justify-center text-muted-foreground">Nenhuma conversa encontrada. Crie uma para começar.</div>
  }


  return (
    <div className="flex flex-1 w-full min-h-0">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={setSelectedChat}
      />
      <ChatPanel key={selectedChat.id} chat={selectedChat} messages={messages} />
      <ContactPanel contact={selectedChat.contact} />
    </div>
  );
}
