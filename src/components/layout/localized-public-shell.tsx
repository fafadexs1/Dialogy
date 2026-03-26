import ErrorBoundary from '@/components/layout/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { I18nProvider } from '@/i18n/i18n-provider';
import { getServerLocale } from '@/i18n/server';
import { ThemeProvider } from '@/providers/theme-provider';

export async function LocalizedPublicShell({ children }: { children: React.ReactNode }) {
  const locale = await getServerLocale();

  return (
    <>
      <ErrorBoundary>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          storageKey="dialogy-theme-v2"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider initialLocale={locale}>{children}</I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
      <Toaster />
    </>
  );
}
