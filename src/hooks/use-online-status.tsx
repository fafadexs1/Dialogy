
'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import type { OnlineAgent } from '@/lib/types';
import { useAuth } from './use-auth';
import { updateUserOnlineStatus } from '@/actions/user';

// 1. Create a Context for the presence state
const PresenceContext = createContext<OnlineAgent[]>([]);

// 2. Create a custom hook to easily access the context
export const usePresence = () => {
  return useContext(PresenceContext);
};

// 3. Create the Provider component
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
        setOnlineAgents([]); // Clear on error
      }
    }, []);

  useEffect(() => {
    if (currentUser?.activeWorkspaceId) {
      const workspaceId = currentUser.activeWorkspaceId;
      // Fetch immediately on mount
      fetchOnlineAgents(workspaceId);

      // Set up an interval to fetch every 30 seconds
      const intervalId = setInterval(() => fetchOnlineAgents(workspaceId), 30000);
      
      // Clean up the interval when the component unmounts
      return () => clearInterval(intervalId);
    }
  }, [currentUser, fetchOnlineAgents]);

  useEffect(() => {
     if (!currentUser?.id) return;
     const userId = currentUser.id;

     const handleVisibilityChange = () => {
        // When the tab becomes visible again, ensure the user is marked as online.
        // We no longer mark them as offline when hidden.
        if (document.visibilityState === 'visible') {
            updateUserOnlineStatus(userId, true);
        }
     }

     const handleBeforeUnload = () => {
        // This is the only place we should mark the user as offline automatically.
        updateUserOnlineStatus(userId, false);
     }
     
     // Set user to online when the provider mounts with a valid user
     updateUserOnlineStatus(userId, true);

     window.addEventListener('beforeunload', handleBeforeUnload);
     document.addEventListener('visibilitychange', handleVisibilityChange);

     return () => {
        // This might not run on tab close, but it's good practice for SPA navigation
        updateUserOnlineStatus(userId, false); 
        window.removeEventListener('beforeunload', handleBeforeUnload);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
     }

  }, [currentUser?.id]);


  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
