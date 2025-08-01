'use client';

import React from 'react';
import { Search, PlusCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Chat, type User } from '@/lib/types';

interface ChatListProps {
  chats: Chat[];
  agents: User[];
  selectedChat: Chat;
  setSelectedChat: (chat: Chat) => void;
}

export default function ChatList({ chats, agents, selectedChat, setSelectedChat }: ChatListProps) {
  const renderChatList = (status: Chat['status']) => (
    chats
      .filter((chat) => chat.status === status)
      .map((chat) => (
        <div
          key={chat.id}
          className={`flex cursor-pointer items-start gap-4 rounded-lg p-3 transition-colors ${
            selectedChat.id === chat.id ? 'bg-primary/10' : 'hover:bg-accent'
          }`}
          onClick={() => setSelectedChat(chat)}
        >
          <Avatar className="h-10 w-10 border">
            <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} data-ai-hint="person" />
            <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{chat.contact.name}</p>
              <p className="text-xs text-muted-foreground">
                {chat.messages[chat.messages.length - 1].timestamp}
              </p>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {chat.messages[chat.messages.length - 1].content}
            </p>
          </div>
        </div>
      ))
  );

  return (
    <div className="flex w-full max-w-sm flex-col border-r bg-card">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Conversas</h2>
          <Button variant="ghost" size="icon">
            <PlusCircle className="h-5 w-5" />
          </Button>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Pesquisar..." className="pl-9" />
        </div>
      </div>
      <div className="px-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Agentes Online</h3>
          <div className="flex items-center space-x-2">
              {agents.filter(a => a.online).map(agent => (
                  <Avatar key={agent.id} className="h-8 w-8 border-2 border-green-500">
                      <AvatarImage src={agent.avatar} alt={agent.name} data-ai-hint="person" />
                      <AvatarFallback>{agent.name.charAt(0)}</AvatarFallback>
                  </Avatar>
              ))}
          </div>
      </div>
      <Tabs defaultValue="atendimentos" className="flex-1 mt-4 flex flex-col">
        <div className='px-4'>
            <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="atendimentos">Atendimentos</TabsTrigger>
            <TabsTrigger value="gerais">Gerais</TabsTrigger>
            <TabsTrigger value="encerrados">Encerrados</TabsTrigger>
            </TabsList>
        </div>
        <ScrollArea className="h-0 flex-1">
          <div className="p-4 space-y-2">
            <TabsContent value="atendimentos" className="mt-0">{renderChatList('atendimentos')}</TabsContent>
            <TabsContent value="gerais" className="mt-0">{renderChatList('gerais')}</TabsContent>
            <TabsContent value="encerrados" className="mt-0">{renderChatList('encerrados')}</TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
