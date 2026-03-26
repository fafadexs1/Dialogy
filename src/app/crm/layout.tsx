import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
