import ErrorBoundary from '@/components/layout/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/providers/theme-provider';

export async function LocalizedPublicShell({ children }: { children: React.ReactNode }) {
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
          {children}
        </ThemeProvider>
      </ErrorBoundary>
      <Toaster />
    </>
  );
}
