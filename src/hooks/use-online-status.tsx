

'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent, User } from '@/lib/types';
import { updateUserOnlineStatus, getOnlineAgents } from '@/actions/user';
import { createClient } from '@/lib/supabase/client';

const PresenceContext = createContext<OnlineAgent[]>([]);

export const usePresence = () => {
  return useContext(PresenceContext);
};

export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const [localUser, setLocalUser] = useState<User | null>(null);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      setLocalUser(session?.user as User ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchOnlineAgentsCallback = useCallback(async (workspaceId: string) => {
      try {
        const agents = await getOnlineAgents(workspaceId);
        setOnlineAgents(agents);
      } catch (error) {
        console.error("Error fetching online agents:", error);
        setOnlineAgents([]);
      }
    }, []);

  useEffect(() => {
    if (!localUser?.activeWorkspaceId) return;
    const workspaceId = localUser.activeWorkspaceId;
    const supabase = createClient();
    
    // Initial fetch
    fetchOnlineAgentsCallback(workspaceId);

    // Set up polling every 2 seconds
    const intervalId = setInterval(() => {
      fetchOnlineAgentsCallback(workspaceId);
    }, 2000);

    // Set up real-time subscription for faster updates
    const channel = supabase
      .channel('public:users')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        (payload) => {
            if ('online' in payload.new || 'online_since' in payload.new) {
                fetchOnlineAgentsCallback(workspaceId);
            }
        }
      )
      .subscribe();

    return () => {
      clearInterval(intervalId); // Clear interval on cleanup
      supabase.removeChannel(channel);
    };
  }, [localUser?.activeWorkspaceId, fetchOnlineAgentsCallback]);


  useEffect(() => {
     if (!localUser?.id) return;
     const userId = localUser.id;

     const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            updateUserOnlineStatus(userId, true);
        }
     }

     const handleBeforeUnload = () => {
        const payload = JSON.stringify({ userId });
        navigator.sendBeacon('/api/users/offline', payload);
     }
     
     updateUserOnlineStatus(userId, true);

     window.addEventListener('beforeunload', handleBeforeUnload);
     document.addEventListener('visibilitychange', handleVisibilityChange);

     return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        updateUserOnlineStatus(userId, false); 
     }

  }, [localUser?.id]);


  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
