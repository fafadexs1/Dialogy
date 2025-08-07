
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
             // Fetch the user's profile data including the last active workspace
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, full_name, avatar_url, email, last_active_workspace_id')
                .eq('id', authUser.id)
                .single();

            if (userError) {
                console.error("Error fetching user data from 'users' table", userError);
                setAppUser(null);
                return;
            }

            // Step 1: Fetch workspace IDs
            const { data: workspaceIdsData, error: workspaceIdsError } = await supabase
                .from('user_workspaces')
                .select('workspace_id')
                .eq('user_id', authUser.id);
            
            if (workspaceIdsError) {
                console.error("Error fetching user workspace IDs", workspaceIdsError);
                setAppUser(null);
                return;
            }

            const workspaceIds = workspaceIdsData?.map(uw => uw.workspace_id) || [];
            let userWorkspaces: any[] = [];

            // Step 2: Fetch workspace details if IDs exist
            if (workspaceIds.length > 0) {
                const { data: workspacesData, error: workspacesError } = await supabase
                    .from('workspaces')
                    .select('*')
                    .in('id', workspaceIds);

                if (workspacesError) {
                    console.error("Error fetching user workspaces", workspacesError);
                    setAppUser(null);
                    return;
                }
                userWorkspaces = workspacesData || [];
            }
            
            const workspaces: Workspace[] = userWorkspaces.map((ws: any) => ({
                id: ws.id,
                name: ws.name,
                avatar: ws.avatar_url || `https://placehold.co/40x40.png?text=${(ws.name || 'W').charAt(0)}`,
            }));

            // The active workspace is now determined by the user's profile
            const activeWorkspaceId = userData?.last_active_workspace_id || (workspaces.length > 0 ? workspaces[0].id : undefined);
            
            setAppUser({
                id: authUser.id,
                name: userData.full_name || authUser.email || 'Usuário',
                email: authUser.email || '',
                avatar: userData.avatar_url || `https://placehold.co/40x40.png?text=${(userData.full_name || 'U').charAt(0)}`,
                workspaces,
                activeWorkspaceId,
                 // Adicionando firstName e lastName para consistência com o tipo User
                firstName: (userData?.full_name || '').split(' ')[0],
                lastName: (userData?.full_name || '').split(' ').slice(1).join(' '),
            });
        } else {
            setAppUser(null);
        }
      }
      fetchAppUser();
  }, [authUser, supabase]);


  return appUser;
}
