import { getCurrentUser } from '@/actions/user';
import ErrorBoundary from '@/components/layout/error-boundary';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { Toaster } from '@/components/ui/toaster';
import { getServerLocale } from '@/i18n/server';
import { ensureServerHeartbeat } from '@/lib/observability/logger';
import { PresenceProvider } from '@/hooks/use-online-status';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { getWorkspaceLimits } from '@/lib/billing-logic';

export async function AppRouteShell({ children }: { children: React.ReactNode }) {
  ensureServerHeartbeat();

  const user = await getCurrentUser();
  const locale = await getServerLocale();
  const billing = user?.activeWorkspaceId
    ? await getWorkspaceLimits(user.activeWorkspaceId)
    : null;

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
            <AuthProvider>
              <PresenceProvider initialUser={user}>
                <MainAppLayout
                  billingStatus={billing?.billingStatus ?? null}
                  billingBlocked={billing?.blocked ?? false}
                >
                  {children}
                </MainAppLayout>
              </PresenceProvider>
            </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
      <Toaster />
    </>
  );
}
