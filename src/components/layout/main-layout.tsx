

'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Sidebar } from './sidebar';
import { PageTransition } from './page-transition';
import { usePathname } from 'next/navigation';

interface MainLayoutProps {
  user?: User;
  children: React.ReactNode;
}

export function MainLayout({ user, children }: MainLayoutProps) {
  const pathname = usePathname();
  return (
    <div className="flex h-screen w-full bg-background">
      {user && <Sidebar user={user} />}
      <main className="flex-1 flex flex-col overflow-y-hidden">
        <PageTransition key={pathname}>{children}</PageTransition>
      </main>
    </div>
  );
}
