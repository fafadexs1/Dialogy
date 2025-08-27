
'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent } from '@/lib/types';
import { useAuth } from './use-auth';
import { updateUserOnlineStatus } from '@/actions/user';
import { createClient } from '@/lib/supabase/client';

const PresenceContext = createContext<OnlineAgent[]>([]);

export const usePresence = () => {
  return useContext(PresenceContext);
};

export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const currentUser = useAuth();
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);

  const fetchOnlineAgents = useCallback(async (workspaceId: string) => {
      try {
        const response = await fetch(`/api/users/online/${workspaceId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch online users');
        }
        const agents: OnlineAgent[] = await response.json();
        setOnlineAgents(agents);
      } catch (error) {
        console.error("Error fetching online agents:", error);
        setOnlineAgents([]);
      }
    }, []);

  useEffect(() => {
    if (!currentUser?.activeWorkspaceId) return;
    const workspaceId = currentUser.activeWorkspaceId;
    const supabase = createClient();
    fetchOnlineAgents(workspaceId);

    const channel = supabase
      .channel('public:users')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        (payload) => {
            if ('online' in payload.new || 'online_since' in payload.new) {
                fetchOnlineAgents(workspaceId);
            }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.activeWorkspaceId, fetchOnlineAgents]);


  useEffect(() => {
     if (!currentUser?.id) return;
     const userId = currentUser.id;

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

  }, [currentUser?.id]);


  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
