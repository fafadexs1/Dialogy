
'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';
import { BuildVersionWatcher } from '@/components/layout/build-version-watcher';
import type { User } from '@/lib/types';
import React from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useAuth } from '@/providers/auth-provider';

export function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const { user: authUser, isLoading: authLoading } = useAuth();

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
    '/terms'
  ];

  const isRoot = pathname === '/';
  const isNoSidebarRoute = noSidebarPrefixes.some(prefix => pathname.startsWith(prefix));

  // Show sidebar if:
  // 1. We have a user (either full profile or raw auth) AND it's a sidebar-compatible route
  // 2. OR if we are still loading authentication
  const shouldShowSidebar = (user || authUser || authLoading) && !isRoot && !isNoSidebarRoute;
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
          {/* If user is loaded, show Sidebar. If still loading, show an empty placeholder of same width to prevent CLS */}
          {user ? (
            <Sidebar user={user} />
          ) : (
            <div className="h-full w-20 flex flex-col items-center bg-sidebar p-4 border-r border-sidebar-border animate-pulse">
              {/* Logo Skeleton */}
              <div className="h-12 w-12 rounded-xl bg-sidebar-accent mb-6 flex-shrink-0" />
              {/* Nav Items Skeleton */}
              <div className="flex-1 flex flex-col gap-4 w-full items-center justify-center">
                <div className="h-12 w-12 rounded-2xl bg-sidebar-accent/50" />
                <div className="h-12 w-12 rounded-2xl bg-sidebar-accent/50" />
                <div className="h-12 w-12 rounded-2xl bg-sidebar-accent/50" />
                <div className="h-12 w-12 rounded-2xl bg-sidebar-accent/50" />
              </div>
              <div className="h-10 w-10 rounded-full bg-sidebar-accent mt-auto" />
            </div>
          )}
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
