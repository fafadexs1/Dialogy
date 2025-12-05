'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';

const PresenceContext = createContext<{ onlineAgents: OnlineAgent[], currentUser: User | null }>({ onlineAgents: [], currentUser: null });

export const usePresence = () => {
  const { onlineAgents } = useContext(PresenceContext);
  return onlineAgents;
};

export const useCurrentUser = () => {
  const { currentUser } = useContext(PresenceContext);
  return currentUser;
};

export const PresenceProvider = ({ children, initialUser = null }: { children: ReactNode, initialUser?: User | null }) => {
  const { user: authUser } = useAuth();
  const [localUser, setLocalUser] = useState<User | null>(initialUser);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const supabase = createClient();

  // Sync AuthUser with LocalUser (fetch profile if needed)
  useEffect(() => {
    if (authUser && !localUser) {
      // We have an auth user but no local user profile yet. Fetch it.
      // This is one of the allowed "initial" fetches.
      const fetchProfile = async () => {
        try {
          const res = await fetch('/api/user');
          if (res.ok) {
            const userData = await res.json();
            setLocalUser(userData);
          }
        } catch (error) {
          console.error("PresenceProvider: Failed to fetch user profile.", error);
        }
      };
      fetchProfile();
    } else if (!authUser && localUser) {
      // User logged out
      setLocalUser(null);
    }
  }, [authUser, localUser]);

  const updateServerPresence = useCallback(
    async (isOnline: boolean) => {
      if (!localUser?.activeWorkspaceId || !localUser.id) return;

      try {
        // Direct DB update using RLS - No Auth API calls!
        const { error } = await supabase.from('user_workspace_presence').upsert({
          user_id: localUser.id,
          workspace_id: localUser.activeWorkspaceId,
          is_online: isOnline,
          last_seen: new Date().toISOString(),
          // We don't touch online_since here to avoid resetting it on every heartbeat.
          // If it's a new row, it will be null, which is acceptable for this optimization.
        }, { onConflict: 'user_id, workspace_id' });

        if (error) {
          console.error('PresenceProvider: Failed to update presence via RLS.', error);
        }
      } catch (error) {
        console.error('PresenceProvider: Failed to persist presence state.', error);
      }
    },
    [localUser?.activeWorkspaceId, localUser?.id]
  );

  const refreshOnlineAgents = useCallback(async () => {
    if (!localUser?.activeWorkspaceId) return;
    try {
      const { getOnlineAgents } = await import('@/actions/user');
      const agents = await getOnlineAgents(localUser.activeWorkspaceId);
      setOnlineAgents(agents);
    } catch (error) {
      console.error("PresenceProvider: Failed to refresh online agents.", error);
    }
  }, [localUser?.activeWorkspaceId]);

  const pathname = usePathname();
  const isPublicPage = ['/login', '/register', '/setup', '/', '/creators'].includes(pathname);

  useEffect(() => {
    // Polling effect: Refresh online agents every 3 seconds
    if (!localUser?.activeWorkspaceId || isPublicPage) return;

    let intervalId: NodeJS.Timeout;
    const isDeveloper = pathname.startsWith('/developer');
    const pollInterval = isDeveloper ? 60000 : 3000;

    const initialTimer = setTimeout(() => {
      refreshOnlineAgents();
      intervalId = setInterval(refreshOnlineAgents, pollInterval);
    }, 1000);

    return () => {
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [refreshOnlineAgents, localUser?.activeWorkspaceId, isPublicPage, pathname]);

  useEffect(() => {
    if (!localUser?.activeWorkspaceId || !localUser.id) return;

    // Set self as online immediately and then refresh list
    updateServerPresence(true).then(() => {
      refreshOnlineAgents();
    });

    // HEARTBEAT & ACTIVITY: Ensure user stays online aggressively
    const heartbeatInterval = setInterval(() => {
      updateServerPresence(true);
    }, 10000);

    const handleActivity = () => {
      if (document.visibilityState === 'visible') {
        updateServerPresence(true);
      }
    };

    let lastActivity = 0;
    const throttledActivity = () => {
      const now = Date.now();
      if (now - lastActivity > 5000) {
        lastActivity = now;
        handleActivity();
      }
    };

    window.addEventListener('visibilitychange', handleActivity);
    window.addEventListener('focus', throttledActivity);
    window.addEventListener('click', throttledActivity);
    window.addEventListener('keydown', throttledActivity);

    const channel = supabase.channel(`db-presence-${localUser.activeWorkspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_workspace_presence',
        },
        (payload) => {
          const newData = payload.new as any;
          const oldData = payload.old as any;
          const workspaceId = newData?.workspace_id || oldData?.workspace_id;

          if (workspaceId && workspaceId !== localUser.activeWorkspaceId) {
            return;
          }
          refreshOnlineAgents();
        }
      )
      .subscribe();

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('visibilitychange', handleActivity);
      window.removeEventListener('focus', throttledActivity);
      window.removeEventListener('click', throttledActivity);
      window.removeEventListener('keydown', throttledActivity);

      supabase.removeChannel(channel);
      void updateServerPresence(false);
    };
  }, [localUser?.activeWorkspaceId, localUser?.id, updateServerPresence, refreshOnlineAgents]);

  useEffect(() => {
    if (!localUser?.id || !localUser.activeWorkspaceId) return;

    const handleBeforeUnload = () => {
      try {
        const payload = {
          userId: localUser.id,
          workspaceId: localUser.activeWorkspaceId,
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/users/online', blob);
      } catch (error) {
        console.error('PresenceProvider: Failed to enqueue offline beacon.', error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [localUser?.id, localUser?.activeWorkspaceId]);

  return (
    <PresenceContext.Provider value={{ onlineAgents, currentUser: localUser }}>
      {children}
    </PresenceContext.Provider>
  );
};
