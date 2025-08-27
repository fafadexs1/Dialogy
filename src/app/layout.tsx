
'use client';

import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { AuthProvider } from '@/hooks/use-auth.tsx';
import type { User } from '@/lib/types';


function RootLayoutContent({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: User | null;
}) {
  return (
    <html lang="en" className="h-full bg-background light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased">
        <AuthProvider user={initialUser}>
            <PresenceProvider>
              <MainAppLayout>
                {children}
              </MainAppLayout>
            </PresenceProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // We can't fetch the user here because this is the root layout and might not have access to the session yet.
  // The logic is now in `page.tsx` which will pass the user down.
  // For the layout, we can assume a null user initially, and client components will populate it.
  return <RootLayoutContent initialUser={null}>{children}</RootLayoutContent>
}
