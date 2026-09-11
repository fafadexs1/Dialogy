import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/actions/user';
import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function AutopilotLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <AppRouteShell>{children}</AppRouteShell>;
}
