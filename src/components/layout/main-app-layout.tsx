
'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';
import type { User } from '@/lib/types';
import React from 'react';

export function MainAppLayout({ user, children }: { user: User | null, children: React.ReactNode }) {
  const pathname = usePathname();
  const transitionKey = pathname.split('?')[0];

  const noSidebarRoutes = ['/login', '/register', '/setup'];
  
  const shouldShowSidebar = user && !noSidebarRoutes.includes(pathname);

  return (
    <div
      className={cn(
        'h-dvh w-full bg-muted/30 overflow-hidden',
        shouldShowSidebar ? 'grid grid-cols-[auto,1fr]' : 'grid grid-cols-1'
      )}
    >
      {shouldShowSidebar && (
        <aside className="w-auto shrink-0 overflow-y-auto border-r bg-background">
          <Sidebar user={user} />
        </aside>
      )}

      <div className="min-h-0 min-w-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto">
           <PageTransition transitionKey={transitionKey} className="h-full">
              <div className="h-full w-full">{children}</div>
           </PageTransition>
        </div>
      </div>
    </div>
  );
}
