
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Contact, MessageSender } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '../ui/skeleton';
import { useAuth } from '@/hooks/use-auth';

export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [agents, setAgents] = useState<User[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const supabase = createClient();
  const currentUser = useAuth();

  const getSenderById = useCallback((id: string): MessageSender => {
    const agent = agents.find(u => u.id === id);
    if (agent) return agent;
    
    const contact = contacts.find(c => c.id === id);
    if (contact) return contact;

    return { 
      id: 'unknown', 
      name: 'Desconhecido', 
      avatar: 'https://placehold.co/40x40.png?text=?' 
    };
  }, [agents, contacts]);


  useEffect(() => {
    if (!currentUser || !currentUser.activeWorkspaceId) return;

    const initializeData = async () => {
        setLoading(true);
        const workspaceId = currentUser.activeWorkspaceId;
        
        // Helper function to fetch all users (agents) in a workspace
        const { data: agentsData, error: agentsError } = await supabase
            .from('user_workspaces')
            .select('users:user_id(id, full_name, avatar_url, email)')
            .eq('workspace_id', workspaceId);

        if (agentsError) {
            console.error("Error fetching agents:", agentsError);
            setLoading(false);
            return;
        }

        const fetchedAgents: User[] = agentsData.map((item: any) => ({
            id: item.users.id,
            name: item.users.full_name,
            avatar: item.users.avatar_url || `https://placehold.co/40x40.png?text=${(item.users.full_name || 'U').charAt(0)}`,
            email: item.users.email,
        }));
        setAgents(fetchedAgents);

        // Helper function to fetch all contacts in a workspace
        const { data: contactsData, error: contactsError } = await supabase
            .from('contacts')
            .select('*')
            .eq('workspace_id', workspaceId);

        if (contactsError) {
            console.error("Error fetching contacts:", contactsError);
            setLoading(false);
            return;
        }

         const fetchedContacts: Contact[] = contactsData.map((contact: any) => ({
            ...contact,
            avatar: contact.avatar_url || `https://placehold.co/40x40.png?text=${(contact.name || 'C').charAt(0)}`,
        }));
        setContacts(fetchedContacts);

        // Fetch chats for the active workspace
        const { data: chatsData, error: chatsError } = await supabase
            .from('chats')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });

        if (chatsError) {
            console.error("Error fetching chats:", chatsError);
            setLoading(false);
            return;
        }

        const formattedChats: Chat[] = chatsData.map(chat => {
            const contact = fetchedContacts.find(c => c.id === chat.contact_id);
            const agent = fetchedAgents.find(a => a.id === chat.agent_id);
            return {
                id: chat.id,
                contact: contact || { id: 'unknown-contact', name: 'Contato Desconhecido', avatar: '', workspace_id: workspaceId },
                agent: agent,
                messages: [], 
                status: chat.status as Chat['status'],
                workspace_id: chat.workspace_id,
            };
        });

        setChats(formattedChats);
        if (formattedChats.length > 0) {
            setSelectedChat(formattedChats[0]);
        }
        setLoading(false);
    };

    initializeData();
  }, [supabase, currentUser]);


  useEffect(() => {
    if (!selectedChat || (agents.length === 0 && contacts.length === 0)) {
        setMessages([]);
        return;
    };

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
            sender: getSenderById(msg.sender_id),
            content: msg.content,
            timestamp: new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            chat_id: msg.chat_id,
            workspace_id: msg.workspace_id,
        }));
        setMessages(formattedMessages);
    };

    fetchMessages();
  }, [selectedChat, supabase, agents, contacts, getSenderById]);

  useEffect(() => {
    if (!currentUser?.activeWorkspaceId) return;
    
    const channel = supabase
      .channel('realtime-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `workspace_id=eq.${currentUser.activeWorkspaceId}`},
        (payload) => {
          const newMessagePayload = payload.new as any;

          if (selectedChat && newMessagePayload.chat_id === selectedChat.id) {
            const newMessage: Message = {
              id: newMessagePayload.id,
              sender: getSenderById(newMessagePayload.sender_id),
              content: newMessagePayload.content,
              timestamp: new Date(newMessagePayload.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              chat_id: newMessagePayload.chat_id,
              workspace_id: newMessagePayload.workspace_id,
            };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, selectedChat, getSenderById, currentUser?.activeWorkspaceId]);


  if (loading || !currentUser) {
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

  return (
    <div className="flex flex-1 w-full min-h-0">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={setSelectedChat}
      />
      <ChatPanel key={selectedChat?.id} chat={selectedChat} messages={messages} currentUser={currentUser} />
      <ContactPanel contact={selectedChat?.contact || null} />
    </div>
  );
}
