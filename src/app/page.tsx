

import { MainLayout } from '@/components/layout/main-layout';
import CustomerChatLayout from '@/components/layout/customer-chat-layout';
import { WorkspaceOnboarding } from '@/components/layout/workspace-onboarding';
import type { User, Workspace } from '@/lib/types';
import { redirect } from 'next/navigation';
import { updateUserOnlineStatus } from '@/actions/user';
import { Skeleton } from '@/components/ui/skeleton';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';


async function fetchUserAndWorkspaces(userId: string): Promise<User | null> {
    console.log(`--- [PAGE_SERVER] fetchUserAndWorkspaces: Buscando dados para o usuário ID: ${userId} ---`);
    if (!userId) return null;
    try {
        const dbUser = await db.user.findUnique({
          where: { id: userId },
        });

        if (!dbUser) {
           console.error('[PAGE_SERVER] fetchUserAndWorkspaces: Nenhum usuário encontrado com o ID:', userId);
           return null;
        }
        console.log(`[PAGE_SERVER] fetchUserAndWorkspaces: Usuário encontrado: ${dbUser.fullName}`);

        const userWorkspaceRoles = await db.userWorkspaceRole.findMany({
            where: { userId: userId },
            include: {
                workspace: {
                    select: { id: true, name: true, avatarUrl: true }
                }
            }
        });

        const workspaces: Workspace[] = userWorkspaceRoles.map(role => ({
            id: role.workspace.id,
            name: role.workspace.name,
            avatar: role.workspace.avatarUrl || ''
        }));
        
        const userObject: User = {
            id: dbUser.id,
            name: dbUser.fullName,
            firstName: dbUser.fullName.split(' ')[0] || '',
            lastName: dbUser.fullName.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatarUrl || undefined,
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.lastActiveWorkspaceId || workspaces[0]?.id,
        };
        console.log(`[PAGE_SERVER] fetchUserAndWorkspaces: Objeto de usuário montado:`, userObject);
        return userObject;
    } catch (error) {
        console.error('[PAGE_SERVER] fetchUserAndWorkspaces: Erro ao buscar dados:', error);
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
  console.log("--- [PAGE_SERVER] Renderizando a página Home ---");
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  const { data: { session }} = await supabase.auth.getSession();

  if (!session) {
    console.log("[PAGE_SERVER] Usuário não autenticado. Redirecionando para /login.");
    return redirect('/login');
  }
  
  const userId = session.user.id;
  console.log("[PAGE_SERVER] Sessão encontrada para o usuário ID:", userId);

  await updateUserOnlineStatus(userId, true);
  
  const user = await fetchUserAndWorkspaces(userId);
  
  if (!user) {
    console.error("[PAGE_SERVER] Não foi possível carregar os dados do usuário. Exibindo mensagem de erro.");
    await updateUserOnlineStatus(userId, false);
    return (
       <MainLayout>
            <div className="flex-1 flex items-center justify-center">
                <p>Ocorreu um erro ao carregar os dados do usuário. Tente novamente mais tarde.</p>
            </div>
       </MainLayout>
    )
  }

  if (!user.activeWorkspaceId) {
    console.log("[PAGE_SERVER] Usuário não possui workspace ativo. Renderizando onboarding.");
    return (
        <MainLayout>
            <WorkspaceOnboarding user={user} />
        </MainLayout>
    )
  }

  console.log("[PAGE_SERVER] Renderizando layout principal com CustomerChatLayout e Suspense.");

  return (
    <MainLayout>
        <Suspense fallback={<LoadingSkeleton />}>
            <CustomerChatLayout currentUser={user} />
        </Suspense>
    </MainLayout>
  );
}
