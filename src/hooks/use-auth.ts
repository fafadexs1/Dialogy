
'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import { useSession } from 'next-auth/react';

async function fetchUserFromApi(userId: string): Promise<User | null> {
    console.log(`--- [USE_AUTH] fetchUserFromApi: Buscando dados da API para o usuário ID: ${userId} ---`);
    try {
        const response = await fetch(`/api/user/${userId}`);
        if (!response.ok) {
            console.error(`[USE_AUTH] fetchUserFromApi: Falha ao buscar usuário. Status: ${response.status}`);
            throw new Error('Failed to fetch user');
        }
        const user = await response.json();
        console.log('[USE_AUTH] fetchUserFromApi: Dados do usuário recebidos da API:', user);
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
        console.log(`--- [USE_AUTH] Hook executado. Status da sessão: ${status} ---`);
        if (status === 'authenticated' && session?.user?.id) {
            console.log(`[USE_AUTH] Sessão autenticada para o usuário ID: ${session.user.id}. Buscando dados completos...`);
            const user = await fetchUserFromApi(session.user.id);
            setAppUser(user);
            if (user) {
              console.log('[USE_AUTH] Estado local do usuário atualizado.');
            } else {
              console.error('[USE_AUTH] Falha ao definir o estado local do usuário, pois a busca na API falhou.');
            }
        } else if (status === 'unauthenticated') {
            console.log('[USE_AUTH] Sessão não autenticada. Limpando usuário local.');
            setAppUser(null);
        }
    }
    
    loadUser();
  }, [session, status]);

  return appUser;
}
