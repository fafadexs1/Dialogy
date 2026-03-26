
import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
