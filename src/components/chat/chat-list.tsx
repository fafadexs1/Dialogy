
'use client';

import React from 'react';
import { Search, PlusCircle, File, Video, Mic, Image as ImageIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Chat, type OnlineAgent, type User, type Message } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePresence } from '@/hooks/use-online-status';
import { FaWhatsapp } from 'react-icons/fa6';

// --- Sub-componentes Fortemente Tipados ---

interface AgentTooltipContentProps {
  agent: OnlineAgent;
}

const AgentTooltipContent: React.FC<AgentTooltipContentProps> = ({ agent }) => {
  const [onlineSince, setOnlineSince] = React.useState('');

  React.useEffect(() => {
    if (agent.joined_at) {
      const updateOnlineTime = () => {
        const distance = formatDistanceToNow(new Date(agent.joined_at), { addSuffix: true, locale: ptBR });
        setOnlineSince(distance);
      };
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

interface LastMessagePreviewProps {
  message: Message;
}

const LastMessagePreview: React.FC<LastMessagePreviewProps> = ({ message }) => {
  const isMedia = message.metadata?.mediaUrl || message.metadata?.thumbnail;

  const getIcon = () => {
    if (!isMedia) return null;
    const mimetype = message.metadata?.mimetype || '';
    if (mimetype.startsWith('image/')) return <ImageIcon className="h-4 w-4 flex-shrink-0" />;
    if (mimetype.startsWith('video/')) return <Video className="h-4 w-4 flex-shrink-0" />;
    if (mimetype.startsWith('audio/')) return <Mic className="h-4 w-4 flex-shrink-0" />;
    return <File className="h-4 w-4 flex-shrink-0" />;
  };

  const getMediaText = () => {
    if (!isMedia) return message.content;
    if (message.content) return message.content;
    const mimetype = message.metadata?.mimetype || '';
    if (mimetype.startsWith('image/')) return 'Imagem';
    if (mimetype.startsWith('video/')) return 'Vídeo';
    if (mimetype.startsWith('audio/')) return 'Áudio';
    if (message.metadata?.fileName) return message.metadata.fileName;
    return 'Arquivo';
  };

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
      {getIcon()}
      <span className="truncate">{getMediaText()}</span>
    </div>
  );
};


interface ChatListItemProps {
    chat: Chat;
    isSelected: boolean;
    onSelect: (chat: Chat) => void;
}

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, onSelect }) => {
    const lastMessage = chat.messages[chat.messages.length - 1];

    return (
        <div
            className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors ${
            isSelected ? 'bg-primary/10' : 'hover:bg-accent'
            }`}
            onClick={() => onSelect(chat)}
        >
            <div className="relative flex-shrink-0">
            <Avatar className="h-10 w-10 border">
                <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} />
                <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
            </Avatar>
            {chat.source === 'whatsapp' && (
                <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                    <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white border-2 border-card">
                        <FaWhatsapp size={10} />
                    </div>
                    </TooltipTrigger>
                    <TooltipContent>
                    <p>Canal: WhatsApp</p>
                    {chat.instance_name && <p>Instância: {chat.instance_name}</p>}
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
            {lastMessage && <LastMessagePreview message={lastMessage} />}
            </div>
        </div>
    );
};


// --- Componente Principal ---

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat) => void;
  currentUser: User;
}

export default function ChatList({ chats, selectedChat, setSelectedChat, currentUser }: ChatListProps) {
  const onlineAgents = usePresence();

  const renderChatList = (chatList: Chat[]) => (
    <div className="space-y-1 p-2">
      {chatList.length > 0 ? (
        chatList.map((chat) => (
          <ChatListItem
            key={chat.id}
            chat={chat}
            isSelected={selectedChat?.id === chat.id}
            onSelect={setSelectedChat}
          />
        ))
      ) : (
        <div className="text-center py-10">
          <p className="text-sm text-muted-foreground">Nenhuma conversa aqui.</p>
        </div>
      )}
    </div>
  );

  const gerais = chats.filter((c) => c.status === 'gerais');
  const atendimentos = chats.filter((c) => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
  const encerrados = chats.filter((c) => c.status === 'encerrados');

  return (
    <div className="flex w-[360px] flex-shrink-0 flex-col border-r bg-card">
      {/* Header */}
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

      {/* Online Agents */}
      <div className="p-4 flex-shrink-0 border-b">
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Agentes Online ({onlineAgents.length})</h3>
        <TooltipProvider>
          <div className="min-h-[48px] flex flex-wrap items-center gap-2 py-1">
            {onlineAgents.map((agent) => (
              <Tooltip key={agent.user.id}>
                <TooltipTrigger>
                  <Avatar className="h-8 w-8 border-2 border-green-500 flex-shrink-0">
                    <AvatarImage src={agent.user.avatar} />
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

      {/* Tabs and Content */}
      <Tabs defaultValue="gerais" className="flex-1 flex flex-col min-h-0">
        <div className="p-2 flex-shrink-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="gerais">Gerais</TabsTrigger>
            <TabsTrigger value="atendimentos">Atendimentos</TabsTrigger>
            <TabsTrigger value="encerrados">Encerrados</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1">
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
      </Tabs>
    </div>
  );
}
