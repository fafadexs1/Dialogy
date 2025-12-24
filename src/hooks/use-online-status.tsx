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
  const [useApiFallback, setUseApiFallback] = useState(false);
  const [presenceBootstrapDone, setPresenceBootstrapDone] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const sessionOnlineSinceRef = useRef<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  // Unique Tab ID for multi-tab support
  const tabIdRef = useRef<string>('');
  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Ref to track if we are currently updating to avoid loop
  const isUpdatingRef = useRef(false);

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

  // Sync AuthUser with LocalUser (fetch profile if needed)
  useEffect(() => {
    // 1. Initial User Sync (Server -> Client)
    if (initialUser) {
      setLocalUser(prev => {
        // Strict equality check for IDs to prevent unnecessary updates
        if (prev?.id === initialUser.id && prev?.activeWorkspaceId === initialUser.activeWorkspaceId) {
          return prev;
        }
        return initialUser;
      });
    }

    if (isAuthLoading) return;

    // 2. Fetch Profile if missing (Client fallback)
    if (authUser && !localUser && !initialUser && !isUpdatingRef.current) {
      // Only fetch if we really don't have a user (neither local nor initial)
      const fetchProfile = async () => {
        isUpdatingRef.current = true;
        try {
          const res = await fetch('/api/user');
          if (res.ok) {
            const userData = await res.json();
            setLocalUser(prev => {
              if (prev?.id === userData.id && prev?.activeWorkspaceId === userData.activeWorkspaceId) return prev;
              return userData;
            });
          }
        } catch (error) {
          console.error("PresenceProvider: Failed to fetch user profile.", error);
        } finally {
          isUpdatingRef.current = false;
        }
      };

      // Debounce fetch slightly to avoid race with initialUser effect
      const timer = setTimeout(fetchProfile, 100);
      return () => clearTimeout(timer);
    } else if (!authUser && localUser) {
      // User logged out
      setLocalUser(null);
    }
  }, [authUser, isAuthLoading, initialUser]); // Removed localUser from deps to break loop

  // Track last bootstrapped user to avoid reset loops
  const bootstrappedUserRef = useRef<string | null>(null);

  useEffect(() => {
    const currentUserKey = localUser ? `${localUser.id}-${localUser.activeWorkspaceId}` : 'null';

    if (bootstrappedUserRef.current === currentUserKey && presenceBootstrapDone) {
      // Already bootstrapped for this user, skip.
      return;
    }

    // Reset per-session tracking when user or workspace updates
    sessionOnlineSinceRef.current = null;
    setUseApiFallback(false);

    // Only reset done flag if strictly necessary (different user)
    if (bootstrappedUserRef.current !== currentUserKey) {
      setPresenceBootstrapDone(false);
    }

    const loadExistingPresence = async () => {
      if (isAuthLoading) return;
      if (!localUser?.id || !localUser.activeWorkspaceId) {
        setPresenceBootstrapDone(true);
        bootstrappedUserRef.current = currentUserKey; // Mark processed
        return;
      }

      bootstrappedUserRef.current = currentUserKey; // Mark processed early to block re-entry

      try {
        const { data, error } = await supabase
          .from('user_workspace_presence')
          .select('online_since, is_online, last_seen')
          .eq('user_id', localUser.id)
          .eq('workspace_id', localUser.activeWorkspaceId)
          .maybeSingle();

        if (!error && data?.is_online && data.online_since) {
          sessionOnlineSinceRef.current = data.online_since;
        }
      } catch (error) {
        console.error('PresenceProvider: Failed to load existing presence.', error);
      } finally {
        setPresenceBootstrapDone(true);
      }
    };

    loadExistingPresence();
  }, [localUser?.id, localUser?.activeWorkspaceId, supabase, isAuthLoading]);

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
          console.error('PresenceProvider: Fallback API call failed.', reason);
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
      const userId = localUser.id;

      // Ensure stable session start time without causing re-renders
      let onlineSince = sessionOnlineSinceRef.current;
      if (isOnline && !onlineSince) {
        const nowIso = new Date().toISOString();
        onlineSince = nowIso;
        sessionOnlineSinceRef.current = nowIso;
      } else if (!isOnline) {
        sessionOnlineSinceRef.current = null;
      }

      // If we already know RLS fails, skip it and go straight to API to prevent flickering
      if (useApiFallback) {
        try {
          await persistPresenceViaApi(isOnline, workspaceId);
        } catch (e) {
          console.error("Fallback API also failed", e);
        }
        return;
      }

      try {
        // Direct DB update using RLS
        const payload: Record<string, any> = {
          user_id: userId,
          workspace_id: workspaceId,
          is_online: isOnline,
          last_seen: new Date().toISOString(),
        };

        // Persist session start once per online session; null it when going offline.
        payload.online_since = isOnline ? onlineSince : null;

        const { error } = await supabase.from('user_workspace_presence').upsert(payload, {
          onConflict: 'user_id, workspace_id',
        });

        if (error) {
          console.warn('PresenceProvider: RLS update failed, switching to API fallback.', error.message);
          setUseApiFallback(true);
          // Try API immediately so we don't miss this beat
          await persistPresenceViaApi(isOnline, workspaceId);
        }
      } catch (error) {
        console.error('PresenceProvider: RLS exception, switching to API fallback.', error);
        setUseApiFallback(true);
        await persistPresenceViaApi(isOnline, workspaceId);
      }
    },
    [localUser?.activeWorkspaceId, localUser?.id, persistPresenceViaApi, supabase, useApiFallback, presenceBootstrapDone, isAuthLoading]
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
    if (isAuthLoading || !localUser?.activeWorkspaceId || isPublicPage) return;

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
  }, [refreshOnlineAgents, localUser?.activeWorkspaceId, isPublicPage, pathname, isAuthLoading]);

  // Use refs to track if we've already set up the subscription to avoid dupes/loops
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (isAuthLoading || !localUser?.activeWorkspaceId || !localUser.id || !presenceBootstrapDone) return;

    // Decoupled: Fetch online agents immediately to show the list ASAP
    refreshOnlineAgents();

    // Set self as online in parallel
    updateServerPresence(true);

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
