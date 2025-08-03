'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Sidebar } from './sidebar';
import { usePathname } from 'next/navigation';
import CustomerChatLayout from './customer-chat-layout';
import InternalChatLayout from './internal-chat-layout';
import CrmLayout from '../crm/crm-layout';

interface MainLayoutProps {
  user: User;
  children: React.ReactNode;
}

export function MainLayout({ user, children }: MainLayoutProps) {
  const pathname = usePathname();

  const renderContent = () => {
    switch (pathname) {
      case '/':
        return <CustomerChatLayout />;
      case '/team':
        return <InternalChatLayout user={user} />;
      case '/crm':
        return <CrmLayout />;
      // Adicione outros casos para /analytics e /settings
      default:
        // Por padrão, pode renderizar o children ou um layout padrão
        return children;
    }
  };


  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar user={user} />
      {children}
    </div>
  );
}
