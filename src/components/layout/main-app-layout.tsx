
'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';
import { BuildVersionWatcher } from '@/components/layout/build-version-watcher';
import type { User } from '@/lib/types';
import React from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';

export function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();

  const noSidebarPrefixes = [
    '/login',
    '/register',
    '/setup',
    '/creators',
    '/developer',
    '/forgot-password',
    '/reset-password',
    '/join',
    '/privacy',
    '/terms',
    '/support'
  ];

  const isRoot = pathname === '/';
  const isNoSidebarRoute = noSidebarPrefixes.some(prefix => pathname.startsWith(prefix));
  const shouldShowSidebar = user && !isRoot && !isNoSidebarRoute;
  const transitionKey = pathname.split('?')[0];

  return (
    <div
      className={cn(
        'h-dvh w-full bg-muted/30',
        shouldShowSidebar ? 'grid grid-cols-[auto,1fr]' : 'flex'
      )}
    >
      <BuildVersionWatcher />
      {shouldShowSidebar && (
        <aside className="w-auto shrink-0 bg-background">
          <Sidebar user={user} />
        </aside>
      )}

      <main className="min-h-0 min-w-0 flex flex-col flex-1 overflow-y-auto">
        <PageTransition transitionKey={transitionKey} className="flex-1 min-h-0">
          {children}
        </PageTransition>
      </main>
    </div>
  );
}

