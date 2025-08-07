'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { User, OnlineAgent } from '@/lib/types';
import { useAuth } from './use-auth';
import { agents } from '@/lib/mock-data';

// 1. Create a Context for the presence state
const PresenceContext = createContext<OnlineAgent[]>([]);

// 2. Create a custom hook to easily access the context
export const usePresence = () => {
  return useContext(PresenceContext);
};

// 3. Create the Provider component
// MOCK IMPLEMENTATION: This provider simulates online status for mock agents.
export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const currentUser = useAuth();
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);

  useEffect(() => {
    // Simulate fetching online agents. In a real app, this would come from a presence service.
    const mockOnlineAgents: OnlineAgent[] = agents
      .filter(agent => agent.online)
      .map(agent => ({
        user: agent,
        joined_at: new Date().toISOString(),
      }));

    setOnlineAgents(mockOnlineAgents);

    // No actual subscription needed for mock
  }, [currentUser]); 

  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};
