
'use client';

import React from 'react';
import type { User, OnlineAgent } from '@/lib/types';
import { Sidebar } from './sidebar';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useAuth } from '@/hooks/use-auth';

interface MainLayoutProps {
  user: User;
  children: React.ReactNode;
}

export function MainLayout({ user, children }: MainLayoutProps) {
  const onlineAgents = useOnlineStatus(user);

  // Clone children to pass down onlineAgents prop
  const childrenWithProps = React.Children.map(children, child => {
    if (React.isValidElement(child)) {
        // @ts-ignore
      return React.cloneElement(child, { onlineAgents });
    }
    return child;
  });

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar user={user} />
      <main className="flex-1 flex flex-col overflow-y-hidden">
        {childrenWithProps}
      </main>
    </div>
  );
}
