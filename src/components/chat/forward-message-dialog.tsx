'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Send } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { getInitialChatsData } from '@/actions/chats';
import type { Chat, Message } from '@/lib/types';
import { forwardMessageAction } from '@/actions/messages';

interface ForwardMessageDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    messageToForward: Message | null;
    workspaceId: string;
    currentUserId: string;
}

export function ForwardMessageDialog({ isOpen, onOpenChange, messageToForward, workspaceId, currentUserId }: ForwardMessageDialogProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [chats, setChats] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (isOpen && workspaceId) {
            setLoading(true);
            // Fetch recent chats to display initially
            getInitialChatsData({ workspaceId, selectedChatId: null, ownership: 'everyone' })
                .then(data => {
                    if (data.chats) {
                        setChats(data.chats);
                    }
                })
                .finally(() => setLoading(false));
        }
    }, [isOpen, workspaceId]);

    const filteredChats = chats.filter(chat =>
        chat.contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.contact.phone?.includes(searchQuery)
    );

    const handleForward = async () => {
        if (!messageToForward || !selectedChatId) return;

        setSending(true);
        try {
            const result = await forwardMessageAction(messageToForward, selectedChatId, null);
            if (result.success) {
                toast({ title: 'Mensagem encaminhada!' });
                onOpenChange(false);
                setSelectedChatId(null);
            } else {
                toast({ title: 'Erro ao encaminhar', description: result.error, variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Erro ao encaminhar', description: 'Ocorreu um erro inesperado.', variant: 'destructive' });
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-zinc-950 border-white/10 text-white sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Encaminhar mensagem</DialogTitle>
                    <DialogDescription className="text-white/60">
                        Selecione a conversa para onde deseja encaminhar.
                    </DialogDescription>
                </DialogHeader>

                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Pesquisar conversa..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-muted-foreground"
                    />
                </div>

                <ScrollArea className="h-[300px] pr-4">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-white/50" />
                        </div>
                    ) : filteredChats.length > 0 ? (
                        <div className="space-y-2">
                            {filteredChats.map(chat => (
                                <div
                                    key={chat.id}
                                    onClick={() => setSelectedChatId(chat.id)}
                                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${selectedChatId === chat.id
                                        ? 'bg-blue-600/20 border border-blue-500/50'
                                        : 'hover:bg-white/5 border border-transparent'
                                        }`}
                                >
                                    <Avatar className="h-10 w-10 border border-white/10">
                                        <AvatarImage fallbackOnBlank src={chat.contact.avatar_url} />
                                        <AvatarFallback className="bg-zinc-800 text-white/70">
                                            {chat.contact.name.charAt(0)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate text-white">{chat.contact.name}</p>
                                        <p className="text-xs text-white/50 truncate">
                                            {chat.contact.phone || 'Sem telefone'}
                                        </p>
                                    </div>
                                    {selectedChatId === chat.id && (
                                        <Send className="h-4 w-4 text-blue-400" />
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-white/50 py-8">Nenhuma conversa encontrada.</p>
                    )}
                </ScrollArea>

                <DialogFooter className="mt-4">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={sending}
                        className="text-white/70 hover:text-white hover:bg-white/10"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleForward}
                        disabled={!selectedChatId || sending}
                        className="bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Encaminhar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
