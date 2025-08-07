
'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { User, OnlineAgent } from '@/lib/types';
import { useAuth } from './use-auth';
import { db } from '@/lib/db';

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

  useEffect(() => {
    if (!currentUser?.id) return;

    const fetchOnlineAgents = async () => {
      try {
        const { rows } = await db.query('SELECT id, full_name as name, avatar_url as avatar, online FROM users WHERE online = true');
        
        const fetchedAgents: OnlineAgent[] = rows.map((agent: any) => ({
          user: {
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            online: agent.online,
            // Add other required fields for User type, can be null/default if not fetched
            firstName: agent.name.split(' ')[0] || '',
            lastName: agent.name.split(' ').slice(1).join(' ') || '',
          },
          joined_at: new Date().toISOString(), // This can be a fixed value or fetched if available
        }));

        setOnlineAgents(fetchedAgents);
      } catch (error) {
        console.error("Error fetching online agents:", error);
        // Set to empty array on error
        setOnlineAgents([]);
      }
    };
    
    fetchOnlineAgents();
    
    // In a real-time app, you might set up a subscription or polling here
    const interval = setInterval(fetchOnlineAgents, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);

  }, [currentUser]); 

  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
