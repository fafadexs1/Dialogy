
'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import { useSession } from 'next-auth/react';

async function fetchUserFromApi(userId: string): Promise<User | null> {
    try {
        const response = await fetch(`/api/user/${userId}`);
        if (!response.ok) {
            console.error(`[USE_AUTH] fetchUserFromApi: Falha ao buscar usuário. Status: ${response.status}`);
            throw new Error('Failed to fetch user');
        }
        const user = await response.json();
        return user;
    } catch (error) {
        console.error("[USE_AUTH] fetchUserFromApi: Erro na requisição:", error);
        return null;
    }
}


export function useAuth(): User | null {
  const { data: session, status } = useSession();
  const [appUser, setAppUser] = useState<User | null>(null);

  useEffect(() => {
    async function loadUser() {
        // Se a sessão está autenticada E (ou o usuário local é nulo ou o ID da sessão mudou)
        if (status === 'authenticated' && session?.user?.id && (!appUser || appUser.id !== session.user.id)) {
            const user = await fetchUserFromApi(session.user.id);
            setAppUser(user);
        } else if (status === 'unauthenticated') {
            setAppUser(null);
        }
    }
    
    loadUser();
  }, [session, status, appUser]);

  return appUser;
}
