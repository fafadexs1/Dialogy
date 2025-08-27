
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { PresenceProvider } from '@/hooks/use-online-status';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import type { User, Workspace } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';

async function fetchUserAndWorkspaces(userId: string): Promise<User | null> {
    if (!userId) return null;
    try {
        const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

        if (userRes.rowCount === 0) {
           console.error('[LAYOUT] fetchUserAndWorkspaces: Nenhum usuário encontrado com o ID:', userId);
           return null;
        }
        const dbUser = userRes.rows[0];
        
        const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            WHERE uwr.user_id = $1
        `, [userId]);

        const workspaces: Workspace[] = workspacesRes.rows.map(r => ({
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
        console.error('[LAYOUT] fetchUserAndWorkspaces: Erro ao buscar dados:', error);
        return null;
    }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  
  const { data: { user: authUser } } = await supabase.auth.getUser();
  
  let user: User | null = null;
  if(authUser) {
    user = await fetchUserAndWorkspaces(authUser.id);
  }

  return (
    <html lang="en" className="h-full bg-background light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased">
            <PresenceProvider>
              <MainAppLayout user={user}>
                  {children}
              </MainAppLayout>
            </PresenceProvider>
        <Toaster />
      </body>
    </html>
  );
}
