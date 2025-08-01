'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Sidebar } from './sidebar';
import CustomerChatLayout from './customer-chat-layout';
import InternalChatLayout from './internal-chat-layout';


interface MainLayoutProps {
  user: User;
}

export function MainLayout({ user }: MainLayoutProps) {
  const [activeView, setActiveView] = React.useState<'customer' | 'internal'>('customer');

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar user={user} activeView={activeView} setActiveView={setActiveView} />
      {activeView === 'customer' ? <CustomerChatLayout /> : <InternalChatLayout user={user} />}
    </div>
  );
}
