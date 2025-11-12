
'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';
import type { User } from '@/lib/types';
import React, { useEffect, useState } from 'react';

export function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // We only fetch the user if they are not on a public-facing page
    if (!['/login', '/register', '/setup', '/'].includes(pathname)) {
      fetch('/api/user')
        .then(res => res.ok ? res.json() : null)
        .then(setUser);
    }
  }, [pathname]);

  const noSidebarRoutes = ['/login', '/register', '/setup', '/'];
  const shouldShowSidebar = user && !noSidebarRoutes.includes(pathname);
  const transitionKey = pathname.split('?')[0];

  return (
    <div
      className={cn(
        'h-dvh w-full bg-muted/30',
        shouldShowSidebar ? 'grid grid-cols-[auto,1fr]' : 'flex'
      )}
    >
      {shouldShowSidebar && (
        <aside className="w-auto shrink-0 border-r bg-background">
          <Sidebar user={user} />
        </aside>
      )}
      
      <main className="min-h-0 min-w-0 flex flex-col flex-1">
        <PageTransition transitionKey={transitionKey} className="flex-1 min-h-0">
          {children}
        </PageTransition>
      </main>
    </div>
  );
}

    