'use client';

import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { SessionProvider } from 'next-auth/react';
import { MainAppLayout } from '@/components/layout/main-app-layout';


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-background light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased">
        <SessionProvider>
          <PresenceProvider>
            <MainAppLayout>
              {children}
            </MainAppLayout>
          </PresenceProvider>
        </SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
