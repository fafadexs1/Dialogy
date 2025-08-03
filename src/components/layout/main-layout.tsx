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
    <div className="flex h-screen bg-background">
      <Sidebar user={user} />
      <div className="flex flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
