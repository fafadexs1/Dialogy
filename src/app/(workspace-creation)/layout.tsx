import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/actions/user';
import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function WorkspaceCreationLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <AppRouteShell>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain" data-workspace-creation-shell>
        {children}
      </div>
    </AppRouteShell>
  );
}
