'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from 'react';
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
  const [useApiFallback, setUseApiFallback] = useState(false);
  const [presenceBootstrapDone, setPresenceBootstrapDone] = useState(false);
  const sessionOnlineSinceRef = useRef<string | null>(null);
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

  useEffect(() => {
    // Reset per-session tracking when user or workspace changes
    sessionOnlineSinceRef.current = null;
    setUseApiFallback(false);
    setPresenceBootstrapDone(false);

    const loadExistingPresence = async () => {
      if (!localUser?.id || !localUser.activeWorkspaceId) {
        setPresenceBootstrapDone(true);
        return;
      }
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
  }, [localUser?.id, localUser?.activeWorkspaceId, supabase]);

  const persistPresenceViaApi = useCallback(
    async (isOnline: boolean, workspaceId: string) => {
      try {
        const response = await fetch('/api/users/online-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          keepalive: true,
          body: JSON.stringify({ workspaceId, isOnline }),
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
    [localUser?.activeWorkspaceId, localUser?.id, persistPresenceViaApi, supabase, useApiFallback, presenceBootstrapDone]
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
    if (!localUser?.activeWorkspaceId || !localUser.id || !presenceBootstrapDone) return;

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
  }, [localUser?.activeWorkspaceId, localUser?.id, updateServerPresence, refreshOnlineAgents, presenceBootstrapDone]);

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
