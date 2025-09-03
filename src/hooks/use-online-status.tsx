

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

    channel
      .on('presence', { event: 'sync' }, () => {
        // 'sync' event is called when the client first connects to the channel
        // and gives you the whole list of presences.
        const newState = channel.presenceState<User>();
        const agents: OnlineAgent[] = Object.values(newState).map(presence => ({
            user: presence[0],
            joined_at: new Date().toISOString() // We can mock this or improve later
        }));
        setOnlineAgents(agents);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        // A new user has joined the channel.
        setOnlineAgents(prevAgents => {
            const newAgents: OnlineAgent[] = newPresences.map(p => ({ user: p, joined_at: new Date().toISOString()}));
            // Avoid duplicates
            return [...prevAgents.filter(a => !newAgents.some(na => na.user.id === a.user.id)), ...newAgents];
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        // A user has left the channel.
        const leftUserIds = leftPresences.map(p => p.id);
        setOnlineAgents(prevAgents => prevAgents.filter(a => !leftUserIds.includes(a.user.id)));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Client is subscribed, now track its own presence.
          await channel.track(localUser);
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
