'use client';

import React from 'react';
import { Search, PlusCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Chat } from '@/lib/types';
import { useOnlineStatus } from '@/hooks/use-online-status';

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat;
  setSelectedChat: (chat: Chat) => void;
}

export default function ChatList({ chats, selectedChat, setSelectedChat }: ChatListProps) {
  const onlineAgents = useOnlineStatus();

  const renderChatList = (chatList: Chat[]) => (
    <div className="space-y-1 p-2">
      {chatList.map((chat) => (
        <div
          key={chat.id}
          className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors ${
            selectedChat.id === chat.id ? 'bg-primary/10' : 'hover:bg-accent'
          }`}
          onClick={() => setSelectedChat(chat)}
        >
          <Avatar className="h-10 w-10 border flex-shrink-0">
            <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} data-ai-hint="person" />
            <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold truncate flex-1">{chat.contact.name}</p>
              <p className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                {chat.messages[chat.messages.length - 1].timestamp}
              </p>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {chat.messages[chat.messages.length - 1].content}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  const atendimentos = chats.filter(c => c.status === 'atendimentos');
  const gerais = chats.filter(c => c.status === 'gerais');
  const encerrados = chats.filter(c => c.status === 'encerrados');

  return (
    <div className="flex w-full max-w-sm flex-col border-r bg-card h-full">
      <div className="p-4 flex-shrink-0">
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
      
      <div className="px-4 pb-4 flex-shrink-0">
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Agentes Online</h3>
        <div className="flex items-center gap-2 overflow-x-auto">
          {onlineAgents.map(agent => (
            <Avatar key={agent.id} className="h-8 w-8 border-2 border-green-500 flex-shrink-0">
              <AvatarImage src={agent.avatar} alt={agent.name} data-ai-hint="person" />
              <AvatarFallback>{agent.name.charAt(0)}</AvatarFallback>
            </Avatar>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <Tabs defaultValue="atendimentos" className="flex-1 flex flex-col">
          <div className="px-4 flex-shrink-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="atendimentos">Atendimentos</TabsTrigger>
              <TabsTrigger value="gerais">Gerais</TabsTrigger>
              <TabsTrigger value="encerrados">Encerrados</TabsTrigger>
            </TabsList>
          </div>
          
          <TabsContent value="atendimentos" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              {renderChatList(atendimentos)}
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="gerais" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              {renderChatList(gerais)}
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="encerrados" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              {renderChatList(encerrados)}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}