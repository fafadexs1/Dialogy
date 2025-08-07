
'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, OnlineAgent } from '@/lib/types';
import { useAuth } from './use-auth';

// 1. Create a Context for the presence state
const PresenceContext = createContext<OnlineAgent[]>([]);

// 2. Create a custom hook to easily access the context
export const usePresence = () => {
  return useContext(PresenceContext);
};

// 3. Create the Provider component
export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const supabase = createClient();
  const currentUser = useAuth();
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  // Use a state with an initializer to ensure the timestamp is set only once per provider lifecycle.
  const [joinedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    // Only run if there is a logged-in user
    if (!currentUser?.id) return;

    const channel = supabase.channel('online-agents');

    const updateOnlineStatus = (presenceState: any) => {
        const uniqueUserIds = new Set<string>();
        const presenceUsers: OnlineAgent[] = [];

        for (const id in presenceState) {
            const presences = presenceState[id] as unknown as { user: User, joined_at: string }[];
            presences.forEach(p => {
                if (p.user && p.user.id && !uniqueUserIds.has(p.user.id)) {
                    uniqueUserIds.add(p.user.id);
                    presenceUsers.push({ user: p.user, joined_at: p.joined_at });
                }
            });
        }
        setOnlineAgents(presenceUsers);
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        updateOnlineStatus(presenceState);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track the user with the persistent joined_at timestamp
          await channel.track({ user: currentUser, joined_at: joinedAt });
        }
      });

    return () => {
      // Cleanup on unmount
      channel.untrack();
      supabase.removeChannel(channel);
    };
  // We add joinedAt to dependency array, though it's stable and won't cause re-runs.
  }, [supabase, currentUser, joinedAt]); 

  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
