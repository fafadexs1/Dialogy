

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User as AuthUser } from '@supabase/supabase-js';
import type { User as AppUser, Workspace } from '@/lib/types';

// This hook centralizes logic for getting the current authenticated user and their app profile.
export function useAuth(): AppUser | null {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setAuthUser(session?.user ?? null);
      }
    );

    // Fetch initial user
    const fetchUser = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        setAuthUser(user);
    }
    fetchUser();

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [supabase.auth]);


  useEffect(() => {
      const fetchAppUser = async () => {
        if (authUser) {
            // Fetch workspaces for the user
            const { data: userWorkspaces, error } = await supabase
                .from('user_workspaces')
                .select('workspaces(*)')
                .eq('user_id', authUser.id);

            if (error) {
                console.error("Error fetching user workspaces", error);
                setAppUser(null);
                return;
            }
            
            const workspaces: Workspace[] = userWorkspaces?.map((uw: any) => ({
                id: uw.workspaces.id,
                name: uw.workspaces.name,
                avatar: uw.workspaces.avatar_url || `https://placehold.co/40x40.png?text=${(uw.workspaces.name || 'W').charAt(0)}`,
            })) || [];

            // A real app would have a mechanism to select and persist the active workspace.
            let activeWorkspaceId: string | undefined = undefined;
            if (typeof window !== 'undefined') {
                activeWorkspaceId = localStorage.getItem('activeWorkspaceId') || undefined;
            }

            // If no active workspace is stored, or if it's not valid, default to the first one.
            if (!activeWorkspaceId || !workspaces.some(ws => ws.id === activeWorkspaceId)) {
                activeWorkspaceId = workspaces.length > 0 ? workspaces[0].id : undefined;
            }
            
            setAppUser({
                id: authUser.id,
                name: authUser.user_metadata.full_name || authUser.email || 'Usuário',
                email: authUser.email || '',
                avatar: authUser.user_metadata.avatar_url || `https://placehold.co/40x40.png?text=${(authUser.user_metadata.full_name || 'U').charAt(0)}`,
                workspaces,
                activeWorkspaceId,
            });
        } else {
            setAppUser(null);
        }
      }
      fetchAppUser();
  }, [authUser, supabase]);


  return appUser;
}
