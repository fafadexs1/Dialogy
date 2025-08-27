

import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import type { User } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  
  // Await the user data here to pass down
  const { data: { user: authUser } } = await supabase.auth.getUser();

  return (
    <html lang="en" className="h-full bg-background light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased">
            <PresenceProvider>
              <MainAppLayout user={authUser as User | null}>
                  {children}
              </MainAppLayout>
            </PresenceProvider>
        <Toaster />
      </body>
    </html>
  );
}
