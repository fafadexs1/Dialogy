

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
    // This effect establishes the real-time presence connection.
    if (!localUser?.activeWorkspaceId || !localUser.id) return;

    const supabase = createClient();
    const channel = supabase.channel(`workspace-presence-${localUser.activeWorkspaceId}`);

    const updatePresenceState = () => {
      const newState = channel.presenceState<User>();

      // Use a Map to ensure unique user IDs, preventing duplicates from multiple tabs.
      const uniqueAgents = new Map<string, OnlineAgent>();

      Object.values(newState).forEach(presenceArray => {
        const userPresence = presenceArray[0];
        if (userPresence && userPresence.id && !uniqueAgents.has(userPresence.id)) {
          uniqueAgents.set(userPresence.id, {
            user: userPresence,
            joined_at: new Date().toISOString()
          });
        }
      });

      setOnlineAgents(Array.from(uniqueAgents.values()));
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        updatePresenceState();
      })
      .on('presence', { event: 'join' }, () => {
        // A user has joined, refetch the whole state to be safe
        updatePresenceState();
      })
      .on('presence', { event: 'leave' }, () => {
        // A user has left, refetch the whole state to be safe
        updatePresenceState();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Client is subscribed, now track its own presence.
          // Ensure the tracked object has all necessary fields for the UI.
          const presencePayload: User = {
            id: localUser.id,
            name: localUser.name,
            firstName: localUser.firstName,
            lastName: localUser.lastName,
            email: localUser.email,
            avatar: localUser.avatar,
          };
          await channel.track(presencePayload);
          void updateServerPresence(true);
        }
      });

    return () => {
      // Cleanup: leave the channel when the component unmounts.
      channel.untrack();
      supabase.removeChannel(channel);
      void updateServerPresence(false);
    };
  }, [localUser, updateServerPresence]);

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
