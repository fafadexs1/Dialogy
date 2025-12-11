'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, User, PhoneCall, ShieldCheck } from 'lucide-react';
import { sendMessage } from '@/actions/support';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface Message {
    id: string;
    message: string;
    created_at: string;
    is_staff: boolean;
    user_id: string;
}

interface ChatInterfaceProps {
    ticketId: string;
    initialMessages: Message[];
    currentUserValues?: any;
}

export function ChatInterface({ ticketId, initialMessages }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    // Scroll to bottom on load and new message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function handleSend() {
        if (!newMessage.trim()) return;

        setIsSending(true);
        const tempId = Math.random().toString();
        const optimisticMessage: Message = {
            id: tempId,
            message: newMessage,
            created_at: new Date().toISOString(),
            is_staff: false, // Optimistic assumption: user is sending
            user_id: 'me'
        };

        // Optimistic update
        setMessages(prev => [...prev, optimisticMessage]);
        setNewMessage('');

        try {
            await sendMessage(ticketId, optimisticMessage.message);
            // In a real app with Supabase Realtime, we would wait for subscription. 
            // Here, success implies it's saved.
            // We could re-fetch or just leave the optimistic one (it might lack real ID)
        } catch (error) {
            console.error(error);
            toast({
                title: "Erro ao enviar",
                description: "Não foi possível enviar sua mensagem.",
                variant: "destructive"
            });
            // Revert optimistic
            setMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            setIsSending(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="space-y-6 pb-4">
                {messages.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                        Nenhuma resposta ainda.
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={cn(
                            "flex gap-3",
                            msg.is_staff ? "flex-row" : "flex-row-reverse"
                        )}
                    >
                        <Avatar className={cn("h-8 w-8", msg.is_staff ? "bg-primary/10" : "bg-muted")}>
                            {msg.is_staff ? (
                                <AvatarFallback className="text-primary font-bold"><ShieldCheck className="h-4 w-4" /></AvatarFallback>
                            ) : (
                                <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                            )}
                        </Avatar>

                        <div className={cn(
                            "flex flex-col max-w-[80%]",
                            msg.is_staff ? "items-start" : "items-end"
                        )}>
                            <div className="flex items-center gap-2 mb-1 px-1">
                                <span className="text-xs font-semibold text-foreground">
                                    {msg.is_staff ? 'Suporte Dialogy' : 'Você'}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                    {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: ptBR })}
                                </span>
                            </div>
                            <div className={cn(
                                "p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
                                msg.is_staff
                                    ? "bg-card border border-border rounded-tl-none"
                                    : "bg-primary text-primary-foreground rounded-tr-none"
                            )}>
                                {msg.message}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>

            <div className="bg-card border border-border rounded-xl p-4 shadow-sm sticky bottom-4">
                <div className="flex gap-2">
                    <Textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Escreva uma resposta..."
                        className="min-h-[60px] resize-none bg-background focus-visible:ring-offset-0"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <Button
                        size="icon"
                        onClick={handleSend}
                        disabled={isSending || !newMessage.trim()}
                        className="h-[60px] w-[60px] shrink-0"
                    >
                        {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                    Pressione Enter para enviar
                </p>
            </div>
        </div>
    );
}
