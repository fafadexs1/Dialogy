
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
import Link from 'next/link';
import { AlertTriangle, CreditCard } from 'lucide-react';
import type { BillingStatus } from '@/lib/billing-logic';

export function MainAppLayout({
  children,
  billingStatus,
  billingBlocked,
  billingUnavailable,
}: {
  children: React.ReactNode;
  billingStatus: BillingStatus;
  billingBlocked: boolean;
  billingUnavailable: boolean;
}) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const { user: authUser, isLoading: authLoading } = useAuth();
  const { resolvedTheme } = useTheme();
  const isInboxRoute = pathname === '/inbox' || pathname.startsWith('/inbox/');
  const isSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/');
  const isAutopilotEditorRoute = /^\/autopilot\/[^/]+\/?$/.test(pathname);
  const isNexusRoute = pathname === '/nexus' || pathname.startsWith('/nexus/');
  const usesFixedViewport = isInboxRoute || isSettingsRoute || isAutopilotEditorRoute || isNexusRoute;
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
  const isBillingRoute = pathname.startsWith('/settings/billing');
  const billingTitle = billingStatus === 'past_due'
    ? 'Pagamento vencido'
    : billingStatus === 'unpaid'
      ? 'Pagamento não recebido'
      : 'Plano inativo';

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
    if (!isSettingsRoute && !isAutopilotEditorRoute && !isNexusRoute) {
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
  }, [isAutopilotEditorRoute, isNexusRoute, isSettingsRoute]);

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
          usesFixedViewport ? 'overflow-hidden overscroll-none' : 'overflow-y-auto'
        )}
      >
        {(billingBlocked || billingUnavailable) && !isBillingRoute && (
          <div className="z-50 flex shrink-0 items-center justify-center gap-3 border-b border-amber-400/30 bg-amber-950 px-4 py-2.5 text-sm text-amber-50">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
            <span>
              {billingUnavailable
                ? <><strong>Cobrança temporariamente indisponível.</strong> Operações faturáveis estão pausadas; tente novamente em instantes.</>
                : <><strong>{billingTitle}.</strong> Regularize a assinatura para voltar a operar o workspace.</>}
            </span>
            {!billingUnavailable && (
              <Link
                href="/settings/billing"
                className="rounded-lg bg-amber-300 px-3 py-1 font-semibold text-amber-950 hover:bg-amber-200"
              >
                Regularizar
              </Link>
            )}
          </div>
        )}
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col',
            usesFixedViewport && 'overflow-hidden overscroll-none'
          )}
        >
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              billingBlocked && isInboxRoute && 'pointer-events-none select-none blur-[7px]'
            )}
            aria-hidden={billingBlocked && isInboxRoute ? true : undefined}
          >
            {children}
          </div>
          {billingBlocked && isInboxRoute && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]">
              <div className="max-w-md rounded-3xl border border-white/15 bg-zinc-950/95 p-7 text-center text-white shadow-2xl">
                <CreditCard className="mx-auto mb-4 h-10 w-10 text-amber-300" />
                <h2 className="text-xl font-semibold">{billingTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  As conversas permanecem protegidas, mas o acesso aos chats está suspenso até a regularização do plano.
                </p>
                <Link
                  href="/settings/billing"
                  className="mt-5 inline-flex rounded-xl bg-amber-300 px-5 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-200"
                >
                  Ver assinatura
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
