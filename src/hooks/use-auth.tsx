
'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/types';

// DEPRECATED: This hook is no longer in use.
// It has been replaced by passing user data down from Server Components
// or fetching data via API routes when necessary.
export function useAuth(): User | null {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/user');
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Failed to fetch user in useAuth:", error);
        setUser(null);
      }
    };

    fetchUser();
  }, []);

  return user;
}
