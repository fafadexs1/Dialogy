'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Sidebar } from './sidebar';

interface MainLayoutProps {
  user: User;
  children: React.ReactNode;
}

export function MainLayout({ user, children }: MainLayoutProps) {
  return (
    <div className="flex h-screen w-full">
      <Sidebar user={user} />
      <main className="flex-1 flex flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
