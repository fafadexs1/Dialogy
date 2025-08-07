
'use client';

import { useState, useEffect } from 'react';
import type { User, Workspace } from '@/lib/types';
import { db } from '@/lib/db'; // We can't use db directly on client, this needs an API route.

async function fetchUserFromApi(userId: string): Promise<User | null> {
    // In a real app, this would be an API call to a secure endpoint
    // For now, we are creating a temporary mock function that simulates the fetch
    // because we can't directly query the DB from the client.
    try {
        // This is a placeholder for where you would make an API call
        // e.g., const response = await fetch('/api/user/me');
        // Since we don't have API routes set up for this yet, we'll simulate the behavior.

        // MOCK IMPLEMENTATION of the API call's result
        if (userId === '8f5a948d-9b37-41d3-ac8f-0797282b9e6f') {
             const user: User = {
                id: '8f5a948d-9b37-41d3-ac8f-0797282b9e6f',
                name: 'Alex Johnson',
                firstName: 'Alex',
                lastName: 'Johnson',
                avatar: 'https://placehold.co/40x40.png',
                email: 'agent@dialogy.com',
                workspaces: [
                    { id: 'ws-1', name: 'Dialogy Inc.', avatar: 'https://placehold.co/40x40.png' },
                ],
                activeWorkspaceId: 'ws-1',
            };
            return Promise.resolve(user);
        }
       return Promise.resolve(null);

    } catch (error) {
        console.error("Error fetching user data:", error);
        return null;
    }
}


export function useAuth(): User | null {
  const [appUser, setAppUser] = useState<User | null>(null);

  useEffect(() => {
    // MOCK: Hardcoding user ID for demonstration. In a real app, this would come from an auth session.
    const mockUserId = '8f5a948d-9b37-41d3-ac8f-0797282b9e6f'; 
    
    async function loadUser() {
        if (mockUserId) {
            const user = await fetchUserFromApi(mockUserId);
            setAppUser(user);
        }
    }
    
    loadUser();
  }, []);

  return appUser;
}
