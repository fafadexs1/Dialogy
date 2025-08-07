
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Contact, MessageSender } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { chats as mockChats, contacts as mockContacts, agents as mockAgents } from '@/lib/mock-data';

export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  
  const currentUser = useAuth();

  const getSenderById = useCallback((id: string): MessageSender => {
    const agent = mockAgents.find(u => u.id === id);
    if (agent) return agent;
    
    const contact = mockContacts.find(c => c.id === id);
    if (contact) return contact;

    return { 
      id: 'unknown', 
      name: 'Desconhecido', 
      avatar: 'https://placehold.co/40x40.png?text=?' 
    };
  }, []);


  useEffect(() => {
    if (!currentUser || !currentUser.activeWorkspaceId) return;

    const initializeData = async () => {
        setLoading(true);
        // MOCK: Using static data. In a real app, you'd fetch this from your DB.
        const workspaceChats = mockChats.filter(c => c.workspace_id === currentUser.activeWorkspaceId);
        
        // Populate agent data in chats for the mock
        const populatedChats = workspaceChats.map(chat => ({
          ...chat,
          agent: mockAgents.find(a => a.id === 'agent-1') // Mock assignment
        }));
        
        setChats(populatedChats);

        if (populatedChats.length > 0) {
            setSelectedChat(populatedChats[0]);
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
        // MOCK: Simulating fetching messages for the selected chat.
        // In a real app, this would be a DB query.
        const mockMessages: Message[] = [
          { 
            id: 'msg-1', 
            chat_id: 'chat-1', 
            workspace_id: 'ws-1', 
            sender: getSenderById('contact-1'), 
            content: 'Olá! Tenho uma dúvida sobre a minha fatura.', 
            timestamp: '10:30' 
          },
          { 
            id: 'msg-2', 
            chat_id: 'chat-1', 
            workspace_id: 'ws-1',
            sender: getSenderById('agent-1'), 
            content: 'Olá, Carlos! Claro, posso te ajudar com isso. Qual é a sua dúvida?', 
            timestamp: '10:31' 
          },
          { 
            id: 'msg-3', 
            chat_id: 'chat-2', 
            workspace_id: 'ws-1',
            sender: getSenderById('contact-2'), 
            content: 'Gostaria de saber mais sobre o plano Pro.', 
            timestamp: '11:00' 
          },
        ];
        
        const chatMessages = mockMessages.filter(m => m.chat_id === selectedChat.id);
        setMessages(chatMessages);
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
