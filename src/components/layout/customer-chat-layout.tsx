'use client';

import React from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat } from '@/lib/types';
import { chats } from '@/lib/mock-data';

export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = React.useState<Chat>(chats[0]);

  return (
    <div className="flex h-full w-full">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={setSelectedChat}
      />
      <ChatPanel key={selectedChat.id} chat={selectedChat} />
      <ContactPanel contact={selectedChat.contact} />
    </div>
  );
}
