import { AppRouteShell } from '@/components/layout/app-route-shell';
import { SettingsLayoutClient } from './settings-layout-client';

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRouteShell>
      <SettingsLayoutClient>{children}</SettingsLayoutClient>
    </AppRouteShell>
  );
}
