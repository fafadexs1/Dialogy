'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef, useMemo } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';

const PresenceContext = createContext<{ onlineAgents: OnlineAgent[], currentUser: User | null, isOffline: boolean }>({ onlineAgents: [], currentUser: null, isOffline: false });

export const usePresence = () => {
  const { onlineAgents, isOffline } = useContext(PresenceContext);
  return { onlineAgents, isOffline };
};

export const useCurrentUser = () => {
  const { currentUser } = useContext(PresenceContext);
  return currentUser;
};

export const PresenceProvider = ({ children, initialUser = null }: { children: ReactNode, initialUser?: User | null }) => {
  const { user: authUser, isLoading: isAuthLoading } = useAuth();
  const [localUser, setLocalUser] = useState<User | null>(initialUser);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const [presenceBootstrapDone, setPresenceBootstrapDone] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  // Unique Tab ID for multi-tab support
  const tabIdRef = useRef<string>('');
  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Ref to track if we are currently updating to avoid loop
  const isUpdatingRef = useRef(false);
  const bootstrappedUserRef = useRef<string | null>(null);
  const fetchingUserRef = useRef(false);

  // ✅ Sync localUser when authUser becomes available but localUser is null
  // This handles the case where server renders with initialUser=null (session not synced yet)
  // but the client has a valid auth session after login
  // 🔄 Added retry with delay for cold start scenarios where session isn't propagated yet
  useEffect(() => {
    if (isAuthLoading) return;
    if (localUser) return; // Already have user data
    if (!authUser) return; // No auth session
    if (fetchingUserRef.current) return; // Already fetching

    fetchingUserRef.current = true;

    const fetchUserWithRetry = async (attempt: number = 1): Promise<void> => {
      const maxAttempts = 3;
      const delay = attempt * 500; // 500ms, 1000ms, 1500ms

      try {
        const res = await fetch('/api/users/me', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setLocalUser(data.user);
            return;
          }
        }

        // If user is null or request failed, retry with delay
        if (attempt < maxAttempts) {
          console.log(`[PresenceProvider] User not found on attempt ${attempt}, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          return fetchUserWithRetry(attempt + 1);
        } else {
          console.warn(`[PresenceProvider] Failed to fetch user after ${maxAttempts} attempts.`);
        }
      } catch (err) {
        console.error('[PresenceProvider] Error fetching user profile:', err);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, delay));
          return fetchUserWithRetry(attempt + 1);
        }
      }
    };

    fetchUserWithRetry().finally(() => {
      fetchingUserRef.current = false;
    });
  }, [authUser, localUser, isAuthLoading]);

  // Monitor online/offline status
  useEffect(() => {
    // Initial check
    setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const currentUserKey = localUser ? `${localUser.id}-${localUser.activeWorkspaceId}` : 'null';

    if (bootstrappedUserRef.current === currentUserKey && presenceBootstrapDone) {
      return;
    }

    if (bootstrappedUserRef.current !== currentUserKey) {
      setPresenceBootstrapDone(false);
    }

    if (isAuthLoading) return;

    if (!localUser?.id || !localUser.activeWorkspaceId) {
      setPresenceBootstrapDone(true);
      bootstrappedUserRef.current = currentUserKey;
      return;
    }

    bootstrappedUserRef.current = currentUserKey;
    setPresenceBootstrapDone(true);
  }, [localUser?.id, localUser?.activeWorkspaceId, isAuthLoading]);

  const persistPresenceViaApi = useCallback(
    async (isOnline: boolean, workspaceId: string) => {
      try {
        const response = await fetch('/api/users/online-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          keepalive: true,
          body: JSON.stringify({ workspaceId, isOnline, tabId: tabIdRef.current }),
        });

        if (!response.ok) {
          const reason = await response.text().catch(() => response.statusText);
          console.error('PresenceProvider: Presence API call failed.', reason);
        }
      } catch (apiError) {
        console.error('PresenceProvider: Failed to persist presence via API.', apiError);
      }
    },
    []
  );

  const updateServerPresence = useCallback(
    async (isOnline: boolean) => {
      if (isAuthLoading) return;
      if (!localUser?.activeWorkspaceId || !localUser.id) return;
      if (!presenceBootstrapDone) return;

      const workspaceId = localUser.activeWorkspaceId;
      await persistPresenceViaApi(isOnline, workspaceId);
    },
    [localUser?.activeWorkspaceId, localUser?.id, persistPresenceViaApi, presenceBootstrapDone, isAuthLoading]
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
    // Polling effect: Refresh online agents every 10 seconds (backup to Realtime)
    // Realtime subscription handles instant updates, polling is just for sync
    if (isAuthLoading || !localUser?.activeWorkspaceId || isPublicPage) return;

    let intervalId: NodeJS.Timeout;
    const isDeveloper = pathname.startsWith('/developer');
    const pollInterval = isDeveloper ? 60000 : 10000; // 10 seconds normal, 1 minute for developer

    const initialTimer = setTimeout(() => {
      refreshOnlineAgents();
      intervalId = setInterval(refreshOnlineAgents, pollInterval);
    }, 2000); // Delay initial fetch by 2s to let auth settle

    return () => {
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [refreshOnlineAgents, localUser?.activeWorkspaceId, isPublicPage, pathname, isAuthLoading]);

  // Use refs to track if we've already set up the subscription to avoid dupes/loops
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (isAuthLoading || !localUser?.activeWorkspaceId || !localUser.id || !presenceBootstrapDone) return;

    // Decoupled: Fetch online agents immediately to show the list ASAP
    refreshOnlineAgents();

    // Set self as online in parallel
    updateServerPresence(true);

    // HEARTBEAT: Ensure user stays online (30 seconds - balance between responsiveness and requests)
    const heartbeatInterval = setInterval(() => {
      updateServerPresence(true);
    }, 30000); // 30 seconds

    const handleActivity = () => {
      if (document.visibilityState === 'visible') {
        updateServerPresence(true);
      }
    };

    let lastActivity = 0;
    const throttledActivity = () => {
      const now = Date.now();
      if (now - lastActivity > 30000) { // 30 seconds throttle (was 5s)
        lastActivity = now;
        handleActivity();
      }
    };

    window.addEventListener('visibilitychange', handleActivity);
    window.addEventListener('focus', throttledActivity);
    window.addEventListener('click', throttledActivity);
    window.addEventListener('keydown', throttledActivity);

    // Only subscribe if channel not already set up or if workspace changed
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`db-presence-${localUser.activeWorkspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_workspace_presence',
          filter: `workspace_id=eq.${localUser.activeWorkspaceId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          const oldData = payload.old as any;
          const workspaceId = newData?.workspace_id || oldData?.workspace_id;

          if (workspaceId && workspaceId !== localUser.activeWorkspaceId) {
            return;
          }

          // Optimization: Ignore heartbeat updates (only last_seen changed)
          // We only trigger a refresh if the user matches our workspace AND:
          // 1. It's an INSERT (new user online)
          // 2. It's a DELETE (user went offline)
          // 3. It's an UPDATE where 'is_online' changed
          if (payload.eventType === 'UPDATE') {
            if (newData.is_online === oldData.is_online) {
              return;
            }
          }

          // Immediately refresh - Realtime already handles the push, just sync state
          refreshOnlineAgents();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('visibilitychange', handleActivity);
      window.removeEventListener('focus', throttledActivity);
      window.removeEventListener('click', throttledActivity);
      window.removeEventListener('keydown', throttledActivity);

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      // REMOVED: void updateServerPresence(false); 
      // We do NOT want to set offline on component re-render or internal navigation.
      // We rely on the `beforeunload` beacon for tab close, and 
      // `last_seen` timestamp timeout on the server (if implemented) or just 
      // letting the next heartbeat pick it up if it was a refresh.
    };
  }, [localUser?.activeWorkspaceId, localUser?.id, updateServerPresence, refreshOnlineAgents, presenceBootstrapDone, supabase, isAuthLoading]);

  useEffect(() => {
    if (!localUser?.id || !localUser.activeWorkspaceId) return;

    const handleBeforeUnload = () => {
      try {
        // Correct payload for status endpoint with tabId
        const payload = {
          workspaceId: localUser.activeWorkspaceId,
          isOnline: false,
          tabId: tabIdRef.current
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        // Use the correct endpoint
        navigator.sendBeacon('/api/users/online-status', blob);
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

  const contextValue = useMemo(() => ({
    onlineAgents,
    currentUser: localUser,
    isOffline
  }), [onlineAgents, localUser, isOffline]);

  return (
    <PresenceContext.Provider value={contextValue}>
      {children}
    </PresenceContext.Provider>
  );
};
