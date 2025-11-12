'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, PlusCircle, File, Video, Mic, Image as ImageIcon, Users, Loader2, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Chat, type OnlineAgent, type User, type Message, EvolutionInstance } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePresence } from '@/hooks/use-online-status';
import { FaWhatsapp } from 'react-icons/fa6';
import { Badge } from '../ui/badge';
import { TagSelectionDialog } from './tag-selection-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from '@/components/ui/dialog';
import { Label } from '../ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { startNewConversation } from '@/actions/messages';
import { toast } from '@/hooks/use-toast';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { cn } from '@/lib/utils';

// --- Start New Conversation Dialog ---
function NewConversationDialog({ workspaceId, onActionSuccess }: { workspaceId: string, onActionSuccess: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && workspaceId) {
      setIsLoading(true);
      getEvolutionApiInstances(workspaceId)
        .then(setInstances)
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, workspaceId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const result = await startNewConversation({
      workspaceId,
      instanceName: formData.get('instanceName') as string,
      phoneNumber: formData.get('phoneNumber') as string,
      message: formData.get('message') as string,
      tabId: null
    });

    if (result.success) {
      toast({ title: 'Mensagem Enviada!', description: 'A conversa foi iniciada e aparecerá na sua lista.' });
      setIsOpen(false);
      onActionSuccess();
    } else {
      toast({ title: 'Erro ao Enviar', description: result.error, variant: 'destructive' });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <PlusCircle className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Iniciar Nova Conversa</DialogTitle>
          <DialogDescription>
            Envie uma mensagem para um novo número para iniciar um atendimento.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2 pb-4">
            <div className="space-y-2">
              <Label htmlFor="instanceName">Instância de Envio</Label>
              <Select name="instanceName" required>
                <SelectTrigger id="instanceName">
                  <SelectValue placeholder="Selecione a instância..." />
                </SelectTrigger>
                <SelectContent>
                  {isLoading ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">Carregando...</div>
                  ) : (
                    instances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.instance_name}>
                        {instance.display_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Número do WhatsApp (JID)</Label>
              <Input id="phoneNumber" name="phoneNumber" placeholder="5511999998888" required />
              <p className="text-xs text-muted-foreground">
                Inclua o código do país e o DDD. Não use máscaras ou caracteres especiais.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Mensagem</Label>
              <Textarea id="message" name="message" placeholder="Olá! Gostaria de falar sobre..." required />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar Mensagem
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
      const interval = setInterval(updateOnlineTime, 60000);
      return () => clearInterval(interval);
    }
  }, [agent.joined_at]);

  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{agent.user.name}</p>
      {onlineSince ? (
        <p className="text-xs text-muted-foreground">Online {onlineSince}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      )}
    </div>
  );
};

interface LastMessagePreviewProps {
  message: Message;
}

const LastMessagePreview: React.FC<LastMessagePreviewProps> = ({ message }) => {
  const isMedia = message.metadata?.mediaUrl || message.metadata?.thumbnail;

  const getIcon = () => {
    if (message.type === 'system') return null;
    if (!isMedia) return null;
    const mimetype = message.metadata?.mimetype || '';
    if (mimetype.startsWith('image/')) return <ImageIcon className="h-4 w-4 flex-shrink-0" />;
    if (mimetype.startsWith('video/')) return <Video className="h-4 w-4 flex-shrink-0" />;
    if (mimetype.startsWith('audio/')) return <Mic className="h-4 w-4 flex-shrink-0" />;
    return <File className="h-4 w-4 flex-shrink-0" />;
  };

  const getTextContent = () => {
    let text = '';
    if (message.type === 'system') text = message.content;
    else if (!isMedia) text = message.content;
    else if (message.content) text = message.content;
    else {
      const mimetype = message.metadata?.mimetype || '';
      if (mimetype.startsWith('image/')) text = 'Imagem';
      else if (mimetype.startsWith('video/')) text = 'Vídeo';
      else if (mimetype.startsWith('audio/')) text = 'Áudio';
      else if (message.metadata?.fileName) text = message.metadata.fileName;
      else text = 'Arquivo';
    }

    const charLimit = 30;
    if (text && text.length > charLimit) return text.substring(0, charLimit) + '...';
    return text;
  };

  return (
    <div className="flex items-start gap-1.5 text-sm text-foreground/70 overflow-hidden">
      <div className="mt-0.5 flex-shrink-0">{getIcon()}</div>
      <p className="truncate">{getTextContent()}</p>
    </div>
  );
};

interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  onSelect: (chat: Chat) => void;
  onUpdate: () => void;
  currentUser: User | null;
}

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, onSelect, onUpdate, currentUser }) => {
  const lastMessage = chat.messages[chat.messages.length - 1];
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);

  const handleSelect = () => {
    onSelect(chat);
    window.history.pushState({}, '', `/inbox/${chat.id}`);
  };

  return (
    <div
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md p-3 transition-all border border-transparent hover:border-border hover:bg-accent/40",
        isSelected && "bg-primary/10 border-primary/30 shadow-sm"
      )}
      onClick={handleSelect}
      onDoubleClick={() => setIsTagDialogOpen(true)}
    >
      <TagSelectionDialog
        isOpen={isTagDialogOpen}
        setIsOpen={setIsTagDialogOpen}
        chat={chat}
        onUpdate={onUpdate}
        user={currentUser}
      />

      <div className="relative flex-shrink-0">
        <Avatar className="h-10 w-10 border">
          <AvatarImage src={chat.contact.avatar_url} alt={chat.contact.name} data-ai-hint="person" />
          <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
        </Avatar>
        {!!chat.instance_name && (
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
        <div className="flex items-start justify-between gap-2">
          <div className='flex-1 min-w-0'>
            <p className="font-semibold truncate" title={chat.contact.name}>
              {chat.contact.name}
            </p>
          </div>
          {lastMessage && (
            <p className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
              {lastMessage.timestamp}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          {chat.tag && chat.color && chat.status !== 'atendimentos' && (
            <Badge
              style={{
                backgroundColor: chat.color,
                color: chat.color?.toLowerCase?.().startsWith('#fe') ? '#000' : '#fff'
              }}
              className="border-transparent text-xs px-2 py-0.5"
              title={chat.tag}
            >
              {chat.tag}
            </Badge>
          )}

          {chat.teamName && chat.status === 'atendimentos' && (
            <Badge
              variant="secondary"
              className="font-medium text-xs py-0.5 px-1.5 flex items-center gap-1"
              title={chat.teamName}
            >
              <Users className="h-3 w-3" />
              {chat.teamName}
            </Badge>
          )}
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            {lastMessage ? <LastMessagePreview message={lastMessage} /> : <div className="h-[20px]" />}
          </div>
          {chat.unreadCount && chat.unreadCount > 0 ? (
            <Badge className="h-5 min-w-[1.25rem] px-1.5 flex-shrink-0 justify-center rounded-full bg-red-500 text-white p-0">
              {chat.unreadCount}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
};

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat) => void;
  currentUser: User;
  onUpdate: () => void;
}

export default function ChatList({ chats, selectedChat, setSelectedChat, currentUser, onUpdate }: ChatListProps) {
  const onlineAgents = usePresence();
  const [activeTab, setActiveTab] = useState<'gerais' | 'atendimentos' | 'encerrados'>('gerais');

  const sortedChats = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      const timeA = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].createdAt).getTime() : 0;
      const timeB = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].createdAt).getTime() : 0;
      return timeB - timeA;
    });

    const gerais = sorted.filter((c) => c.status === 'gerais');
    const atendimentos = sorted.filter((c) => c.status === 'atendimentos' && c.agent?.id === currentUser.id);
    const encerrados = sorted.filter((c) => c.status === 'encerrados');

    return { gerais, atendimentos, encerrados };
  }, [chats, currentUser.id]);

  const TABS = [
    { id: 'gerais', label: 'Fila', data: sortedChats.gerais },
    { id: 'atendimentos', label: 'Atendendo', data: sortedChats.atendimentos },
    { id: 'encerrados', label: 'Encerrados', data: sortedChats.encerrados }
  ] as const;

  const currentChats = TABS.find((t) => t.id === activeTab)?.data || [];

  return (
    <div className="flex h-full w-[360px] flex-shrink-0 flex-col border-r bg-card/95 backdrop-blur-sm min-h-0">
      {/* Header */}
      <div className="p-4 flex-shrink-0 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Conversas</h2>
          <div className="flex items-center">
            <Button variant="ghost" size="icon">
              <Filter className="h-5 w-5" />
            </Button>
            {currentUser.activeWorkspaceId && (
              <NewConversationDialog workspaceId={currentUser.activeWorkspaceId} onActionSuccess={onUpdate} />
            )}
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Pesquisar..." className="pl-9" />
        </div>
      </div>

      {/* Online agents */}
      <div className="p-4 flex-shrink-0 border-b">
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
          Agentes Online ({onlineAgents.length})
        </h3>
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

      {/* Tabs */}
      <div className="p-2 flex-shrink-0 border-b">
        <div className="flex items-center bg-muted rounded-md p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 text-sm font-medium p-1.5 rounded-sm transition-colors',
                activeTab === tab.id
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span>{tab.label}</span>
              {tab.data.length > 0 && (
                <Badge
                  className={cn(
                    'px-1.5 h-5 text-xs',
                    activeTab === tab.id
                      ? 'bg-primary/20 text-primary'
                      : 'bg-secondary-foreground/10 text-muted-foreground'
                  )}
                >
                  {tab.data.length}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Chat list (uniform padding for all tabs) */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-1 p-3">
          {currentChats.length > 0 ? (
            currentChats.map((chat) => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                isSelected={selectedChat?.id === chat.id}
                onSelect={setSelectedChat}
                onUpdate={onUpdate}
                currentUser={currentUser}
              />
            ))
          ) : (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground">Nenhuma conversa aqui.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
