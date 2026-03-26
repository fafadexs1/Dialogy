import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
