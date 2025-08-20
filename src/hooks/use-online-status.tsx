
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
        if (document.visibilityState === 'visible') {
            updateUserOnlineStatus(userId, true);
        }
     }

     const handleBeforeUnload = () => {
        // Usa navigator.sendBeacon para uma chamada mais confiável ao fechar a página.
        // Ele envia uma pequena quantidade de dados de forma assíncrona, sem atrasar o descarregamento da página.
        const payload = JSON.stringify({ userId });
        navigator.sendBeacon('/api/users/offline', payload);
     }
     
     // Define o usuário como online quando o provedor é montado com um usuário válido.
     updateUserOnlineStatus(userId, true);

     // Adiciona os event listeners
     window.addEventListener('beforeunload', handleBeforeUnload);
     document.addEventListener('visibilitychange', handleVisibilityChange);

     return () => {
        // Limpa os listeners quando o componente é desmontado
        window.removeEventListener('beforeunload', handleBeforeUnload);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        // Opcional: pode-se chamar a função de offline aqui também para cobrir navegações SPA
        updateUserOnlineStatus(userId, false); 
     }

  }, [currentUser?.id]);


  return (
    <PresenceContext.Provider value={onlineAgents}>
      {children}
    </PresenceContext.Provider>
  );
};

    