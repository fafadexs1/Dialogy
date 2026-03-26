import { getCurrentUser } from '@/actions/user';
import ErrorBoundary from '@/components/layout/error-boundary';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { Toaster } from '@/components/ui/toaster';
import { I18nProvider } from '@/i18n/i18n-provider';
import { getServerLocale } from '@/i18n/server';
import { ensureServerHeartbeat } from '@/lib/observability/logger';
import { PresenceProvider } from '@/hooks/use-online-status';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@/providers/theme-provider';

export async function AppRouteShell({ children }: { children: React.ReactNode }) {
  ensureServerHeartbeat();

  const user = await getCurrentUser();
  const locale = await getServerLocale();

  return (
    <>
      <ErrorBoundary>
        <ThemeProvider
          attribute="class"
          defaultTheme={user?.themePreference ?? 'dark'}
          storageKey={user ? `dialogy-theme-${user.id}` : 'dialogy-theme-v2'}
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider initialLocale={locale}>
            <AuthProvider>
              <PresenceProvider initialUser={user}>
                <MainAppLayout>{children}</MainAppLayout>
              </PresenceProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
      <Toaster />
    </>
  );
}
