'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Paperclip, Send, Smile, Hash, AtSign } from 'lucide-react';
import { type InternalChannel, type InternalMessage, type User } from '@/lib/types';
import { internalMessages as allMessages } from '@/lib/mock-data';

interface InternalChatPanelProps {
  channel: InternalChannel;
  currentUser: User;
}

export default function InternalChatPanel({ channel, currentUser }: InternalChatPanelProps) {
  const [messages, setMessages] = React.useState<InternalMessage[]>(allMessages.filter(m => m.channelId === channel.id));
  const [newMessage, setNewMessage] = React.useState('');
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMessages(allMessages.filter(m => m.channelId === channel.id));
  }, [channel]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() === '') return;

    const message: InternalMessage = {
      id: `imsg-${Date.now()}`,
      sender: currentUser,
      content: newMessage,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      channelId: channel.id,
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

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b bg-card px-6">
        <div className="flex items-center gap-2">
            {channel.type === 'channel' ? <Hash className="h-5 w-5 text-muted-foreground" /> : <AtSign className="h-5 w-5 text-muted-foreground" />}
            <h2 className="font-semibold text-lg">{channel.name}</h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" >
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="space-y-1 p-6">
            {messages.map((message, index) => {
              const showAvatar = index === 0 || messages[index - 1].sender.id !== message.sender.id;
              return (
              <div
                key={message.id}
                className={`flex items-start gap-4 py-1 animate-in fade-in ${showAvatar ? 'mt-4' : ''}`}
              >
                <div className='w-10'>
                {showAvatar && (
                    <Avatar className="h-10 w-10">
                    <AvatarImage src={message.sender.avatar} alt={message.sender.name} data-ai-hint="person" />
                    <AvatarFallback>{message.sender.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                )}
                </div>
                <div className='flex-1'>
                    {showAvatar && (
                        <div className="flex items-baseline gap-2">
                            <p className="font-semibold">{message.sender.name}</p>
                            <p className="text-xs text-muted-foreground">{message.timestamp}</p>
                        </div>
                    )}
                    <p className="text-sm text-foreground/90">{message.content}</p>
                </div>
              </div>
            )})}
          </div>
        </ScrollArea>
      </div>

      <footer className="border-t bg-card p-4">
        <form onSubmit={handleSendMessage} className="relative mt-2">
          <Input
            placeholder={`Mensagem em ${channel.type === 'channel' ? '#' : ''}${channel.name}`}
            className="pr-28"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
            <Button type="button" variant="ghost" size="icon"><Smile className="h-5 w-5" /></Button>
            <Button type="button" variant="ghost" size="icon"><Paperclip className="h-5 w-5" /></Button>
            <Button type="submit" size="icon" className='w-8 h-8'>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </footer>
    </main>
  );
}
