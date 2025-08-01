'use client';

import React from 'react';
import { type User, type InternalChannel } from '@/lib/types';
import { internalChannels, agents } from '@/lib/mock-data';
import ChannelList from '../internal-chat/channel-list';
import InternalChatPanel from '../internal-chat/internal-chat-panel';
import TeamPanel from '../internal-chat/team-panel';

interface InternalChatLayoutProps {
    user: User;
}

export default function InternalChatLayout({ user }: InternalChatLayoutProps) {
    const [selectedChannel, setSelectedChannel] = React.useState<InternalChannel>(internalChannels[0]);
    
    return (
        <>
            <ChannelList 
                channels={internalChannels}
                selectedChannel={selectedChannel}
                setSelectedChannel={setSelectedChannel}
                currentUser={user}
            />
            <InternalChatPanel 
                key={selectedChannel.id} 
                channel={selectedChannel}
                currentUser={user}
            />
            <TeamPanel members={selectedChannel.type === 'channel' ? selectedChannel.members : [user, selectedChannel.recipient!].filter(Boolean) as User[]} />
        </>
    );
}
