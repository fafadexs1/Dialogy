'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, PlusCircle, File, Video, Mic, Image as ImageIcon, Users, Loader2, Filter, MessageSquare } from 'lucide-react';
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
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

import { SearchDetailsDialog } from './search-details-dialog';

// --- Start New Conversation Dialog ---
function NewConversationDialog({ workspaceId, onActionSuccess, trigger }: { workspaceId: string, onActionSuccess: () => void, trigger?: React.ReactNode }) {
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
        {trigger || (
          <Button variant="ghost" size="icon">
            <PlusCircle className="h-5 w-5" />
          </Button>
        )}
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
    <div className="flex items-start gap-1.5 text-sm text-white/60 overflow-hidden">
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
  };

  return (
    <div
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-all duration-200 border border-transparent relative overflow-hidden group",
        isSelected
          ? "bg-white/10 border-white/10 shadow-lg"
          : "hover:bg-white/5 hover:border-white/5"
      )}
      onClick={handleSelect}
      onDoubleClick={() => setIsTagDialogOpen(true)}
    >
      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-500"></div>
      )}

      <TagSelectionDialog
        isOpen={isTagDialogOpen}
        setIsOpen={setIsTagDialogOpen}
        chat={chat}
        onUpdate={onUpdate}
        user={currentUser}
      />

      <div className="relative flex-shrink-0">
        <Avatar className="h-10 w-10 border border-white/10">
          <AvatarImage src={chat.contact.avatar_url} alt={chat.contact.name} data-ai-hint="person" />
          <AvatarFallback className="bg-zinc-800 text-white">{chat.contact.name.charAt(0)}</AvatarFallback>
        </Avatar>
        {!!chat.instance_name && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white border-2 border-black shadow-sm">
                  <FaWhatsapp size={10} />
                </div>
              </TooltipTrigger>
              <TooltipContent className="bg-black/80 border-white/10 backdrop-blur-md text-white">
                <p>Canal: WhatsApp</p>
                {chat.instance_name && <p>Instância: {chat.instance_name}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className='flex-1 min-w-0'>
            <p className={cn("font-semibold truncate text-sm", isSelected ? "text-white" : "text-white/90")} title={chat.contact.name}>
              {chat.contact.name}
            </p>
          </div>
          {lastMessage && (
            <p className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
              {lastMessage.timestamp}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1">
          {chat.tag && chat.color && chat.status !== 'atendimentos' && (
            <Badge
              style={{
                backgroundColor: chat.color,
                color: chat.color?.toLowerCase?.().startsWith('#fe') ? '#000' : '#fff'
              }}
              className="border-transparent text-[10px] px-1.5 py-0 rounded-md shadow-sm"
              title={chat.tag}
            >
              {chat.tag}
            </Badge>
          )}

          {chat.teamName && chat.status === 'atendimentos' && (
            <Badge
              variant="secondary"
              className="font-medium text-[10px] py-0 px-1.5 flex items-center gap-1 bg-white/10 text-white hover:bg-white/20 border-white/5"
              title={chat.teamName}
            >
              <Users className="h-3 w-3" />
              {chat.teamName}
            </Badge>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            {lastMessage ? <LastMessagePreview message={lastMessage} /> : <div className="h-[20px]" />}
          </div>
          {chat.unreadCount && chat.unreadCount > 0 ? (
            <Badge className="h-5 min-w-[1.25rem] px-1.5 flex-shrink-0 justify-center rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0 shadow-md text-[10px]">
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
  const [ownershipFilter, setOwnershipFilter] = useState<'mine' | 'everyone'>('mine');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);

  const sortedChats = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      const timeA = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].createdAt).getTime() : 0;
      const timeB = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].createdAt).getTime() : 0;
      return timeB - timeA;
    });

    const gerais = sorted.filter((c) => c.status === 'gerais');
    const atendimentos = sorted.filter((c) => c.status === 'atendimentos');
    const encerrados = sorted.filter((c) => c.status === 'encerrados');

    return { gerais, atendimentos, encerrados };
  }, [chats]);

  const TABS = [
    { id: 'gerais', label: 'Fila', data: sortedChats.gerais },
    { id: 'atendimentos', label: 'Atendendo', data: sortedChats.atendimentos },
    { id: 'encerrados', label: 'Encerrados', data: sortedChats.encerrados }
  ] as const;

  const getBaseChatsForTab = useCallback(
    (tabId: typeof TABS[number]['id']) => {
      switch (tabId) {
        case 'gerais':
          return sortedChats.gerais;
        case 'atendimentos':
          return sortedChats.atendimentos;
        case 'encerrados':
        default:
          return sortedChats.encerrados;
      }
    },
    [sortedChats]
  );

  const filterChatByControls = useCallback(
    (chat: Chat) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'open' ? chat.status !== 'encerrados' : chat.status === 'encerrados');

      const matchesOwner =
        ownershipFilter === 'everyone' ||
        chat.agent?.id === currentUser.id ||
        chat.status === 'gerais';

      const matchesUnread = !onlyUnread || (chat.unreadCount ?? 0) > 0;
      const matchesUnassigned = !showUnassignedOnly || !chat.agent;

      // Search Logic
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        (chat.contact.name || '').toLowerCase().includes(query) ||
        (chat.contact.phone || '').includes(query) ||
        chat.messages.some(m => (m.content || '').toLowerCase().includes(query));

      return matchesStatus && matchesOwner && matchesUnread && matchesUnassigned && matchesSearch;
    },
    [statusFilter, ownershipFilter, onlyUnread, showUnassignedOnly, currentUser.id, searchQuery]
  );

  const filteredChats = useMemo(() => {
    return getBaseChatsForTab(activeTab).filter(filterChatByControls);
  }, [activeTab, getBaseChatsForTab, filterChatByControls]);

  return (
    <div className="flex h-full w-[380px] flex-shrink-0 flex-col border-r border-white/10 bg-black/20 backdrop-blur-xl min-h-0">
      {/* Header */}
      <div className="p-4 flex-shrink-0 border-b border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Conversas</h2>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Filtros" className="h-8 w-8 text-muted-foreground hover:text-white hover:bg-white/10">
                  <Filter className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4 space-y-4 bg-black/90 border-white/10 backdrop-blur-xl text-white">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Responsável</p>
                  <RadioGroup
                    value={ownershipFilter}
                    onValueChange={(value) => setOwnershipFilter(value as 'mine' | 'everyone')}
                    className="mt-2 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="mine" id="owner-mine" className="border-white/20 text-blue-500" />
                      <Label htmlFor="owner-mine" className="cursor-pointer text-white/80">Somente minhas conversas</Label>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="everyone" id="owner-all" className="border-white/20 text-blue-500" />
                      <Label htmlFor="owner-all" className="cursor-pointer text-white/80">Todos os atendentes</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                  <RadioGroup
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as 'all' | 'open' | 'closed')}
                    className="mt-2 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="all" id="status-all" className="border-white/20 text-blue-500" />
                      <Label htmlFor="status-all" className="cursor-pointer text-white/80">Todos</Label>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="open" id="status-open" className="border-white/20 text-blue-500" />
                      <Label htmlFor="status-open" className="cursor-pointer text-white/80">Abertos (Fila + Atendendo)</Label>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="closed" id="status-closed" className="border-white/20 text-blue-500" />
                      <Label htmlFor="status-closed" className="cursor-pointer text-white/80">Encerrados</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Somente não lidas</p>
                      <p className="text-xs text-muted-foreground">Priorize contatos aguardando resposta</p>
                    </div>
                    <Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} className="data-[state=checked]:bg-blue-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Somente sem responsável</p>
                      <p className="text-xs text-muted-foreground">Ótimo para dividir a fila com o time</p>
                    </div>
                    <Switch checked={showUnassignedOnly} onCheckedChange={setShowUnassignedOnly} className="data-[state=checked]:bg-blue-600" />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {currentUser.activeWorkspaceId && (
              <NewConversationDialog
                workspaceId={currentUser.activeWorkspaceId}
                onActionSuccess={onUpdate}
                trigger={
                  <Button size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md transition-all duration-300 border-0">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Nova Conversa
                  </Button>
                }
              />
            )}
          </div>
        </div>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-blue-400 transition-colors" />
          <Input
            placeholder="Pesquisar por nome, telefone ou mensagem..."
            className="pl-9 bg-white/5 border-white/10 focus:border-blue-500/50 focus:bg-white/10 focus:ring-1 focus:ring-blue-500/50 transition-all rounded-xl text-white placeholder:text-muted-foreground"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery.trim()) {
                e.preventDefault();
                e.stopPropagation();
                setIsSearchDialogOpen(true);
              }
            }}
          />
        </div>
      </div>

      <SearchDetailsDialog
        isOpen={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        searchQuery={searchQuery}
        chats={chats}
        onSelectChat={setSelectedChat}
      />

      {/* Online agents */}
      <div className="px-4 py-3 flex-shrink-0 border-b border-white/10 bg-white/5">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Agentes Online ({onlineAgents.length})
        </h3>
        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-2">
            {onlineAgents.map((agent) => (
              <Tooltip key={agent.user.id}>
                <TooltipTrigger>
                  <div className="relative">
                    <Avatar className="h-8 w-8 border-2 border-black ring-2 ring-green-500/50">
                      <AvatarImage src={agent.user.avatar} />
                      <AvatarFallback className="bg-zinc-800 text-xs">{agent.user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-black"></span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-black/80 border-white/10 backdrop-blur-md text-white">
                  <AgentTooltipContent agent={agent} />
                </TooltipContent>
              </Tooltip>
            ))}
            {onlineAgents.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhum outro agente online</p>
            )}
          </div>
        </TooltipProvider>
      </div>

      {/* Tabs */}
      <div className="p-3 flex-shrink-0 border-b border-white/10">
        <div className="flex items-center bg-black/40 rounded-lg p-1 border border-white/5">
          {TABS.map((tab) => {
            const filteredCount = getBaseChatsForTab(tab.id).filter(filterChatByControls).length;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 text-xs font-medium py-1.5 rounded-md transition-all duration-200',
                  activeTab === tab.id
                    ? 'bg-white/10 text-white shadow-sm border border-white/5'
                    : 'text-muted-foreground hover:text-white hover:bg-white/5'
                )}
              >
                <span>{tab.label}</span>
                {filteredCount > 0 && (
                  <Badge
                    className={cn(
                      'px-1.5 h-4 text-[10px] min-w-[16px] justify-center',
                      activeTab === tab.id
                        ? 'bg-blue-500 text-white'
                        : 'bg-white/10 text-muted-foreground'
                    )}
                  >
                    {filteredCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat list */}
      <ScrollArea className="flex-1 min-h-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="space-y-1 p-2">
          {filteredChats.length > 0 ? (
            filteredChats.map((chat) => (
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
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3 opacity-50">
              {activeTab === 'atendimentos' ? (
                <>
                  <div className="p-4 bg-blue-500/10 rounded-full mb-2 ring-1 ring-blue-500/20">
                    <div className="h-8 w-8 text-blue-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
                    </div>
                  </div>
                  <h3 className="font-semibold text-white">Nenhuma conversa</h3>
                  <p className="text-sm text-muted-foreground max-w-[200px]">
                    Você não é responsável por nenhuma conversa no momento
                  </p>
                  {currentUser.activeWorkspaceId && (
                    <div className="pt-2 opacity-100 pointer-events-auto">
                      <NewConversationDialog
                        workspaceId={currentUser.activeWorkspaceId}
                        onActionSuccess={onUpdate}
                        trigger={
                          <Button variant="outline" className="gap-2 border-blue-500/20 hover:bg-blue-500/10 text-blue-400 hover:text-blue-300">
                            <PlusCircle className="h-4 w-4" />
                            Nova Conversa
                          </Button>
                        }
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <MessageSquare className="h-12 w-12 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada nesta seção.</p>
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea >
    </div >
  );
}
