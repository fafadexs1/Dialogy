import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import ErrorBoundary from '@/components/layout/error-boundary';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { ensureServerHeartbeat } from '@/lib/observability/logger';

import { getCurrentUser } from '@/actions/user';
import { FacebookSDK } from '@/components/integrations/facebook-sdk';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  ensureServerHeartbeat();
  const user = await getCurrentUser();

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased" suppressHydrationWarning>
        <ErrorBoundary>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider>
              <FacebookSDK appId={process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || ''} />
              <PresenceProvider initialUser={user}>
                <MainAppLayout>
                  {children}
                </MainAppLayout>
              </PresenceProvider>
            </AuthProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
