import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import ErrorBoundary from '@/components/layout/error-boundary';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { ensureServerHeartbeat } from '@/lib/observability/logger';
import { I18nProvider } from '@/i18n/i18n-provider';
import { getServerLocale } from '@/i18n/server';

import { getCurrentUser } from '@/actions/user';
import { FacebookSDK } from '@/components/integrations/facebook-sdk';
import { globalSeoStore } from '@/services/global-seo-store';
import { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const { settings, updatedAt } = await globalSeoStore.getWithMeta();

  const iconVersion = updatedAt ? new Date(updatedAt).getTime() : Date.now();
  const getIcon = (url: string) => {
    const ext = url.split('.').pop()?.toLowerCase();
    let type = undefined;
    if (ext === 'png') type = 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') type = 'image/jpeg';
    if (ext === 'svg') type = 'image/svg+xml';
    if (ext === 'ico') type = 'image/x-icon';

    const separator = url.includes('?') ? '&' : '?';
    return { url: `${url}${separator}v=${iconVersion}`, type };
  };
  const fallbackIcon = `/api/favicon?v=${iconVersion}`;
  const baseIcon = settings.faviconUrl ? getIcon(settings.faviconUrl) : { url: fallbackIcon };

  return {
    title: {
      default: settings.siteName,
      template: settings.titleTemplate || `%s | ${settings.siteName}`,
    },
    description: settings.description,
    icons: [
      { rel: 'icon', ...baseIcon },
      { rel: 'shortcut icon', ...baseIcon },
      ...(settings.faviconUrl ? [{ rel: 'apple-touch-icon', ...baseIcon }] : []),
    ],
    openGraph: {
      siteName: settings.siteName,
      images: settings.defaultOgImage ? [settings.defaultOgImage] : undefined,
    },
    other: {
      'theme-color': settings.themeColor || '#ffffff',
    }
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  ensureServerHeartbeat();
  const user = await getCurrentUser();
  const locale = await getServerLocale();

  return (
    <html lang={locale} className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="h-full font-body antialiased" suppressHydrationWarning>
        <ErrorBoundary>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            forcedTheme="dark"
            storageKey="dialogy-theme-v2"
            enableSystem={false}
            disableTransitionOnChange
          >
            <I18nProvider initialLocale={locale}>
              <AuthProvider>
                <FacebookSDK appId={process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || ''} />
                <PresenceProvider initialUser={user}>
                  <MainAppLayout>
                    {children}
                  </MainAppLayout>
                </PresenceProvider>
              </AuthProvider>
            </I18nProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
