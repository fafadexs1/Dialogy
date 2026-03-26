import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function AutomationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
