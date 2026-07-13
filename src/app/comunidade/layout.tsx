import { AppRouteShell } from '@/components/layout/app-route-shell';

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
