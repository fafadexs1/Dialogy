
'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';

export function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const transitionKey = pathname.split('?')[0];

  const noSidebarRoutes = ['/login', '/register', '/setup'];
  const shouldShowSidebar = !noSidebarRoutes.includes(pathname);
  
  const user = useAuth();
  const hasSidebar = shouldShowSidebar && !!user;

  return (
    <div
      className={cn(
        'h-dvh w-full bg-background overflow-hidden',
        hasSidebar ? 'grid grid-cols-[auto,1fr]' : 'grid grid-cols-1'
      )}
    >
      {hasSidebar && (
        <aside className="w-auto shrink-0 overflow-y-auto border-r">
          <Sidebar user={user} />
        </aside>
      )}

      <div className="min-h-0 min-w-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto">
           <PageTransition transitionKey={transitionKey} className="h-full">
              {children}
           </PageTransition>
        </div>
      </div>
    </div>
  );
}
