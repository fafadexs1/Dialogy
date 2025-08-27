

'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { User } from '@/lib/types';

// A new context to provide the user object throughout the client components
const AuthContext = createContext<User | null>(null);

export function useAuth(): User | null {
  return useContext(AuthContext);
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      // Assuming you have a function to get the current user's full data
      // This would typically be an API call
      try {
        const res = await fetch('/api/user'); // A new API route to get user data
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null)
      }
    };

    // This is a placeholder, a real app would likely check for a session token
    // and fetch the user if one exists. For now, we simulate this.
    // The actual user data will be injected at the page level for initial render.
    // This client-side fetch is for subsequent navigation.

    // A better approach for client-side updates might involve Supabase's onAuthStateChange
    // to trigger a re-fetch.
    
  }, []);

  return (
    <AuthContext.Provider value={user}>
      {children}
    </AuthContext.Provider>
  );
};
