

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
        // This seems to be returning a Supabase user object, not our extended User type.
        // We need to fetch our user profile.
        if (session?.user) {
            fetch('/api/user').then(res => res.json()).then(data => setLocalUser(data));
        } else {
            setLocalUser(null);
        }
    });

    // Also fetch user on initial load
    fetch('/api/user').then(res => res.json()).then(data => {
        if(data && !data.error) {
             setLocalUser(data);
        }
    }).catch(() => setLocalUser(null));

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

    // Set up real-time subscription for faster updates
    const channel = supabase
      .channel('public:users')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        (payload) => {
            const updatedUser = payload.new as User;
            console.log('[PRESENCE] User online status changed:', updatedUser);

            setOnlineAgents(prevAgents => {
                const agentExists = prevAgents.some(a => a.user.id === updatedUser.id);

                if (updatedUser.online) {
                    // If agent is now online and not in the list, add them.
                    if (!agentExists) {
                         const newAgent: OnlineAgent = {
                            user: {
                                id: updatedUser.id,
                                name: updatedUser.name,
                                firstName: updatedUser.name.split(' ')[0] || '',
                                lastName: updatedUser.name.split(' ').slice(1).join(' ') || '',
                                avatar: updatedUser.avatar_url,
                                email: updatedUser.email,
                            },
                            joined_at: new Date().toISOString()
                        };
                        return [...prevAgents, newAgent];
                    }
                } else {
                    // If agent is now offline, remove them from the list.
                    return prevAgents.filter(a => a.user.id !== updatedUser.id);
                }
                // If no change in list composition, return previous state.
                return prevAgents;
            });
        }
      )
      .subscribe();

    return () => {
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
