'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data';

// This hook simulates a WebSocket connection for real-time online status.
export function useOnlineStatus() {
  // Initialize with a random subset of agents being online.
  const [onlineAgents, setOnlineAgents] = useState<User[]>(() => 
    agents.filter(() => Math.random() > 0.5)
  );

  useEffect(() => {
    // Simulate receiving WebSocket messages every 5 seconds.
    const interval = setInterval(() => {
      // Create a new list of online agents based on random status.
      // In a real WebSocket implementation, this would be the list from the server.
      const updatedOnlineAgents = agents.filter(agent => {
        // If an agent is currently online, they have a 70% chance of staying online.
        const isCurrentlyOnline = onlineAgents.some(onlineAgent => onlineAgent.id === agent.id);
        if (isCurrentlyOnline) {
          return Math.random() > 0.3; 
        }
        // If an agent is offline, they have a 20% chance of coming online.
        return Math.random() > 0.8; 
      });
      
      setOnlineAgents(updatedOnlineAgents);
    }, 5000); // Update every 5 seconds

    // Clean up the interval when the component unmounts.
    return () => clearInterval(interval);
  }, [onlineAgents]); // Re-run effect when onlineAgents changes to have the latest state in the closure

  return onlineAgents;
}
