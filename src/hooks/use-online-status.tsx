

'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

const PresenceContext = createContext<OnlineAgent[]>([]);

export const usePresence = () => {
  return useContext(PresenceContext);
};

export const PresenceProvider = ({ children, initialUser = null }: { children: ReactNode, initialUser?: User | null }) => {
  const [localUser, setLocalUser] = useState<User | null>(initialUser);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const updateServerPresence = useCallback(
    async (isOnline: boolean) => {
      if (!localUser?.activeWorkspaceId) return;

      try {
        await fetch('/api/users/online-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: localUser.activeWorkspaceId, isOnline }),
          keepalive: !isOnline, // keep the offline request alive during tab close
        });
      } catch (error) {
        console.error('PresenceProvider: Failed to persist presence state.', error);
      }
    },
    [localUser?.activeWorkspaceId]
  );

  useEffect(() => {
    if (initialUser) {
      setLocalUser(initialUser);
      return;
    }

    // This effect runs once to get the initial local user data ONLY if not provided.
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/user');
        if (res.ok) {
          const userData = await res.json();
          setLocalUser(userData);
        }
      } catch (error) {
        console.error("PresenceProvider: Failed to fetch initial user.", error);
      }
    };
    fetchUser();
  }, [initialUser]);

  useEffect(() => {
    // This effect establishes the real-time presence connection via Database (user_workspace_presence).
    if (!localUser?.activeWorkspaceId || !localUser.id) return;

    const supabase = createClient();

    // Function to fetch the latest online agents list from the server (DB)
    const refreshOnlineAgents = async () => {
      if (!localUser.activeWorkspaceId) return;
      try {
        // We need to import this dynamically or pass it as a prop if we want to avoid importing server actions directly in hooks if they cause issues, 
        // but Next.js handles server actions in client components/hooks fine.
        // However, since we are inside the hook, let's assume getOnlineAgents is available.
        // We need to import it at the top of the file.
        const { getOnlineAgents } = await import('@/actions/user');
        const agents = await getOnlineAgents(localUser.activeWorkspaceId);
        setOnlineAgents(agents);
      } catch (error) {
        console.error("PresenceProvider: Failed to refresh online agents.", error);
      }
    };

    // Initial fetch
    refreshOnlineAgents();

    // Set self as online immediately
    void updateServerPresence(true);

    const channel = supabase.channel(`db-presence-${localUser.activeWorkspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_workspace_presence',
          filter: `workspace_id=eq.${localUser.activeWorkspaceId}`,
        },
        () => {
          // Whenever the presence table changes for this workspace, refresh the full list.
          // This ensures we always have the correct joined user data.
          refreshOnlineAgents();
        }
      )
      .subscribe();

    return () => {
      // Cleanup
      supabase.removeChannel(channel);
      void updateServerPresence(false);
    };
  }, [localUser?.activeWorkspaceId, localUser?.id, updateServerPresence]);

  useEffect(() => {
    if (!localUser?.id || !localUser.activeWorkspaceId) return;

    const handleBeforeUnload = () => {
      try {
        const payload = JSON.stringify({
          userId: localUser.id,
          workspaceId: localUser.activeWorkspaceId,
        });
        navigator.sendBeacon('/api/users/online', payload);
      } catch (error) {
        console.error('PresenceProvider: Failed to enqueue offline beacon.', error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [localUser?.id, localUser?.activeWorkspaceId]);


  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
