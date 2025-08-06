
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User as AuthUser } from '@supabase/supabase-js';
import type { User as AppUser } from '@/lib/types';
import { agents } from '@/lib/mock-data'; // We'll use this to get mock profile data

// This hook centralizes logic for getting the current authenticated user and their app profile.
export function useAuth(): AppUser | null {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setAuthUser(session?.user ?? null);
      }
    );

    // Fetch initial user
    const fetchUser = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        setAuthUser(user);
    }
    fetchUser();

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [supabase.auth]);


  useEffect(() => {
      if (authUser) {
          // In a real app, you would fetch the profile from the `profiles` table.
          // For now, we find the matching agent from our mock data.
          const profile = agents.find(a => a.email === authUser.email);
          if (profile) {
              setAppUser({
                  ...profile,
                  id: authUser.id, // Make sure to use the real UUID from auth
                  name: authUser.user_metadata.full_name || profile.name,
                  email: authUser.email
              });
          } else {
              // Fallback for a user that might not be in the mock `agents` array
              setAppUser({
                  id: authUser.id,
                  firstName: authUser.user_metadata.full_name?.split(' ')[0] || 'User',
                  lastName: authUser.user_metadata.full_name?.split(' ')[1] || '',
                  name: authUser.user_metadata.full_name || 'Usuário',
                  email: authUser.email,
                  avatar: 'https://placehold.co/40x40.png'
              });
          }
      } else {
          setAppUser(null);
      }
  }, [authUser]);


  return appUser;
}
