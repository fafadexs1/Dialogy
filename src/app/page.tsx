

'use server';

import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import type { User } from '@/lib/types';
import { redirect } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';

async function fetchUserAndWorkspaces(userId: string) {
     if (!userId) return null;
    try {
        const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

        if (userRes.rowCount === 0) {
           console.error('[PAGE] fetchUserAndWorkspaces: Nenhum usuário encontrado com o ID:', userId);
           return null;
        }
        const dbUser = userRes.rows[0];
        
        const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            WHERE uwr.user_id = $1
        `, [userId]);

        const workspaces = workspacesRes.rows.map(r => ({
            id: r.id,
            name: r.name,
            avatar: r.avatar_url || ''
        }));
        
        const userObject: User = {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url || undefined,
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
        };
        return userObject;
    } catch (error) {
        console.error('[PAGE] fetchUserAndWorkspaces: Erro ao buscar dados:', error);
        return null;
    }
}


function LoadingSkeleton() {
    return (
        <div className="flex flex-1 w-full min-h-0 h-full">
          <div className="flex w-[360px] flex-shrink-0 flex-col border-r bg-card p-4 gap-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <div className="space-y-2 mt-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
              </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
              <Skeleton className="h-16 w-full" />
              <div className="flex-1 p-6 space-y-4">
                  <Skeleton className="h-10 w-1/2 ml-auto" />
                  <Skeleton className="h-10 w-1/2" />
                  <Skeleton className="h-10 w-1/2 ml-auto" />
              </div>
              <Skeleton className="h-24 w-full" />
          </div>
           <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l bg-card p-4 gap-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
           </div>
        </div>
    )
}

export default async function Home() {
  const supabase = createClient(cookies());

  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return redirect('/login');
  }
  
  const user = await fetchUserAndWorkspaces(authUser.id);
  
  if (!user) {
    // This case might happen if there's a desync between auth and public users table.
    // Redirecting to login should resolve it.
    return redirect('/login');
  }
  
  if (!user.activeWorkspaceId) {
    return <WorkspaceOnboarding user={user} />;
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
        <CustomerChatLayout initialUser={user} />
    </Suspense>
  );
}
