import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MessageSquare, User as UserIcon, Phone, Calendar } from 'lucide-react';
import { Chat, Message } from '@/lib/types';

interface SearchDetailsDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    searchQuery: string;
    chats: Chat[];
    onSelectChat: (chat: Chat) => void;
}

export function SearchDetailsDialog({ isOpen, onOpenChange, searchQuery, chats, onSelectChat }: SearchDetailsDialogProps) {
    const results = useMemo(() => {
        if (!searchQuery.trim()) return { contacts: [], messages: [] };

        const query = searchQuery.toLowerCase();
        const contacts: Chat[] = [];
        const messages: { chat: Chat; message: Message }[] = [];

        const addedContactIds = new Set<string>();

        chats.forEach(chat => {
            // Check Contact
            const nameMatch = (chat.contact.name || '').toLowerCase().includes(query);

            const rawPhone = (chat.contact.phone || '');
            const rawJid = (chat.contact.phone_number_jid || '');

            const sanitizedPhone = rawPhone.replace(/\D/g, '');
            const sanitizedJid = rawJid.replace(/\D/g, '');
            const sanitizedQuery = query.replace(/\D/g, '');

            const phoneMatch =
                rawPhone.includes(query) ||
                (sanitizedQuery && sanitizedPhone.includes(sanitizedQuery)) ||
                rawJid.includes(query) ||
                (sanitizedQuery && sanitizedJid.includes(sanitizedQuery));

            if ((nameMatch || phoneMatch) && !addedContactIds.has(chat.contact.id)) {
                contacts.push(chat);
                addedContactIds.add(chat.contact.id);
            }

            // Check Messages
            if (chat.messages && Array.isArray(chat.messages)) {
                chat.messages.forEach(message => {
                    const content = (message.content || '');
                    const lowerContent = content.toLowerCase();

                    // Filter out system messages (case insensitive check)
                    if (lowerContent.includes("atendimento encerrado por")) {
                        return;
                    }

                    if (lowerContent.includes(query)) {
                        messages.push({ chat, message });
                    }
                });
            }
        });

        // Sort messages by date (newest first)
        messages.sort((a, b) => new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime());

        return { contacts, messages };
    }, [searchQuery, chats]);

    const handleSelect = (chat: Chat) => {
        onSelectChat(chat);
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-zinc-950 border-white/10 text-white p-0 gap-0">
                <DialogHeader className="p-6 pb-4 border-b border-white/10">
                    <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                        Resultados para <span className="text-blue-400">"{searchQuery}"</span>
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="flex-1 min-h-0 p-6">
                    <div className="space-y-8">
                        {/* Contacts Section */}
                        {results.contacts.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <UserIcon className="h-4 w-4" />
                                    Contatos ({results.contacts.length})
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {results.contacts.map(chat => (
                                        <button
                                            key={chat.id}
                                            onClick={() => handleSelect(chat)}
                                            className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all text-left group"
                                        >
                                            <Avatar className="h-10 w-10 border border-white/10">
                                                <AvatarImage src={chat.contact.avatar_url} />
                                                <AvatarFallback className="bg-zinc-800">{chat.contact.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <p className="font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                                                    {chat.contact.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <Phone className="h-3 w-3" />
                                                    {chat.contact.phone}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Messages Section */}
                        {results.messages.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4" />
                                    Mensagens ({results.messages.length})
                                </h3>
                                <div className="space-y-2">
                                    {results.messages.map(({ chat, message }) => (
                                        <button
                                            key={message.id}
                                            onClick={() => handleSelect(chat)}
                                            className="w-full flex flex-col gap-2 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all text-left group"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <Avatar className="h-6 w-6 border border-white/10">
                                                        <AvatarImage src={chat.contact.avatar_url} />
                                                        <AvatarFallback className="bg-zinc-800 text-[10px]">{chat.contact.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="text-sm font-medium text-white/70 group-hover:text-blue-400 transition-colors truncate">
                                                        {chat.contact.name}
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
                                    ))}
                                </div>
                            </div>
                        )}

                        {results.contacts.length === 0 && results.messages.length === 0 && (
                            <div className="text-center py-12 text-muted-foreground">
                                <p>Nenhum resultado encontrado para "{searchQuery}"</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
