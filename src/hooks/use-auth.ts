
'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import { useSession } from 'next-auth/react';

async function fetchUserFromApi(userId: string): Promise<User | null> {
    // In a real app, this would be an API call to a secure endpoint
    // For now, we are creating a temporary mock function that simulates the fetch
    // because we can't directly query the DB from the client.
    try {
        // This is a placeholder for where you would make an API call
        // e.g., const response = await fetch(`/api/user/${userId}`);
        const response = await fetch(`/api/user/${userId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch user');
        }
        const user = await response.json();
        return user;
    } catch (error) {
        console.error("Error fetching user data:", error);
        return null;
    }
}


export function useAuth(): User | null {
  const { data: session, status } = useSession();
  const [appUser, setAppUser] = useState<User | null>(null);

  useEffect(() => {
    async function loadUser() {
        if (status === 'authenticated' && session?.user?.id) {
            // NOTE: We could store the full user object in the session token
            // to avoid this extra fetch, but this approach ensures data is always fresh.
            const user = await fetchUserFromApi(session.user.id);
            setAppUser(user);
        } else {
            setAppUser(null);
        }
    }
    
    loadUser();
  }, [session, status]);

  return appUser;
}
