
'use client';

import React from 'react';
import { Search, PlusCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Chat, type OnlineAgent } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePresence } from '@/hooks/use-online-status';
import { FaWhatsapp } from 'react-icons/fa';

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat) => void;
}

const AgentTooltipContent = ({ agent }: { agent: OnlineAgent }) => {
  const [onlineSince, setOnlineSince] = React.useState('');

  React.useEffect(() => {
    if (agent.joined_at) {
       const updateOnlineTime = () => {
        const distance = formatDistanceToNow(new Date(agent.joined_at), {
            addSuffix: true,
            locale: ptBR,
        });
        setOnlineSince(distance);
      }
      updateOnlineTime();
      const interval = setInterval(updateOnlineTime, 60000); // Atualiza a cada minuto
      return () => clearInterval(interval);
    }
  }, [agent.joined_at]);

  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{agent.user.name}</p>
      {onlineSince && <p className="text-xs text-muted-foreground">Online {onlineSince}</p>}
    </div>
  );
};


export default function ChatList({ chats, selectedChat, setSelectedChat }: ChatListProps) {
  const onlineAgents = usePresence();

  const renderChatList = (chatList: Chat[]) => (
    <div className="space-y-1 p-2">
      {chatList.length > 0 ? chatList.map((chat) => {
        const lastMessage = chat.messages[chat.messages.length - 1];
        const source = lastMessage?.source_from_api;
        const instanceName = lastMessage?.instance_name;

        return (
          <div
            key={chat.id}
            className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors ${
              selectedChat?.id === chat.id ? 'bg-primary/10' : 'hover:bg-accent'
            }`}
            onClick={() => setSelectedChat(chat)}
          >
            <div className="relative flex-shrink-0">
              <Avatar className="h-10 w-10 border">
                <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} data-ai-hint="person" />
                <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
              </Avatar>
              {source === 'whatsapp' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white border-2 border-card">
                        <FaWhatsapp size={10} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Canal: WhatsApp</p>
                      {instanceName && <p>Instância: {instanceName}</p>}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold truncate">{chat.contact.name}</p>
                {lastMessage && (
                  <p className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {lastMessage.timestamp}
                  </p>
                )}
              </div>
              {lastMessage && (
                  <p className="text-sm text-muted-foreground truncate">
                      {lastMessage.content}
                  </p>
              )}
            </div>
          </div>
        )
      }) : (
        <div className="text-center py-10">
          <p className="text-sm text-muted-foreground">Nenhuma conversa aqui.</p>
        </div>
      )}
    </div>
  );

  const gerais = chats.filter(c => c.status === 'gerais');
  const atendimentos = chats.filter(c => c.status === 'atendimentos');
  const encerrados = chats.filter(c => c.status === 'encerrados');

  return (
    <div className="flex w-full max-w-sm flex-col border-r bg-card">
      <div className="p-4 flex-shrink-0 border-b">
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
      
      <div className="p-4 flex-shrink-0 border-b">
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Agentes Online ({onlineAgents.length})</h3>
        <TooltipProvider>
            <div className="min-h-[48px] flex flex-wrap items-center gap-2 py-1">
            {onlineAgents.map(agent => (
                <Tooltip key={agent.user.id}>
                    <TooltipTrigger>
                        <Avatar className="h-8 w-8 border-2 border-green-500 flex-shrink-0">
                            <AvatarImage src={agent.user.avatar} alt={agent.user.name} data-ai-hint="person" />
                            <AvatarFallback>{agent.user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                        <AgentTooltipContent agent={agent} />
                    </TooltipContent>
                </Tooltip>
            ))}
            </div>
        </TooltipProvider>
      </div>

      <Tabs defaultValue="gerais" className="flex-1 flex flex-col min-h-0">
        <div className="p-2 flex-shrink-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="gerais">Gerais</TabsTrigger>
            <TabsTrigger value="atendimentos">Atendimentos</TabsTrigger>
            <TabsTrigger value="encerrados">Encerrados</TabsTrigger>
          </TabsList>
        </div>
        
        <div className="flex-1 relative">
          <ScrollArea className="absolute inset-0 h-full w-full">
             <TabsContent value="gerais" className="m-0">
              {renderChatList(gerais)}
            </TabsContent>
            <TabsContent value="atendimentos" className="m-0">
              {renderChatList(atendimentos)}
            </TabsContent>
            <TabsContent value="encerrados" className="m-0">
              {renderChatList(encerrados)}
            </TabsContent>
          </ScrollArea>
        </div>
      </Tabs>
    </div>
  );
}
