'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Paperclip, Phone, Send, Smile, Video } from 'lucide-react';
import { type Chat, type Message, type User } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import SmartReplies from './smart-replies';
import ChatSummary from './chat-summary';

interface ChatPanelProps {
  chat: Chat;
}

export default function ChatPanel({ chat }: ChatPanelProps) {
  const [messages, setMessages] = React.useState<Message[]>(chat.messages);
  const [newMessage, setNewMessage] = React.useState('');
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() === '') return;

    const message: Message = {
      id: `msg-${Date.now()}`,
      sender: agents[0] as User,
      content: newMessage,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages([...messages, message]);
    setNewMessage('');
  };

  React.useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [messages]);

  const chatHistoryForAI = messages.map(m => `${m.sender.name}: ${m.content}`).join('\n');
  const lastCustomerMessage = messages.filter(m => m.sender.id.startsWith('contact')).pop()?.content || '';

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b bg-card px-6">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border">
            <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} data-ai-hint="person" />
            <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <h2 className="font-semibold">{chat.contact.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <ChatSummary chatHistory={chatHistoryForAI} />
          <Button variant="ghost" size="icon"><Phone className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon"><Video className="h-5 w-5" /></Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" >
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="space-y-6 p-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-end gap-3 animate-in fade-in ${
                  message.sender.id.startsWith('agent') ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={message.sender.avatar} alt={message.sender.name} data-ai-hint="person" />
                  <AvatarFallback>{message.sender.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div
                  className={`max-w-md rounded-xl px-4 py-3 text-sm shadow-md ${
                    message.sender.id.startsWith('agent')
                      ? 'rounded-br-none bg-primary text-primary-foreground'
                      : 'rounded-bl-none bg-card'
                  }`}
                >
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <footer className="border-t bg-card p-4">
        <SmartReplies 
          customerMessage={lastCustomerMessage}
          chatHistory={chatHistoryForAI}
          onSelectReply={(reply) => setNewMessage(reply)}
        />
        <form onSubmit={handleSendMessage} className="relative mt-2">
          <Input
            placeholder="Digite sua mensagem..."
            className="pr-36"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
            <Button type="button" variant="ghost" size="icon"><Smile className="h-5 w-5" /></Button>
            <Button type="button" variant="ghost" size="icon"><Paperclip className="h-5 w-5" /></Button>
            <Button type="submit" size="sm">
              Enviar <Send className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      </footer>
    </main>
  );
}
