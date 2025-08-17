'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Sidebar } from './sidebar';
import { PageTransition } from './page-transition';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  user?: User;
  children: React.ReactNode;
}

export function MainLayout({ user, children }: MainLayoutProps) {
  const pathname = usePathname();
  const transitionKey = pathname.split('?')[0];
  const hasSidebar = Boolean(user);

  return (
    <div
      className={cn(
        'h-dvh w-full bg-background overflow-hidden',
        hasSidebar ? 'grid grid-cols-[auto,1fr]' : 'grid grid-cols-1'
      )}
    >
      {hasSidebar && (
        <aside className="w-auto shrink-0 overflow-y-auto border-r">
          <Sidebar user={user!} />
        </aside>
      )}

      {/* Main column */}
      <div className="min-h-0 min-w-0 flex flex-col overflow-hidden">
        {/* Scrollable page area */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PageTransition transitionKey={transitionKey} className="h-full">
            {children}
          </PageTransition>
        </div>
      </div>
    </div>
  );
}
