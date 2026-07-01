'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef, useMemo } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { WORKSPACE_CHANGED_EVENT } from '@/components/layout/workspace-switcher';
import { runCacheCleanup, scheduleCacheCleanupOnIdle } from '@/lib/cache';
import { getPresenceHeartbeatIntervalMs } from '@/lib/presence';

const PresenceContext = createContext<{
  onlineAgents: OnlineAgent[],
  currentUser: User | null,
  isOffline: boolean,
  connectionStatus: 'connected' | 'reconnecting' | 'offline'
}>({
  onlineAgents: [],
  currentUser: null,
  isOffline: false,
  connectionStatus: 'connected'
});

export const usePresence = () => {
  const { onlineAgents, isOffline, connectionStatus } = useContext(PresenceContext);
  return { onlineAgents, isOffline, connectionStatus };
};

export const useCurrentUser = () => {
  const { currentUser } = useContext(PresenceContext);
  return currentUser;
};

function buildUserSnapshot(user: User | null | undefined): string {
  if (!user) return 'null';
  const workspaces = (user.workspaces || []).map((workspace) => ({
    id: workspace.id,
    name: workspace.name || '',
    avatar: workspace.avatar || '',
    timezone: workspace.timezone || '',
    closeMessageTemplate: workspace.closeMessageTemplate || '',
    transferTeamMessageTemplate: workspace.transferTeamMessageTemplate || '',
    marketingAutoCloseSeconds: workspace.marketingAutoCloseSeconds ?? null,
    queueAutoCloseSeconds: workspace.queueAutoCloseSeconds ?? null,
  }));

  return JSON.stringify({
    id: user.id,
    avatar: user.avatar || user.avatar_url || '',
    activeWorkspaceId: user.activeWorkspaceId || null,
    themePreference: user.themePreference || null,
    workspaces,
  });
}

export const PresenceProvider = ({ children, initialUser = null }: { children: ReactNode, initialUser?: User | null }) => {
  const { user: authUser, session, isLoading: isAuthLoading } = useAuth();
  const [localUser, setLocalUser] = useState<User | null>(initialUser);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const [presenceBootstrapDone, setPresenceBootstrapDone] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('connected');
  const supabase = useMemo(() => createClient(), []);
  const accessToken = session?.access_token ?? null;

  useEffect(() => {
    setLocalUser((prev) => {
      const prevSnapshot = buildUserSnapshot(prev);
      const nextSnapshot = buildUserSnapshot(initialUser);
      if (prevSnapshot === nextSnapshot) {
        return prev;
      }
      return initialUser ?? null;
    });
  }, [initialUser]);

  // Listen for workspace change events to refetch user data
  useEffect(() => {
    const handleWorkspaceChange = async () => {
      console.log('[PresenceProvider] Workspace changed, refetching user data...');
      // Clear online agents immediately 
      setOnlineAgents([]);

      // Refetch user data from server
      try {
        const res = await fetch('/api/users/me', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            console.log('[PresenceProvider] User refetched, new workspace:', data.user.activeWorkspaceId);
            setLocalUser(data.user);
          }
        }
      } catch (error) {
        console.error('[PresenceProvider] Error refetching user:', error);
      }
    };

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
  }, []);

  // Unique Tab ID for multi-tab support
  const tabIdRef = useRef<string>('');
  if (typeof window !== 'undefined' && !tabIdRef.current) {
    tabIdRef.current = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  const bootstrappedUserRef = useRef<string | null>(null);
  const fetchingUserRef = useRef(false);
  const presenceFailureCountRef = useRef(0);
  const presenceBackoffUntilRef = useRef(0);
  const lastPresenceErrorKeyRef = useRef<string | null>(null);
  const lastPresenceErrorLoggedAtRef = useRef(0);

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

  // Track previous workspace to detect changes and clear stale data
  const previousWorkspaceIdRef = useRef<string | undefined>(undefined);

  // Clear online agents immediately when workspace changes
  useEffect(() => {
    const currentWorkspaceId = localUser?.activeWorkspaceId;

    if (previousWorkspaceIdRef.current !== undefined &&
      previousWorkspaceIdRef.current !== currentWorkspaceId) {
      // Workspace changed - clear old agents immediately
      console.log(`[PresenceProvider] Workspace changed from ${previousWorkspaceIdRef.current} to ${currentWorkspaceId}, clearing agents`);
      setOnlineAgents([]);

      // Clean up cache from old workspace
      runCacheCleanup(previousWorkspaceIdRef.current);
    }

    // Schedule cleanup on idle if first load
    if (previousWorkspaceIdRef.current === undefined && currentWorkspaceId) {
      scheduleCacheCleanupOnIdle();
    }

    previousWorkspaceIdRef.current = currentWorkspaceId;
  }, [localUser?.activeWorkspaceId]);

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

  const logPresenceFailure = useCallback((message: string, details: unknown, errorKey: string) => {
    const now = Date.now();
    if (
      lastPresenceErrorKeyRef.current === errorKey &&
      now - lastPresenceErrorLoggedAtRef.current < 30000
    ) {
      return;
    }

    lastPresenceErrorKeyRef.current = errorKey;
    lastPresenceErrorLoggedAtRef.current = now;
    console.error(message, details);
  }, []);

  const persistPresenceViaApi = useCallback(
    async (isOnline: boolean, workspaceId: string, source: string) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return;
      }

      const now = Date.now();
      if (presenceBackoffUntilRef.current > now) {
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch('/api/users/online-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({ workspaceId, isOnline, tabId: tabIdRef.current, source }),
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const reason = await response.text().catch(() => response.statusText);
          presenceFailureCountRef.current += 1;
          presenceBackoffUntilRef.current =
            Date.now() + Math.min(getPresenceHeartbeatIntervalMs(), 5000 * presenceFailureCountRef.current);
          logPresenceFailure(
            'PresenceProvider: Presence API call failed.',
            { status: response.status, reason, source },
            `http:${response.status}:${source}`
          );
          return;
        }

        presenceFailureCountRef.current = 0;
        presenceBackoffUntilRef.current = 0;
        lastPresenceErrorKeyRef.current = null;
      } catch (apiError) {
        clearTimeout(timeoutId);
        presenceFailureCountRef.current += 1;
        presenceBackoffUntilRef.current =
          Date.now() + Math.min(getPresenceHeartbeatIntervalMs(), 5000 * presenceFailureCountRef.current);

        const isAbortError = apiError instanceof DOMException && apiError.name === 'AbortError';
        logPresenceFailure(
          isAbortError
            ? 'PresenceProvider: Presence API request timed out.'
            : 'PresenceProvider: Failed to persist presence via API.',
          apiError,
          `${isAbortError ? 'timeout' : 'fetch'}:${source}`
        );
      }
    },
    [logPresenceFailure]
  );

  const updateServerPresence = useCallback(
    async (isOnline: boolean, source: string = 'activity') => {
      if (isAuthLoading) return;
      if (!localUser?.activeWorkspaceId || !localUser.id) return;
      if (!presenceBootstrapDone) return;

      const workspaceId = localUser.activeWorkspaceId;
      await persistPresenceViaApi(isOnline, workspaceId, source);
    },
    [localUser?.activeWorkspaceId, localUser?.id, persistPresenceViaApi, presenceBootstrapDone, isAuthLoading]
  );

  // Monitor online/offline status - Enhanced with forced reconnection
  useEffect(() => {
    setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false);

    const handleOnline = () => {
      setIsOffline(false);
      console.log('[PresenceProvider] Browser online, Supabase will auto-reconnect...');
      setConnectionStatus('reconnecting');
      void updateServerPresence(true, 'browser_online');
    };

    const handleOffline = () => {
      setIsOffline(true);
      setConnectionStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [supabase, updateServerPresence]);

  // Debounce ref for refreshOnlineAgents
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshOnlineAgents = useCallback(async () => {
    const workspaceId = localUser?.activeWorkspaceId;
    if (!workspaceId) return;

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/users/online/${workspaceId}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Failed to refresh online agents: ${response.status}`);
        }

        const agents = await response.json();
        setOnlineAgents(Array.isArray(agents) ? agents : []);
      } catch (error) {
        console.error("PresenceProvider: Failed to refresh online agents.", error);
      }
    }, 500); // 500ms trailing debounce
  }, [localUser?.activeWorkspaceId]);

  const pathname = usePathname();
  const isPublicPage = ['/login', '/register', '/setup', '/', '/creators'].includes(pathname);

  useEffect(() => {
    // Polling effect: Refresh online agents every 10 seconds (backup to Realtime)
    // Realtime subscription handles instant updates, polling is just for sync
    if (isAuthLoading || !localUser?.activeWorkspaceId || isPublicPage) return;

    let intervalId: ReturnType<typeof setInterval> | undefined;
    const isDeveloper = pathname.startsWith('/developer');
    // HARDENING: Optimize polling. If connected, relax to 60s. If resetting/offline, aggressive 10s.
    const pollInterval = (connectionStatus === 'connected' && !isDeveloper) ? 60000 : 10000;

    const initialTimer = setTimeout(() => {
      refreshOnlineAgents();
      intervalId = setInterval(refreshOnlineAgents, pollInterval);
    }, 2000); // Delay initial fetch by 2s to let auth settle

    return () => {
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [refreshOnlineAgents, localUser?.activeWorkspaceId, isPublicPage, pathname, isAuthLoading, connectionStatus]);

  // Use refs to track if we've already set up the subscription to avoid dupes/loops
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (isAuthLoading || !localUser?.activeWorkspaceId || !localUser.id || !presenceBootstrapDone || !accessToken) return;

    // Decoupled: Fetch online agents immediately to show the list ASAP
    refreshOnlineAgents();

    // Set self as online in parallel
    updateServerPresence(true, 'bootstrap');

    const heartbeatMs = getPresenceHeartbeatIntervalMs();
    const heartbeatInterval = setInterval(() => {
      updateServerPresence(true, 'heartbeat');
    }, heartbeatMs);

    const handleVisibleActivity = (source: string) => {
      if (document.visibilityState === 'visible') {
        updateServerPresence(true, source);
      }
    };

    let lastActivity = 0;
    const throttledActivity = (source: string) => {
      const now = Date.now();
      if (now - lastActivity > heartbeatMs) {
        lastActivity = now;
        handleVisibleActivity(source);
      }
    };

    const handleVisibility = () => handleVisibleActivity('visibility');
    const handleFocus = () => throttledActivity('focus');
    const handleClick = () => throttledActivity('activity');
    const handleKeydown = () => throttledActivity('activity');
    const handlePageShow = () => updateServerPresence(true, 'manual_recovery');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('pageshow', handlePageShow);

    // Only subscribe if channel not already set up or if workspace changed
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    supabase.realtime.setAuth(accessToken);

    const channel = supabase.channel(`workspace:${localUser.activeWorkspaceId}:presence`, {
      config: {
        private: true,
      },
    })
      .on(
        'broadcast',
        { event: 'presence_changed' },
        () => {
          refreshOnlineAgents();
        }
      )
      .subscribe((status) => {
        console.log(`[PresenceProvider] Realtime status: ${status}`);

        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          refreshOnlineAgents();
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('reconnecting');
        }

        if (status === 'CLOSED') {
          setConnectionStatus(typeof navigator !== 'undefined' && navigator.onLine ? 'reconnecting' : 'offline');
        }
      });

    channelRef.current = channel;

    return () => {
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('pageshow', handlePageShow);

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      // Presence is not forced offline on cleanup because BFCache and internal navigation
      // may tear down effects without meaning the operator actually went away.
    };
  }, [localUser?.activeWorkspaceId, localUser?.id, updateServerPresence, refreshOnlineAgents, presenceBootstrapDone, supabase, isAuthLoading, accessToken]);

  useEffect(() => {
    if (!localUser?.id || !localUser.activeWorkspaceId) return;

    const handleBeforeUnload = () => {
      try {
        // Correct payload for status endpoint with tabId
        const payload = {
          workspaceId: localUser.activeWorkspaceId,
          isOnline: false,
          tabId: tabIdRef.current,
          source: 'beforeunload'
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        // Use the correct endpoint
        navigator.sendBeacon('/api/users/online-status', blob);
      } catch (error) {
        console.error('PresenceProvider: Failed to enqueue offline beacon.', error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [localUser?.id, localUser?.activeWorkspaceId]);

  const contextValue = useMemo(() => ({
    onlineAgents,
    currentUser: localUser,
    isOffline,
    connectionStatus
  }), [onlineAgents, localUser, isOffline, connectionStatus]);

  return (
    <PresenceContext.Provider value={contextValue}>
      {children}
    </PresenceContext.Provider>
  );
};
