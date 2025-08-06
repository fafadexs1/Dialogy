'use client';

import React, { useEffect, useState } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User } from '@/lib/types';
import { chats as mockChats, agents, contacts } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';

// This is a helper function to map sender IDs to user objects.
// In a real app, you might fetch this from a user management system or have it in a global state.
const getUserById = (id: string): User => {
  const allUsers = [...agents, ...contacts];
  return allUsers.find(u => u.id === id) || { 
    id: 'unknown', 
    name: 'Unknown', 
    firstName: 'Unknown', 
    lastName: '', 
    avatar: 'https://placehold.co/40x40.png' 
  };
}


export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = React.useState<Chat>(mockChats[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const supabase = createClient();

  useEffect(() => {
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
  }, [selectedChat.id, supabase]);

  useEffect(() => {
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
  }, [supabase, selectedChat.id]);

  return (
    <div className="flex flex-1 w-full min-h-0">
      <ChatList
        chats={mockChats}
        selectedChat={selectedChat}
        setSelectedChat={setSelectedChat}
      />
      <ChatPanel key={selectedChat.id} chat={selectedChat} messages={messages} />
      <ContactPanel contact={selectedChat.contact} />
    </div>
  );
}
