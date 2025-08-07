'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { OnlineAgent } from '@/lib/types';
import { useAuth } from './use-auth';

// 1. Create a Context for the presence state
const PresenceContext = createContext<OnlineAgent[]>([]);

// 2. Create a custom hook to easily access the context
export const usePresence = () => {
  return useContext(PresenceContext);
};

// 3. Create the Provider component
// This provider fetches online agents from the API periodically.
export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const currentUser = useAuth();
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);

  useEffect(() => {
    const fetchOnlineAgents = async () => {
      try {
        const response = await fetch('/api/users/online');
        if (!response.ok) {
          throw new Error('Failed to fetch online users');
        }
        const agents: OnlineAgent[] = await response.json();
        setOnlineAgents(agents);
      } catch (error) {
        console.error("Error fetching online agents:", error);
        setOnlineAgents([]); // Clear on error
      }
    };

    if (currentUser) {
      // Fetch immediately on mount
      fetchOnlineAgents();

      // Set up an interval to fetch every 30 seconds
      const intervalId = setInterval(fetchOnlineAgents, 30000);

      // Clean up the interval when the component unmounts
      return () => clearInterval(intervalId);
    }
  }, [currentUser]); 

  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
