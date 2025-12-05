'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Paperclip, MoreVertical, CheckCircle2, AlertCircle, Clock, User, Bot } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

// Mock data
const ticketDetails = {
    id: 'TKT-1024',
    subject: 'Erro ao integrar WhatsApp Baileys',
    status: 'open',
    priority: 'high',
    category: 'technical',
    createdAt: '2024-05-20T10:00:00Z',
    updatedAt: '2024-05-20T11:30:00Z',
};

const initialMessages = [
    {
        id: '1',
        content: 'Olá, estou tentando conectar minha instância do Baileys mas o QR Code não gera. Fica carregando infinitamente.',
        sender: 'user',
        timestamp: '2024-05-20T10:00:00Z',
    },
    {
        id: '2',
        content: 'Olá! Sinto muito pelo inconveniente. Você poderia confirmar se está utilizando a versão mais recente da API? Além disso, verifique se não há bloqueios de firewall na porta utilizada.',
        sender: 'agent',
        agentName: 'Suporte Técnico',
        timestamp: '2024-05-20T10:15:00Z',
    },
    {
        id: '3',
        content: 'Estou usando a versão v2. A porta 8080 está liberada. Vou tentar reiniciar o container.',
        sender: 'user',
        timestamp: '2024-05-20T10:20:00Z',
    },
];

export default function TicketDetailPage({ params }: { params: { ticketId: string } }) {
    const [messages, setMessages] = useState(initialMessages);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = () => {
        if (!newMessage.trim()) return;

        const message = {
            id: Date.now().toString(),
            content: newMessage,
        sender: 'user',
        timestamp: new Date().toISOString(),
    };

        setMessages((prev) => [...prev, message]);
        setNewMessage('');

        // Simulate agent reply
        setTimeout(() => {
            const reply = {
                id: (Date.now() + 1).toString(),
                content: 'Obrigado pelo retorno. Aguardamos seu teste após o reinício.',
                sender: 'agent',
                agentName: 'Suporte Técnico',
                timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, reply]);
        }, 2000);
    };

    return (
        <div className="flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 overflow-hidden">
            {/* Header */}
            <header className="flex-shrink-0 h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-6 flex items-center justify-between z-10">
                <div className="flex items-center gap-4">
                    <Link href="/support/tickets">
                        <Button variant="ghost" size="icon" className="rounded-full">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-lg font-semibold tracking-tight">{ticketDetails.subject}</h1>
                            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                                {ticketDetails.id}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(ticketDetails.updatedAt).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20">
                        Aberto
                    </Badge>
                    <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* Chat Area */}
                <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950/50">
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {messages.map((msg) => (
                            <motion.div
                                key={msg.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                            >
                                <Avatar className="h-8 w-8 mt-1">
                                    {msg.sender === 'user' ? (
                                        <>
                                            <AvatarImage src={undefined} />
                                            <AvatarFallback className="bg-blue-600 text-white">VC</AvatarFallback>
                                        </>
                                    ) : (
                                        <>
                                            <AvatarFallback className="bg-violet-600 text-white">
                                                <Bot className="h-4 w-4" />
                                            </AvatarFallback>
                                        </>
                                    )}
                                </Avatar>
                                <div className={`flex flex-col max-w-[80%] ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium text-muted-foreground">
                                            {msg.sender === 'user' ? 'Você' : msg.agentName}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground/70">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div
                                        className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.sender === 'user'
                                            ? 'bg-blue-600 text-white rounded-tr-none'
                                            : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-tl-none'
                                            }`}
                                    >
                                        {msg.content}
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                        <div className="max-w-4xl mx-auto flex items-end gap-2">
                            <Button variant="ghost" size="icon" className="flex-shrink-0 text-muted-foreground hover:text-blue-600">
                                <Paperclip className="h-5 w-5" />
                            </Button>
                            <div className="flex-1 relative">
                                <Textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Digite sua mensagem..."
                                    className="min-h-[50px] max-h-[150px] resize-none pr-12 py-3 rounded-xl border-zinc-200 dark:border-zinc-800 focus-visible:ring-blue-500"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                />
                                <Button
                                    size="icon"
                                    className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                                    onClick={handleSendMessage}
                                    disabled={!newMessage.trim()}
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </main>

                {/* Sidebar Details (Desktop only) */}
                <aside className="hidden lg:block w-80 border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 p-6 overflow-y-auto">
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Detalhes</h3>
                            <div className="space-y-4">
                                <div>
                                    <span className="text-xs text-muted-foreground block mb-1">Status</span>
                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                                        Aberto
                                    </Badge>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground block mb-1">Prioridade</span>
                                    <span className="text-sm font-medium text-red-500 flex items-center gap-2">
                                        <AlertCircle className="h-4 w-4" /> Alta
                                    </span>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground block mb-1">Categoria</span>
                                    <span className="text-sm font-medium">Técnico</span>
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Solicitante</h3>
                            <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                    <AvatarFallback>VC</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="text-sm font-medium">Você</p>
                                    <p className="text-xs text-muted-foreground">user@example.com</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
