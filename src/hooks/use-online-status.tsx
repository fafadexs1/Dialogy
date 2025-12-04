

'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { usePathname } from 'next/navigation';

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

  const pathname = usePathname();
  const isPublicPage = ['/login', '/register', '/setup', '/', '/creators'].includes(pathname);

  // Re-fetch user if we are on a private page and don't have a user yet.
  // This handles client-side navigation from login -> inbox.
  useEffect(() => {
    if (!isPublicPage && !localUser && !initialUser) {
      const fetchUser = async () => {
        try {
          const res = await fetch('/api/user');
          if (res.ok) {
            const userData = await res.json();
            setLocalUser(userData);
          }
        } catch (error) {
          console.error("PresenceProvider: Failed to fetch user on route change.", error);
        }
      };
      fetchUser();
    }
  }, [pathname, isPublicPage, localUser, initialUser]);

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



  useEffect(() => {
    // Polling effect: Refresh online agents every 3 seconds
    // Only poll if we have a workspace AND we are not on a public page
    if (!localUser?.activeWorkspaceId || isPublicPage) return;

    // Wait for interface to load (1s), then do a smart refresh, then start polling (3s or 60s)
    let intervalId: NodeJS.Timeout;
    const isDeveloper = pathname.startsWith('/developer');
    const pollInterval = isDeveloper ? 60000 : 3000;

    const initialTimer = setTimeout(() => {
      refreshOnlineAgents(); // Smart refresh after load
      intervalId = setInterval(refreshOnlineAgents, pollInterval);
    }, 1000);

    return () => {
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [refreshOnlineAgents, localUser?.activeWorkspaceId, isPublicPage, pathname]);

  useEffect(() => {
    // This effect establishes the real-time presence connection via Database (user_workspace_presence).
    if (!localUser?.activeWorkspaceId || !localUser.id) return;

    const supabase = createClient();

    // Set self as online immediately and then refresh list
    updateServerPresence(true).then(() => {
      refreshOnlineAgents();
    });

    // HEARTBEAT & ACTIVITY: Ensure user stays online aggressively
    // "FODA" implementation: Heartbeat every 20s + activity triggers
    const heartbeatInterval = setInterval(() => {
      updateServerPresence(true);
    }, 20000);

    const handleActivity = () => {
      if (document.visibilityState === 'visible') {
        // We don't want to spam the server on every click, so we could throttle this if needed.
        // But for now, let's rely on the fact that updateServerPresence is async and relatively cheap.
        // To avoid absolute spam, we can check a timestamp or just let the heartbeat do the heavy lifting,
        // but the user wants it "FODA", so let's ensure we catch them coming back.
        // We'll just call it. The browser limits concurrent requests anyway.
        // Actually, let's throttle it slightly to avoid 100 requests if they rage click.
        // But for simplicity and robustness, we'll just trust the heartbeat mostly, 
        // and use these events to catch "tab switch back" immediately.
        updateServerPresence(true);
      }
    };

    // Throttle the activity handler to run at most once every 5 seconds
    let lastActivity = 0;
    const throttledActivity = () => {
      const now = Date.now();
      if (now - lastActivity > 5000) {
        lastActivity = now;
        handleActivity();
      }
    };

    window.addEventListener('visibilitychange', handleActivity); // Always fire on visibility change
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
          // filter: `workspace_id=eq.${localUser.activeWorkspaceId}`, // Removed due to "invalid column" error
        },
        (payload) => {
          // Client-side filtering
          const newData = payload.new as any;
          const oldData = payload.old as any;
          const workspaceId = newData?.workspace_id || oldData?.workspace_id;

          if (workspaceId && workspaceId !== localUser.activeWorkspaceId) {
            return;
          }

          // Whenever the presence table changes for this workspace, refresh the full list.
          // This ensures we always have the correct joined user data.
          refreshOnlineAgents();
        }
      )
      .subscribe();

    return () => {
      // Cleanup
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
    <PresenceContext.Provider value={{ onlineAgents, currentUser: localUser }}>
      {children}
    </PresenceContext.Provider>
  );
};
