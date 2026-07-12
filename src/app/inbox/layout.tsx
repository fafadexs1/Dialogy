import { AppRouteShell } from '@/components/layout/app-route-shell';
import { GlobalAlertRealtime } from '@/components/layout/global-alert-realtime';
import { getGlobalAlertAction } from '@/actions/system-alerts';

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const alert = await getGlobalAlertAction();

  return (
    <AppRouteShell>
      <div className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
          <GlobalAlertRealtime initialAlert={alert} />
          <div className="relative min-h-0 w-full flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </AppRouteShell>
  );
}
