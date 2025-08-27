
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { type User as SupabaseUser } from '@supabase/supabase-js';

// Cache to prevent re-fetching user details on every re-render
let cachedUser: User | null = null;
let lastFetchedUserId: string | null = null;

async function fetchUserDetails(supabaseUser: SupabaseUser): Promise<User | null> {
  const userId = supabaseUser.id;
  if (cachedUser && lastFetchedUserId === userId) {
    return cachedUser;
  }

  try {
    const response = await fetch(`/api/user/${userId}`);
    if (!response.ok) {
      console.error(`[USE_AUTH] fetchUserDetails: Falha ao buscar detalhes do usuário. Status: ${response.status}`);
      throw new Error('Failed to fetch user details');
    }
    const userDetails: User = await response.json();
    cachedUser = userDetails;
    lastFetchedUserId = userId;
    return userDetails;
  } catch (error) {
    console.error("[USE_AUTH] fetchUserDetails: Erro na requisição:", error);
    return null;
  }
}

export function useAuth(): User | null {
  const [appUser, setAppUser] = useState<User | null>(cachedUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const userDetails = await fetchUserDetails(session.user);
        setAppUser(userDetails);
      } else {
        setAppUser(null);
        cachedUser = null;
        lastFetchedUserId = null;
      }
      setLoading(false);
    };

    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const userDetails = await fetchUserDetails(session.user);
          setAppUser(userDetails);
        } else {
          setAppUser(null);
          cachedUser = null;
          lastFetchedUserId = null;
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return appUser;
}
