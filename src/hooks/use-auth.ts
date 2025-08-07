
'use client';

import { useState, useEffect } from 'react';
import type { User as AppUser } from '@/lib/types';
import { agents } from '@/lib/mock-data';

// This hook centralizes logic for getting the current authenticated user and their app profile.
// MOCK IMPLEMENTATION: This hook returns a mocked user for demonstration purposes.
export function useAuth(): AppUser | null {
  const [appUser, setAppUser] = useState<AppUser | null>(null);

  useEffect(() => {
    // In a real app, you would fetch the user from your auth provider.
    // Here, we simulate it by taking the first agent from mock data.
    const mockAuthenticatedUser = agents[0];
    
    // Simulate fetching profile and workspaces
    const userWithWorkspaces = {
      ...mockAuthenticatedUser,
      workspaces: mockAuthenticatedUser.workspaces || [],
      activeWorkspaceId: mockAuthenticatedUser.activeWorkspaceId || mockAuthenticatedUser.workspaces?.[0]?.id,
    };
    
    setAppUser(userWithWorkspaces);
  }, []);

  return appUser;
}
