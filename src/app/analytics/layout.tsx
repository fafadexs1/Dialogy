import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
