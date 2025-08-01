'use client';

import React from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, type User } from '@/lib/types';
import { chats, agents } from '@/lib/mock-data';

export default function CustomerChatLayout() {
  const [selectedChat, setSelectedChat] = React.useState<Chat>(chats[0]);

  return (
    <>
      <ChatList
        chats={chats}
        agents={agents}
        selectedChat={selectedChat}
        setSelectedChat={setSelectedChat}
      />
      <ChatPanel key={selectedChat.id} chat={selectedChat} />
      <ContactPanel contact={selectedChat.contact} />
    </>
  );
}
