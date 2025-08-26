
'use client';

import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { SessionProvider, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';
import { useAuth } from '@/hooks/use-auth';

function AppStructure({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();
  const user = useAuth();

  const transitionKey = pathname.split('?')[0];

  const noSidebarRoutes = ['/login', '/register', '/setup'];
  const shouldShowSidebar = !noSidebarRoutes.includes(pathname) && status === 'authenticated' && !!user;

  return (
    <div
      className={cn(
        'h-dvh w-full bg-background overflow-hidden',
        shouldShowSidebar ? 'grid grid-cols-[auto,1fr]' : 'grid grid-cols-1'
      )}
    >
      {shouldShowSidebar && user && (
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-background light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased">
        <SessionProvider>
          <PresenceProvider>
            <AppStructure>
              {children}
            </AppStructure>
          </PresenceProvider>
        </SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
