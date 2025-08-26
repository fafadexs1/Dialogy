
'use client';

import { useState, useEffect, useCallback } from 'react';
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

  const loadUser = useCallback(async () => {
    if (status === 'authenticated' && session?.user?.id) {
        const user = await fetchUserFromApi(session.user.id);
        setAppUser(user);
    } else if (status === 'unauthenticated') {
        setAppUser(null);
    }
  }, [session, status]);

  useEffect(() => {
    // Only load user if the user is not set or the session ID has changed
    if (!appUser || (session?.user?.id && appUser.id !== session.user.id)) {
      loadUser();
    }
  }, [session, appUser, loadUser]);

  return appUser;
}
