

'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

const PresenceContext = createContext<OnlineAgent[]>([]);

export const usePresence = () => {
  return useContext(PresenceContext);
};

export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const [localUser, setLocalUser] = useState<User | null>(null);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);

  useEffect(() => {
    // This effect runs once to get the initial local user data.
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
  }, []);

  useEffect(() => {
    // This effect establishes the real-time presence connection.
    if (!localUser?.activeWorkspaceId || !localUser.id) return;

    const supabase = createClient();
    const channel = supabase.channel(`workspace-presence-${localUser.activeWorkspaceId}`);

    const updatePresenceState = () => {
        const newState = channel.presenceState<User>();
        const agents: OnlineAgent[] = Object.values(newState).map(presence => ({
            user: presence[0],
            joined_at: new Date().toISOString()
        }));
        setOnlineAgents(agents);
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
        }
      });

    return () => {
        // Cleanup: leave the channel when the component unmounts.
        channel.untrack();
        supabase.removeChannel(channel);
    };
  }, [localUser]);


  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
