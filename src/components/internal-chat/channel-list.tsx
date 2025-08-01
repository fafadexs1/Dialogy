'use client';

import React from 'react';
import { Search, Plus, Hash, User as UserIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type InternalChannel, type User } from '@/lib/types';
import { Badge } from '../ui/badge';

interface ChannelListProps {
  channels: InternalChannel[];
  selectedChannel: InternalChannel;
  setSelectedChannel: (channel: InternalChannel) => void;
  currentUser: User;
}

export default function ChannelList({ channels, selectedChannel, setSelectedChannel, currentUser }: ChannelListProps) {
  const teamChannels = channels.filter(c => c.type === 'channel');
  const directMessages = channels.filter(c => c.type === 'dm');

  const renderChannelItem = (channel: InternalChannel) => (
    <div
        key={channel.id}
        className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors ${
            selectedChannel.id === channel.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
        }`}
        onClick={() => setSelectedChannel(channel)}
        >
        {channel.type === 'channel' ? <Hash className="h-4 w-4" /> : 
        <Avatar className="h-6 w-6">
            <AvatarImage src={channel.recipient?.avatar} alt={channel.recipient?.name} data-ai-hint="person" />
            <AvatarFallback>{channel.recipient?.name.charAt(0)}</AvatarFallback>
        </Avatar>
        }
        <span className="flex-1 font-medium truncate">{channel.name}</span>
        {channel.unreadCount && channel.unreadCount > 0 && <Badge variant="secondary" className="bg-red-500 text-white">{channel.unreadCount}</Badge>}
    </div>
  );


  return (
    <div className="flex w-full max-w-xs flex-col border-r bg-card">
        <div className="p-4 border-b">
            <div className="flex items-center justify-between">
                <div className='flex items-center gap-2'>
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={currentUser.avatar} alt={currentUser.name} data-ai-hint="person" />
                        <AvatarFallback>{currentUser.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <h2 className="text-lg font-semibold">{currentUser.name}</h2>
                </div>
            </div>
            <div className="relative mt-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Pesquisar..." className="pl-9" />
            </div>
        </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
            <div>
                <div className='flex items-center justify-between mb-2'>
                    <h3 className="text-sm font-semibold text-muted-foreground">Canais</h3>
                    <Button variant="ghost" size="icon" className='h-6 w-6'><Plus className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-1">
                    {teamChannels.map(renderChannelItem)}
                </div>
            </div>
            <div>
                <div className='flex items-center justify-between mb-2'>
                    <h3 className="text-sm font-semibold text-muted-foreground">Mensagens Diretas</h3>
                    <Button variant="ghost" size="icon" className='h-6 w-6'><Plus className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-1">
                    {directMessages.map(renderChannelItem)}
                </div>
            </div>
        </div>
      </ScrollArea>
    </div>
  );
}
