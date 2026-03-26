import { AppRouteShell } from '@/components/layout/app-route-shell';
import { GlobalAlertBanner } from '@/components/layout/global-alert-banner';
import { getGlobalAlertAction } from '@/actions/system-alerts';

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const alert = await getGlobalAlertAction();

  return (
    <AppRouteShell>
      <div className="flex flex-col h-full w-full relative isolate">
        {alert.active && alert.message && (
          <GlobalAlertBanner alert={alert} />
        )}
        <div className="flex-1 w-full min-h-0 relative">
          {children}
        </div>
      </div>
    </AppRouteShell>
  );
}
