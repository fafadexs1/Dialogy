
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Contact, MessageSender } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/db'; // Cannot be used on client

// This function would ideally be an API call
async function fetchDataForWorkspace(workspaceId: string) {
    // MOCK: This is a placeholder for the data that would be fetched from the database
    // In a real app, you would have API endpoints like /api/chats?workspaceId=...
    const allChats: any[] = [
        { id: 'chat-1', workspace_id: 'ws-1', contact_id: 'contact-1', agent_id: 'agent-1', status: 'atendimentos' }
    ];
    const allContacts: any[] = [
        { id: 'contact-1', name: 'Carlos Silva', avatar: 'https://placehold.co/40x40.png' }
    ];
    const allAgents: any[] = [
        { id: 'agent-1', name: 'Alex Johnson', avatar: 'https://placehold.co/40x40.png' }
    ];
    const allMessages: any[] = [
         { id: 'msg-1', chat_id: 'chat-1', workspace_id: 'ws-1', sender_id: 'contact-1', content: 'Olá! Tenho uma dúvida sobre a minha fatura.', created_at: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })},
         { id: 'msg-2', chat_id: 'chat-1', workspace_id: 'ws-1', sender_id: 'agent-1', content: 'Olá, Carlos! Claro, posso te ajudar com isso. Qual é a sua dúvida?', created_at: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })},
    ];

    const chats = allChats
        .filter(c => c.workspace_id === workspaceId)
        .map(c => ({
            ...c,
            contact: allContacts.find(con => con.id === c.contact_id),
            agent: allAgents.find(a => a.id === c.agent_id),
        }));

    return { chats, messages: allMessages };
}


export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  
  const currentUser = useAuth();
  
  const getSenderById = useCallback((id: string, allUsers: (User | Contact)[]): MessageSender => {
    const sender = allUsers.find(u => u.id === id);
    if (sender) return sender;

    return { 
      id: 'unknown', 
      name: 'Desconhecido', 
      avatar: 'https://placehold.co/40x40.png?text=?',
      firstName: '?',
      lastName: '?',
    };
  }, []);


  useEffect(() => {
    if (!currentUser || !currentUser.activeWorkspaceId) return;

    const initializeData = async () => {
        setLoading(true);
        // Using the mock fetching function
        const { chats: fetchedChats } = await fetchDataForWorkspace(currentUser.activeWorkspaceId);
        
        setChats(fetchedChats);

        if (fetchedChats.length > 0) {
            setSelectedChat(fetchedChats[0]);
        }
        setLoading(false);
    };

    initializeData();
  }, [currentUser]);


  useEffect(() => {
    if (!selectedChat) {
        setMessages([]);
        return;
    };

    const fetchMessages = async () => {
        // Using the mock fetching function
        const { messages: allMessages } = await fetchDataForWorkspace(selectedChat.workspace_id);
        const chatMessagesData = allMessages.filter(m => m.chat_id === selectedChat.id);

        const allUsersForChat = [selectedChat.contact, selectedChat.agent].filter(Boolean) as (User | Contact)[];

        const formattedMessages = chatMessagesData.map(m => ({
            id: m.id,
            chat_id: m.chat_id,
            workspace_id: m.workspace_id,
            content: m.content,
            timestamp: m.created_at,
            sender: getSenderById(m.sender_id, allUsersForChat),
        }));
        
        setMessages(formattedMessages);
    };

    fetchMessages();
  }, [selectedChat, getSenderById]);


  if (loading || !currentUser) {
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
        setSelectedChat={setSelectedChat}
      />
      <ChatPanel key={selectedChat?.id} chat={selectedChat} messages={messages} currentUser={currentUser} />
      <ContactPanel contact={selectedChat?.contact || null} />
    </div>
  );
}
