
'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';

export function MainAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const transitionKey = pathname.split('?')[0];

  return (
      <div className="min-h-0 min-w-0 flex flex-col overflow-hidden h-full">
        <div className="flex-1 min-h-0 overflow-y-auto">
           <PageTransition transitionKey={transitionKey} className="h-full">
              {children}
           </PageTransition>
        </div>
      </div>
  );
}
