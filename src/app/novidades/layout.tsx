import { AppRouteShell } from '@/components/layout/app-route-shell';

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
