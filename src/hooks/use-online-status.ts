
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, OnlineAgent } from '@/lib/types';
import { agents } from '@/lib/mock-data'; // Usaremos para obter os dados estáticos do agente

// This hook uses Supabase's Realtime Presence feature for real-time online status.
export function useOnlineStatus(currentUser: User | null): OnlineAgent[] {
  const supabase = createClient();
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  // Use a state with an initializer to ensure the timestamp is set only once per component lifecycle.
  const [joinedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!currentUser?.id) return;

    const channel = supabase.channel('online-agents');

    const updateOnlineStatus = (presenceState: any) => {
        const uniqueUserIds = new Set<string>();
        const presenceUsers: OnlineAgent[] = [];

        for (const id in presenceState) {
            const presences = presenceState[id] as unknown as { user: User, joined_at: string }[];
            presences.forEach(p => {
                if (p.user && !uniqueUserIds.has(p.user.id)) {
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
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        // This can be simplified to just re-syncing the state
        const presenceState = channel.presenceState();
        updateOnlineStatus(presenceState);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
         // This can be simplified to just re-syncing the state
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
      channel.untrack();
      supabase.removeChannel(channel);
    };
  // We add joinedAt to dependency array, though it's stable and won't cause re-runs.
  }, [supabase, currentUser, joinedAt]); 

  return onlineAgents;
}
