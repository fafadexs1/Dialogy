
'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from '@/components/layout/sidebar';
import { BuildVersionWatcher } from '@/components/layout/build-version-watcher';
import type { User } from '@/lib/types';
import React from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

export function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const { user: authUser, isLoading: authLoading } = useAuth();
  const { resolvedTheme } = useTheme();
  const isInboxRoute = pathname === '/inbox' || pathname.startsWith('/inbox/');
  const isSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/');
  const [mounted, setMounted] = React.useState(false);

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
  const initialTheme = user?.themePreference === 'light' || user?.themePreference === 'dark'
    ? user.themePreference
    : 'dark';
  const effectiveTheme = mounted ? resolvedTheme ?? initialTheme : initialTheme;
  const isLightTheme = effectiveTheme === 'light';
  const shellThemeClass = shouldShowSidebar
    ? isInboxRoute
      ? (isLightTheme ? 'inbox-light' : 'inbox-dark')
      : (isLightTheme ? 'app-shell-light' : '')
    : '';
  const transitionKey = pathname.split('?')[0];

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;

    root.classList.remove('app-shell-light', 'inbox-light', 'inbox-dark');

    if (shellThemeClass) {
      root.classList.add(shellThemeClass);
    }

    return () => {
      root.classList.remove('app-shell-light', 'inbox-light', 'inbox-dark');
    };
  }, [shellThemeClass]);

  React.useEffect(() => {
    if (!isSettingsRoute) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const previousBodyOverscroll = body.style.overscrollBehavior;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [isSettingsRoute]);

  return (
    <div
      className={cn(
        'h-dvh w-full overflow-hidden overscroll-none',
        shellThemeClass,
        shouldShowSidebar ? 'bg-background' : 'bg-muted/30',
        shouldShowSidebar ? 'grid grid-cols-[auto,1fr]' : 'flex'
      )}
    >
      <BuildVersionWatcher />
      {shouldShowSidebar && (
        <aside className="hidden md:block w-auto shrink-0 bg-background">
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

      <main
        className={cn(
          'min-h-0 min-w-0 flex flex-1 flex-col',
          isSettingsRoute ? 'overflow-hidden overscroll-none' : 'overflow-y-auto'
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            isSettingsRoute && 'overflow-hidden overscroll-none'
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
