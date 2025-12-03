import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MessageSquare, User as UserIcon, Phone, Calendar, Loader2, Sparkles, ArrowUpRight, Compass } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { searchChatsAndContacts, getOrCreateChatAction } from '@/actions/chats';
import type { Chat, Contact, Message } from '@/lib/types';
import { buildChatProtocol } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface SearchDetailsDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    searchQuery: string;
    chats: Chat[];
    workspaceId?: string;
    onSelectChat: (chat: Chat) => void;
}

export function SearchDetailsDialog({ isOpen, onOpenChange, searchQuery, chats, workspaceId, onSelectChat }: SearchDetailsDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [remoteChats, setRemoteChats] = useState<Chat[]>([]);
    const [remoteMessages, setRemoteMessages] = useState<Message[]>([]);
    const [crmContacts, setCrmContacts] = useState<Contact[]>([]);
    const [error, setError] = useState<string | null>(null);
    const upsertChats = useInboxStore((state) => state.upsertChats);
    const router = useRouter();
    const { toast } = useToast();

    const isProtocolSearch = searchQuery.trim().toUpperCase().startsWith('PRT-');

    useEffect(() => {
        let active = true;

        if (!isOpen || !workspaceId || !searchQuery.trim()) {
            setRemoteChats([]);
            setRemoteMessages([]);
            setCrmContacts([]);
            setError(null);
            return;
        }

        setIsLoading(true);
        searchChatsAndContacts(workspaceId, searchQuery).then((res) => {
            if (!active) return;
            if (res.error) {
                setError(res.error);
                setRemoteChats([]);
                setRemoteMessages([]);
                setCrmContacts([]);
            } else {
                setRemoteChats(res.chats || []);
                setRemoteMessages(res.messages || []);
                setCrmContacts(res.contacts || []);
                setError(null);
            }
        }).catch(() => {
            if (!active) return;
            setError('Falha ao buscar resultados');
            setRemoteChats([]);
            setRemoteMessages([]);
            setCrmContacts([]);
        }).finally(() => {
            if (active) setIsLoading(false);
        });

        return () => { active = false; };
    }, [isOpen, workspaceId, searchQuery]);

    const handleSelectChat = (chat: Chat) => {
        upsertChats([chat]);
        onSelectChat(chat);
        onOpenChange(false);
    };

    const handleContactClick = async (contact: Contact) => {
        if (!workspaceId) return;

        // Check if we already have a chat for this contact in the list
        const existingChat = chats.find(c => c.contact.id === contact.id) || remoteChats.find(c => c.contact.id === contact.id);
        if (existingChat) {
            handleSelectChat(existingChat);
            return;
        }

        // If not, fetch or create
        try {
            const result = await getOrCreateChatAction(workspaceId, contact.id);
            if (result.chatId) {
                const newChat: Chat = {
                    id: result.chatId,
                    status: 'gerais', // Default for new
                    workspace_id: workspaceId,
                    contact: contact,
                    messages: [],
                    unreadCount: 0,
                    updatedAt: new Date().toISOString(),
                    protocol: buildChatProtocol(result.chatId),
                };
                handleSelectChat(newChat);
            } else if (result.error) {
                toast({ title: "Erro", description: result.error, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Erro", description: "Falha ao abrir conversa.", variant: "destructive" });
        }
    };

    const hasResults = remoteChats.length > 0 || (!isProtocolSearch && (crmContacts.length > 0 || remoteMessages.length > 0));

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col bg-zinc-950 border-white/10 text-white p-0 gap-0 overflow-hidden">
                <DialogHeader className="p-6 pb-3 border-b border-white/10">
                    <DialogTitle className="text-xl font-semibold flex items-center gap-2 overflow-hidden">
                        <Sparkles className="h-4 w-4 text-blue-400 flex-shrink-0" />
                        <div className="flex items-center gap-1 truncate">
                            <span>Buscando por</span>
                            <span className="text-blue-400 truncate">"{searchQuery}"</span>
                        </div>
                    </DialogTitle>
                    <p className="text-sm text-white/60 flex items-center gap-2 mt-1">
                        <Compass className="h-4 w-4 text-white/40" />
                        Resultados em contatos do CRM e histórico de conversas.
                    </p>
                </DialogHeader>

                <div className="px-6 pt-3 pb-2 flex items-center gap-2 text-sm text-white/70">
                    {isLoading && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 border border-white/10 text-white/80">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                            Refinando resultados...
                        </span>
                    )}
                    {error && (
                        <span className="text-red-300 text-sm">Não foi possível carregar a pesquisa agora.</span>
                    )}
                </div>

                <ScrollArea className="flex-1 min-h-0 max-h-[70vh] p-6 overflow-y-auto">
                    <div className="space-y-8 pb-6 pr-1">

                        {/* 1. Chats (Contact/Protocol Matches) */}
                        {remoteChats.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <MessageSquare className="h-4 w-4" />
                                    {isProtocolSearch ? 'Protocolo' : `Conversas (${remoteChats.length})`}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {remoteChats.map(chat => {
                                        const lastMessage = chat.messages?.[chat.messages.length - 1];
                                        const statusLabel = chat.status === 'gerais'
                                            ? 'Fila'
                                            : chat.status === 'atendimentos'
                                                ? 'Atendendo'
                                                : 'Encerrado';
                                        const statusColor = chat.status === 'encerrados'
                                            ? 'bg-red-500/20 text-red-200 border-red-500/30'
                                            : chat.status === 'atendimentos'
                                                ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30'
                                                : 'bg-blue-500/20 text-blue-100 border-blue-500/30';

                                        return (
                                            <button
                                                key={chat.id}
                                                onClick={() => handleSelectChat(chat)}
                                                className="relative flex flex-col gap-2 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all text-left group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-10 w-10 border border-white/10">
                                                        <AvatarImage src={chat.contact.avatar_url} />
                                                        <AvatarFallback className="bg-zinc-800">{chat.contact.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium text-white truncate group-hover:text-blue-300 transition-colors">
                                                                {chat.contact.name}
                                                            </p>
                                                            <Badge className={`text-[10px] border ${statusColor}`}>
                                                                {statusLabel}
                                                            </Badge>
                                                            {chat.protocol && (
                                                                <Badge className="text-[10px] bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 max-w-[120px] truncate" title={chat.protocol}>
                                                                    {chat.protocol}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                                            <Phone className="h-3 w-3" />
                                                            {chat.contact.phone_number_jid || chat.contact.email || 'Sem contato'}
                                                        </p>
                                                    </div>
                                                    <ArrowUpRight className="h-4 w-4 text-white/40 group-hover:text-white/70 transition-colors" />
                                                </div>
                                                {lastMessage && (
                                                    <p className="text-xs text-white/70 line-clamp-2 pl-3 border-l border-white/10">
                                                        {lastMessage.content || 'Mensagem'}
                                                    </p>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 2. Messages (Content Matches) */}
                        {!isProtocolSearch && remoteMessages.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <MessageSquare className="h-4 w-4" />
                                    Mensagens Encontradas ({remoteMessages.length})
                                </div>
                                <div className="space-y-2">
                                    {remoteMessages.map((message) => {
                                        const chatForMessage: Chat = {
                                            id: message.chat_id,
                                            status: 'atendimentos',
                                            workspace_id: message.workspace_id,
                                            contact: {
                                                id: (message as any).contact_id,
                                                workspace_id: message.workspace_id,
                                                name: (message as any).contact_name || 'Contato',
                                                avatar_url: (message as any).contact_avatar_url,
                                                email: (message as any).contact_email,
                                                phone_number_jid: (message as any).contact_phone_number_jid,
                                                address: (message as any).contact_address,
                                            },
                                            messages: [message],
                                            unreadCount: 0,
                                            updatedAt: message.createdAt
                                        };

                                        return (
                                            <button
                                                key={message.id}
                                                onClick={() => handleSelectChat(chatForMessage)}
                                                className="w-full flex flex-col gap-2 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all text-left group"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Avatar className="h-6 w-6 border border-white/10">
                                                            <AvatarImage src={chatForMessage.contact.avatar_url} />
                                                            <AvatarFallback className="bg-zinc-800 text-[10px]">{chatForMessage.contact.name.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="text-sm font-medium text-white/70 group-hover:text-blue-400 transition-colors truncate">
                                                            {chatForMessage.contact.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 flex-shrink-0">
                                                        <Calendar className="h-3 w-3" />
                                                        {format(new Date(message.createdAt), "dd/MM/yy HH:mm", { locale: ptBR })}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-white/90 line-clamp-2 pl-8 border-l-2 border-white/10 group-hover:border-blue-500/50 transition-colors">
                                                    {message.content}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 3. CRM Contacts */}
                        {crmContacts.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <UserIcon className="h-4 w-4" />
                                    Contatos no CRM ({crmContacts.length})
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {crmContacts.map(contact => (
                                        <button
                                            key={contact.id}
                                            onClick={() => handleContactClick(contact)}
                                            className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/10 transition-colors text-left group"
                                        >
                                            <Avatar className="h-10 w-10 border border-white/10">
                                                <AvatarImage src={contact.avatar_url} />
                                                <AvatarFallback className="bg-zinc-800">{contact.name?.charAt(0) || '?'}</AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-white truncate group-hover:text-blue-300 transition-colors">{contact.name}</p>
                                                <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                                    <Phone className="h-3 w-3" />
                                                    {contact.phone_number_jid || contact.email || 'Dados indisponíveis'}
                                                </p>
                                            </div>
                                            <ArrowUpRight className="h-4 w-4 text-white/40 group-hover:text-white/70 transition-colors opacity-0 group-hover:opacity-100" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!hasResults && (
                            <div className="text-center py-12 text-muted-foreground">
                                <p>Nenhum resultado encontrado para "{searchQuery}"</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
                <div className="px-6 pb-4">
                    <Separator className="bg-white/10" />
                    <div className="pt-3 text-xs text-white/60">
                        Dica: pressione Enter no campo de busca para abrir este painel rapidamente.
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
