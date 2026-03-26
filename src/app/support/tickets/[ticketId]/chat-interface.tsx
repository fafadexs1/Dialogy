'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, ShieldCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { sendMessage } from '@/actions/support';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface MessageAuthor {
    id: string;
    display_name: string;
    email: string | null;
    avatar_url: string | null;
}

interface Message {
    id: string;
    message: string;
    created_at: string;
    is_staff: boolean;
    user_id: string;
    ticket_id: string;
    author: MessageAuthor | null;
}

interface ChatInterfaceProps {
    ticketId: string;
    initialMessages: Message[];
}

function getInitials(name?: string | null) {
    const source = name?.trim();
    if (!source) return 'US';

    const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'US';
}

export function ChatInterface({ ticketId, initialMessages }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function handleSend() {
        const content = newMessage.trim();
        if (!content) return;

        setIsSending(true);

        try {
            const result = await sendMessage(ticketId, content);
            const savedMessage = result.message;
            if (savedMessage) {
                setMessages((prev) => [...prev, savedMessage]);
            }
            setNewMessage('');
        } catch (error) {
            console.error(error);
            toast({
                title: 'Erro ao enviar',
                description: 'Nao foi possivel enviar sua mensagem.',
                variant: 'destructive',
            });
        } finally {
            setIsSending(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="space-y-6 pb-4">
                {messages.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                        Nenhuma resposta ainda.
                    </div>
                )}

                {messages.map((msg) => {
                    const authorName = msg.author?.display_name || (msg.is_staff ? 'Suporte Dialogy' : 'Usuario');
                    const roleLabel = msg.is_staff ? 'Suporte' : 'Solicitante';

                    return (
                        <div
                            key={msg.id}
                            className={cn(
                                'flex gap-3',
                                msg.is_staff ? 'flex-row' : 'flex-row-reverse'
                            )}
                        >
                            <Avatar className={cn('h-8 w-8', msg.is_staff ? 'bg-primary/10' : 'bg-muted')}>
                                <AvatarImage src={msg.author?.avatar_url || undefined} alt={authorName} />
                                <AvatarFallback className={cn(msg.is_staff ? 'text-primary font-bold' : '')}>
                                    {msg.is_staff ? <ShieldCheck className="h-4 w-4" /> : getInitials(authorName)}
                                </AvatarFallback>
                            </Avatar>

                            <div
                                className={cn(
                                    'flex max-w-[80%] flex-col',
                                    msg.is_staff ? 'items-start' : 'items-end'
                                )}
                            >
                                <div className="mb-1 flex items-center gap-2 px-1">
                                    <span className="text-xs font-semibold text-foreground">
                                        {authorName}
                                    </span>
                                    <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                        {roleLabel}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: ptBR })}
                                    </span>
                                </div>
                                <div
                                    className={cn(
                                        'rounded-2xl p-3 text-sm leading-relaxed whitespace-pre-wrap shadow-sm',
                                        msg.is_staff
                                            ? 'rounded-tl-none border border-border bg-card'
                                            : 'rounded-tr-none bg-primary text-primary-foreground'
                                    )}
                                >
                                    {msg.message}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            <div className="sticky bottom-4 rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex gap-2">
                    <Textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Escreva uma resposta..."
                        className="min-h-[60px] resize-none bg-background focus-visible:ring-offset-0"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleSend();
                            }
                        }}
                    />
                    <Button
                        size="icon"
                        onClick={() => void handleSend()}
                        disabled={isSending || !newMessage.trim()}
                        className="h-[60px] w-[60px] shrink-0"
                    >
                        {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </Button>
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                    Pressione Enter para enviar
                </p>
            </div>
        </div>
    );
}
