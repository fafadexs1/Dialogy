import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function AutopilotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
