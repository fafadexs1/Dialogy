import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function ReferralsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
